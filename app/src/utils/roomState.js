/**
 * TriviaForge - Room state helpers
 *
 * Questions about a live room's state that decide what gets saved to the database.
 */

/** Whether any player has an answer recorded (in a round quiz answers only count once a round ends). */
export const sessionHasAnswers = (room) => {
  return Object.values(room.players).some(player =>
    player.answers && Object.keys(player.answers).length > 0
  );
};

/**
 * Whether a room has anything worth resuming after a restart. Wider than sessionHasAnswers: a room
 * that players joined (or where a question or round was started) should still come back after a
 * restart even before anyone's answer has been recorded.
 */
export const roomIsWorthSaving = (room) => {
  if (sessionHasAnswers(room)) return true;
  if ((room.presentedQuestions || []).length > 0 || room.currentQuestionIndex !== null) return true;
  if (room.rounds && room.rounds.phase !== 'idle') return true;
  return Object.values(room.players).some(player => !player.isSpectator);
};

/**
 * Whether completing a quiz should save the session. Any recorded answer is worth saving, and so is a
 * session that already exists in the database (a resumed one, or one that was auto-saved): it has to
 * be saved to be marked completed, or it would stay in the list of in-progress sessions forever.
 *
 * @param {Object} room - Live room
 * @param {boolean} alreadySaved - Whether the database already has a session for this room's code
 * @returns {boolean}
 */
export const shouldSaveOnComplete = (room, alreadySaved) => alreadySaved || sessionHasAnswers(room);
