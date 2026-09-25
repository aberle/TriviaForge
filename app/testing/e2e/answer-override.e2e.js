/**
 * The presenter can settle a dispute by counting a player's answer to a finished question as
 * correct (or as wrong). It then counts exactly like that everywhere, as if it had always been
 * graded that way, and players are not told it was changed. Socket and API only: no browser.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite(
  'answer override',
  {
    chrome: false,
    quiz: {
      title: `Recount ${Date.now().toString(36)}`,
      rounds: [{ title: 'One', timeLimitSeconds: null }, { title: 'Two', timeLimitSeconds: null }],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0, 0),
        Q.tf('The sky is blue on a clear day.', 0),
        Q.sa('Name the largest planet in our solar system', ['Jupiter'], 0),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1, 1),
      ],
    },
    timeoutMs: 120000,
  },
  async ({ ok, section, env }) => {
    const pres = env.presenter;
    const room = env.room;
    const admin = async (path) => (await env.api('GET', path)).json();
    const progress = async () => admin(`/api/room/progress/${room}`);
    const scoreOf = async (username) => (await progress()).players.find((p) => p.username === username);

    const join = async (username, displayName) => {
      const bot = env.bot();
      const mark = bot.mark();
      bot.emit('joinRoom', { roomCode: room, username, displayName, playerID: bot.playerID });
      await bot.waitFor('roundState', { since: mark });
      return { bot, username, name: displayName };
    };
    const ann = await join('ov_ann', 'Ann');
    const bob = await join('ov_bob', 'Bob');
    const cy = await join('ov_cy', 'Cy');

    const override = async (username, questionIndex, correct) => {
      const mark = pres.mark();
      pres.emit('overrideAnswer', { roomCode: room, username, questionIndex, correct });
      const done = await Promise.race([
        pres.waitFor('answerOverridden', { since: mark }).then(() => 'ok'),
        pres.waitFor('overrideRejected', { since: mark }).then((p) => p.message),
      ]);
      await sleep(250);
      return done;
    };
    const submit = (player, roundIndex, answers) => player.bot.emit('submitRound', { roomCode: room, roundIndex, answers });
    const endRound = async (index) => {
      const mark = ann.bot.mark();
      pres.emit('endRound', { roomCode: room, roundIndex: index });
      return ann.bot.waitFor('roundEnded', { since: mark });
    };

    section('Round one is played');
    pres.emit('startRound', { roomCode: room, roundIndex: 0 });
    await sleep(500);
    submit(ann, 0, [1, 1, 'Saturn']); // all wrong
    submit(bob, 0, [0, 0, 'Jupiter']); // all right
    submit(cy, 0, [0, 0, 'jupiter']); // all right
    await sleep(500);
    let ended = await endRound(0);
    ok('Ann starts with 0 of 3, Bob and Cy 3 of 3', ended.you.roundScore === 0 && ended.standings.map((s) => `${s.name}:${s.totalScore}`).join() === 'Bob:3,Cy:3,Ann:0', JSON.stringify(ended.standings));

    section('Rejected requests');
    const mark = ann.bot.mark();
    ann.bot.emit('overrideAnswer', { roomCode: room, username: 'ov_ann', questionIndex: 0, correct: true });
    const denied = await ann.bot.waitFor('overrideRejected', { since: mark });
    ok('a player cannot change a grade (not even their own)', /presenter/i.test(denied.message) && (await scoreOf('ov_ann')).correct === 0, denied.message);
    ok('an unfinished question cannot be changed', /not finished/i.test(await override('ov_ann', 3, true)));
    ok('a player who did not exist cannot be graded', /not found/i.test(await override('ov_nobody', 0, true)));
    ok('a non-boolean grade is refused', /invalid/i.test(await override('ov_ann', 0, 'yes')));

    section('Counting an answer as correct');
    const updateSeen = ann.bot.mark();
    const bobSeen = bob.bot.mark();
    ok('the presenter counts an answer to the first question as correct', (await override('ov_ann', 0, true)) === 'ok');
    const annUpdate = await ann.bot.waitFor('roundResults', { since: updateSeen });
    ok("Ann's own results are corrected at once: 1 of 3 this round, first question correct", annUpdate.lastEnded.you.roundScore === 1 && annUpdate.lastEnded.you.results[0] === true && annUpdate.lastEnded.you.results[1] === false, JSON.stringify(annUpdate.lastEnded.you));
    ok('...her history and the leaderboard agree', annUpdate.history[0].results[0] === true && annUpdate.lastEnded.standings.find((s) => s.name === 'Ann').totalScore === 1);
    const bobUpdate = await bob.bot.waitFor('roundResults', { since: bobSeen });
    ok("everyone else sees Ann's new score on the leaderboard", bobUpdate.lastEnded.standings.find((s) => s.name === 'Ann').totalScore === 1);
    ok("nothing in what players receive says it was changed", !/overrid|edited|dispute|manual/i.test(JSON.stringify(annUpdate) + JSON.stringify(bobUpdate)));
    await override('ov_ann', 2, true); // the typed short answer too
    ok('a short answer can be counted as correct as well', (await scoreOf('ov_ann')).correct === 2 && (await scoreOf('ov_ann')).results['2'] === true);

    section('Counting an answer as wrong, and undoing');
    await override('ov_bob', 1, false);
    ok("Bob's correct answer can be counted wrong", (await scoreOf('ov_bob')).correct === 2);
    ok('and the presenter can see which grades were changed', JSON.stringify((await scoreOf('ov_bob')).overridden) === '{"1":false}', JSON.stringify((await scoreOf('ov_bob')).overridden));
    await override('ov_bob', 1, true);
    const restored = await scoreOf('ov_bob');
    ok('setting it back to what the grader said clears the change', restored.correct === 3 && Object.keys(restored.overridden).length === 0, JSON.stringify(restored.overridden));

    section('A rejoining player gets the corrected results');
    ann.bot.close();
    await sleep(300);
    const back = env.bot(ann.bot.playerID);
    const rejoin = back.mark();
    back.emit('joinRoom', { roomCode: room, username: 'ov_ann', displayName: 'Ann', playerID: ann.bot.playerID });
    const snapshot = await back.waitFor('roundState', { since: rejoin });
    ok('their snapshot already has the corrected results', snapshot.history[0].results.join() === 'true,false,true' && snapshot.lastEnded.you.roundScore === 2, JSON.stringify(snapshot.history[0].results));
    ann.bot = back;

    section('The last round, the final results and what is saved');
    pres.emit('startRound', { roomCode: room, roundIndex: 1 });
    await sleep(500);
    submit(ann, 1, [1]);
    submit(bob, 1, [1]);
    submit(cy, 1, [0]);
    await sleep(400);
    const lastMark = ann.bot.mark();
    await endRound(1);
    await override('ov_ann', 3, false); // a correct answer, counted wrong (the last round)
    const lastUpdate = await ann.bot.waitFor('roundResults', { since: lastMark });
    ok("in the final round the player's update still withholds the standings", lastUpdate.lastEnded.standings === null && lastUpdate.lastEnded.you.rank === null && lastUpdate.lastEnded.you.roundScore === 0, JSON.stringify(lastUpdate.lastEnded.you));
    ok("...while the presenter's standings are right (Ann 2, Bob 4, Cy 3)", (await scoreOf('ov_ann')).correct === 2 && (await scoreOf('ov_bob')).correct === 4 && (await scoreOf('ov_cy')).correct === 3);

    const completeMark = ann.bot.mark();
    pres.emit('completeQuiz', { roomCode: room });
    const results = await ann.bot.waitFor('quizResults', { since: completeMark, timeout: 20000 });
    const finalScores = Object.fromEntries(results.players.map((p) => [p.name, p.score]));
    ok('the final results use the corrected grades', finalScores.Ann === 2 && finalScores.Bob === 4 && finalScores.Cy === 3, JSON.stringify(finalScores));
    ok('once the quiz is completed grades can no longer be changed', /completed/i.test(await override('ov_ann', 1, true)));
    await sleep(1500);

    const sessions = (await admin('/api/sessions')).filter((s) => s.quizId === env.quiz.id);
    const detail = await admin(`/api/sessions/${sessions[0].filename}`);
    const annResult = detail.playerResults.find((p) => p.name === 'Ann');
    ok('the saved session has Ann on 2 correct, and each question shows who got it right', annResult.correct === 2 && detail.questions[0].answerCorrectness.Ann === true && detail.questions[3].answerCorrectness.Ann === false, JSON.stringify(annResult));

    section('After a restart');
    pres.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    await sleep(1000);
    const resumeMark = pres.mark();
    pres.emit('resumeSession', { sessionFilename: sessions[0].filename, userId: 1, isRootAdmin: true });
    await pres.waitFor('roomCreated', { since: resumeMark });
    const revived = await scoreOf('ov_ann');
    ok('a resumed session remembers the changed grades', revived.correct === 2 && JSON.stringify(revived.overridden) === '{"0":true,"2":true,"3":false}', JSON.stringify(revived.overridden));
  }
);
