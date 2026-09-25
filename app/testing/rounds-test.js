/**
 * TriviaForge - Rounds integration test (v5.16.0)
 *
 * Drives a running server over real Socket.IO connections: a presenter, three players,
 * a late joiner and a display. Covers the round flow end to end, with emphasis on the
 * things that are easy to get wrong: answer leaks while a round is open, timer expiry,
 * end-round races, presenter-only controls, reconnects, resume, and persistence.
 *
 * Usage (server must be running, ideally with DEBUG_MODE=true so auth rate limits are off):
 *   TEST_BASE_URL=http://localhost:3000 TEST_ADMIN_PASSWORD=changeme node testing/rounds-test.js
 *
 * Optional: set DATABASE_URL to also verify what was persisted (session_rounds etc.).
 * Takes about 30 seconds (one round is timed at 10 seconds).
 */

import { io } from 'socket.io-client';
import pg from 'pg';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'changeme';
const RUN_ID = Date.now().toString(36);
const ROUND1_SECONDS = 10;

// ---------- tiny assertion helpers ----------

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const section = (title) => console.log(`\n▶ ${title}`);

// ---------- admin API (to create the quiz) ----------

async function adminSession() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  });
  if (!login.ok) throw new Error(`Admin login failed (${login.status}). Set TEST_ADMIN_PASSWORD.`);
  const { token } = await login.json();

  const csrfRes = await fetch(`${BASE}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  const { csrfToken } = await csrfRes.json();
  const cookie = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'x-csrf-token': csrfToken,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

// ---------- socket client wrapper ----------

function connect(name, playerID) {
  const socket = io(BASE, { auth: { playerID }, transports: ['websocket'], forceNew: true });
  const log = [];
  socket.onAny((event, payload) => log.push({ event, payload }));

  return {
    name,
    playerID,
    socket,
    log,
    mark: () => log.length,
    all: (event, since = 0) => log.slice(since).filter((e) => e.event === event).map((e) => e.payload),
    async waitFor(event, { since = 0, pred = () => true, timeout = 5000 } = {}) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const hit = log.slice(since).find((e) => e.event === event && pred(e.payload));
        if (hit) return hit.payload;
        await sleep(25);
      }
      throw new Error(`${name}: timed out waiting for "${event}"`);
    },
    async expectNo(event, { since = 0, ms = 400 } = {}) {
      await sleep(ms);
      return !log.slice(since).some((e) => e.event === event);
    },
    close: () => socket.close(),
  };
}

async function joinRoom(client, roomCode, { spectator = false } = {}) {
  const since = client.mark();
  client.socket.emit('joinRoom', {
    roomCode,
    username: client.name,
    displayName: spectator ? 'Spectator Display' : client.name,
    playerID: client.playerID,
    isSpectator: spectator,
  });
  return client.waitFor('roundState', { since });
}

// ---------- the test ----------

const quiz = {
  title: `Rounds Test ${RUN_ID}`,
  description: 'Created by testing/rounds-test.js',
  rounds: [
    { title: 'Warmup', timeLimitSeconds: ROUND1_SECONDS },
    { title: 'Finals', timeLimitSeconds: null },
  ],
  questions: [
    { text: 'What is the capital of France?', type: 'multiple_choice', choices: ['Paris', 'Rome', 'Oslo'], correctChoice: 0, roundIndex: 0 },
    { text: 'The sky is blue on a clear day.', type: 'true_false', choices: ['True', 'False'], correctChoice: 0, roundIndex: 0 },
    { text: 'Name the largest planet in our solar system', type: 'short_answer', choices: ['Jupiter'], correctChoice: -1, roundIndex: 0 },
    { text: 'How many legs does a spider have?', type: 'multiple_choice', choices: ['Six', 'Eight', 'Ten'], correctChoice: 1, roundIndex: 1 },
    { text: 'Which planet is known as the Red Planet?', type: 'multiple_choice', choices: ['Venus', 'Mars', 'Saturn'], correctChoice: 1, roundIndex: 1 },
  ],
};

const clients = [];
const track = (c) => {
  clients.push(c);
  return c;
};

async function main() {
  const api = await adminSession();
  let quizId;
  let roomCode;
  let resumedRoomCode;

  try {
    section('Setup: create a 2-round quiz and a room');
    const created = await api('POST', '/api/quizzes', quiz);
    check('quiz created', created.status === 200 && created.data?.id, JSON.stringify(created.data)?.slice(0, 120));
    quizId = created.data.id;

    const fetched = await api('GET', `/api/quizzes/quiz_${quizId}.json`);
    check('quiz round-trips its rounds', fetched.data.rounds.length === 2 && fetched.data.rounds[0].timeLimitSeconds === ROUND1_SECONDS);
    check('questions carry roundIndex', fetched.data.questions.map((q) => q.roundIndex).join() === '0,0,0,1,1');

    roomCode = String(1000 + Math.floor(Math.random() * 9000));
    const presenter = track(connect('presenter', `pres-${RUN_ID}`));
    presenter.socket.emit('createRoom', { roomCode, quizFilename: `quiz_${quizId}.json`, userId: 1 });
    const roomCreated = await presenter.waitFor('roomCreated');
    check('roomCreated includes the rounds', roomCreated.rounds?.length === 2 && roomCreated.rounds[0].questionIndexes.join() === '0,1,2');
    const presenterSnapshot = await presenter.waitFor('roundState');
    check('presenter gets an idle round snapshot', presenterSnapshot.phase === 'idle' && presenterSnapshot.nextRoundIndex === 0);

    const p1 = track(connect(`p1_${RUN_ID}`, `id-p1-${RUN_ID}`));
    const p2 = track(connect(`p2_${RUN_ID}`, `id-p2-${RUN_ID}`));
    const p3 = track(connect(`p3_${RUN_ID}`, `id-p3-${RUN_ID}`));
    const display = track(connect(`display_${RUN_ID}`, `id-display-${RUN_ID}`));
    for (const p of [p1, p2, p3]) await joinRoom(p, roomCode);
    await joinRoom(display, roomCode, { spectator: true });

    section('Presenter-only controls and legacy guards');
    let mark = p1.mark();
    p1.socket.emit('startRound', { roomCode, roundIndex: 0 });
    await p1.waitFor('roomError', { since: mark });
    check('a player cannot start a round', await display.expectNo('roundStarted'));

    mark = presenter.mark();
    presenter.socket.emit('presentQuestion', { roomCode, questionIndex: 0 });
    const guard = await presenter.waitFor('roomError', { since: mark });
    check('presentQuestion is rejected in a round quiz', /rounds/i.test(guard));

    mark = presenter.mark();
    presenter.socket.emit('startAutoMode', { roomCode, questionTimer: 20, revealDelay: 5 });
    const autoGuard = await presenter.waitFor('roomError', { since: mark });
    check('auto-pilot is rejected in a round quiz', /auto-pilot/i.test(autoGuard));

    mark = p1.mark();
    p1.socket.emit('completeQuiz', { roomCode });
    await p1.waitFor('roomError', { since: mark });
    check('a player cannot complete the quiz', true);

    section('Round 1 (timed): start, drafts, submit, no leaks');
    const windowStart = { p1: p1.mark(), p2: p2.mark(), p3: p3.mark(), display: display.mark() };
    presenter.socket.emit('startRound', { roomCode, roundIndex: 0 });
    const started = await p1.waitFor('roundStarted', { since: windowStart.p1 });
    await display.waitFor('roundStarted', { since: windowStart.display });
    check('roundStarted has the timer', started.timeLimitSeconds === ROUND1_SECONDS && started.endsAt - started.serverNow > 5000);
    check('round shows all 3 questions', started.questions.length === 3 && started.questions.map((q) => q.index).join() === '0,1,2');
    check('questions are sanitized', started.questions.every((q) => !('correctChoice' in q) && !('acceptedAnswers' in q)));
    check('short-answer choices are hidden', started.questions[2].choices.length === 0);

    // P2 saves a draft (never submits); P1 submits; P3 does nothing
    p2.socket.emit('saveRoundDraft', { roomCode, roundIndex: 0, answers: [0, 1, 'jupitar'] });
    mark = p1.mark();
    p1.socket.emit('submitRound', { roomCode, roundIndex: 0, answers: [0, 0, 'Jupiter'] });
    const ack = await p1.waitFor('roundSubmitted', { since: mark });
    check('submit is acknowledged', ack.success === true);
    const progress = await presenter.waitFor('roundProgress', { pred: (p) => p.submitted === 1 && p.submittedNames?.length === 1 });
    check('presenter sees who submitted', progress.submittedNames[0] === p1.name && progress.total === 3);
    const playerProgress = await p3.waitFor('roundProgress', { since: windowStart.p3, pred: (p) => p.submitted === 1 });
    check('players see counts but not names', !('submittedNames' in playerProgress));

    // Edits after submitting are only drafts: they don't count unless the player resubmits
    p1.socket.emit('saveRoundDraft', { roomCode, roundIndex: 0, answers: [1, 1, 'Mars'] });
    await sleep(200);

    // Leak scan: everything players/display received while the round was open
    let leaks = [];
    for (const [label, client] of [['p1', p1], ['p2', p2], ['p3', p3], ['display', display]]) {
      const end = client.log.findIndex((e, i) => i >= windowStart[label] && e.event === 'roundEnded');
      const seen = client.log.slice(windowStart[label], end === -1 ? undefined : end);
      for (const { event, payload } of seen) {
        const text = JSON.stringify(payload);
        if (/"correctChoice"|"acceptedAnswers"|Jupiter/.test(text)) leaks.push(`${label}:${event}`);
        if (event === 'playerListUpdate') {
          for (const pl of payload.players) {
            if (Object.keys(pl.answers || {}).length > 0 || (pl.choice !== null && pl.choice !== undefined)) {
              leaks.push(`${label}:playerListUpdate exposes ${pl.name}'s answers`);
            }
          }
        }
      }
    }
    check('no answers leak while the round is open', leaks.length === 0, leaks.join('; '));

    section('Reconnect keeps the draft');
    p2.close();
    await sleep(300);
    const p2b = track(connect(p2.name, p2.playerID));
    const snapshot = await joinRoom(p2b, roomCode);
    check('rejoin snapshot has the open round', snapshot.phase === 'open' && snapshot.current?.roundIndex === 0);
    check('rejoin snapshot restores the draft', JSON.stringify(snapshot.current.you.draft) === JSON.stringify([0, 1, 'jupitar']));
    check('rejoin keeps the remaining time', snapshot.current.endsAt > snapshot.current.serverNow);

    section(`Timer expiry ends round 1 (waiting ~${ROUND1_SECONDS + 2}s)`);
    const ended = await p1.waitFor('roundEnded', { timeout: (ROUND1_SECONDS + 6) * 1000 });
    check('round ended by timeout', ended.reason === 'timeout' && ended.roundIndex === 0 && ended.isLastRound === false);
    check('correct answers are revealed after the round', ended.questions[0].correctChoice === 0 && ended.questions[2].acceptedAnswers?.[0]?.answer_text === 'Jupiter');
    check('standings rank players', ended.standings.map((s) => `${s.rank}:${s.name}:${s.totalScore}`).join() === `1:${p1.name}:3,2:${p2.name}:2,3:${p3.name}:0`, JSON.stringify(ended.standings));
    check('edits made after submitting do not count until resubmitted (personal result uses the submission)', ended.you.roundScore === 3 && ended.you.rank === 1 && ended.you.results.every((r) => r === true));
    const p2Ended = await p2b.waitFor('roundEnded');
    check("P2's unsubmitted draft was auto-submitted (fuzzy short answer graded)", p2Ended.you.answers.join() === '0,1,jupitar' && p2Ended.you.results.join() === 'true,false,true');
    const p3Ended = await p3.waitFor('roundEnded');
    check('a player who never answered scores zero', p3Ended.you.roundScore === 0 && p3Ended.you.answers.every((a) => a === null));
    const displayEnded = await display.waitFor('roundEnded');
    check('the display gets the leaderboard without personal data', displayEnded.standings.length === 3 && !('you' in displayEnded));

    mark = presenter.mark();
    presenter.socket.emit('startRound', { roomCode, roundIndex: 0 });
    const replay = await presenter.waitFor('roomError', { since: mark });
    check('a played round cannot be restarted', /already been played/i.test(replay));

    section('Round 2 (untimed): late joiner, kick, race');
    const r2Mark = { p1: p1.mark(), p2: p2b.mark(), p3: p3.mark(), presenter: presenter.mark(), display: display.mark() };
    presenter.socket.emit('startRound', { roomCode, roundIndex: 1 });
    const started2 = await p1.waitFor('roundStarted', { since: r2Mark.p1 });
    check('untimed round has no end time', started2.timeLimitSeconds === null && started2.endsAt === null);

    p1.socket.emit('submitRound', { roomCode, roundIndex: 1, answers: [0, 0] });
    await p1.waitFor('roundSubmitted', { since: r2Mark.p1 });
    p1.socket.emit('submitRound', { roomCode, roundIndex: 1, answers: [1, 1] }); // changed their mind: resubmit
    await p1.waitFor('roundSubmitted', { since: r2Mark.p1, pred: () => p1.all('roundSubmitted', r2Mark.p1).length >= 2 });
    check('a player can resubmit to change their answers', p1.all('roundSubmitted', r2Mark.p1).every((a) => a.success === true) && p1.all('roundSubmitted', r2Mark.p1).length === 2);

    const p4 = track(connect(`p4_${RUN_ID}`, `id-p4-${RUN_ID}`));
    const lateSnapshot = await joinRoom(p4, roomCode);
    check('a late joiner gets the open round', lateSnapshot.phase === 'open' && lateSnapshot.current.roundIndex === 1 && lateSnapshot.lastEnded?.roundIndex === 0);
    await presenter.waitFor('roundProgress', { pred: (p) => p.total === 4 });

    mark = presenter.mark();
    presenter.socket.emit('kickPlayer', { roomCode, username: p4.name });
    const afterKick = await presenter.waitFor('roundProgress', { since: mark, pred: (p) => p.total === 3 });
    check('kicking a player updates the progress total', afterKick.submitted === 1);

    p3.socket.emit('submitRound', { roomCode, roundIndex: 1, answers: [1, 0] });
    await p3.waitFor('roundSubmitted', { since: r2Mark.p3 });

    const endedBefore = p1.all('roundEnded').length;
    presenter.socket.emit('endRound', { roomCode, roundIndex: 1 });
    presenter.socket.emit('endRound', { roomCode, roundIndex: 1 }); // duplicate: must finalize only once
    const ended2 = await p1.waitFor('roundEnded', { since: r2Mark.p1 });
    check('presenter ended the round', ended2.reason === 'presenter' && ended2.isLastRound === true);
    await sleep(400);
    check('a duplicate endRound finalizes once', p1.all('roundEnded').length === endedBefore + 1);

    mark = p2b.mark();
    p2b.socket.emit('submitRound', { roomCode, roundIndex: 1, answers: [1, 1] });
    const late = await p2b.waitFor('roundSubmitted', { since: mark });
    check('a submit after the round ended is refused', late.success === false && late.ended === true);
    const p2Final = await p2b.waitFor('roundEnded', { since: r2Mark.p2 });
    check('a player who missed the round scores zero in it', p2Final.you.roundScore === 0);

    // The final round's standings go to the presenter only, until the quiz is completed
    const presEnded2 = await presenter.waitFor('roundEnded', { since: r2Mark.presenter });
    check('final standings reach the presenter', presEnded2.standings.map((s) => `${s.name}:${s.totalScore}`).join() === `${p1.name}:5,${p2.name}:2,${p3.name}:1`, JSON.stringify(presEnded2.standings));
    const displayEnded2 = await display.waitFor('roundEnded', { since: r2Mark.display });
    check('final standings are withheld from players and the display', ended2.standings === null && p2Final.standings === null && displayEnded2.standings === null);
    check('a player gets their round result but no rank or total for the final round', ended2.you.roundScore === 2 && ended2.you.rank === null && ended2.you.totalScore === null);

    section('Completing the quiz');
    mark = p1.mark();
    presenter.socket.emit('completeQuiz', { roomCode });
    const completed = await p1.waitFor('quizCompleted', { since: mark });
    check('quiz completed and saved', !!completed.filename, JSON.stringify(completed));
    // The server sends the final results 5 seconds after completing (plus the save), so allow generous slack
    const results = await p1.waitFor('quizResults', { since: mark, timeout: 20000 });
    check('final results grade short answers', results.players.find((p) => p.name === p1.name)?.score === 5 && results.players.find((p) => p.name === p2.name)?.score === 2, JSON.stringify(results.players));

    if (process.env.DATABASE_URL) {
      section('Persistence');
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const rounds = await pool.query(
          `SELECT sr.round_order, sr.title, sr.time_limit_seconds FROM session_rounds sr
           JOIN game_sessions gs ON gs.id = sr.game_session_id WHERE gs.room_code = $1 ORDER BY sr.round_order`, [roomCode]);
        check('session_rounds snapshot saved', rounds.rows.map((r) => `${r.round_order}:${r.title}:${r.time_limit_seconds}`).join() === `1:Warmup:${ROUND1_SECONDS},2:Finals:null`, JSON.stringify(rounds.rows));
        const qs = await pool.query(
          `SELECT sq.round_order FROM session_questions sq JOIN game_sessions gs ON gs.id = sq.game_session_id
           WHERE gs.room_code = $1 ORDER BY sq.presentation_order`, [roomCode]);
        check('session_questions record their round', qs.rows.map((r) => r.round_order).join() === '1,1,1,2,2');
        const scores = await pool.query(
          `SELECT gp.display_name, gp.score FROM game_participants gp JOIN game_sessions gs ON gs.id = gp.game_session_id
           WHERE gs.room_code = $1 ORDER BY gp.display_name`, [roomCode]);
        check('participant scores saved', scores.rows.map((r) => `${r.display_name}:${r.score}`).join() === `${p1.name}:5,${p2.name}:2,${p3.name}:1`, JSON.stringify(scores.rows));
      } finally {
        await pool.end();
      }
    }

    section('Resume restores completed rounds and short-answer text');
    const resumer = track(connect('resumer', `pres2-${RUN_ID}`));
    resumer.socket.emit('resumeSession', { sessionFilename: `session_${completed.filename}.json`, userId: 1, isRootAdmin: true });
    const resumed = await resumer.waitFor('roomCreated');
    resumedRoomCode = resumed.roomCode;
    const resumedState = await resumer.waitFor('roundState');
    check('resumed room is between rounds with both rounds completed', resumedState.phase === 'ended' && resumedState.completed.join() === '0,1' && resumedState.nextRoundIndex === null);
    const resumedStandings = resumedState.lastEnded.standings.map((s) => `${s.name}:${s.totalScore}`).join();
    check('standings are recomputed from saved answers (incl. typed text)', resumedStandings === `${p1.name}:5,${p2.name}:2,${p3.name}:1`, resumedStandings);
    mark = resumer.mark();
    resumer.socket.emit('startRound', { roomCode: resumedRoomCode, roundIndex: 0 });
    await resumer.waitFor('roomError', { since: mark });
    check('a resumed room does not replay finished rounds', true);
  } finally {
    section('Cleanup');
    for (const code of [roomCode, resumedRoomCode].filter(Boolean)) {
      clients[0]?.socket.emit('closeRoom', { roomCode: code, userId: 1, isRootAdmin: true });
    }
    await sleep(300);
    if (quizId) {
      const del = await api('DELETE', `/api/quizzes/quiz_${quizId}.json`);
      check('test quiz removed', del.status === 200);
    }
    clients.forEach((c) => c.close());
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ Test aborted:', err.message);
  clients.forEach((c) => c.close());
  process.exit(1);
});
