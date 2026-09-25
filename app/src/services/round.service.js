/**
 * TriviaForge - Round Service
 *
 * Live-room logic for quizzes that are split into rounds (v5.16.0).
 *
 * In a round, players see every question at once, answer at their own pace and submit
 * the round. A round is either timed (it ends by itself) or untimed (the presenter ends
 * it). Correct answers are revealed only after the round ends, followed by a leaderboard.
 *
 * Design rules:
 * - While a round is open, drafts and submissions live in `room.rounds`, never in
 *   `player.answers` / `player.choice`. `playerListUpdate` broadcasts full player objects to
 *   every client, so writing answers early would leak them. Answers are copied into
 *   `player.answers` only when the round is finalized, which also marks the round's
 *   questions presented and revealed so saving, stats and exports work unchanged.
 * - Drafts and submissions are keyed by `username` (room.players is keyed by socket ID,
 *   which changes on reconnect).
 * - `finalizeRound` is synchronous and idempotent, and is shared by the presenter's
 *   "end round" and the timer, so a timer expiry racing a submit can't double-finalize.
 */

import { isAnswerCorrect } from '../utils/grading.js';
import { ROUND_CONSTRAINTS } from '../config/constants.js';

const DEBUG_ENABLED = process.env.DEBUG_MODE === 'true';

/** Extra time after a timed round's `endsAt` before the server closes it, to absorb latency. */
export const TIMER_GRACE_MS = 2000;

/** Same bound as live short-answer submissions (see the submitAnswer handler in server.js). */
const MAX_TEXT_ANSWER_LENGTH = 100;

const ACTIVE_STATES = ['connected', 'away', 'warning'];

/**
 * RoundService - Manages round state, timers and events for live rooms
 */
class RoundService {
  constructor() {
    this.io = null;
    this.roomService = null;
    this.quizOptions = null;
    this.saveSession = null;

    // Map<roomCode, Timeout> - kept off the room object, which can be serialized
    this.timers = new Map();
  }

  /**
   * Initialize the service with required dependencies.
   * @param {object} io - Socket.IO server instance
   * @param {object} roomService - Room management service
   * @param {object} quizOptions - Reference to quizOptions (for the short-answer threshold)
   * @param {Function} saveSession - async (roomCode, room) => persists the session
   */
  initialize(io, roomService, quizOptions, saveSession) {
    this.io = io;
    this.roomService = roomService;
    this.quizOptions = quizOptions;
    this.saveSession = saveSession;
  }

  /**
   * Whether a room plays the round flow (its quiz has at least one round).
   * @param {object} room - Live room
   * @returns {boolean}
   */
  isRoundMode(room) {
    return (room?.quizData?.rounds?.length || 0) > 0;
  }

  /**
   * Fresh round state for a new room.
   * phase: 'idle' (nothing played yet) | 'open' (a round is running) | 'ended' (between rounds)
   * @returns {object}
   */
  createState() {
    return {
      phase: 'idle',
      current: null,
      startedAt: null,
      endsAt: null,
      countdownSeconds: null, // an untimed round the presenter set a countdown on: how long it runs for
      countdownStartedAt: null,
      completed: [],
      lastEndedIndex: null,
      lastEndedReason: null,
      drafts: {}, // { [username]: (number|string|null)[] } latest answers, aligned to the open round's questions
      submitted: {}, // { [username]: true } who has submitted at least once
      submittedAnswers: {}, // { [username]: (number|string|null)[] } the answers they last SUBMITTED
    };
  }

  /**
   * Round state for a room resumed from the database. A round counts as completed when all
   * of its questions were revealed; an unfinished round is simply played again.
   * @param {object} room - Resumed room (revealedQuestions already loaded)
   * @returns {object}
   */
  restoreState(room) {
    const state = this.createState();
    const revealed = new Set(room.revealedQuestions || []);

    for (const round of room.quizData.rounds) {
      if (round.questionIndexes.every((idx) => revealed.has(idx))) {
        state.completed.push(round.index);
      }
    }

    if (state.completed.length > 0) {
      state.phase = 'ended';
      state.lastEndedIndex = Math.max(...state.completed);
      state.lastEndedReason = 'presenter';
    }
    return state;
  }

  /**
   * A question as players may see it while the round is open: no correct answer, and no
   * choices for short answer (those are the accepted answers).
   * @param {object} question - Room question
   * @returns {object}
   */
  sanitizeQuestion(question) {
    return {
      text: question.text,
      type: question.type,
      imageUrl: question.imageUrl || null,
      imageType: question.imageType || null,
      choices: question.type === 'short_answer' ? [] : question.choices,
    };
  }

  /**
   * Validate submitted answers for a round into a positional array (null = unanswered).
   * Never trust the client: bad indexes, wrong types and overlong text become null.
   * @param {object} room - Live room
   * @param {number} roundIndex - Round index
   * @param {*} answers - Raw client payload
   * @returns {(number|string|null)[]}
   */
  sanitizeAnswers(room, roundIndex, answers) {
    const round = room.quizData.rounds[roundIndex];
    return round.questionIndexes.map((globalIdx, k) => {
      const question = room.quizData.questions[globalIdx];
      const answer = Array.isArray(answers) ? answers[k] : null;

      if (question.type === 'short_answer') {
        if (typeof answer !== 'string') return null;
        const text = answer.slice(0, MAX_TEXT_ANSWER_LENGTH);
        return text.trim() === '' ? null : text;
      }

      return Number.isInteger(answer) && answer >= 0 && answer < question.choices.length ? answer : null;
    });
  }

  /**
   * Start a round (presenter action). Validation failures are returned, not thrown.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   * @param {number} roundIndex - Round to start
   * @returns {{ok: boolean, message?: string}}
   */
  startRound(roomCode, room, roundIndex) {
    if (!this.isRoundMode(room)) return { ok: false, message: 'This quiz does not have rounds' };
    if (room.status === 'completed') return { ok: false, message: 'This quiz is already completed' };

    const state = room.rounds;
    if (state.phase === 'open') return { ok: false, message: 'A round is already in progress' };

    const round = room.quizData.rounds[roundIndex];
    if (!Number.isInteger(roundIndex) || !round) return { ok: false, message: 'Round not found' };
    if (state.completed.includes(roundIndex)) return { ok: false, message: 'That round has already been played' };

    state.phase = 'open';
    state.current = roundIndex;
    state.startedAt = Date.now();
    state.endsAt = round.timeLimitSeconds ? state.startedAt + round.timeLimitSeconds * 1000 : null;
    state.countdownSeconds = null;
    state.countdownStartedAt = null;
    state.drafts = {};
    state.submitted = {};
    state.submittedAnswers = {};
    room.lastActivityAt = Date.now();

    if (round.timeLimitSeconds) {
      this._armTimer(roomCode, roundIndex, round.timeLimitSeconds * 1000 + TIMER_GRACE_MS);
    }

    this.io.to(roomCode).emit('roundStarted', this.buildStartedPayload(room));
    this.emitProgress(roomCode, room);

    if (DEBUG_ENABLED) console.log(`[Rounds] Room ${roomCode} started round ${roundIndex} (${round.title})`);
    return { ok: true };
  }

  /**
   * Start a countdown on the open round if it has no time limit: it ends by itself when the time is
   * up, like a timed round (players' unsent answers are submitted). Presenter action.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   * @param {number} roundIndex - The round the presenter is looking at
   * @param {number} seconds - How long the countdown runs
   * @returns {{ok: boolean, message?: string}}
   */
  startCountdown(roomCode, room, roundIndex, seconds) {
    const state = room.rounds;
    if (!this.isRoundMode(room) || state.phase !== 'open' || roundIndex !== state.current) {
      return { ok: false, message: 'That round is not open' };
    }
    if (room.quizData.rounds[state.current].timeLimitSeconds) {
      return { ok: false, message: 'This round already has a time limit' };
    }
    if (state.countdownSeconds) return { ok: false, message: 'A countdown is already running' };
    if (
      !Number.isInteger(seconds) ||
      seconds < ROUND_CONSTRAINTS.MIN_TIME_LIMIT_SECONDS ||
      seconds > ROUND_CONSTRAINTS.MAX_TIME_LIMIT_SECONDS
    ) {
      return {
        ok: false,
        message: `A countdown must be between ${ROUND_CONSTRAINTS.MIN_TIME_LIMIT_SECONDS} and ${ROUND_CONSTRAINTS.MAX_TIME_LIMIT_SECONDS} seconds`,
      };
    }

    state.countdownSeconds = seconds;
    state.countdownStartedAt = Date.now();
    state.endsAt = state.countdownStartedAt + seconds * 1000;
    room.lastActivityAt = Date.now();
    this._armTimer(roomCode, roundIndex, seconds * 1000 + TIMER_GRACE_MS);

    this.io.to(roomCode).emit('roundTimer', this.buildTimerPayload(room));
    if (DEBUG_ENABLED) console.log(`[Rounds] Room ${roomCode} round ${roundIndex} countdown started (${seconds}s)`);
    return { ok: true };
  }

  /**
   * Cancel a presenter countdown: the round goes back to having no time limit.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   * @param {number} roundIndex - The round the presenter is looking at
   * @returns {{ok: boolean, message?: string}}
   */
  cancelCountdown(roomCode, room, roundIndex) {
    const state = room.rounds;
    if (!this.isRoundMode(room) || state.phase !== 'open' || roundIndex !== state.current || !state.countdownSeconds) {
      return { ok: false, message: 'There is no countdown to cancel' };
    }

    this._clearTimer(roomCode);
    state.countdownSeconds = null;
    state.countdownStartedAt = null;
    state.endsAt = null;
    room.lastActivityAt = Date.now();

    this.io.to(roomCode).emit('roundTimer', this.buildTimerPayload(room));
    if (DEBUG_ENABLED) console.log(`[Rounds] Room ${roomCode} round ${roundIndex} countdown cancelled`);
    return { ok: true };
  }

  /**
   * Save a player's in-progress answers so a reconnect (or the timer) doesn't lose them.
   * @param {object} room - Live room
   * @param {object} player - The player entry (room.players[socket.id])
   * @param {number} roundIndex - Round the answers belong to
   * @param {Array} answers - Positional answers
   * @returns {{ok: boolean, ended?: boolean, message?: string}}
   */
  saveDraft(room, player, roundIndex, answers) {
    const check = this._checkAnswerable(room, player, roundIndex);
    if (!check.ok) return check;

    room.rounds.drafts[player.username] = this.sanitizeAnswers(room, roundIndex, answers);
    room.lastActivityAt = Date.now();
    return { ok: true };
  }

  /**
   * Submit a player's answers for the open round. Players can submit again to change their
   * answers; the newest submission replaces the previous one until the round ends.
   * @param {object} room - Live room
   * @param {object} player - The player entry (room.players[socket.id])
   * @param {number} roundIndex - Round being submitted
   * @param {Array} answers - Positional answers
   * @returns {{ok: boolean, ended?: boolean, message?: string}}
   */
  submitRound(room, player, roundIndex, answers) {
    const check = this._checkAnswerable(room, player, roundIndex);
    if (!check.ok) return check;

    // A player can submit again until the round ends: the newest submission replaces the last one
    const sanitized = this.sanitizeAnswers(room, roundIndex, answers);
    room.rounds.drafts[player.username] = sanitized;
    room.rounds.submittedAnswers[player.username] = sanitized;
    room.rounds.submitted[player.username] = true;
    room.lastActivityAt = Date.now();
    return { ok: true };
  }

  /**
   * End the open round: auto-submit drafts, record answers, reveal, and broadcast the
   * results and leaderboard. Synchronous and idempotent (no-op unless a round is open).
   * @param {string} roomCode - Room code
   * @param {'presenter'|'timeout'} reason - Why the round ended
   * @returns {boolean} True if a round was finalized
   */
  finalizeRound(roomCode, reason) {
    const room = this.roomService.getRoom(roomCode);
    const state = room?.rounds;
    if (!room || !state || state.phase !== 'open') return false;

    this._clearTimer(roomCode);

    const roundIndex = state.current;
    const round = room.quizData.rounds[roundIndex];

    // Record each player's answers (submitted or still a draft) as ordinary answers
    for (const player of Object.values(room.players)) {
      if (player.isSpectator) continue;
      // What counts: the last submission. Edits made after submitting only count if they were
      // submitted too. A player who never submitted has their latest draft auto-submitted.
      const draft = state.submitted[player.username]
        ? state.submittedAnswers[player.username]
        : state.drafts[player.username];
      if (!draft) continue;

      if (!player.answers) player.answers = {};
      round.questionIndexes.forEach((globalIdx, k) => {
        if (draft[k] !== null && draft[k] !== undefined && player.answers[globalIdx] === undefined) {
          player.answers[globalIdx] = draft[k];
        }
      });
    }

    // The round's questions are now presented and revealed (drives saving, stats, resume)
    for (const globalIdx of round.questionIndexes) {
      if (!room.presentedQuestions.includes(globalIdx)) room.presentedQuestions.push(globalIdx);
      if (!room.revealedQuestions.includes(globalIdx)) room.revealedQuestions.push(globalIdx);
    }

    if (!state.completed.includes(roundIndex)) state.completed.push(roundIndex);
    state.phase = 'ended';
    state.current = null;
    state.startedAt = null;
    state.endsAt = null;
    state.countdownSeconds = null;
    state.countdownStartedAt = null;
    state.drafts = {};
    state.submitted = {};
    state.submittedAnswers = {};
    state.lastEndedIndex = roundIndex;
    state.lastEndedReason = reason;
    room.lastActivityAt = Date.now();

    this._emitEnded(roomCode, room, roundIndex, reason);
    this.io.to(roomCode).emit('playerListUpdate', {
      roomCode,
      players: Object.values(room.players).filter((p) => !p.isSpectator),
      revealedCount: room.revealedQuestions.length,
      totalQuestions: room.quizData.questions.length,
    });

    this._persist(roomCode, room);

    if (DEBUG_ENABLED) console.log(`[Rounds] Room ${roomCode} ended round ${roundIndex} (${reason})`);
    return true;
  }

  /**
   * Submission progress for the open round. `total` counts players who are connected (or
   * away) plus anyone who already submitted, so a player who submits and then drops still counts.
   * @param {object} room - Live room
   * @returns {{roundIndex: number, submitted: number, total: number, submittedUsernames: string[]}}
   */
  getProgress(room) {
    const state = room.rounds;
    const active = Object.values(room.players)
      .filter((p) => !p.isSpectator && ACTIVE_STATES.includes(p.connectionState))
      .map((p) => p.username);
    const submittedUsernames = Object.keys(state.submitted);

    return {
      roundIndex: state.current,
      submitted: submittedUsernames.length,
      total: new Set([...active, ...submittedUsernames]).size,
      submittedUsernames,
    };
  }

  /**
   * Broadcast submission progress while a round is open. Everyone gets the counts; only the
   * presenter also gets the names of players who have submitted.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   */
  emitProgress(roomCode, room) {
    if (!this.isRoundMode(room) || room.rounds.phase !== 'open') return;

    const { roundIndex, submitted, total, submittedUsernames } = this.getProgress(room);
    const counts = { roundIndex, submitted, total };
    const broadcast = room.presenterId ? this.io.to(roomCode).except(room.presenterId) : this.io.to(roomCode);

    broadcast.emit('roundProgress', counts);
    if (room.presenterId) {
      this.io.to(room.presenterId).emit('roundProgress', {
        ...counts,
        submittedNames: this._namesFor(room, submittedUsernames),
      });
    }
  }

  /**
   * Forget a removed (kicked) player's draft and submission.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   * @param {string} username - The removed player's username
   */
  removePlayer(roomCode, room, username) {
    if (!this.isRoundMode(room)) return;
    delete room.rounds.drafts[username];
    delete room.rounds.submitted[username];
    delete room.rounds.submittedAnswers[username];
    this.emitProgress(roomCode, room);
  }

  /**
   * Send the current round state to one socket (join, presenter view/refresh, resume).
   * Players also get their own draft and last round result.
   * @param {object} socket - Target socket
   * @param {string} roomCode - Room code
   * @param {{isPresenter?: boolean}} [options]
   */
  sendSnapshot(socket, roomCode, { isPresenter = false } = {}) {
    const room = this.roomService.getRoom(roomCode);
    if (!this.isRoundMode(room)) return;

    const entry = room.players[socket.id];
    const player = !isPresenter && entry && !entry.isSpectator ? entry : null;
    socket.emit('roundState', this.buildSnapshot(room, { player, isPresenter }));
  }

  /**
   * Cancel a room's round timer (room closed or expired).
   * @param {string} roomCode - Room code
   */
  cleanup(roomCode) {
    this._clearTimer(roomCode);
  }

  // ---- Payload builders ----

  /**
   * How the open round is timed. A timed round counts down from when it started; an untimed round
   * the presenter set a countdown on counts down from when the countdown started (`countdown: true`).
   * `serverNow` lets clients correct for clock skew when counting down to `endsAt`.
   * @param {object} room - Live room
   * @returns {object}
   */
  buildTimerPayload(room) {
    const state = room.rounds;
    const round = room.quizData.rounds[state.current];
    return {
      roundIndex: round.index,
      timeLimitSeconds: round.timeLimitSeconds || state.countdownSeconds || null,
      countdown: !!state.countdownSeconds,
      serverNow: Date.now(),
      startedAt: state.countdownStartedAt ?? state.startedAt,
      endsAt: state.endsAt,
    };
  }

  /**
   * The `roundStarted` payload: the open round's questions, sanitized for players.
   * `serverNow` lets clients correct for clock skew when counting down to `endsAt`.
   * @param {object} room - Live room
   * @returns {object}
   */
  buildStartedPayload(room) {
    const state = room.rounds;
    const round = room.quizData.rounds[state.current];
    return {
      roundIndex: round.index,
      title: round.title,
      ...this.buildTimerPayload(room),
      totalRounds: room.quizData.rounds.length,
      questions: round.questionIndexes.map((globalIdx) => ({
        index: globalIdx,
        ...this.sanitizeQuestion(room.quizData.questions[globalIdx]),
      })),
    };
  }

  /**
   * The full round state for (re)joining clients.
   * @param {object} room - Live room
   * @param {{player?: object|null, isPresenter?: boolean}} [options]
   * @returns {object}
   */
  buildSnapshot(room, { player = null, isPresenter = false } = {}) {
    const state = room.rounds;
    const rounds = room.quizData.rounds;

    const snapshot = {
      totalRounds: rounds.length,
      rounds: rounds.map((r) => ({
        index: r.index,
        title: r.title,
        questionCount: r.questionIndexes.length,
        questionIndexes: r.questionIndexes,
        timeLimitSeconds: r.timeLimitSeconds,
      })),
      phase: state.phase,
      nextRoundIndex: rounds.find((r) => !state.completed.includes(r.index))?.index ?? null,
      completed: [...state.completed],
      current: null,
      progress: null,
      lastEnded: null,
    };

    if (state.phase === 'open') {
      snapshot.current = this.buildStartedPayload(room);
      if (player) {
        snapshot.current.you = {
          draft: state.drafts[player.username] || null,
          submitted: !!state.submitted[player.username],
          submittedAnswers: state.submittedAnswers[player.username] || null,
        };
      }

      const { roundIndex, submitted, total, submittedUsernames } = this.getProgress(room);
      snapshot.progress = { roundIndex, submitted, total };
      if (isPresenter) snapshot.progress.submittedNames = this._namesFor(room, submittedUsernames);
    }

    Object.assign(snapshot, this.buildResultsUpdate(room, { player, isPresenter }));

    return snapshot;
  }

  /**
   * The results part of the state: the last finished round (with this player's own result) and
   * their results for every finished round. Sent in the snapshot, and on its own when a grade changes.
   * @param {object} room - Live room
   * @param {{player?: object|null, isPresenter?: boolean}} [options]
   * @returns {{lastEnded: object|null, history?: object[]}}
   */
  buildResultsUpdate(room, { player = null, isPresenter = false } = {}) {
    const state = room.rounds;
    const rounds = room.quizData.rounds;
    const update = { lastEnded: null };

    if (state.lastEndedIndex !== null) {
      const { base, rows } = this._buildEnded(room, state.lastEndedIndex, state.lastEndedReason || 'presenter');
      const hidden = !isPresenter && this._standingsHidden(room, base);
      update.lastEnded = hidden ? { ...base, standings: null } : base;
      const row = player && rows.find((r) => r.socketId === player.id);
      if (row) {
        update.lastEnded = {
          ...update.lastEnded,
          you: this._youFor(room, rounds[state.lastEndedIndex], row, { hideStanding: hidden }),
        };
      }
    }

    // A player's results for every finished round, for their Progress view after a rejoin
    if (player) update.history = this._historyFor(room, player);
    return update;
  }

  /**
   * Tell everyone the results changed (the presenter overrode a grade): each player gets their own
   * corrected results, the presenter the full standings, everyone else the public ones.
   * @param {string} roomCode - Room code
   * @param {object} room - Live room
   */
  emitResultsUpdate(roomCode, room) {
    const players = Object.entries(room.players).filter(([, p]) => !p.isSpectator);
    const excluded = players.map(([socketId]) => socketId);
    if (room.presenterId) {
      excluded.push(room.presenterId);
      this.io.to(room.presenterId).emit('roundResults', this.buildResultsUpdate(room, { isPresenter: true }));
    }
    this.io.to(roomCode).except(excluded).emit('roundResults', this.buildResultsUpdate(room));
    for (const [socketId, player] of players) {
      this.io.to(socketId).emit('roundResults', this.buildResultsUpdate(room, { player: { ...player, id: socketId } }));
    }
  }

  // ---- Internals ----

  _checkAnswerable(room, player, roundIndex) {
    if (!this.isRoundMode(room)) return { ok: false, message: 'This quiz does not have rounds' };
    if (!player || player.isSpectator) return { ok: false, message: 'Only players can answer' };

    const state = room.rounds;
    if (state.phase !== 'open' || state.current !== roundIndex) {
      return { ok: false, ended: true, message: 'This round is no longer open' };
    }
    return { ok: true };
  }

  _namesFor(room, usernames) {
    const wanted = new Set(usernames);
    return Object.values(room.players)
      .filter((p) => !p.isSpectator && wanted.has(p.username))
      .map((p) => p.name);
  }

  /**
   * Standings after a round: total points across completed rounds, plus the given round's
   * points. Ties share a rank (1, 2, 2, 4). Spectators are excluded.
   */
  _computeStandings(room, roundIndex) {
    const threshold = this.quizOptions?.shortAnswerMatchThreshold ?? 0.85;
    const questions = room.quizData.questions;
    const rounds = room.quizData.rounds;
    const round = rounds[roundIndex];
    const playedIndexes = room.rounds.completed.flatMap((i) => rounds[i].questionIndexes);

    const rows = Object.entries(room.players)
      .filter(([, p]) => !p.isSpectator)
      .map(([socketId, p]) => {
        const score = (indexes) =>
          indexes.reduce((sum, idx) => sum + (isAnswerCorrect(room, p, idx, threshold) ? 1 : 0), 0);
        return {
          socketId,
          name: p.name,
          roundScore: round ? score(round.questionIndexes) : 0,
          totalScore: score(playedIndexes),
        };
      });

    rows.sort((a, b) => b.totalScore - a.totalScore || b.roundScore - a.roundScore || a.name.localeCompare(b.name));

    let rank = 0;
    rows.forEach((row, i) => {
      if (i === 0 || row.totalScore !== rows[i - 1].totalScore) rank = i + 1;
      row.rank = rank;
    });
    return rows;
  }

  /** The generic (non-player-specific) `roundEnded` payload plus the standings rows behind it. */
  _buildEnded(room, roundIndex, reason) {
    const rounds = room.quizData.rounds;
    const round = rounds[roundIndex];
    const rows = this._computeStandings(room, roundIndex);

    const base = {
      roundIndex,
      title: round.title,
      reason,
      totalRounds: rounds.length,
      isLastRound: room.rounds.completed.length >= rounds.length,
      questions: this._revealedQuestions(room, round),
      standings: rows.map(({ rank, name, roundScore, totalScore }) => ({ rank, name, roundScore, totalScore })),
    };
    return { base, rows };
  }

  /** A finished round's questions with their correct answers. */
  _revealedQuestions(room, round) {
    return round.questionIndexes.map((globalIdx) => {
      const q = room.quizData.questions[globalIdx];
      return {
        index: globalIdx,
        text: q.text,
        type: q.type,
        imageUrl: q.imageUrl || null,
        imageType: q.imageType || null,
        choices: q.choices,
        correctChoice: q.correctChoice,
        acceptedAnswers: q.acceptedAnswers,
      };
    });
  }

  /**
   * One player's answers and results for every finished round, oldest first. Only finished
   * rounds are included, so nothing here can reveal an open round's answers.
   */
  _historyFor(room, player) {
    const threshold = this.quizOptions?.shortAnswerMatchThreshold ?? 0.85;
    const rounds = room.quizData.rounds;

    return [...room.rounds.completed]
      .sort((a, b) => a - b)
      .map((roundIndex) => {
        const round = rounds[roundIndex];
        const answers = round.questionIndexes.map((idx) => player.answers?.[idx] ?? null);
        const results = round.questionIndexes.map((idx, k) =>
          answers[k] === null ? null : isAnswerCorrect(room, player, idx, threshold)
        );
        return { roundIndex, title: round.title, questions: this._revealedQuestions(room, round), answers, results };
      });
  }

  /** One player's own answers and results for a finished round. */
  /**
   * The last round's standings stay hidden from players and displays until the quiz is completed,
   * so the presenter decides when the final result is revealed. The presenter always sees them.
   */
  _standingsHidden(room, ended) {
    return ended.isLastRound && room.status !== 'completed';
  }

  _youFor(room, round, row, { hideStanding = false } = {}) {
    const threshold = this.quizOptions?.shortAnswerMatchThreshold ?? 0.85;
    const player = room.players[row.socketId];
    const answers = round.questionIndexes.map((idx) => player?.answers?.[idx] ?? null);
    const results = round.questionIndexes.map((idx, k) =>
      answers[k] === null ? null : isAnswerCorrect(room, player, idx, threshold)
    );
    return {
      answers,
      results,
      roundScore: row.roundScore,
      // Their overall position is part of the standings, so it is withheld with them
      totalScore: hideStanding ? null : row.totalScore,
      rank: hideStanding ? null : row.rank,
    };
  }

  /** Players each get their own result on top of the shared payload; everyone else the shared one. */
  _emitEnded(roomCode, room, roundIndex, reason) {
    const { base, rows } = this._buildEnded(room, roundIndex, reason);
    const round = room.quizData.rounds[roundIndex];

    const hidden = this._standingsHidden(room, base);
    const publicBase = hidden ? { ...base, standings: null } : base;

    // The presenter always gets the standings; the display and everyone else may not
    const excluded = rows.map((r) => r.socketId);
    if (room.presenterId) {
      excluded.push(room.presenterId);
      this.io.to(room.presenterId).emit('roundEnded', base);
    }
    this.io.to(roomCode).except(excluded).emit('roundEnded', publicBase);

    for (const row of rows) {
      this.io.to(row.socketId).emit('roundEnded', {
        ...publicBase,
        you: this._youFor(room, round, row, { hideStanding: hidden }),
      });
    }
  }

  _armTimer(roomCode, roundIndex, ms) {
    this._clearTimer(roomCode);
    const handle = setTimeout(() => {
      this.timers.delete(roomCode);
      const room = this.roomService.getRoom(roomCode);
      if (!room?.rounds || room.rounds.phase !== 'open' || room.rounds.current !== roundIndex) return;
      this.finalizeRound(roomCode, 'timeout');
    }, ms);
    this.timers.set(roomCode, handle);
  }

  _clearTimer(roomCode) {
    const handle = this.timers.get(roomCode);
    if (handle) clearTimeout(handle);
    this.timers.delete(roomCode);
  }

  /** Save the session after every round so a crash between rounds loses nothing. */
  _persist(roomCode, room) {
    const hasAnswers = Object.values(room.players).some((p) => p.answers && Object.keys(p.answers).length > 0);
    if (!hasAnswers || !this.saveSession) return;

    this.saveSession(roomCode, room).catch((err) => {
      console.error(`[Rounds] Failed to save session for room ${roomCode}:`, err);
    });
  }
}

export const roundService = new RoundService();
export default roundService;
