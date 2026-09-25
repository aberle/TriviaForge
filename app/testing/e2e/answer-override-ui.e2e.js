/**
 * Settling a dispute from the presenter's Live Standings: a "Mark correct" button next to each
 * finished answer. The player's own screen updates at once, without any sign that the grade was
 * changed, and a round they are in the middle of is not disturbed.
 */

import { runSuite, Q, BASE, pick, submitAnswers, sleep } from './lib/harness.js';

const TITLE = `Recount ${Date.now().toString(36)}`;

await runSuite(
  'answer override (presenter UI)',
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
    timeoutMs: 180000,
  },
  async ({ ok, section, env }) => {
    const presenter = await env.adminPage('/presenter');
    await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.includes(${JSON.stringify(TITLE)}))`);
    await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)})); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(200);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    const room = await presenter.eval(`(([...document.querySelectorAll('*')].find(e => e.children.length < 4 && e.innerText?.includes('TriviaForge Presenter') && /\\d{4}/.test(e.innerText)) || {}).innerText || '').match(/\\d{4}/)?.[0]`);
    const ann = await env.player('Ann', { room });
    const bob = env.bot();
    bob.emit('joinRoom', { roomCode: room, username: 'bob_ui', displayName: 'Bob', playerID: bob.playerID });
    await presenter.waitText('2 player(s)');

    // Question `q` (1-based) of the open Live Standings modal, and its player rows
    const rows = (q) => `[...document.querySelectorAll('.modal-overlay .question-detail:nth-of-type(${q}) .player-response')]`;
    const openStandings = async () => {
      await presenter.clickText('Standings', '.btn-standings');
      await presenter.waitText('Question Breakdown');
      await sleep(500);
    };
    const expand = async (q) => {
      await presenter.eval(`document.querySelectorAll('.modal-overlay .player-answers-header')[${q - 1}].click(); true`);
      await sleep(300);
    };

    section('Round one');
    await presenter.clickText('Start');
    await ann.waitText('Round 1 of 2');
    bob.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0, 1] });
    await pick(ann, 0, 'Rome'); // wrong, but Ann disputes it
    await pick(ann, 1, 'Eight');
    await submitAnswers(ann);
    await presenter.waitText('2 of 2 players have submitted');
    await presenter.clickText('End Round');
    await ann.waitText('this round');
    ok('Ann starts with 1 of 2', await ann.has('1 / 2'));
    ok('...and is second on the leaderboard', await ann.eval(`document.querySelector('.leaderboard-row.is-you')?.innerText.includes('2')`));

    section('Settling the dispute');
    await openStandings();
    await expand(1);
    const buttons = await presenter.eval(`${rows(1)}.map(r => ({ name: r.querySelector('.player-name').innerText, button: r.querySelector('.override-btn')?.innerText.trim() }))`);
    ok('each answer to a finished question has a button: "Mark correct" for a wrong one, "Mark wrong" for a right one', buttons.some((b) => /Ann/.test(b.name) && b.button === 'Mark correct') && buttons.some((b) => /Bob/.test(b.name) && b.button === 'Mark wrong'), JSON.stringify(buttons));
    await presenter.eval(`${rows(1)}.find(r => /Ann/.test(r.innerText)).querySelector('.override-btn').click(); true`);
    await presenter.waitFor(`${rows(1)}.some(r => /Ann/.test(r.innerText) && r.querySelector('.override-btn')?.innerText.trim() === 'Mark wrong')`, { timeout: 6000 });
    ok('the button flips to "Mark wrong" and the answer is tagged as edited (for the presenter only)', await presenter.eval(`${rows(1)}.find(r => /Ann/.test(r.innerText)).innerText.includes('edited')`));
    ok('the standings table counts it: Ann has 2 correct', await presenter.eval(`[...document.querySelectorAll('.modal-overlay .standings-row')].find(r => /Ann/.test(r.innerText)).querySelector('.correct').innerText.trim() === '2'`));

    section("Ann's screen");
    await ann.waitText('2 / 2', { timeout: 6000 });
    ok('her round result is corrected live: 2 of 2', await ann.has('2 / 2'));
    ok('and she is tied for first place now', await ann.eval(`document.querySelector('.leaderboard-row.is-you')?.innerText.includes('1')`));
    const annText = await ann.eval('document.body.innerText');
    ok('nothing on her screen says it was changed', !/edited|overrid|dispute|changed by/i.test(annText), (annText.match(/.{0,30}(edited|overrid|dispute|changed by).{0,30}/i) || [''])[0]);

    section('While the next round is open');
    await presenter.eval(`document.querySelector('.modal-close-btn').click(); true`);
    await presenter.clickText('Start');
    await ann.waitText('Round 2 of 2');
    await pick(ann, 0, 'Venus'); // an answer that is not submitted yet
    await sleep(600);
    await openStandings();
    await expand(2);
    await presenter.eval(`${rows(2)}.find(r => /Bob/.test(r.innerText)).querySelector('.override-btn').click(); true`);
    await sleep(1200);
    ok("changing a grade from round one does not disturb Ann's unsent answer in round two", (await ann.has('1 / 1 answered')) && (await ann.eval(`!!document.querySelector('.choice-btn.selected, .selected')`)));
    ok('no uncaught errors', [presenter, ann].every((p) => p.realErrors().length === 0), [presenter, ann].flatMap((p) => p.realErrors()).join(' | '));
  }
);
