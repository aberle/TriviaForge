/**
 * After a round ends, the presenter reviews it before anyone sees results: every typed answer the
 * grader marked wrong is listed so false negatives can be counted as correct. Players and the display
 * only see "checking the answers" until the presenter finishes the review. The screen always
 * appears, even when there is nothing to check.
 */

import { runSuite, Q, BASE, pick, submitAnswers, sleep, getRoomCode } from './lib/harness.js';

const TITLE = `Reviewing ${Date.now().toString(36)}`;

await runSuite(
  'presenter round review',
  {
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Typed answers', timeLimitSeconds: null }, { title: 'Multiple choice', timeLimitSeconds: null }],
      questions: [
        Q.sa('What is the capital of the Netherlands?', ['Amsterdam'], 0),
        Q.sa('Name the largest planet in our solar system', ['Jupiter'], 0),
        Q.mc('What is the capital of France?', ['Paris', 'Rome'], 0, 1),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1, 1),
      ],
    },
    timeoutMs: 180000,
  },
  async ({ ok, section, env }) => {
    const presenter = await env.adminPage('/presenter');
    await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.includes(${JSON.stringify(TITLE)}))`);
    await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)})); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(200);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    const room = await getRoomCode(presenter);
    const ann = await env.player('Ann', { room });
    const bob = env.bot();
    const cy = env.bot();
    bob.emit('joinRoom', { roomCode: room, username: 'bob_rv', displayName: 'Bob', playerID: bob.playerID });
    cy.emit('joinRoom', { roomCode: room, username: 'cy_rv', displayName: 'Cy', playerID: cy.playerID });
    await presenter.waitText('Connected (3)'); // this room's own list (other rooms in the sidebar also say "N player(s)")

    // End Round; if some players haven't submitted the presenter is asked to confirm first
    const endRound = async () => {
      await presenter.clickText('End Round');
      await sleep(500);
      if (await presenter.visible('.dialog-buttons')) await presenter.clickText('Confirm', '.dialog-buttons button');
      await presenter.waitText('Finish Review');
    };

    const review = (sel) => presenter.eval(`(() => { const p = document.querySelector('.rd-review'); return p ? (${sel})(p) : null; })()`);
    const entries = () => review(`(p) => [...p.querySelectorAll('.rd-review-entry')].map((e) => ({ name: e.querySelector('.rd-review-player').innerText, answer: e.querySelector('.rd-review-answer').innerText, accepted: e.classList.contains('accepted'), button: e.querySelector('button').innerText.trim() }))`);

    section('Round one: typed answers');
    await presenter.clickText('Start');
    await ann.waitText('Round 1 of 2');
    bob.emit('submitRound', { roomCode: room, roundIndex: 0, answers: ['Amsterdam', 'Saturn'] });
    cy.emit('submitRound', { roomCode: room, roundIndex: 0, answers: ['Rotterdam', null] });
    // Ann types "Mokum" (a nickname of Amsterdam: right, but not what the grader knows) and "Jupiter"
    await ann.eval(`(() => { const inputs = document.querySelectorAll('.short-answer-input'); [['Mokum', 0], ['Jupiter', 1]].forEach(([text, i]) => { inputs[i].value = text; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); }); return true; })()`);
    await ann.waitText('2 / 2 answered');
    await submitAnswers(ann);
    await presenter.waitFor(`/^\\s*3 of/.test(document.querySelector('.rd-progress-text')?.innerText || '')`, { timeout: 15000 }).catch((err) => {
      throw new Error(`${err.message} (Bob's replies: ${JSON.stringify(bob.all('roundSubmitted'))}, Cy's: ${JSON.stringify(cy.all('roundSubmitted'))}, Bob got roundStarted: ${bob.all('roundStarted').length})`);
    }); // all three have submitted
    await endRound();

    section('The presenter checks the answers');
    const listed = await entries();
    ok('every typed answer the grader marked wrong is listed with who typed it', listed.length === 3 && ['Ann:"Mokum"', 'Cy:"Rotterdam"', 'Bob:"Saturn"'].every((x) => listed.some((e) => `${e.name}:${e.answer}` === x)), JSON.stringify(listed));
    ok('answers the grader accepted (Bob\'s Amsterdam, Ann\'s Jupiter) and blanks are not listed', !listed.some((e) => /Amsterdam|Jupiter/.test(e.answer)) && listed.length === 3);
    ok('each question shows its accepted answers', await review(`(p) => /Accepted:\\s*Amsterdam/.test(p.innerText) && /Accepted:\\s*Jupiter/.test(p.innerText)`));

    section('Meanwhile, everyone else');
    await ann.waitText('checking the answers');
    ok('the player is told the answers are being checked and sees no results', (await ann.has('checking the answers')) && !(await ann.has('this round')) && !(await ann.visible('.round-leaderboard')));
    await sleep(400);
    ok('and the results are not on the wire either', bob.all('roundEnded').length === 0);
    const late = env.bot();
    const lateMark = late.mark();
    late.emit('joinRoom', { roomCode: room, username: 'late_rv', displayName: 'Late', playerID: late.playerID });
    const lateState = await late.waitFor('roundState', { since: lateMark });
    ok('a player joining now is told the round is in review, without any answers', lateState.phase === 'review' && lateState.review?.items === undefined && !/Amsterdam|Jupiter/.test(JSON.stringify(lateState)), JSON.stringify(lateState).slice(0, 200));

    section('Counting an answer as correct');
    await presenter.eval(`[...document.querySelectorAll('.rd-review-entry')].find((e) => /Ann/.test(e.innerText)).querySelector('button').click(); true`);
    await presenter.waitFor(`[...document.querySelectorAll('.rd-review-entry')].some((e) => /Ann/.test(e.innerText) && e.classList.contains('accepted'))`, { timeout: 6000 });
    let after = await entries();
    ok('the answer is marked as counted correct, with an undo', after.find((e) => e.name === 'Ann').accepted && /undo/i.test(after.find((e) => e.name === 'Ann').button), JSON.stringify(after));
    ok('the other answers are untouched', after.filter((e) => e.accepted).length === 1);
    await presenter.clickText('Counted correct (undo)');
    await presenter.waitFor(`![...document.querySelectorAll('.rd-review-entry')].some((e) => e.classList.contains('accepted'))`, { timeout: 6000 });
    ok('undoing puts it back', (await entries()).every((e) => !e.accepted));
    await presenter.eval(`[...document.querySelectorAll('.rd-review-entry')].find((e) => /Ann/.test(e.innerText)).querySelector('button').click(); true`);
    await presenter.waitFor(`[...document.querySelectorAll('.rd-review-entry')].some((e) => /Ann/.test(e.innerText) && e.classList.contains('accepted'))`, { timeout: 6000 });

    ok("still nothing has reached the player", (await ann.has('checking the answers')) && bob.all('roundEnded').length === 0);

    section('Re-opening the round');
    // Bob's "Saturn" is counted correct too; he will not change it
    await presenter.eval(`[...document.querySelectorAll('.rd-review-entry')].find((e) => /Bob/.test(e.innerText)).querySelector('button').click(); true`);
    await presenter.waitFor(`[...document.querySelectorAll('.rd-review-entry')].some((e) => /Bob/.test(e.innerText) && e.classList.contains('accepted'))`, { timeout: 6000 });
    await presenter.clickText('Re-open Round');
    await presenter.waitText('Re-open this round?');
    await presenter.clickText('Confirm', '.dialog-buttons button');
    await ann.waitText('Round 1 of 2');
    await ann.waitFor(`document.querySelectorAll('.short-answer-input').length === 2 && document.querySelectorAll('.short-answer-input')[0].value !== ''`, { timeout: 8000 });
    ok('players get their questions back with the answers they gave, already submitted', (await ann.eval(`[...document.querySelectorAll('.short-answer-input')].map((i) => i.value).join()`)) === 'Mokum,Jupiter' && (await ann.has('Answers submitted!')));
    ok('and are told the presenter re-opened it', await ann.has('re-opened the round'));
    ok('the presenter is back on the live round: everyone who had answers counts as submitted (3 of the 4 in the room), it can be ended, and a countdown offered (no time limit now)', (await presenter.has('End Round')) && (await presenter.has('3 of 4 players have submitted')) && (await presenter.has('Auto-end in')));
    ok('other players get it too, with their own submitted answers', bob.all('roundState').at(-1).phase === 'open' && Array.isArray(bob.all('roundState').at(-1).current.you.submittedAnswers));
    // Ann changes her answer to one the grader accepts, and resubmits
    await ann.eval(`(() => { const input = document.querySelectorAll('.short-answer-input')[0]; input.value = 'Amsterdam'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await ann.waitText('Submit Updated Answers');
    await ann.clickText('Submit Updated Answers');
    await ann.waitText('Updated answers submitted');
    await endRound();
    await presenter.waitText('Finish Review');
    const second = await entries();
    ok("in the second review Ann's changed answer is accepted by the grader (not listed), the others are still there", !second.some((e) => e.name === 'Ann') && second.some((e) => e.name === 'Cy' && !e.accepted), JSON.stringify(second));
    ok("Bob's unchanged answer is still counted correct: the grade the presenter settled is kept", second.some((e) => e.name === 'Bob' && e.accepted), JSON.stringify(second));

    await presenter.clickText('Finish Review');
    await ann.waitText('this round');
    ok("Ann's result is 2 of 2 (her changed answer, and Jupiter)", await ann.has('2 / 2'));
    ok('and the leaderboard has her level with Bob in first place (Ann 2, Bob 2, Cy 0)', await ann.eval(`document.querySelector('.leaderboard-row.is-you')?.innerText.includes('1')`));

    section('Live Standings remembers the grade that was kept');
    await presenter.clickText('Standings', '.btn-standings');
    await presenter.waitText('Question Breakdown');
    await sleep(500);
    await presenter.eval(`document.querySelectorAll('.modal-overlay .player-answers-header').forEach((h) => h.click()); true`);
    await sleep(300);
    const edited = (q, who) => presenter.eval(`[...document.querySelectorAll('.modal-overlay .question-detail:nth-of-type(${q}) .player-response')].find((r) => /${who}/.test(r.innerText)).innerText.includes('edited')`);
    ok("Bob's counted-correct answer is tagged as edited", await edited(2, 'Bob'));
    ok("Ann's is not: she changed that answer, so the old grade no longer applied", !(await edited(1, 'Ann')));
    await presenter.eval(`document.querySelector('.modal-close-btn').click(); true`);

    section('Round two: nothing to check, the review still appears');
    await presenter.clickText('Start');
    await ann.waitText('Round 2 of 2');
    await pick(ann, 0, 'Paris');
    await pick(ann, 1, 'Eight');
    await submitAnswers(ann);
    await endRound(); // the other players never submitted, so there is a confirmation first
    ok('the review screen appears even though there are no typed answers', (await presenter.has('nothing to review')) && (await presenter.count('.rd-review-entry')) === 0);
    ok("...and the presenter can't complete the quiz until it is finished", !(await presenter.has('Complete Quiz & Save')));
    await presenter.clickText('Finish Review');
    await ann.waitText('this round');
    await presenter.waitText('Complete Quiz');
    ok('finishing it sends the results and unlocks completing the quiz', (await ann.has('2 / 2')) && (await presenter.has('Complete Quiz')));

    ok('no uncaught errors', [presenter, ann].every((p) => p.realErrors().length === 0), [presenter, ann].flatMap((p) => p.realErrors()).join(' | '));
  }
);
