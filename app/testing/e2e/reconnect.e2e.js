/**
 * Refreshing the player page: it shows "Reconnecting…" (never the landing page) while it rejoins
 * the room it was in, and falls back to the landing page only when reconnecting fails.
 *
 * A recorder is installed before each page loads and notes every screen that ever appears, so a
 * one-frame flash of the landing page can't slip through.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

// Records, from the very first paint, which screens appeared (visible elements only: the join form
// stays in the DOM, hidden, while reconnecting)
const RECORDER = `window.__seen = { landing: false, reconnecting: false, inRoom: false };
new MutationObserver(() => {
  const s = window.__seen;
  const join = document.querySelector('.join-section');
  if ((join && join.getClientRects().length > 0) || (document.body && document.body.innerText.includes('Join a Room to Start'))) s.landing = true;
  if (document.querySelector('.reconnecting-display')) s.reconnecting = true;
  if (document.body && document.body.innerText.includes('Waiting for Question')) s.inRoom = true;
}).observe(document, { childList: true, subtree: true });`;

// Simulates an unreachable server: WebSockets always fail (the polling fallback is blocked by URL)
const FAILING_WEBSOCKET = `window.__RealWebSocket = window.WebSocket;
window.WebSocket = function () {
  const ws = { readyState: 3, close() {}, send() {}, addEventListener() {}, removeEventListener() {} };
  setTimeout(() => { ws.onerror && ws.onerror(new Event('error')); ws.onclose && ws.onclose({ code: 1006 }); }, 50);
  return ws;
};`;

await runSuite(
  'reconnect on refresh',
  { quiz: { rounds: [{ title: 'R', timeLimitSeconds: null }], questions: [Q.mc('Capital of France?', ['Paris', 'Rome'], 0, 0)] }, timeoutMs: 240000 },
  async ({ ok, section, env }) => {
    const phone = { width: 390, height: 844, mobile: true };

    const seen = (page) => page.eval('window.__seen');
    const landingVisible = (page) => page.visible('.join-section');

    const openWithRecorder = async (url, { unreachable = false } = {}) => {
      const page = await env.open('about:blank', phone);
      if (unreachable) {
        await page.send('Network.enable');
        await page.send('Network.setBlockedURLs', { urls: ['*/socket.io/?*'] });
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAILING_WEBSOCKET });
      }
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
      await page.goto(url);
      return page;
    };

    // A tab on the player page with nothing saved for auto-rejoin (a saved room would make the page
    // reconnect instead of showing the join form). Cleared from a neutral page first.
    const cleanPlayerTab = async () => {
      const tab = await env.open(`${BASE}/login`, phone);
      await tab.eval(`localStorage.removeItem('trivia_last_room'); true`);
      await tab.goto(`${BASE}/player`);
      return tab;
    };

    // Join a room in a fresh tab and close it: closing saves the room for auto-rejoin
    const joinAndCloseTab = async (room) => {
      const tab = await cleanPlayerTab();
      await env.joinForm(tab, room, 'Ann');
      await tab.waitText('Waiting for Question');
      await tab.closeTab();
    };

    section('A normal refresh');
    await joinAndCloseTab(env.room);
    let page = await openWithRecorder(`${BASE}/player`);
    await page.waitText('Waiting for Question', { timeout: 15000 });
    await sleep(500);
    let s = await seen(page);
    ok('the landing page never flashes', s.landing === false, JSON.stringify(s));
    ok('a "Reconnecting" screen is shown first, then the room', s.reconnecting === true && s.inRoom === true, JSON.stringify(s));
    await page.closeTab();

    section('The room was closed while the player was away');
    const closedRoom = await env.newRoom();
    await joinAndCloseTab(closedRoom);
    env.presenter.emit('closeRoom', { roomCode: closedRoom, userId: 1, isRootAdmin: true });
    await sleep(700);
    page = await openWithRecorder(`${BASE}/player`);
    await page.waitFor(`(() => { const j = document.querySelector('.join-section'); return !!j && j.getClientRects().length > 0; })()`, { timeout: 8000, label: 'landing page after a closed room' });
    s = await seen(page);
    ok('it shows Reconnecting briefly, then falls back to the landing page quickly', s.reconnecting === true && s.landing === true && s.inRoom === false, JSON.stringify(s));
    ok('...with an explanation, and the stale room is forgotten', (await page.has('Room not found')) && (await page.eval(`localStorage.getItem('trivia_last_room')`)) === null);
    await page.closeTab();

    section('The server cannot be reached');
    const unreachableRoom = await env.newRoom();
    await joinAndCloseTab(unreachableRoom);
    page = await openWithRecorder(`${BASE}/player`, { unreachable: true });
    await sleep(2000);
    ok('it waits on the Reconnecting screen (not the landing page)', (await page.visible('.reconnecting-display')) && !(await landingVisible(page)));
    await page.waitFor(`(() => { const j = document.querySelector('.join-section'); return !!j && j.getClientRects().length > 0; })()`, { timeout: 20000, label: 'give-up fallback' });
    ok('...and gives up after a while, with a message and the landing page', await page.has("Couldn't reconnect to room"));
    await page.closeTab();

    section('Cancelling the reconnect');
    const cancelRoom = await env.newRoom();
    await joinAndCloseTab(cancelRoom);
    page = await openWithRecorder(`${BASE}/player`, { unreachable: true });
    await sleep(1500);
    await page.clickText('Join a different room');
    await sleep(500);
    ok('"Join a different room" goes straight to the landing page and forgets the saved room', (await landingVisible(page)) && (await page.eval(`localStorage.getItem('trivia_last_room')`)) === null);
    await page.send('Network.setBlockedURLs', { urls: [] });
    await page.eval('window.WebSocket = window.__RealWebSocket; true');
    await sleep(6000);
    ok('...and does not rejoin the old room behind their back once the server is reachable', !(await page.has('Waiting for Question')));
    await page.closeTab();

    section('Links and first visits');
    const wipe = await env.open(`${BASE}/login`, phone);
    await wipe.eval(`localStorage.removeItem('trivia_last_room'); true`);
    await wipe.closeTab();
    page = await openWithRecorder(`${BASE}/player`);
    await sleep(1500);
    s = await seen(page);
    ok('a first visit (nothing saved) goes straight to the landing page', s.landing === true && s.reconnecting === false, JSON.stringify(s));
    await page.closeTab();

    const savedRoom = await env.newRoom();
    await joinAndCloseTab(savedRoom);
    page = await openWithRecorder(`${BASE}/player?room=9999`);
    await sleep(1500);
    s = await seen(page);
    ok('a link to a different room goes to the landing page with that code, not the reconnecting screen', s.landing === true && s.reconnecting === false && (await page.eval(`document.querySelector('#roomCodeManual')?.value`)) === '9999', JSON.stringify(s));
    await page.closeTab();

    section('Leaving on purpose');
    const leaveRoom = await env.newRoom();
    const desktop = await env.open(`${BASE}/login`);
    await desktop.eval(`localStorage.removeItem('trivia_last_room'); true`);
    await desktop.goto(`${BASE}/player`);
    await env.joinForm(desktop, leaveRoom, 'Ann');
    await desktop.waitText('Waiting for Question');
    await desktop.goto(await desktop.eval('location.href')); // a refresh saves the room key
    await desktop.waitText('Waiting for Question', { timeout: 15000 });
    await desktop.clickText('Leave Room');
    await sleep(500);
    await desktop.eval(`[...document.querySelectorAll('button.btn-danger')].filter(b => b.innerText.includes('Leave Room')).pop().click(); true`);
    await sleep(1500);
    ok('after leaving on purpose the saved room is forgotten', (await desktop.eval(`localStorage.getItem('trivia_last_room')`)) === null);
    await desktop.goto(`${BASE}/player`);
    await sleep(2500);
    ok('...so a refresh shows the landing page, not the room they left', (await landingVisible(desktop)) && !(await desktop.has('Waiting for Question')));
    ok('no uncaught errors', desktop.realErrors().length === 0, desktop.realErrors().join(' | '));
  }
);
