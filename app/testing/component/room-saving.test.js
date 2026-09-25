/**
 * Which live rooms are saved when the server shuts down: any room with something to resume (players,
 * a started question or round, answers). Nothing is loaded by Vite here, these are plain functions.
 */

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { APP_ROOT, suite } from './lib.js';

const { sessionHasAnswers, roomIsWorthSaving, shouldSaveOnComplete } = await import(pathToFileURL(path.join(APP_ROOT, 'src/utils/roomState.js')).href);
const t = suite('rooms worth saving');

const room = (overrides = {}) => ({ players: {}, presentedQuestions: [], currentQuestionIndex: null, ...overrides });
const player = (overrides = {}) => ({ name: 'Ann', isSpectator: false, answers: {}, ...overrides });

t.ok('an empty room is not worth saving', !roomIsWorthSaving(room()));
t.ok('a room with only a spectator display is not worth saving', !roomIsWorthSaving(room({ players: { a: player({ isSpectator: true }) } })));
t.ok('a room a player has joined is saved (even before any answer)', roomIsWorthSaving(room({ players: { a: player() } })));
t.ok('a room where a question was presented is saved', roomIsWorthSaving(room({ presentedQuestions: [0] })));
t.ok('a room with a question live right now is saved', roomIsWorthSaving(room({ currentQuestionIndex: 0 })));
t.ok('a round quiz whose round is open is saved, though nobody has submitted', roomIsWorthSaving(room({ rounds: { phase: 'open' } })));
t.ok('a round quiz between rounds is saved', roomIsWorthSaving(room({ rounds: { phase: 'ended' } })));
t.ok('a round quiz that has not started and has nobody in it is not', !roomIsWorthSaving(room({ rounds: { phase: 'idle' } })));
t.ok('a room with a recorded answer is saved', roomIsWorthSaving(room({ players: { a: player({ answers: { 0: 1 } }) } })));
t.ok('sessionHasAnswers still only counts recorded answers', !sessionHasAnswers(room({ players: { a: player() } })) && sessionHasAnswers(room({ players: { a: player({ answers: { 0: 1 } }) } })));

// Completing a quiz
t.ok('completing a room with answers saves it', shouldSaveOnComplete(room({ players: { a: player({ answers: { 0: 1 } }) } }), false));
t.ok('completing a brand new room nobody answered in does not save anything', !shouldSaveOnComplete(room({ players: { a: player() } }), false));
t.ok('completing a session that is already in the database saves it even without answers (so it leaves the in-progress list)', shouldSaveOnComplete(room({ players: { a: player() } }), true));

process.exit(t.finish() ? 0 : 1);
