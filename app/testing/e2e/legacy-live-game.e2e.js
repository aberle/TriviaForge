/**
 * A quiz WITHOUT rounds still plays exactly as before (question by question), short answers are
 * graded in the final results, and a player rejoining a completed room gets the results back.
 * Socket-only: no browser needed.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite(
  'quiz without rounds',
  {
    chrome: false,
    quiz: {
      title: `Legacy ${Date.now().toString(36)}`,
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0),
        Q.tf('The sky is blue on a clear day.'),
        Q.sa('Name the largest planet in our solar system', ['Jupiter']),
      ],
    },
  },
  async ({ ok, section, env }) => {
    section('Playing question by question');
    const pres = env.presenter;
    const created = pres.all('roomCreated').find((p) => p.roomCode === env.room);
    ok('the room has no rounds and no round state', !(created.rounds?.length > 0) && pres.all('roundState').length === 0);

    const room = env.room;
    const player = env.bot();
    const since = player.mark();
    player.emit('joinRoom', { roomCode: room, username: 'legacy_pl', displayName: 'legacy_pl', playerID: player.playerID });
    await player.waitFor('answerHistoryRestored', { since });
    ok('a player joining gets no round snapshot', player.all('roundState').length === 0);

    const answers = [0, 0, 'Jupiter'];
    for (let i = 0; i < 3; i++) {
      const mark = player.mark();
      const presMark = pres.mark();
      pres.emit('presentQuestion', { roomCode: room, questionIndex: i });
      await player.waitFor('questionPresented', { since: mark, pred: (p) => p.questionIndex === i });
      player.emit('submitAnswer', { roomCode: room, choice: answers[i] });
      await pres.waitFor('allPlayersAnswered', { since: presMark, pred: (p) => p.questionIndex === i });
      pres.emit('revealAnswer', { roomCode: room });
      const revealed = await player.waitFor('questionRevealed', { since: mark, pred: (p) => p.questionIndex === i });
      ok(`question ${i + 1} is presented, answered and revealed as correct`, revealed.results?.[0]?.is_correct === true);
    }

    section('Completing');
    const beforeComplete = player.mark();
    pres.emit('completeQuiz', { roomCode: room });
    await player.waitFor('quizCompleted', { since: beforeComplete });
    const results = await player.waitFor('quizResults', { since: beforeComplete, timeout: 20000 });
    ok('the final score counts the short answer (3 of 3)', results.players[0]?.score === 3 && results.totalQuestions === 3, JSON.stringify(results.players));

    section('Rejoining a completed room');
    player.close(); // the same device can't be in the room twice
    await sleep(400);
    const again = env.bot(player.playerID);
    const mark = again.mark();
    again.emit('joinRoom', { roomCode: room, username: 'legacy_pl', displayName: 'legacy_pl', playerID: player.playerID });
    const completed = await again.waitFor('quizCompleted', { since: mark, timeout: 8000 });
    const restored = await again.waitFor('quizResults', { since: mark, timeout: 8000 });
    ok('the returning player is told the quiz is done and gets their results back', completed.restored === true && restored.players[0]?.score === 3);
    await sleep(100);
  }
);
