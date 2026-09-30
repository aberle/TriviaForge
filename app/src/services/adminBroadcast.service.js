/**
 * Lets quiz-mutation endpoints (quiz.controller.js) notify every OTHER admin session of a change,
 * without those controllers depending on socket.io directly. server.js injects the io instance once
 * at startup (the same initialize() pattern autoModeService/roundService use).
 */

let io = null;

export function initialize(ioInstance) {
  io = ioInstance;
}

/** A quiz was created, updated, or (soft-)deleted -- tell every admin session to refresh it if open. */
export function notifyQuizChanged(quizId) {
  io?.to('admins').emit('quizChanged', { quizId });
}
