/**
 * A player who closes the tab and reopens it later used to be auto-rejoined only if under 5 minutes
 * had passed -- an arbitrary client-side guess. A quiz with a longer gap between rounds (reviewing
 * answers, chatting) routinely leaves a player idle past that window while the room is still very
 * much running, so they landed on the join screen (with a "Recent Rooms" quick-join button) instead
 * of being silently reconnected. Whether the room is still worth rejoining is now the server's call:
 * the saved session is always retried, and a rejection ("Room not found.") is what falls back to the
 * join screen, not a fixed age cutoff.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

await runSuite(
  'player idle rejoin',
  { quiz: { title: `Idle Rejoin ${Date.now().toString(36)}`, rounds: [{ title: 'R1' }], questions: [Q.mc('Q1', ['a', 'b'], 0, 0)] } },
  async ({ ok, section, env }) => {
    const room = env.room;
    const ann = await env.player('Ann', { room, width: 390, height: 844 });
    await sleep(300);
    const username = await ann.eval(`localStorage.getItem('playerUsername')`);
    await ann.closeTab();
    await sleep(300);

    // A fresh tab, seeded with a session saved 6 minutes ago -- well past the old 5-minute cutoff --
    // simulates a closed-and-reopened tab (not a reload: no live in-memory room state to re-stamp it)
    const seedOldSession = (page, roomCode) =>
      page.eval(`localStorage.setItem('trivia_last_room', JSON.stringify({ roomCode: ${JSON.stringify(roomCode)}, username: ${JSON.stringify(username)}, displayName: 'Ann', timestamp: Date.now() - 6 * 60000 })); true`);

    section('The room is still running: the player is silently reconnected, no join screen');
    const fresh = await env.open(`${BASE}/`);
    await fresh.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    await seedOldSession(fresh, room);
    await fresh.goto(`${BASE}/player`);
    await fresh.waitText('Waiting for Question', { timeout: 8000 });
    ok('the player lands back in the room rather than the join form', !(await fresh.eval(`!!document.querySelector('#roomCodeManual')`)));
    await fresh.closeTab();

    section('The room is genuinely gone: still falls back to the join form, rather than hanging');
    env.presenter.emit('closeRoom', { roomCode: room, userId: env.login.user.id || 1, isRootAdmin: true });
    await sleep(500);
    const afterClose = await env.open(`${BASE}/`);
    await afterClose.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    await seedOldSession(afterClose, room);
    await afterClose.goto(`${BASE}/player`);
    await sleep(2000);
    ok('the join form appears instead of hanging on "Reconnecting..."', await afterClose.eval(`!!document.querySelector('#roomCodeManual')`));

    ok('no uncaught errors', afterClose.realErrors().length === 0, afterClose.realErrors().join(' | '));
  }
);
