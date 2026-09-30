/**
 * If an admin's socket genuinely drops (phone locked for a while, wifi blip) and someone else changes
 * the same quiz in the meantime, a 'quizChanged' broadcast sent while disconnected is missed outright
 * -- socket.io does not replay it. AdminPage.vue resyncs on reconnect (and on the tab becoming visible
 * again) through the same modal-aware path a live notification uses, so a manual page reload is never
 * required to catch up.
 *
 * Forcing a REAL disconnect in headless Chrome took real trial and error (see the session notes this
 * came out of): CDP's Network.emulateNetworkConditions doesn't actually interrupt an already-open
 * WebSocket, so "going offline" that way never disconnects anything. This suite instead intercepts
 * `WebSocket`/`XMLHttpRequest` (added via Page.addScriptToEvaluateOnNewDocument, so it survives
 * navigation) and redirects new connection attempts to a real, unreachable address during a blocked
 * window -- a genuinely failing native WebSocket fires real close/error events (onclose/onerror
 * property handlers included) that engine.io's own reconnection logic correctly reacts to, unlike a
 * hand-rolled fake EventTarget standing in for one.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TITLE = `Reconnect Resync ${Date.now().toString(36)}`;

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

await runSuite(
  'admin reconnect resync',
  {
    chrome: true,
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Round A' }],
      questions: [Q.mc('Original question', ['x', 'y'], 0, 0)],
    },
  },
  async ({ ok, section, env }) => {
    section('A change made entirely while the admin\'s socket was genuinely disconnected still shows up once it reconnects');

    // localStorage isn't reachable on about:blank -- open at the real origin first (same reason
    // env.adminPage() does), THEN install the shim (it applies to the NEXT navigation onward, so it
    // will be in place once we goto /admin below), THEN set the auth token, THEN navigate for real.
    const admin = await env.open(`${BASE}/`);
    await admin.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    const consoleLog = [];
    admin.on('Runtime.consoleAPICalled', (p) => {
      consoleLog.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    });
    await installTransportBlockShim(admin);

    const token = env.login.token;
    const userId = env.login.user.id || 1;
    await admin.eval(`localStorage.setItem('authToken', ${JSON.stringify(token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); localStorage.setItem('userId', String(${userId})); localStorage.setItem('isRootAdmin', 'true'); true`);
    await admin.goto(`${BASE}/admin`);
    await admin.waitFor(`document.querySelector('.admin-page')`);
    await sleep(500);
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).click(); true`);
    await admin.waitFor(`document.querySelectorAll('.round-header').length === 1`);
    await sleep(400);
    await admin.eval(`document.querySelectorAll('.round-number')[0].click(); true`);
    await sleep(300);
    ok('starts with 1 question', (await admin.eval(`document.querySelectorAll('.question-item').length`)) === 1);

    const waitForLog = async (substr, since, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (consoleLog.slice(since).some((l) => l.includes(substr))) return true;
        await sleep(100);
      }
      return false;
    };

    const sinceBlock = consoleLog.length;
    await admin.eval(`window.__blockTransport = true; window.__sockets[window.__sockets.length - 1]?.close(); true`);
    ok('the socket genuinely disconnects once blocked', await waitForLog('Socket.IO disconnected', sinceBlock));

    // A second admin (a plain API call stands in for a separate session) changes the quiz while this
    // tab's socket is fully, confirmedly down -- the broadcast for this has nowhere to land
    const quiz = await env.getQuiz(env.quiz.id);
    await env.api('PUT', `/api/quizzes/${env.quiz.filename}`, {
      title: TITLE,
      description: '',
      rounds: quiz.rounds,
      questions: [...quiz.questions, Q.mc('Added while genuinely disconnected', ['x', 'y'], 0, 0)],
    });
    await sleep(800);
    ok('...and while still disconnected, the change is genuinely missed (still 1)', (await admin.eval(`document.querySelectorAll('.question-item').length`)) === 1);

    const sinceUnblock = consoleLog.length;
    await admin.eval(`window.__blockTransport = false; true`);
    ok('the socket genuinely reconnects once unblocked', await waitForLog('Socket.IO connected', sinceUnblock));
    await admin.waitFor(`document.querySelectorAll('.question-item').length === 2`, { timeout: 8000 });
    ok('the missed change is picked up once reconnected, no manual reload needed', await admin.has('Added while genuinely disconnected'));

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
