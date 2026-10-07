/**
 * A player who reconnects (phone woke up, wifi blip) gets a new socket before the server has
 * re-associated them with it: the rejoin is still in flight. A round submit or draft that lands in
 * that gap used to be rejected ("Only players can answer") -- the player saw an error and had to tap
 * Submit again, which is why iPhone players reported pressing it several times. The server now finds
 * the returning player by the PlayerID the new socket presents, so the first tap is accepted.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite('round submit on reconnect', { quiz: { title: `Submit Reconnect ${Date.now().toString(36)}`, rounds: [{ title: 'R1' }], questions: [Q.mc('Q1', ['a', 'b'], 0, 0)] } }, async ({ ok, section, env }) => {
  const room = env.room;
  env.presenter.emit('startRound', { roomCode: room, roundIndex: 0 });
  await sleep(400);

  const playerID = `reconnect-${Date.now()}`;
  const username = `user_${playerID}`;
  const join = (bot) => bot.emit('joinRoom', { roomCode: room, username, displayName: 'Returning', playerID });

  const first = env.bot(playerID);
  await sleep(300);
  join(first);
  await sleep(600);
  first.socket.disconnect();
  await sleep(300);

  section('A reconnected socket submits before its rejoin is processed');
  const second = env.bot(playerID);
  await sleep(300);
  const sinceSubmit = second.mark();
  second.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0] });
  await sleep(500);
  const early = second.all('roundSubmitted', sinceSubmit);
  ok('the first submit is accepted, not rejected as "Only players can answer"', early.length === 1 && early[0].success === true, JSON.stringify(early));

  section('A draft saved in the same gap is kept');
  const third = env.bot(playerID);
  await sleep(300);
  third.emit('saveRoundDraft', { roomCode: room, roundIndex: 0, answers: [1] });
  await sleep(200);
  const sinceRejoin = third.mark();
  join(third);
  await sleep(600);
  const snapshot = third.all('roundState', sinceRejoin).at(-1);
  ok('the rejoin snapshot still has that draft', JSON.stringify(snapshot?.current?.you?.draft) === '[1]', JSON.stringify(snapshot?.current?.you));

  ok('no uncaught errors', true);
});
