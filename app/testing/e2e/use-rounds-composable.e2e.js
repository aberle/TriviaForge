/**
 * The useRounds composable (the client side of the round protocol, shared by the player, presenter
 * and display pages) wired to real sockets on a real server. Needs no browser.
 */

import { runSuite, Q, sleep } from './lib/harness.js';
import { startVite } from '../component/lib.js';

await runSuite(
  'useRounds composable',
  {
    chrome: false,
    quiz: {
      title: `Composable ${Date.now().toString(36)}`,
      rounds: [{ title: 'R1', timeLimitSeconds: 30 }, { title: 'R2', timeLimitSeconds: null }],
      questions: [Q.mc('Question one text here', ['a', 'b'], 0, 0), Q.mc('Question two text here', ['a', 'b'], 1, 1)],
    },
  },
  async ({ ok, env }) => {
    const vite = await startVite();
    try {
      const { useRounds } = await vite.ssrLoadModule('/src/composables/useRounds.js');
      // useRounds expects useSocket()'s on/off; a raw socket.io client has the same shape
      const adapt = (bot) => ({ on: (e, cb) => bot.socket.on(e, cb), off: (e, cb) => bot.socket.off(e, cb) });
      const room = env.room;
      const presBot = env.presenter;
      const plBot = env.bot('composable-pl');
      const pres = useRounds(adapt(presBot));
      const pl = useRounds(adapt(plBot));
      pres.attach();
      pl.attach();
      pl.attach(); // attaching twice must not register the listeners twice

      presBot.emit('viewRoom', { roomCode: room, userId: 1, isRootAdmin: true });
      plBot.emit('joinRoom', { roomCode: room, username: 'cc_player', displayName: 'cc_player', playerID: plBot.playerID });
      await sleep(600);
      ok('the player snapshot has 2 rounds, idle, next = 0', pl.rounds.value.length === 2 && pl.phase.value === 'idle' && pl.nextRoundIndex.value === 0);
      ok('the presenter snapshot includes each round\'s question indexes', JSON.stringify(pres.rounds.value[0]?.questionIndexes) === '[0]');

      presBot.emit('startRound', { roomCode: room, roundIndex: 0 });
      await sleep(500);
      ok('roundStarted opens the round with its title', pl.phase.value === 'open' && pl.current.value?.title === 'R1');
      const skew = Math.abs(Date.now() - new Date(pl.current.value.clientStartedAt).getTime());
      ok("the round's start time is corrected to this device's clock", skew < 1500, `skew=${skew}ms`);
      ok('the presenter gets the list of submitted names', Array.isArray(pres.progress.value?.submittedNames));

      plBot.emit('saveRoundDraft', { roomCode: room, roundIndex: 0, answers: [1] });
      plBot.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0] });
      await sleep(500);
      ok('the submit acknowledgement marks the player as submitted', pl.submitted.value === true);
      ok('the presenter sees 1 of 1 submitted, by name', pres.progress.value?.submitted === 1 && pres.progress.value.submittedNames[0] === 'cc_player');

      presBot.emit('endRound', { roomCode: room, roundIndex: 0 });
      await sleep(500);
      ok('roundEnded: phase ended, round 0 completed, next = 1', pl.phase.value === 'ended' && pl.completed.value.join() === '0' && pl.nextRoundIndex.value === 1);
      ok("the player's own result and rank are present", pl.lastEnded.value?.you?.roundScore === 1 && pl.lastEnded.value.you.rank === 1);
      ok("the presenter's copy has no personal result", pres.lastEnded.value && !('you' in pres.lastEnded.value));

      // A fresh connection for the same player gets a snapshot of the state between rounds
      plBot.close();
      await sleep(300);
      const plBot2 = env.bot('composable-pl');
      const pl2 = useRounds(adapt(plBot2));
      pl2.attach();
      plBot2.emit('joinRoom', { roomCode: room, username: 'cc_player', displayName: 'cc_player', playerID: plBot2.playerID });
      await sleep(600);
      ok('rejoining restores the ended phase, their result and bumps the snapshot version', pl2.phase.value === 'ended' && pl2.lastEnded.value?.you?.roundScore === 1 && pl2.snapshotVersion.value === 1);

      pl2.reset();
      ok('reset clears everything', pl2.rounds.value.length === 0 && pl2.phase.value === 'idle' && pl2.lastEnded.value === null);
    } finally {
      await vite.close();
    }
  }
);
