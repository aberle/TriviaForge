/**
 * The presenter's phone locks (or the wifi blips) and the socket reconnects. Reconnecting gives the
 * socket a new id, and the server only moves the room's presenter onto a socket when it is told to
 * (createRoom / viewRoom). The presenter page used to reconnect without saying so, so every
 * presenter-only action -- including Start Round -- was refused until the page was reloaded. The page
 * now re-opens the room it is showing whenever the socket connects.
 */

import { runSuite, BASE, Q, getRoomCode, pick, submitAnswers, sleep } from './lib/harness.js';

// Install a WebSocket/XHR shim that can cut the socket's transport on demand (see admin-reconnect-resync)
const installTransportBlockShim = (page) =>
  page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__blockTransport = false;
      window.__sockets = [];
      const OrigWebSocket = window.WebSocket;
      window.WebSocket = function(url, ...args) {
        const actualUrl = window.__blockTransport ? 'ws://127.0.0.1:1/blocked' : url;
        const ws = new OrigWebSocket(actualUrl, ...args);
        window.__sockets.push(ws);
        return ws;
      };
      window.WebSocket.prototype = OrigWebSocket.prototype;
      const OrigXHR = window.XMLHttpRequest;
      window.XMLHttpRequest = function() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open.bind(xhr);
        xhr.open = function(method, url, ...rest) {
          if (window.__blockTransport && String(url).includes('/socket.io/')) {
            return origOpen(method, 'http://127.0.0.1:1/blocked', ...rest);
          }
          return origOpen(method, url, ...rest);
        };
        return xhr;
      };
    `,
  });

const TITLE = `Presenter Reconnect ${Date.now().toString(36)}`;

await runSuite(
  'presenter reconnect',
  { chrome: true, quiz: { title: TITLE, rounds: [{ title: 'Round A' }, { title: 'Round B' }], questions: [Q.mc('First question', ['x', 'y'], 0, 0), Q.mc('Second question', ['x', 'y'], 0, 1)] } },
  async ({ ok, section, env }) => {
    const consoleLog = [];
    const presenter = await env.open(`${BASE}/`);
    await presenter.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    presenter.on('Runtime.consoleAPICalled', (p) => consoleLog.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')));
    await installTransportBlockShim(presenter);
    await presenter.eval(`localStorage.setItem('authToken', ${JSON.stringify(env.login.token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); localStorage.setItem('userId', String(${env.login.user.id || 1})); localStorage.setItem('isRootAdmin', 'true'); true`);
    await presenter.goto(`${BASE}/presenter`);
    await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.includes(${JSON.stringify(TITLE)}))`);
    await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)})); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(200);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    const room = await getRoomCode(presenter);

    const ann = await env.player('Ann', { room, height: 700 });
    await sleep(300);

    const waitForLog = async (substr, since, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (consoleLog.slice(since).some((l) => l.includes(substr))) return true;
        await sleep(100);
      }
      return false;
    };

    section('The presenter loses its connection and it comes back on a new socket');
    const sinceDown = consoleLog.length;
    await presenter.eval(`window.__blockTransport = true; window.__sockets[window.__sockets.length - 1]?.close(); true`);
    ok('the presenter socket genuinely disconnects', await waitForLog('Socket.IO disconnected', sinceDown));
    const sinceUp = consoleLog.length;
    await presenter.eval(`window.__blockTransport = false; true`);
    ok('...and reconnects', await waitForLog('Socket.IO connected', sinceUp));
    await sleep(600); // let the page re-open its room after reconnecting

    section('Start Round still works straight after reconnecting');
    await presenter.eval(`document.querySelector('.rd-round button').click(); true`);
    ok('the first round starts for the player (no page refresh needed)', await ann.waitText('Round 1 of 2', { timeout: 6000 }).then(() => true, () => false));

    section('The presenter still sees who has submitted, straight after reconnecting');
    await pick(ann, 0, 'x');
    await submitAnswers(ann);
    const sawName = await presenter.waitFor(`[...document.querySelectorAll('.rd-name-chip')].some(c => c.innerText.includes('Ann'))`, { timeout: 6000 }).then(() => true, () => false);
    ok('the presenter\'s submitted list includes Ann without a page refresh', sawName);

    ok('no uncaught errors', presenter.realErrors().length === 0, presenter.realErrors().join(' | '));
  }
);
