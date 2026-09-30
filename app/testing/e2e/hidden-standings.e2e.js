/**
 * Hidden standings mode: a round quiz room where nobody sees results, answers or standings until the
 * presenter completes the quiz. The presenter still sees everything. After completion the final
 * results appear, and the Progress button shows each player's answers and the correct ones.
 */

import { runSuite, Q, BASE, pick, submitAnswers, sleep, getRoomCode } from './lib/harness.js';

const TITLE = `Hidden ${Date.now().toString(36)}`;

await runSuite(
  'hidden standings mode',
  {
    quiz: {
      title: TITLE,
      rounds: [{ title: 'One', timeLimitSeconds: null }, { title: 'Two', timeLimitSeconds: null }],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0, 0),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1, 0),
        Q.mc('Which planet is known as the Red Planet?', ['Venus', 'Mars'], 1, 1),
      ],
    },
    timeoutMs: 240000,
  },
  async ({ ok, section, env }) => {
    const plain = await env.createQuiz({ title: `Plain ${TITLE}`, questions: [Q.mc('A question without rounds', ['a', 'b'], 0)] });
    const presenter = await env.adminPage('/presenter');
    const choose = async (title) => {
      await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.trim() === ${JSON.stringify(title)})`);
      await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.trim() === ${JSON.stringify(title)}); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(300);
    };

    section('Choosing the mode');
    await choose(`Plain ${TITLE}`);
    ok('a quiz without rounds has no hidden-standings option', !(await presenter.visible('.hidden-standings-option')));
    await choose(TITLE);
    ok('a round quiz has the option, off by default', (await presenter.visible('.hidden-standings-option')) && !(await presenter.eval(`document.querySelector('.hidden-standings-option input').checked`)));
    await presenter.eval(`document.querySelector('.hidden-standings-option input').click(); true`);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    ok('the room shows that standings are hidden until the end', await presenter.has('Standings hidden until the end'));
    const room = await getRoomCode(presenter);

    const display = await env.open(`${BASE}/display?room=${room}`, { width: 1600, height: 900 });
    await display.waitText('Connected to room');
    const ann = await env.player('Ann', { room });
    const bob = env.bot();
    bob.emit('joinRoom', { roomCode: room, username: 'bob_hs', displayName: 'Bob', playerID: bob.playerID });
    await presenter.waitText('Connected (2)'); // this room's own list (other rooms in the sidebar also say "N player(s)")

    section('Round one, results held back');
    await presenter.clickText('Start');
    await ann.waitText('Round 1 of 2');
    bob.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0, 1] });
    await pick(ann, 0, 'Rome');
    await pick(ann, 1, 'Eight');
    await submitAnswers(ann);
    await presenter.waitText('2 of 2 players have submitted');
    await presenter.clickText('End Round');
    await presenter.waitText('Finish Review');
    // While the presenter is still reviewing, players and the display already see the hidden page (no "in a moment")
    await ann.waitText('hidden until the end');
    ok('during the review the player is already on the hidden-results page, with no "results in a moment"', (await ann.has('Your answers are in')) && !(await ann.has('in a moment')) && !(await ann.has('checking the answers')));
    await display.waitText('end of the quiz');
    ok('and so is the display', !(await display.has('checking the answers')));
    await presenter.clickText('Finish Review');
    await ann.waitText('hidden until the end');
    const annText = await ann.eval('document.body.innerText');
    ok('the player is told results are hidden, and sees no score, rank, leaderboard or correct answers', /hidden until the end/i.test(annText) && !(await ann.visible('.round-leaderboard')) && !/\d \/ \d this round|overall|Correct answer/i.test(annText), annText.slice(0, 300));
    await display.waitText('end of the quiz');
    ok('the display shows only that results are coming at the end', !(await display.has('Leaderboard')) && !(await display.has('Accepted:')) && !(await display.has('The answers')));
    const wire = bob.all('roundEnded').at(-1);
    ok('on the wire the players get no results, answers or standings', wire.hidden === true && wire.standings === null && wire.questions.length === 0 && !('you' in wire) && !/correctChoice|Paris/.test(JSON.stringify(wire)), JSON.stringify(wire));
    ok('the presenter still sees the leaderboard', (await presenter.has('Leaderboard after Round 1')) && (await presenter.count('.leaderboard-row')) === 2);

    section("Nowhere else it could leak");
    await ann.eval(`document.querySelector('#progressBtn').click(); true`);
    await sleep(500);
    ok("the player's Answer Statistics button says results are hidden for now", (await ann.has('Results are hidden for now')) && !(await ann.has('Incorrect')));
    await ann.eval(`document.querySelector('.modal-close-btn').click(); true`);
    const again = env.bot(bob.playerID);
    bob.close();
    await sleep(300);
    const mark = again.mark();
    again.emit('joinRoom', { roomCode: room, username: 'bob_hs', displayName: 'Bob', playerID: again.playerID });
    const snap = await again.waitFor('roundState', { since: mark });
    const history = await again.waitFor('answerHistoryRestored', { since: mark });
    ok('a player rejoining gets the hidden state, no history and no correct answers', snap.hiddenStandings === true && snap.history.length === 0 && snap.lastEnded.hidden === true && history.answerHistory.every((h) => h.isRevealed === false && h.correctChoice === undefined), JSON.stringify(snap).slice(0, 200));
    const api = await (await fetch(`${BASE}/api/player/progress/${room}?username=bob_hs`)).json();
    ok('and the public progress endpoint reveals nothing either', api.questionHistory.every((q) => q.revealed === false && q.correctChoice === null), JSON.stringify(api.questionHistory[0]));

    section('The last round and the end');
    await presenter.clickText('Start');
    await ann.waitText('Round 2 of 2');
    await pick(ann, 0, 'Mars');
    await submitAnswers(ann);
    again.emit('submitRound', { roomCode: room, roundIndex: 1, answers: [0] });
    await presenter.waitText('2 of 2 players have submitted');
    await presenter.clickText('End Round');
    await presenter.waitText('Finish Review');
    await presenter.clickText('Finish Review');
    await ann.waitText('hidden until the end');
    await presenter.waitText('Complete Quiz');
    await presenter.clickText('Complete Quiz');
    await presenter.clickText('Confirm', '.dialog-buttons button');
    await ann.waitText('Full Leaderboard', { timeout: 30000 });
    ok('completing the quiz reveals the final results: podium and full leaderboard', (await ann.has('Full Leaderboard')) && (await ann.count('.remaining-row')) === 2);
    ok('the top button and the results page both say Answer Statistics', (await ann.eval(`document.querySelector('#progressBtn').textContent`)).includes('Answer Statistics') && (await ann.eval(`!!document.querySelector('.stats-button')`)));
    await ann.eval(`document.querySelector('.stats-button').click(); true`); // the button under the podium opens the same modal
    await sleep(600);
    ok('the modal is titled Answer Statistics', (await ann.eval(`document.querySelector('.modal-overlay').innerText`)).includes('Answer Statistics'));
    const progress = await ann.eval(`document.querySelector('.modal-overlay').innerText`);
    ok('and the Answer Statistics button now shows her answers and which were right: 2 of 3', /Q1\./.test(progress) && /Incorrect/.test(progress) && (progress.match(/Correct/g) || []).length >= 2, progress.slice(0, 400));

    section('The mode survives a restart');
    await ann.eval(`document.querySelector('.modal-close-btn').click(); true`);
    const sessions = (await (await env.api('GET', '/api/sessions')).json()).filter((s) => s.quizId === env.quiz.id);
    env.presenter.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    await sleep(800);
    const resumeMark = env.presenter.mark();
    env.presenter.emit('resumeSession', { sessionFilename: sessions[0].filename, userId: 1, isRootAdmin: true });
    const resumed = await env.presenter.waitFor('roomCreated', { since: resumeMark });
    ok('a resumed session is still in hidden standings mode', resumed.hiddenStandings === true);

    ok('no uncaught errors', [presenter, ann].every((p) => p.realErrors().length === 0), [presenter, ann].flatMap((p) => p.realErrors()).join(' | '));
  }
);
