/**
 * A player who closes the tab and reopens it later used to be auto-rejoined only if under 5 minutes
 * had passed -- an arbitrary client-side guess. A quiz with a longer gap between rounds (reviewing
 * answers, chatting) routinely leaves a player idle past that window while the room is still very
 * much running, so they landed on the join screen (with a "Recent Rooms" quick-join button) instead
 * of being silently reconnected. Whether the room is still worth rejoining is now the server's call:
 * the saved session is always retried, and a rejection ("Room not found.") is what falls back to the
 * join screen, not a fixed age cutoff.
 *
 * That fix alone wasn't enough for a phone left idle for a while and reopened, which turned out to
 * have two further, separate causes (both covered below):
 *  - The saved session used to be written only from 'beforeunload', which a backgrounded phone often
 *    never fires at all (iOS Safari can drop a suspended tab from memory with no JS event firing);
 *    there was nothing to rejoin from. It's now kept fresh continuously while in the room.
 *  - A backgrounded phone's old socket doesn't send a clean close -- it just goes unresponsive -- and
 *    the server used to flatly refuse the new tab's join with "Already connected in another tab" for
 *    as long as the old socket looked connected (up to socket.io's own ~85s ping timeout), rather than
 *    reaching the reconnection logic that force-disconnects the stale socket and hands the room over.
 *
 * Even with both of those fixed, a real phone (same tab, never reloaded, Chrome not Safari) left idle
 * for 15+ minutes still landed on the join screen. The remaining cause: a genuine socket disconnect
 * started a client-side 30s-then-2min-then-5min chain that gave up and called the exact same code as
 * pressing "Leave Room" -- clearing the saved session and resetting local state -- purely because of
 * how long the socket had been down, regardless of whether the room was still running. Coming back
 * after that had already fired, in the SAME tab, had nothing left to rejoin from: no reload happens, so
 * the localStorage fallback never gets a chance to run either. That auto-leave is gone; a rejoin the
 * server actually rejects is what falls back to the join screen now, same as the first fix above.
 * Separately, the logic that forces a reconnect+rejoin on returning to the tab was iOS-only; Android
 * only kicked off a reconnect attempt without ever following through with the rejoin, and anything
 * else (desktop Chrome, Firefox, Samsung Internet...) had no forced-reconnect path at all. One path now
 * runs for every platform.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

// Blocks new WebSocket/XHR connection attempts once armed, redirecting them to an unreachable address
// (so a genuinely closed socket can't reconnect while "blocked"). Also compresses the app's own
// human-scale setTimeout delays (the 30s/2min visibility-debounce chain) so a test doesn't need to
// wait minutes of real wall-clock time, and lets a test fake document.hidden without actually
// backgrounding the OS-level tab (not something headless Chrome can be made to do from script).
// Installed before navigation (survives it) so it's in place for the room's very first socket connect.
const TRANSPORT_BLOCK_SHIM = `
  window.__blockTransport = false;
  window.__sockets = [];
  const OrigWebSocket = window.WebSocket;
  window.WebSocket = function (url, ...args) {
    const actualUrl = window.__blockTransport ? 'ws://127.0.0.1:1/blocked' : url;
    const ws = new OrigWebSocket(actualUrl, ...args);
    window.__sockets.push(ws);
    return ws;
  };
  window.WebSocket.prototype = OrigWebSocket.prototype;

  // Compress ONLY the exact delays the visibility/disconnect debounce chain uses (30s, 2min, 5min) --
  // not every long setTimeout indiscriminately, which also catches socket.io's own internal timers and
  // breaks the connection outright (found the hard way: a blanket "delay > 1000" rule never even
  // connects). 5min is included so this is a real mutation-testable guard against the old behavior
  // (which took a full 5 real minutes to fire) reappearing, not just a check of the new behavior.
  const origSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, delay, ...args) {
    const compressed = [30000, 2 * 60 * 1000, 5 * 60 * 1000].includes(delay) ? delay / 60 : delay;
    return origSetTimeout(fn, compressed, ...args);
  };

  let __hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => __hidden });
  window.__setHidden = (value) => { __hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
`;

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

    section('A phone backgrounded (not closed) and left idle: the old socket never sends a clean close, but a new tab still gets back into the room');
    // This browser profile's localStorage still has Ann's saved session from the section above (tabs
    // share it) -- land on a neutral page first and clear it, or this tab tries to auto-rejoin as Ann
    // instead of showing the join form for Cam. Adding the shim here still applies to the /player
    // navigation that follows -- it takes effect on every navigation from this point on, not just the
    // next one.
    const cam = await env.open(`${BASE}/login`, { width: 390, height: 844, mobile: true });
    await cam.eval(`localStorage.removeItem('trivia_last_room'); true`);
    await cam.send('Page.addScriptToEvaluateOnNewDocument', { source: TRANSPORT_BLOCK_SHIM });
    await cam.goto(`${BASE}/player`);
    await env.joinForm(cam, room, 'Cam');
    await cam.waitText('Waiting for Question');
    // Going idle: block new connection attempts WITHOUT closing the existing socket, so no close frame
    // is ever sent -- unlike a real tab close, which the earlier sections exercise
    await cam.eval('window.__blockTransport = true; true');
    await sleep(300);

    // The same browser profile's localStorage (including the saved session and the player's
    // persistent ID) carries over to this new tab, exactly as reopening the same tab on a real phone
    const camReturns = await env.open(`${BASE}/`, { width: 390, height: 844, mobile: true });
    await camReturns.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    await camReturns.goto(`${BASE}/player`);
    await camReturns.waitText('Waiting for Question', { timeout: 8000 });
    ok(
      'the returning tab lands back in the room, not the join form or an "already connected" error',
      !(await camReturns.eval(`!!document.querySelector('#roomCodeManual')`))
    );
    await camReturns.closeTab();
    await cam.closeTab();

    section('Same tab, never reloaded, genuinely disconnected a long time: still gets back in, not forgotten');
    const dee = await env.open(`${BASE}/login`, { width: 390, height: 844, mobile: true });
    await dee.eval(`localStorage.removeItem('trivia_last_room'); true`);
    await dee.send('Page.addScriptToEvaluateOnNewDocument', { source: TRANSPORT_BLOCK_SHIM });
    await dee.goto(`${BASE}/player`);
    await env.joinForm(dee, room, 'Dee');
    await dee.waitText('Waiting for Question');

    // A real disconnect (closes the live socket), with reconnection attempts blocked so it stays down
    // -- then "page hidden", standing in for the phone being put away
    await dee.eval(`window.__blockTransport = true; window.__sockets[window.__sockets.length - 1]?.close(); true`);
    await dee.eval(`window.__setHidden(true); true`);
    // Let the (compressed) away -> disconnected -> auto-leave chain run its full course while still
    // hidden and disconnected -- 30s + 2min + 5min, compressed by 60x, plus margin
    await sleep(9000);

    // The phone comes back: visible again, and the network (eventually) available again
    await dee.eval(`window.__blockTransport = false; window.__setHidden(false); true`);
    await dee.waitText('Waiting for Question', { timeout: 8000 });
    ok(
      'back in the room on its own, without ever needing the join form',
      !(await dee.eval(`!!document.querySelector('#roomCodeManual')`))
    );
    ok('the saved session survived the whole thing (never wiped by the old auto-leave)', !!(await dee.eval(`localStorage.getItem('trivia_last_room')`)));
    await dee.closeTab();

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
