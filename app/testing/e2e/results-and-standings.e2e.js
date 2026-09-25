/**
 * Standings and final results, seen from a player's phone, the display page and over the wire:
 *  - a normal round ends with a leaderboard for everyone
 *  - after the FINAL round the standings are withheld (from players and the display, on screen and
 *    on the wire) until the presenter completes the quiz
 *  - the final results show a podium where ties share a step, plus a full leaderboard with shared ranks
 *  - there is no "class average", and a refresh on the results page comes back to the results
 *
 * Scores (4 questions, two rounds): Ann 3, Bob 3, Cy 2, Dee 2, Eve 0  ->  ranks 1, 1, 3, 3, 5
 */

import { runSuite, Q, BASE, pick, submitAnswers, sleep } from './lib/harness.js';

await runSuite(
  'results and standings',
  {
    quiz: {
      rounds: [{ title: 'First', timeLimitSeconds: null }, { title: 'Second', timeLimitSeconds: null }],
      questions: [
        Q.mc('Capital of France?', ['Paris', 'Rome'], 0, 0),
        Q.mc('Capital of Italy?', ['Paris', 'Rome'], 1, 0),
        Q.mc('Capital of Spain?', ['Madrid', 'Rome'], 0, 1),
        Q.mc('Capital of Egypt?', ['Cairo', 'Rome'], 0, 1),
      ],
    },
  },
  async ({ ok, section, env }) => {
    const { presenter, room } = env;
    const control = (event, roundIndex) => presenter.emit(event, { roomCode: room, roundIndex });
    const rows = (page) => page.eval(`[...document.querySelectorAll('.remaining-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);

    const display = await env.open(`${BASE}/display?room=${room}`, { width: 1600, height: 900 });
    await display.waitText('Connected to room');
    const ann = await env.player('Ann');

    const bots = {};
    const answers = { Bob: [[0, 1], [0, 1]], Cy: [[0, 1], [1, 1]], Dee: [[0, 1], [1, 1]], Eve: [[1, 0], [1, 1]] };
    for (const name of Object.keys(answers)) {
      bots[name] = env.bot(`e2e-${name}-${Date.now()}`);
      bots[name].emit('joinRoom', { roomCode: room, username: `${name.toLowerCase()}_e2e`, displayName: name, playerID: bots[name].playerID });
    }
    await sleep(900);
    const submitBots = (roundIndex) => {
      for (const [name, bot] of Object.entries(bots)) bot.emit('submitRound', { roomCode: room, roundIndex, answers: answers[name][roundIndex] });
    };

    section('Round 1 (not the last): the leaderboard is shown');
    control('startRound', 0);
    await ann.waitText('Round 1 of 2');
    await pick(ann, 0, 'Paris');
    await pick(ann, 1, 'Rome');
    await submitAnswers(ann);
    submitBots(0);
    await sleep(500);
    control('endRound', 0);
    await ann.waitText('this round');
    ok('the player sees the leaderboard with rank and total', (await ann.count('.leaderboard-row')) === 5 && (await ann.has('overall')));
    await display.waitText('Leaderboard');
    ok('the display shows the leaderboard', (await display.count('.leaderboard-row')) === 5);

    section('The final round: standings are withheld');
    control('startRound', 1);
    await ann.waitText('Round 2 of 2');
    await pick(ann, 0, 'Madrid');
    await pick(ann, 1, 'Rome'); // wrong: Ann finishes on 3
    await submitAnswers(ann);
    submitBots(1);
    await sleep(500);
    const mark = { bob: bots.Bob.mark(), presenter: presenter.mark() };
    control('endRound', 1);
    await ann.waitText('this round');
    await sleep(600);
    ok('the player sees their own round result and answers', (await ann.has('1 / 2')) && (await ann.has('Your answer')));
    ok('...but no leaderboard, rank or total points', !(await ann.visible('.round-leaderboard')) && !(await ann.has('overall')) && !(await ann.has('total points')));
    ok('...and is told the standings come when the presenter finishes', await ann.has('final standings will be revealed'));
    await display.waitText('The answers');
    ok('the display shows the answers but no leaderboard', !(await display.visible('.round-leaderboard')) && (await display.has('final standings will be revealed')));

    const botFinal = bots.Bob.all('roundEnded', mark.bob).at(-1);
    const presenterFinal = presenter.all('roundEnded', mark.presenter).at(-1);
    ok('on the wire: another player gets no standings, rank or total for the final round', botFinal.isLastRound && botFinal.standings === null && botFinal.you.rank === null && botFinal.you.totalScore === null && typeof botFinal.you.roundScore === 'number');
    ok('on the wire: the presenter still gets the final standings', presenterFinal.standings?.length === 5);

    await ann.goto(await ann.eval('location.href'));
    await ann.waitText('this round', { timeout: 15000 });
    await sleep(800);
    ok('after a refresh the standings are still hidden', !(await ann.visible('.round-leaderboard')) && !(await ann.has('overall')));
    const rejoinSnapshot = await new Promise((resolve) => {
      const bot = env.bot();
      bot.socket.on('roundState', (state) => { resolve(state); bot.close(); });
      bot.emit('joinRoom', { roomCode: room, username: 'late_e2e', displayName: 'Late', playerID: bot.playerID });
    });
    ok("a rejoining player's snapshot has no standings either", rejoinSnapshot.lastEnded?.standings === null);

    section('Completing the quiz reveals the final results');
    const presMark = presenter.mark();
    control('completeQuiz');
    await ann.waitText('Full Leaderboard', { timeout: 20000 });
    await display.waitText('Full Leaderboard', { timeout: 20000 });
    await sleep(1200);

    const annRows = await rows(ann);
    ok('the full leaderboard lists every player, ties sharing a rank (1, 1, 3, 3, 5)', annRows.length === 5 && annRows.map((r) => r.split(' ')[0]).join(',') === '1,1,3,3,5', JSON.stringify(annRows));
    ok("the viewing player's row is highlighted", await ann.eval(`document.querySelector('.remaining-row--you')?.innerText.includes('Ann')`));
    const podium = await ann.eval(`[...document.querySelectorAll('.podium-slot')].map(s => s.querySelector('.podium-rank-label').innerText.trim() + ':' + [...s.querySelectorAll('.podium-name')].map(n => n.innerText.trim()).join('+'))`);
    ok('the podium puts tied players on the same step (1st: Ann + Bob, 3rd: Cy + Dee, no 2nd)', JSON.stringify(podium) === JSON.stringify(['1ST:Ann+Bob', '3RD:Cy+Dee']), JSON.stringify(podium));
    ok('the display shows the same leaderboard', (await rows(display)).length === 5 && !(await display.visible('.remaining-row--you')));
    ok('there is no "class average" on the results', !(await ann.has('average')) && !(await display.has('average')));
    const results = presenter.all('quizResults', presMark)[0];
    ok('on the wire: the results carry no classAverage but do carry players and the total', results && !('classAverage' in results) && results.players.length === 5 && results.totalQuestions === 4);

    section('Refreshing on the results page');
    await ann.goto(await ann.eval('location.href'));
    await ann.waitText('Full Leaderboard', { timeout: 15000 });
    ok('the player comes back to the final results, not the last round', (await ann.has('Final Results')) && (await rows(ann)).length === 5 && !(await ann.has('revealed when the presenter finishes')));
    ok('...with no "Results in 5…" countdown', !(await ann.has('Results in')));
    await display.goto(`${BASE}/display?room=${room}`);
    await display.waitText('Full Leaderboard', { timeout: 15000 });
    ok('the display comes back to the results too', (await rows(display)).length === 5);
    const restored = await new Promise((resolve) => {
      const bot = env.bot();
      bot.socket.on('roomRestored', (u) => { resolve(u.quizCompleted); bot.close(); });
      bot.emit('viewRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    });
    ok('a refreshed presenter is told the quiz is already completed', restored === true);
    const late = await new Promise((resolve) => {
      const bot = env.bot();
      const seen = [];
      bot.socket.onAny((e) => seen.push(e));
      bot.emit('joinRoom', { roomCode: room, username: 'late2_e2e', displayName: 'Late Two', playerID: bot.playerID });
      setTimeout(() => { bot.close(); resolve(seen); }, 900);
    });
    ok('a late joiner to a completed room gets the completed state and results', late.includes('quizCompleted') && late.includes('quizResults'));
    ok('no uncaught errors', ann.realErrors().length === 0 && display.realErrors().length === 0, [...ann.realErrors(), ...display.realErrors()].join(' | '));
  }
);
