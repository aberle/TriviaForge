/**
 * Test harness shared by the end-to-end suites: a tiny runner, plus an environment that creates a
 * quiz, opens rooms and drives players (socket bots and real Chrome pages).
 *
 * The environment only ever touches what it created: its own quizzes and rooms are removed at the
 * end, and nothing else on the server is closed or deleted.
 */

import { io } from 'socket.io-client';
import { BASE, ADMIN_USER, ADMIN_PASSWORD } from './config.js';
import { launchChrome, Page, sleep } from './cdp.js';

export { BASE, sleep, Page };

// ---------------------------------------------------------------------------------------------
// Question builders
// ---------------------------------------------------------------------------------------------

export const Q = {
  mc: (text, choices, correct, roundIndex) => ({ text, type: 'multiple_choice', choices, correctChoice: correct, roundIndex }),
  tf: (text, roundIndex) => ({ text, type: 'true_false', choices: ['True', 'False'], correctChoice: 0, roundIndex }),
  sa: (text, accepted, roundIndex) => ({ text, type: 'short_answer', choices: accepted, correctChoice: -1, roundIndex }),
};

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

/**
 * Run one suite. `body` receives `{ ok, section, env }`. The environment is created from
 * `options.quiz` (omit it for a suite that builds its own), and is always cleaned up.
 *
 * @param {string} name - Suite name
 * @param {{quiz?: object, chrome?: boolean, timeoutMs?: number}} options
 * @param {(t: {ok: Function, section: Function, env: object}) => Promise<void>} body
 */
export async function runSuite(name, options, body) {
  const { quiz, chrome = true, timeoutMs = 180000 } = options;
  let pass = 0;
  let fail = 0;

  const ok = (label, condition, detail = '') => {
    if (condition) {
      pass++;
      console.log(`  ✅ ${label}`);
    } else {
      fail++;
      console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    }
  };
  const section = (title) => console.log(`\n▶ ${title}`);

  console.log(`\n=== ${name} ===`);
  const watchdog = setTimeout(() => {
    console.log(`  ❌ suite timed out after ${timeoutMs / 1000}s`);
    process.exit(2);
  }, timeoutMs);

  let env;
  try {
    env = await setup({ quiz, chrome });
    await body({ ok, section, env });
  } catch (err) {
    fail++;
    console.log(`  ❌ suite aborted: ${err.message}`);
    // A picture of every open page makes a failure much easier to diagnose
    for (const [i, page] of (env?.pages || []).entries()) {
      try {
        console.log(`     screenshot: ${await page.shot(`${name.replace(/\W+/g, '-')}-abort-${i}`)}`);
      } catch {
        // page already gone
      }
    }
  } finally {
    try {
      await env?.cleanup();
    } catch {
      // best effort
    }
    clearTimeout(watchdog);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${name}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------------

async function adminSession() {
  let token = process.env.TEST_ADMIN_TOKEN;
  let user = { id: 1 };
  if (!token) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    if (!res.ok) throw new Error(`Admin login failed (${res.status}). Set TEST_ADMIN_USER / TEST_ADMIN_PASSWORD.`);
    ({ token, user } = await res.json());
  }

  const csrfRes = await fetch(`${BASE}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  const { csrfToken } = await csrfRes.json();
  const cookie = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  const request = (method, path, body) =>
    fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken, Cookie: cookie, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });

  /** Upload a file as multipart form data (returns the fetch Response). */
  const upload = (path, filename, buffer, { query = '', fields = {} } = {}) => {
    const form = new FormData();
    form.append('file', new Blob([buffer]), filename);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return fetch(`${BASE}${path}${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-csrf-token': csrfToken, Cookie: cookie },
      body: form,
    });
  };

  return { token, user, request, upload };
}

async function setup({ quiz, chrome: wantChrome }) {
  const admin = await adminSession();
  const config = await fetch(`${BASE}/api/config`).then((r) => r.json()).catch(() => ({ guestOnly: false }));

  const quizIds = [];
  const rooms = [];
  const sockets = [];
  const pages = [];
  let browser = null;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const env = {
    config,
    guestOnly: config.guestOnly === true,
    admin: admin.request,
    login: { token: admin.token, user: admin.user },
    pages,

    /** Call the admin API as the logged-in admin (returns the fetch Response). */
    api: (method, path, body) => admin.request(method, path, body),

    /** Have cleanup delete a quiz this test created some other way (e.g. by importing a file). */
    trackQuiz: (id) => quizIds.push(id),

    /** Upload a file to the admin API (multipart form data). */
    upload: (path, filename, buffer, options) => admin.upload(path, filename, buffer, options),

    /** Create a quiz through the API. */
    async createQuiz({ title = `E2E ${uid()}`, description = 'created by an end-to-end test', rounds, questions }) {
      const res = await admin.request('POST', '/api/quizzes', { title, description, rounds, questions });
      if (!res.ok) throw new Error(`could not create quiz (${res.status})`);
      const created = await res.json();
      quizIds.push(created.id);
      return { ...created, title };
    },

    /** Read a quiz back as the admin API returns it. */
    async getQuiz(id) {
      return (await admin.request('GET', `/api/quizzes/quiz_${id}.json`)).json();
    },

    async deleteQuiz(id) {
      await admin.request('DELETE', `/api/quizzes/quiz_${id}.json`);
    },

    /** A socket.io client that logs everything it receives. */
    bot(playerID = `bot-${uid()}`) {
      const socket = io(BASE, { auth: { playerID }, transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      const log = [];
      socket.onAny((event, payload) => log.push({ event, payload }));
      return {
        socket,
        log,
        playerID,
        emit: (...args) => socket.emit(...args),
        mark: () => log.length,
        all: (event, since = 0) => log.slice(since).filter((e) => e.event === event).map((e) => e.payload),
        async waitFor(event, { since = 0, pred = () => true, timeout = 5000 } = {}) {
          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const hit = log.slice(since).find((e) => e.event === event && pred(e.payload));
            if (hit) return hit.payload;
            await sleep(25);
          }
          throw new Error(`timed out waiting for "${event}"`);
        },
        close: () => socket.close(),
      };
    },

    /** Open a room for a quiz; the returned presenter bot controls it. */
    async newRoom(quizId = env.quiz.id) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      const since = env.presenter.mark();
      env.presenter.emit('createRoom', { roomCode: code, quizFilename: `quiz_${quizId}.json`, userId: admin.user.id || 1 });
      // The server picks another code if this one is taken by a saved session, so use what it answers with
      const created = await env.presenter.waitFor('roomCreated', { since });
      rooms.push(created.roomCode);
      return created.roomCode;
    },

    /** Display names of the (non-spectator) players currently in a room. */
    players(room) {
      return new Promise((resolve, reject) => {
        const bot = env.bot();
        const timer = setTimeout(() => reject(new Error('timed out reading a room')), 5000);
        bot.socket.on('roomRestored', (u) => {
          if (u.roomCode !== room) return;
          clearTimeout(timer);
          resolve(u.players.map((p) => p.name).sort());
          bot.close();
        });
        bot.emit('viewRoom', { roomCode: room, userId: admin.user.id || 1, isRootAdmin: true });
      });
    },

    // -------- browser --------

    async browser() {
      if (!browser) browser = await launchChrome();
      return browser;
    },

    /** Open a tab. */
    async open(url = 'about:blank', { width = 1300, height = 900, mobile = false } = {}) {
      const page = await Page.open(await env.browser(), url);
      pages.push(page);
      await page.setViewport(width, height, mobile);
      return page;
    },

    /** A tab signed in as the admin (for the admin and presenter pages). */
    async adminPage(path = '/admin', viewport = {}) {
      // The login page is registered at '/' (there is no '/login' route -- router.js), but this only
      // ever uses this tab to stash a token into localStorage before jumping to the real target path,
      // so which page (if any) actually renders here has never mattered.
      const page = await env.open(`${BASE}/`, { width: 1500, height: 950, ...viewport });
      // Page.open() doesn't wait for the navigation it kicks off to finish (unlike goto(), which has
      // a fixed sleep for exactly this). Touching localStorage while the tab is still on the
      // transient pre-navigation document (still "about:blank" under the hood) throws a
      // SecurityError -- invisible against localhost (load is near-instant) but a real, reproducible
      // race against an actual remote server with real network latency (found deploying to a live
      // domain for the first time). readyState is NOT a usable signal here: the transient document
      // reports 'complete' immediately too (an empty document finishes "loading" trivially fast).
      // The transient document's URL is always the literal "about:blank", though, so waiting for the
      // URL to actually become the target's is a reliable, route-independent signal that the real
      // navigation has committed.
      await page.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
      await page.eval(`localStorage.setItem('authToken', ${JSON.stringify(admin.token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); localStorage.setItem('userId', String(${admin.user.id || 1})); localStorage.setItem('isRootAdmin', 'true'); true`);
      await page.goto(`${BASE}${path}`);
      return page;
    },

    /** Fill in the join form on a player page and press Join (works in guest-only mode too). */
    async joinForm(page, room, displayName) {
      await page.waitFor(`!!document.querySelector('#playerDisplayName')`);
      if (await page.eval(`!!document.querySelector('#playerUsername')`)) {
        await page.fill('#playerUsername', `user_${uid()}`);
      }
      if (displayName !== null) await page.fill('#playerDisplayName', displayName);
      await page.fill('#roomCodeManual', room);
      await sleep(600); // the form looks the room up (identity) once the code stops changing
      await page.clickText('Join Room');
    },

    /** A phone-sized player page, already joined to `room` (default: the suite's room). */
    async player(displayName = 'Ann', { room = env.room, width = 390, height = 844, url = `${BASE}/player` } = {}) {
      const page = await env.open(url, { width, height, mobile: width < 700 });
      await env.joinForm(page, room, displayName);
      await page.waitText('Waiting for Question');
      return page;
    },

    async cleanup() {
      for (const room of rooms) env.presenter?.emit('closeRoom', { roomCode: room, userId: admin.user.id || 1, isRootAdmin: true });
      await sleep(300);

      // deleteQuiz only ever soft-deletes (is_active=false): the quiz row, its quiz_questions links
      // and its questions all stay in the database forever, permanently counted as "in use" by the
      // question bank (found the hard way -- this quietly filled a real deployment's bank with dozens
      // of leftover test questions and made the bank's own duplicate-question check misfire on a real
      // upload). Clean up properly instead, through the app's own real deletion endpoints:
      //   1. A played room auto-saves a session; session_questions has a RESTRICT foreign key
      //      specifically to protect real game history, which blocks hard-deleting a question until
      //      its session is gone. Delete any session tied to one of this suite's own quizzes first.
      //   2. Hard-delete every question the suite's quizzes contained (cascades their quiz_questions
      //      rows too). This targets exactly the question ids this suite's own quizzes ended up with,
      //      not "every question with matching text", so it can't touch anything a real user created.
      //   3. Soft-delete the quiz as before -- there is no hard-delete-quiz endpoint, so the empty,
      //      already-inactive quiz shell is the one bit of debris this can't remove.
      if (quizIds.length) {
        try {
          const sessions = await (await admin.request('GET', '/api/sessions')).json();
          for (const s of sessions) {
            if (quizIds.includes(s.quizId)) await admin.request('DELETE', `/api/sessions/${s.filename}`).catch(() => {});
          }
        } catch {
          // best effort -- a suite that never played a room has nothing to find here anyway
        }
        for (const id of quizIds) {
          try {
            const quiz = await env.getQuiz(id);
            for (const q of quiz.questions || []) {
              if (q.id) await admin.request('DELETE', `/api/questions/${q.id}?confirm=true`).catch(() => {});
            }
          } catch {
            // quiz may already be gone
          }
        }
      }
      for (const id of quizIds) await env.deleteQuiz(id).catch(() => {});

      sockets.forEach((s) => s.close());
      pages.forEach((p) => p.disconnect());
      browser?.close();
    },
  };

  // The presenter bot controls every room the environment creates
  env.presenter = env.bot(`presenter-${uid()}`);

  if (quiz) {
    env.quiz = await env.createQuiz(quiz);
    env.room = await env.newRoom(env.quiz.id);
  }
  if (wantChrome) await env.browser();
  return env;
}

// ---------------------------------------------------------------------------------------------
// Helpers for the round-play screens
// ---------------------------------------------------------------------------------------------

/**
 * A round closes into the presenter's review; results go out only when the presenter finishes it.
 * Waits for the presenter bot to be told a round closed, then finishes the review (for tests that
 * aren't about the review itself).
 */
export async function finishReviewOnClose(presenterBot, room, { since = 0, timeout = 40000 } = {}) {
  const review = await presenterBot.waitFor('roundReview', { since, timeout });
  presenterBot.emit('finishRoundReview', { roomCode: room, roundIndex: review.roundIndex });
  return review;
}

/**
 * The admin Questions panel: only one round is ever expanded at a time (clicking a collapsed round's
 * toggle collapses whichever one was open). Ensures `roundIdx` is the expanded one -- a no-op if it
 * already is -- and optionally waits for its own `.question-item` count to settle, since collapsing
 * one round and expanding another isn't instant. Tests of the collapsing feature itself manage
 * collapse state directly instead of calling this.
 */
export async function expandRound(page, roundIdx, questionCount) {
  await page.eval(`(() => {
    const b = document.querySelectorAll('.btn-collapse')[${roundIdx}];
    if (b && b.getAttribute('aria-expanded') === 'false') b.click();
    return true;
  })()`);
  if (questionCount !== undefined) {
    await page.waitFor(`document.querySelectorAll('.question-item').length === ${questionCount}`, { timeout: 8000 });
  }
  await sleep(250);
}

/**
 * The current room code shown in the presenter's navbar, once a room is live. Reads the dedicated
 * `.navbar-room-code` element rather than scanning for text containing the brand name ("TriviaForge
 * Presenter") -- that used to work only because the brand name was hardcoded; now that APP_NAME is
 * configurable (a production deploy can set it to anything), searching for the literal brand string
 * finds nothing there and silently produces an undefined room code.
 */
export async function getRoomCode(page) {
  return page.eval(`document.querySelector('.navbar-room-code')?.innerText.trim()`);
}

/** Pick a choice by its text inside the question card at `cardIndex`. */
export function pick(page, cardIndex, choiceText) {
  return page.eval(`(() => {
    const card = document.querySelectorAll('.question-card')[${cardIndex}];
    const btn = [...card.querySelectorAll('.choice-btn, .tf-btn')].find(b => b.innerText.includes(${JSON.stringify(choiceText)}));
    btn.click();
    return true;
  })()`);
}

/** Submit the open round on a player page and wait for the confirmation. */
export async function submitAnswers(page) {
  await page.clickText('Submit Answers');
  // With questions left blank the first tap only warns: tap again to send them as they are
  await sleep(350);
  if (await page.has('still unanswered')) await page.clickText('Anyway');
  await page.waitText('Answers submitted!');
}
