/**
 * SQL fragments shared by the question bank and duplicate detection.
 */

/**
 * The question belongs to at least one quiz. A question that no quiz uses any more is only kept
 * because a played session refers to it (the history of what was asked), so it is not part of the
 * bank: it can't be reused and would only show up as a phantom duplicate of the current version.
 * Expects the questions table to be aliased as `q`.
 */
export const QUESTION_IN_A_QUIZ_SQL = `EXISTS (SELECT 1 FROM quiz_questions qq_link WHERE qq_link.question_id = q.id)`;
