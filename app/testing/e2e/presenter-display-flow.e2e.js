/**
 * A whole round quiz through the real presenter page (Make Live, Start, End Round, Complete), with a
 * player on a phone, bots for the other players, and the display page.
 */

import { runSuite, Q, BASE, pick, submitAnswers, sleep } from './lib/harness.js';

const TITLE = `Presenting ${Date.now().toString(36)}`;

await runSuite(
  'presenter and display flow',
  {
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Warmup', timeLimitSeconds: 90 }, { title: 'Finals', timeLimitSeconds: null }],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo', 'Madrid'], 0, 0),
        Q.tf('The sky is blue on a clear day.', 0),
        Q.sa('Name the largest planet in our solar system', ['Jupiter'], 0),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight', 'Ten'], 1, 1),
        Q.mc('Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Saturn'], 1, 1),
      ],
    },
    timeoutMs: 240000,
  },
  async ({ ok, section, env }) => {
    section('Presenter: make the room live');
    const presenter = await env.adminPage('/presenter');
    await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.includes(${JSON.stringify(TITLE)}))`);
    await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)})); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(200);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    const room = await presenter.eval(`(([...document.querySelectorAll('*')].find(e => e.children.length < 4 && e.innerText?.includes('TriviaForge Presenter') && /\\d{4}/.test(e.innerText)) || {}).innerText || '').match(/\\d{4}/)?.[0]`);
    ok('the room is created and the round controls replace the question list', /^\d{4}$/.test(room) && (await presenter.has('Warmup')) && !(await presenter.has('Auto-Pilot')), String(room));
    ok('there is no per-room guest-only option (guest-only is a server setting)', !(await presenter.visible('.guest-only-option')));

    const display = await env.open(`${BASE}/display?room=${room}`, { width: 1600, height: 900 });
    await display.waitText('Connected to room');
    const ann = await env.player('Ann', { room });
    const bob = env.bot();
    const cy = env.bot();
    bob.emit('joinRoom', { roomCode: room, username: 'bob_e2e', displayName: 'Bob', playerID: bob.playerID });
    cy.emit('joinRoom', { roomCode: room, username: 'cy_e2e', displayName: 'Cy', playerID: cy.playerID });
    await presenter.waitText('3 player(s)');
    await sleep(500);

    const confirmDialog = async (page) => {
      await page.clickText('Confirm', '.dialog-buttons button');
    };

    section('Round 1 (timed)');
    await presenter.clickText('Start');
    await presenter.waitText('LIVE');
    await ann.waitText('Round 1 of 2');
    ok('the player sees all three questions at once, with a timer, and no correct answers marked', (await ann.count('.question-card')) === 3 && (await ann.visible('.timer-bar')) && !(await ann.eval(`!!document.querySelector('.choice-btn.correct, .correct-indicator')`)));
    await display.waitText('Round 1 of 2');
    ok('the display shows the round, its questions and the open-ended marker, but no accepted answers', (await display.has('Warmup')) && (await display.has('What is the capital of France?')) && (await display.has('Open-ended answer')) && !(await display.has('Accepted:')));
    ok('the presenter sees the correct answers (marked for them only)', (await presenter.has('Accepted:')) && (await presenter.has('answers shown for you only')));
    bob.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0, 1, 'Jupiter'] });
    await presenter.waitText('1 of 3 players have submitted');

    await pick(ann, 0, 'Paris');
    await pick(ann, 1, 'True');
    await ann.fill('.short-answer-input', 'jupitar');
    await ann.waitText('3 / 3 answered');
    await submitAnswers(ann);
    await presenter.waitText('2 of 3 players have submitted');
    ok('the presenter sees who has submitted, by name', await presenter.eval(`document.querySelector('.rd-names')?.innerText.includes('Ann') && document.querySelector('.rd-names')?.innerText.includes('Bob')`));
    ok('...and the players list marks them', (await presenter.count('.player-answered')) === 2);

    await presenter.clickText('End Round');
    await presenter.waitText('has not submitted yet');
    await confirmDialog(presenter); // Cy hasn't submitted: the presenter is warned first
    await ann.waitText('this round');
    ok("the player's review shows 3 / 3 and their typed answer graded correct", (await ann.has('3 / 3')) && (await ann.has('jupitar')));
    ok('the leaderboard appears for the player and the display after a normal round', (await ann.count('.leaderboard-row')) === 3 && (await ann.eval(`document.querySelector('.leaderboard-row.is-you')?.innerText.includes('Ann')`)));
    await display.waitText('The answers');
    ok('the display shows the answers and the leaderboard', (await display.has('Leaderboard')) && (await display.has('Accepted:')) && (await display.has('Jupiter')));
    await presenter.waitText('Leaderboard after Round 1');

    section('Round 2 (untimed) and the final standings');
    await presenter.clickText('Start');
    await ann.waitText('Round 2 of 2');
    ok('an untimed round says so', await ann.has('No time limit'));
    bob.emit('submitRound', { roomCode: room, roundIndex: 1, answers: [1, 0] });
    await pick(ann, 0, 'Eight');
    await pick(ann, 1, 'Mars');
    await submitAnswers(ann);
    await presenter.waitText('2 of 3 players have submitted');
    await presenter.clickText('End Round');
    await confirmDialog(presenter);
    await ann.waitText('this round');
    await sleep(600);
    ok('after the final round the player gets no standings until the quiz is completed', !(await ann.visible('.round-leaderboard')) && (await ann.has('final standings will be revealed')));
    await presenter.waitText('All rounds are done');
    ok('the presenter does see the final standings', (await presenter.has('Final Standings')) && (await presenter.has('Complete Quiz')));

    section('Complete the quiz');
    await presenter.clickText('Complete Quiz');
    await confirmDialog(presenter);
    await ann.waitText('Full Leaderboard', { timeout: 25000 });
    ok('players get the final results: podium and full leaderboard (Cy answered nothing, so is not ranked)', (await ann.has('Full Leaderboard')) && (await ann.count('.remaining-row')) === 2, String(await ann.count('.remaining-row')));
    await presenter.waitText('Quiz completed and saved');
    ok('the presenter cannot start more rounds or complete it again', !(await presenter.has('Complete Quiz & Save')) || (await presenter.has('Quiz completed and saved')));

    ok('no uncaught errors on any page', [presenter, display, ann].every((p) => p.realErrors().length === 0), [presenter, display, ann].flatMap((p) => p.realErrors()).join(' | '));
  }
);
