/**
 * Resuming a saved session (what a presenter does after a server restart) brings it back under its
 * ORIGINAL room code, updates the original session rather than creating a second one, and lets
 * players rejoin with the code and answers they already had. Socket-only: no browser needed.
 *
 * Closing a room saves it and removes it from memory, which is what a restart does to a live room.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite(
  'resuming a session',
  {
    chrome: false,
    quiz: {
      title: `Resume ${Date.now().toString(36)}`,
      questions: [Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0), Q.tf('The sky is blue on a clear day.'), Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1)],
    },
  },
  async ({ ok, section, env }) => {
    const pres = env.presenter;
    const room = env.room;
    const answerFirstTwo = async (player) => {
      for (let i = 0; i < 2; i++) {
        const mark = player.mark();
        pres.emit('presentQuestion', { roomCode: room, questionIndex: i });
        await player.waitFor('questionPresented', { since: mark, pred: (p) => p.questionIndex === i });
        player.emit('submitAnswer', { roomCode: room, choice: 0 });
        await sleep(300);
        pres.emit('revealAnswer', { roomCode: room });
        await player.waitFor('questionRevealed', { since: mark, pred: (p) => p.questionIndex === i });
      }
    };

    section('Playing part of a quiz');
    const player = env.bot();
    const join = (bot) => bot.emit('joinRoom', { roomCode: room, username: 'resume_pl', displayName: 'Resumer', playerID: player.playerID });
    join(player);
    await player.waitFor('answerHistoryRestored');
    await answerFirstTwo(player);
    ok('two questions were played', true);

    section('Resuming after the room is gone');
    player.close();
    await sleep(300);
    pres.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    await sleep(1000);

    const incomplete = await (await env.api('GET', '/api/sessions/incomplete')).json();
    const saved = incomplete.find((s) => s.roomCode === room);
    ok('the session was saved and is listed as resumable, with its room code', !!saved, JSON.stringify(incomplete.slice(0, 2)));

    const mark = pres.mark();
    pres.emit('resumeSession', { sessionFilename: saved.filename, userId: 1, isRootAdmin: true });
    const resumed = await pres.waitFor('roomCreated', { since: mark });
    ok('the resumed room has the ORIGINAL room code', resumed.roomCode === room, `${room} -> ${resumed.roomCode}`);
    ok('the presenter is told which questions were already played', resumed.revealedQuestions.join() === '0,1');

    section('Players come back');
    const back = env.bot(player.playerID);
    const rejoin = back.mark();
    back.emit('joinRoom', { roomCode: room, username: 'resume_pl', displayName: 'Resumer', playerID: player.playerID });
    const history = await back.waitFor('answerHistoryRestored', { since: rejoin });
    ok('a player rejoins with the same room code and gets their two earlier answers back', history.answerHistory.length === 2, JSON.stringify(history).slice(0, 200));

    section('Resuming twice');
    const again = pres.mark();
    pres.emit('resumeSession', { sessionFilename: saved.filename, userId: 1, isRootAdmin: true });
    const live = await pres.waitFor('sessionAlreadyLive', { since: again });
    ok('resuming a session that is already live points at its room instead of building another', live.roomCode === room);

    section('Finishing');
    const finishMark = back.mark();
    pres.emit('presentQuestion', { roomCode: room, questionIndex: 2 });
    await back.waitFor('questionPresented', { since: finishMark, pred: (p) => p.questionIndex === 2 });
    back.emit('submitAnswer', { roomCode: room, choice: 1 });
    await sleep(300);
    pres.emit('revealAnswer', { roomCode: room });
    pres.emit('completeQuiz', { roomCode: room });
    const results = await back.waitFor('quizResults', { since: finishMark, timeout: 20000 });
    ok('the resumed quiz can be finished, and the score covers answers from before and after', results.players[0]?.totalAnswered === 3, JSON.stringify(results.players));
    await sleep(500);

    section('Room codes are never reused');
    // The room is closed (saved) with its code still belonging to the session. Someone asking for
    // that same code for a new room must get a different one, and the saved session must survive.
    const reuse = pres.mark();
    pres.emit('createRoom', { roomCode: room, quizFilename: `quiz_${env.quiz.id}.json`, userId: 1 });
    const other = await pres.waitFor('roomCreated', { since: reuse, pred: (p) => p.roomCode !== undefined });
    ok('the still-live room keeps working when its own presenter asks again', other.roomCode === room);
    pres.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    await sleep(1000);
    const taken = pres.mark();
    pres.emit('createRoom', { roomCode: room, quizFilename: `quiz_${env.quiz.id}.json`, userId: 1 });
    const fresh = await pres.waitFor('roomCreated', { since: taken });
    ok('a new room asking for a saved session\'s code is given a different one', fresh.roomCode !== room && /^\d{4}$/.test(fresh.roomCode), fresh.roomCode);
    const stillThere = (await (await env.api('GET', '/api/sessions')).json()).find((s) => s.roomCode === room);
    ok('...and the saved session is untouched: still under its code, completed, all 3 questions', !!stillThere && stillThere.status === 'completed' && stillThere.presentedCount === 3, JSON.stringify(stillThere));
    pres.emit('closeRoom', { roomCode: fresh.roomCode, userId: 1, isRootAdmin: true });
    await sleep(500);

    section('History');
    pres.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
    await sleep(1000);
    const sessions = (await (await env.api('GET', '/api/sessions')).json()).filter((s) => s.quizId === env.quiz.id);
    ok('the quiz has ONE session in the history (resuming did not add a second)', sessions.length === 1 && sessions[0].roomCode === room, JSON.stringify(sessions.map((s) => [s.sessionId, s.roomCode])));
  }
);
