/**
 * TriviaForge - Answer Grading
 *
 * Single place that decides whether a live-room answer is correct, so new code
 * (rounds, final results) doesn't re-implement the multiple-choice / short-answer split.
 */

import { matchShortAnswer } from './similarity.js';

/**
 * Grade one answer against its question.
 *
 * @param {Object} question - Room question ({ type, correctChoice, acceptedAnswers })
 * @param {number|string|null|undefined} answer - A choice index (multiple_choice / true_false)
 *   or the typed text (short_answer). Missing answers are never correct.
 * @param {number} [threshold=0.85] - Minimum similarity (0-1) for short-answer matches
 * @returns {boolean} True if the answer is correct
 */
export function gradeAnswer(question, answer, threshold = 0.85) {
  if (!question || answer === undefined || answer === null) return false;

  if (question.type === 'short_answer') {
    if (typeof answer !== 'string' || answer === '') return false;
    return matchShortAnswer(answer, question.acceptedAnswers || [], threshold).isCorrect;
  }

  return answer === question.correctChoice;
}

export default { gradeAnswer };
