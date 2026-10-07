/**
 * The presenter's "N of M players have submitted" count. A player whose phone is locked (or whose
 * connection dropped) still owes the round an answer, so they stay in the total. Leaving them out made
 * the count read 4/4 with five players in the game while the fifth had not answered yet.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite('round progress count', { quiz: { title: `Progress Count ${Date.now().toString(36)}`, rounds: [{ title: 'R1' }], questions: [Q.mc('Q1', ['a', 'b'], 0, 0)] } }, async ({ ok, section, env }) => {
  const room = env.room;
  const pres = env.presenter;
  const latest = () => pres.all('roundProgress').at(-1);

  const names = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'];
  const players = [];
  for (const name of names) {
    const playerID = `count-${name}-${Date.now()}`;
    const bot = env.bot(playerID);
    await sleep(150);
    bot.emit('joinRoom', { roomCode: room, username: `user_${name.toLowerCase()}_${Date.now()}`, displayName: name, playerID });
    players.push({ name, bot, playerID });
  }
  await sleep(500);

  pres.emit('startRound', { roomCode: room, roundIndex: 0 });
  await sleep(500);

  section('Five players in the round, one of them drops off the connection');
  players[4].bot.socket.disconnect();
  await sleep(500);
  ok('the presenter counts all five players, including the one who dropped off', latest()?.total === 5, JSON.stringify(latest()));

  section('The other four submit: it reads 4 of 5, not 4 of 4');
  for (const p of players.slice(0, 4)) {
    p.bot.emit('submitRound', { roomCode: room, roundIndex: 0, answers: [0] });
    await sleep(150);
  }
  await sleep(400);
  ok('four of five have submitted', latest()?.submitted === 4 && latest()?.total === 5, JSON.stringify(latest()));
  ok('and the presenter is told which four', JSON.stringify((latest()?.submittedNames || []).sort()) === JSON.stringify(['Ann', 'Bob', 'Cy', 'Dee']), JSON.stringify(latest()?.submittedNames));

  ok('no uncaught errors', true);
});
