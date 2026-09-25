/**
 * TriviaForge - Quiz Controller
 *
 * Handles all quiz-related operations:
 * - CRUD operations for quizzes
 * - Excel import/export functionality
 * - Quiz template generation
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { query, getClient, transaction } from '../config/database.js';
import {
  NotFoundError,
  BadRequestError,
} from '../utils/errors.js';
import { sendSuccess } from '../utils/responses.js';
import { validateRounds } from '../utils/validators.js';
import { ROUND_CONSTRAINTS } from '../config/constants.js';

// Ensure uploads directory exists on startup
const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'questions');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Helper: Validate rounds against the question list, throwing a 400 on failure.
 *
 * @param {Array} rounds - Round definitions from the request body
 * @param {Array} questions - Ordered questions from the request body
 */
function assertValidRounds(rounds, questions) {
  const result = validateRounds(rounds, questions);
  if (!result.valid) {
    throw new BadRequestError(result.error);
  }
}

/**
 * Helper: Insert a quiz's rounds and return their database IDs, indexed by roundIndex.
 * Callers must have already removed the quiz's previous rounds. No rounds (undefined
 * or empty) means a round-less quiz.
 *
 * @param {Object} client - Transaction client
 * @param {number} quizId - Quiz ID
 * @param {Array<{title?: string, timeLimitSeconds?: number|null}>} rounds - Round definitions
 * @returns {Promise<number[]>} Round IDs, aligned with the rounds array
 */
async function insertQuizRounds(client, quizId, rounds) {
  const roundIds = [];
  for (let i = 0; i < (rounds || []).length; i++) {
    const round = rounds[i];
    const result = await client.query(
      'INSERT INTO quiz_rounds (quiz_id, round_order, title, time_limit_seconds) VALUES ($1, $2, $3, $4) RETURNING id',
      [quizId, i + 1, (round.title || '').trim(), round.timeLimitSeconds || null]
    );
    roundIds.push(result.rows[0].id);
  }
  return roundIds;
}

/**
 * Helper: Get quiz by ID with all questions and answers
 *
 * @param {number} quizId - Quiz ID
 * @returns {Promise<Object|null>} Quiz object or null if not found
 */
async function getQuizById(quizId) {
  const client = await getClient();
  try {
    // Fetch quiz metadata
    const quizResult = await client.query(
      'SELECT id, title, description, answer_display_timeout, created_at, show_results FROM quizzes WHERE id = $1 AND is_active = TRUE',
      [quizId]
    );

    if (quizResult.rows.length === 0) {
      return null;
    }

    const quiz = quizResult.rows[0];

    // Fetch questions with answers (direct query to include image fields)
    const questionsResult = await client.query(
      `
      SELECT
        qs.id AS question_id,
        qs.question_text,
        qs.question_type,
        qs.image_url,
        qs.image_type,
        qq.question_order,
        qq.round_id,
        a.id AS answer_id,
        a.answer_text,
        a.is_correct,
        a.display_order
      FROM quiz_questions qq
      JOIN questions qs ON qq.question_id = qs.id
      JOIN answers a ON qs.id = a.question_id
      WHERE qq.quiz_id = $1
      ORDER BY qq.question_order, a.display_order
    `,
      [quizId]
    );

    // Group answers by question
    const questionsMap = new Map();
    for (const row of questionsResult.rows) {
      if (!questionsMap.has(row.question_id)) {
        questionsMap.set(row.question_id, {
          id: row.question_id,
          text: row.question_text,
          type: row.question_type,
          imageUrl: row.image_url,
          imageType: row.image_type,
          order: row.question_order,
          roundId: row.round_id,
          choices: [],
        });
      }
      questionsMap.get(row.question_id).choices.push({
        id: row.answer_id,
        text: row.answer_text,
        isCorrect: row.is_correct,
        order: row.display_order,
      });
    }

    // Convert map to array sorted by question_order
    const questions = Array.from(questionsMap.values()).sort(
      (a, b) => a.order - b.order
    );

    // Rounds (v5.16.0): each question gets the zero-based index of its round
    const roundsResult = await client.query(
      'SELECT id, title, time_limit_seconds FROM quiz_rounds WHERE quiz_id = $1 ORDER BY round_order',
      [quizId]
    );
    const rounds = roundsResult.rows.map((r) => ({
      title: r.title,
      timeLimitSeconds: r.time_limit_seconds,
    }));
    const roundIndexById = new Map(roundsResult.rows.map((r, i) => [r.id, i]));
    for (const q of questions) {
      q.roundIndex = roundIndexById.has(q.roundId) ? roundIndexById.get(q.roundId) : null;
    }

    return {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      answerDisplayTimeout: quiz.answer_display_timeout,
      showResults: quiz.show_results !== false,
      createdAt: quiz.created_at,
      rounds,
      questions,
    };
  } finally {
    client.release();
  }
}

/**
 * Helper: List all active quizzes (basic info only)
 *
 * @returns {Promise<Array>} Array of quiz objects
 */
async function listQuizzesFromDB() {
  const result = await query(`
    SELECT
      q.id,
      q.title,
      q.description,
      q.created_at,
      q.question_timer,
      q.reveal_delay,
      q.available_live,
      q.available_solo,
      q.show_results,
      COUNT(qq.question_id) as question_count,
      (SELECT COUNT(*) FROM quiz_rounds qr WHERE qr.quiz_id = q.id) as round_count
    FROM quizzes q
    LEFT JOIN quiz_questions qq ON q.id = qq.quiz_id
    WHERE q.is_active = TRUE
    GROUP BY q.id, q.title, q.description, q.created_at, q.question_timer, q.reveal_delay, q.available_live, q.available_solo, q.show_results
    ORDER BY q.created_at DESC
  `);

  return result.rows;
}

/**
 * List all quizzes
 *
 * GET /api/quizzes
 */
export async function listQuizzes(req, res, next) {
  try {
    const quizzes = await listQuizzesFromDB();

    // Format response to match expected structure for frontend
    const formatted = quizzes.map((q) => ({
      id: q.id,
      filename: `quiz_${q.id}.json`, // For backward compatibility with frontend
      title: q.title,
      description: q.description,
      questionCount: parseInt(q.question_count),
      createdAt: q.created_at,
      // v5.4.0: Timer and availability settings
      questionTimer: q.question_timer,
      revealDelay: q.reveal_delay,
      availableLive: q.available_live !== false, // Default true
      availableSolo: q.available_solo !== false, // Default true
      showResults: q.show_results !== false, // Default true
      roundCount: parseInt(q.round_count) || 0, // v5.16.0
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
}

/**
 * Get single quiz by ID
 *
 * GET /api/quizzes/:filename
 * Note: :filename param is actually the quiz ID (for backward compatibility)
 * Format: quiz_123.json → extract ID 123
 */
export async function getQuiz(req, res, next) {
  try {
    // Extract quiz ID from filename format (quiz_123.json → 123)
    const filename = req.params.filename;
    const quizId = filename.includes('_')
      ? parseInt(filename.split('_')[1].replace('.json', ''))
      : parseInt(filename);

    if (isNaN(quizId)) {
      throw new BadRequestError('Invalid quiz ID format');
    }

    const quiz = await getQuizById(quizId);

    if (!quiz) {
      throw new NotFoundError('Quiz');
    }

    // Format response to match expected frontend structure
    const formatted = {
      filename: `quiz_${quiz.id}.json`,
      title: quiz.title,
      description: quiz.description,
      rounds: quiz.rounds,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        imageUrl: q.imageUrl || null,
        imageType: q.imageType || null,
        choices: q.choices.map((c) => c.text),
        correctChoice: q.choices.findIndex((c) => c.isCorrect),
        roundIndex: q.roundIndex,
      })),
    };

    res.json(formatted);
  } catch (err) {
    next(err);
  }
}

/**
 * Create new quiz
 *
 * POST /api/quizzes
 * Body: { title, description, questions }
 */
export async function createQuiz(req, res, next) {
  const { title, description, questions, rounds, questionTimer, revealDelay, availableLive, availableSolo, showResults } = req.body;
  const client = await getClient();

  try {
    assertValidRounds(rounds, questions);

    await client.query('BEGIN');

    // Insert quiz (use authenticated user's ID) - v5.4.0: includes timer and availability settings
    const userId = req.user?.user_id || 1; // Fallback for backward compatibility
    const quizResult = await client.query(
      `INSERT INTO quizzes (title, description, created_by, question_timer, reveal_delay, available_live, available_solo, show_results)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), COALESCE($7, TRUE), COALESCE($8, TRUE)) RETURNING id`,
      [title, description, userId, questionTimer || null, revealDelay || null, availableLive, availableSolo, showResults]
    );
    const quizId = quizResult.rows[0].id;

    const roundIds = await insertQuizRounds(client, quizId, rounds);

    // Insert each question with answers
    for (let i = 0; i < (questions || []).length; i++) {
      const q = questions[i];

      // Insert question - use provided type or default to multiple_choice
      const questionType = q.type || 'multiple_choice';
      const imageUrl = q.imageUrl || null;
      const imageType = q.imageType || null;
      const questionResult = await client.query(
        'INSERT INTO questions (question_text, question_type, image_url, image_type, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [q.text, questionType, imageUrl, imageType, userId]
      );
      const questionId = questionResult.rows[0].id;

      // Link question to quiz
      await client.query(
        'INSERT INTO quiz_questions (quiz_id, question_id, question_order, round_id) VALUES ($1, $2, $3, $4)',
        [quizId, questionId, i + 1, roundIds[q.roundIndex] ?? null]
      );

      // Insert answers — for short_answer questions every entry is an accepted answer, so all are "correct"
      for (let j = 0; j < (q.choices || []).length; j++) {
        const isCorrect = questionType === 'short_answer' ? true : j === q.correctChoice;
        await client.query(
          'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
          [questionId, q.choices[j], isCorrect, j]
        );
      }
    }

    await client.query('COMMIT');

    // Return formatted response
    const filename = `quiz_${quizId}.json`;
    res.json({
      filename,
      id: quizId,
      title,
      description,
      rounds: rounds || [],
      questions: questions || [],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * What makes two versions of a question the same: text, type, image and the answers (with which are
 * correct), in order. Used to tell an untouched question from an edited one when a quiz is saved.
 */
const questionSignature = (text, type, imageUrl, imageType, answers) =>
  JSON.stringify([text, type || 'multiple_choice', imageUrl || null, imageType || null, answers]);

/** The signature of a question as it arrives from the admin page. */
const incomingSignature = (q) => {
  const type = q.type || 'multiple_choice';
  const answers = (q.choices || []).map((choice, j) => [choice, type === 'short_answer' ? true : j === q.correctChoice]);
  return questionSignature(q.text, type, q.imageUrl, q.imageType, answers);
};

/** The signatures of stored questions, keyed by question id. */
async function loadStoredSignatures(client, questionIds) {
  const signatures = new Map();
  if (questionIds.length === 0) return signatures;
  const result = await client.query(
    `SELECT q.id, q.question_text, q.question_type, q.image_url, q.image_type,
            COALESCE(json_agg(json_build_array(a.answer_text, a.is_correct) ORDER BY a.display_order)
                     FILTER (WHERE a.id IS NOT NULL), '[]') AS answers
     FROM questions q
     LEFT JOIN answers a ON a.question_id = q.id
     WHERE q.id = ANY($1::int[])
     GROUP BY q.id`,
    [questionIds]
  );
  for (const row of result.rows) {
    signatures.set(row.id, questionSignature(row.question_text, row.question_type, row.image_url, row.image_type, row.answers));
  }
  return signatures;
}

/**
 * Update existing quiz
 *
 * PUT /api/quizzes/:filename
 * Body: { title, description, questions }
 */
export async function updateQuiz(req, res, next) {
  const client = await getClient();

  try {
    // Extract quiz ID from filename
    const filename = req.params.filename;
    const quizId = filename.includes('_')
      ? parseInt(filename.split('_')[1].replace('.json', ''))
      : parseInt(filename);

    if (isNaN(quizId)) {
      throw new BadRequestError('Invalid quiz ID format');
    }

    const { title, description, questions, rounds, questionTimer, revealDelay, availableLive, availableSolo, showResults } = req.body;

    // If questions is provided, it must be an array
    if (questions !== undefined && !Array.isArray(questions)) {
      throw new BadRequestError('Questions must be an array');
    }

    // A full update replaces the quiz's rounds too: omitting `rounds` means no rounds
    if (questions !== undefined) {
      assertValidRounds(rounds, questions);
    }

    await client.query('BEGIN');

    // Check if this is a metadata-only update (no questions provided)
    const isMetadataOnlyUpdate = questions === undefined;

    if (isMetadataOnlyUpdate) {
      // Only update the fields that are provided (v5.4.0: availability toggles)
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (title !== undefined) {
        updates.push(`title = $${paramIndex++}`);
        values.push(title);
      }
      if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        values.push(description);
      }
      if (questionTimer !== undefined) {
        updates.push(`question_timer = $${paramIndex++}`);
        values.push(questionTimer || null);
      }
      if (revealDelay !== undefined) {
        updates.push(`reveal_delay = $${paramIndex++}`);
        values.push(revealDelay || null);
      }
      if (availableLive !== undefined) {
        updates.push(`available_live = $${paramIndex++}`);
        values.push(availableLive);
      }
      if (availableSolo !== undefined) {
        updates.push(`available_solo = $${paramIndex++}`);
        values.push(availableSolo);
      }
      if (showResults !== undefined) {
        updates.push(`show_results = $${paramIndex++}`);
        values.push(showResults);
      }

      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(quizId);
        await client.query(
          `UPDATE quizzes SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
          values
        );
      }

      await client.query('COMMIT');

      // Return the updated quiz
      const updatedQuiz = await client.query('SELECT * FROM quizzes WHERE id = $1', [quizId]);
      return res.json({
        success: true,
        quiz: updatedQuiz.rows[0]
      });
    }

    // Full update with questions - original logic
    // Update quiz metadata (v5.4.0: includes timer and availability settings)
    await client.query(
      `UPDATE quizzes SET
        title = $1,
        description = $2,
        question_timer = $3,
        reveal_delay = $4,
        available_live = COALESCE($5, available_live),
        available_solo = COALESCE($6, available_solo),
        show_results = COALESCE($7, show_results),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8`,
      [title, description, questionTimer || null, revealDelay || null, availableLive, availableSolo, showResults, quizId]
    );

    // Get list of questions currently associated with this quiz
    const oldQuestionsResult = await client.query(
      'SELECT question_id FROM quiz_questions WHERE quiz_id = $1',
      [quizId]
    );
    const oldQuestionIds = oldQuestionsResult.rows.map((row) => row.question_id);

    // Delete quiz-question relationships first, then the old rounds (re-created below)
    await client.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [quizId]);
    await client.query('DELETE FROM quiz_rounds WHERE quiz_id = $1', [quizId]);

    // A question that is unchanged keeps its row (and its tags and history): saving after a reorder, a
    // round change or a rename must not copy every question. Only added or edited questions get new
    // rows. The client sends each question's id; it counts only if it belongs to this quiz.
    const storedSignatures = await loadStoredSignatures(client, oldQuestionIds);
    const reusedIds = new Set();
    const questionIdFor = new Map(); // index in the request -> reused question id
    questions.forEach((q, i) => {
      if (!Number.isInteger(q.id) || reusedIds.has(q.id)) return;
      if (storedSignatures.get(q.id) !== incomingSignature(q)) return;
      reusedIds.add(q.id);
      questionIdFor.set(i, q.id);
    });

    // Delete the old questions that are no longer used. Ones a played session refers to are kept
    // (history), and so are ones another quiz uses (e.g. created from a selection in the bank).
    const replacedIds = oldQuestionIds.filter((id) => !reusedIds.has(id));
    if (replacedIds.length > 0) {
      await client.query(
        `
        DELETE FROM questions
        WHERE id = ANY($1::int[])
        AND NOT EXISTS (
          SELECT 1 FROM session_questions WHERE question_id = questions.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM quiz_questions WHERE question_id = questions.id
        )
      `,
        [replacedIds]
      );
    }

    const roundIds = await insertQuizRounds(client, quizId, rounds);

    // Link reused questions and insert new ones with their answers (use authenticated user's ID)
    const userId = req.user?.user_id || 1; // Fallback for backward compatibility
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];

      // Insert question - use provided type or default to multiple_choice
      const questionType = q.type || 'multiple_choice';
      let questionId = questionIdFor.get(i);
      const isNew = questionId === undefined;
      if (isNew) {
        const imageUrl = q.imageUrl || null;
        const imageType = q.imageType || null;
        const questionResult = await client.query(
          'INSERT INTO questions (question_text, question_type, image_url, image_type, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [q.text, questionType, imageUrl, imageType, userId]
        );
        questionId = questionResult.rows[0].id;
      }

      // Link question to quiz
      await client.query(
        'INSERT INTO quiz_questions (quiz_id, question_id, question_order, round_id) VALUES ($1, $2, $3, $4)',
        [quizId, questionId, i + 1, roundIds[q.roundIndex] ?? null]
      );

      if (!isNew) continue;

      // Insert answers — for short_answer questions every entry is an accepted answer, so all are "correct"
      for (let j = 0; j < (q.choices || []).length; j++) {
        const isCorrect = questionType === 'short_answer' ? true : j === q.correctChoice;
        await client.query(
          'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
          [questionId, q.choices[j], isCorrect, j]
        );
      }
    }

    await client.query('COMMIT');

    // Return formatted response
    res.json({
      filename: `quiz_${quizId}.json`,
      id: quizId,
      title,
      description,
      rounds: rounds || [],
      questions,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

/**
 * Delete quiz (soft delete - sets is_active = false)
 *
 * DELETE /api/quizzes/:filename
 */
export async function deleteQuiz(req, res, next) {
  try {
    // Extract quiz ID from filename
    const filename = req.params.filename;
    const quizId = filename.includes('_')
      ? parseInt(filename.split('_')[1].replace('.json', ''))
      : parseInt(filename);

    if (isNaN(quizId)) {
      throw new BadRequestError('Invalid quiz ID format');
    }

    // Soft delete: set is_active to false
    const result = await query(
      'UPDATE quizzes SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id',
      [quizId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Quiz');
    }

    sendSuccess(res, null, 'Quiz deleted successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * Upload image for question
 *
 * POST /api/quizzes/upload-image
 * Multipart form data with 'image' field
 */
export async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      throw new BadRequestError('No image file uploaded');
    }

    // Return the URL path for the uploaded image
    const imageUrl = `/uploads/questions/${req.file.filename}`;

    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Download Excel quiz template
 *
 * GET /api/quiz-template
 */
export async function downloadTemplate(req, res, next) {
  try {
    // Create a new workbook with ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Quiz');

    // Set column widths
    worksheet.columns = [
      { width: 40 }, // Question Text
      { width: 18 }, // Choice A
      { width: 18 }, // Choice B
      { width: 18 }, // Choice C
      { width: 18 }, // Choice D
      { width: 18 }, // Choice E
      { width: 18 }, // Choice F
      { width: 18 }, // Choice G
      { width: 18 }, // Choice H
      { width: 18 }, // Choice I
      { width: 18 }, // Choice J
      { width: 30 }, // Correct Answer
    ];

    // Row 1: Quiz Title (label + editable)
    worksheet.getRow(1).values = ['Quiz Title', 'My Quiz Title'];
    worksheet.getCell('A1').font = { bold: true };
    worksheet.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9EAD3' },
    }; // Light green
    worksheet.getCell('B1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    }; // White (editable)
    worksheet.getCell('B1').border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };

    // Row 2: Description (label + editable)
    worksheet.getRow(2).values = ['Description', 'Description of the quiz'];
    worksheet.getCell('A2').font = { bold: true };
    worksheet.getCell('A2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9EAD3' },
    }; // Light green
    worksheet.getCell('B2').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFFFF' },
    }; // White (editable)
    worksheet.getCell('B2').border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };

    // Row 3: Empty

    // Row 4: Index reference (reference only - light gray background)
    const indexRow = worksheet.getRow(4);
    indexRow.values = [
      'Index →',
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '← Use these numbers',
      'Round title, if the quiz has rounds',
    ];
    indexRow.font = { bold: true, color: { argb: 'FF666666' } };
    indexRow.alignment = { horizontal: 'center' };
    for (let col = 1; col <= 13; col++) {
      const cell = worksheet.getCell(4, col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      }; // Light gray
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }

    // Row 5: Column headers (reference only - blue background)
    const headerRow = worksheet.getRow(5);
    headerRow.values = [
      'Question Text',
      'Choice A',
      'Choice B',
      'Choice C',
      'Choice D',
      'Choice E',
      'Choice F',
      'Choice G',
      'Choice H',
      'Choice I',
      'Choice J',
      'Correct Answer (0-based index)',
      'Round (optional)',
    ];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White text
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let col = 1; col <= 13; col++) {
      const cell = worksheet.getCell(5, col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      }; // Blue
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }

    // Sample questions (rows 6-9) - white background (editable)
    const sampleData = [
      ['What is 2+2?', '3', '4', '5', '6', '', '', '', '', '', '', '1'],
      ['What color is the sky?', 'Red', 'Blue', 'Green', 'Yellow', '', '', '', '', '', '', '1'],
      [
        'Sample question with 6 choices',
        'Choice 1',
        'Choice 2',
        'Choice 3',
        'Choice 4',
        'Choice 5',
        'Choice 6',
        '',
        '',
        '',
        '',
        '3',
      ],
      [
        'Sample question with 10 choices',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
        'G',
        'H',
        'I',
        'J',
        '9',
      ],
    ];

    for (let i = 0; i < sampleData.length; i++) {
      const row = worksheet.getRow(6 + i);
      row.values = sampleData[i];

      // Style each cell in the sample rows
      for (let col = 1; col <= 13; col++) {
        const cell = worksheet.getCell(6 + i, col);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' },
        }; // White
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };

        // Center align the correct answer column
        if (col === 12) {
          cell.alignment = { horizontal: 'center' };
        }
      }
    }

    worksheet.getColumn(13).width = 34;

    // Optional second sheet: the rounds, in order, with their time limits. Questions name their round
    // in the "Round (optional)" column; leave both blank for a quiz without rounds.
    const roundsSheet = workbook.addWorksheet('Rounds');
    roundsSheet.getRow(1).values = ['Round Title', 'Time Limit (seconds, blank = untimed)'];
    roundsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (let col = 1; col <= 2; col++) {
      roundsSheet.getCell(1, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    }
    roundsSheet.getRow(2).values = ['(Example) Warm-up', 60];
    roundsSheet.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
    roundsSheet.getRow(3).values = [`Delete the example row. Time limits are ${ROUND_CONSTRAINTS.MIN_TIME_LIMIT_SECONDS}-${ROUND_CONSTRAINTS.MAX_TIME_LIMIT_SECONDS} seconds.`];
    roundsSheet.getRow(3).font = { italic: true, color: { argb: 'FF888888' } };
    roundsSheet.getColumn(1).width = 30;
    roundsSheet.getColumn(2).width = 38;

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Send file
    res.setHeader('Content-Disposition', 'attachment; filename="quiz_template.xlsx"');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * Helper: the text of an Excel cell (plain values and rich text both arrive as something printable).
 */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
  }
  return String(value).trim();
}

/**
 * Helper: work out the rounds of an imported quiz. Each question can name its round in the optional
 * "Round" column; an optional second sheet named "Rounds" lists the rounds in order with their time
 * limits (seconds, blank = untimed). Rounds appear in the order of that sheet, then in the order they
 * are first used, and questions are grouped by round (keeping their order inside a round).
 *
 * Throws a 400 for a mix of questions with and without a round, or a bad time limit.
 *
 * @param {Object} workbook - The loaded ExcelJS workbook
 * @param {Array<{roundTitle: string, rowIndex: number}>} questions - Parsed questions (grouped in place)
 * @returns {Array<{title: string, timeLimitSeconds: number|null}>} Rounds ([] when the quiz has none)
 */
function readImportRounds(workbook, questions) {
  if (!questions.some((q) => q.roundTitle)) return [];

  const missing = questions.find((q) => !q.roundTitle);
  if (missing) {
    throw new BadRequestError(
      `Row ${missing.rowIndex} has no round. When any question has a round, every question needs one.`
    );
  }

  const rounds = [];
  const indexOf = (title) => rounds.findIndex((r) => r.title.toLowerCase() === title.toLowerCase());

  // The optional "Rounds" sheet: title + time limit, one round per row (after the header row)
  const sheet = workbook.getWorksheet('Rounds');
  if (sheet) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const title = cellText(row.getCell(1).value);
      if (!title || indexOf(title) !== -1) return;

      const rawLimit = cellText(row.getCell(2).value);
      let timeLimitSeconds = null;
      if (rawLimit !== '') {
        timeLimitSeconds = Number(rawLimit);
        if (
          !Number.isInteger(timeLimitSeconds) ||
          timeLimitSeconds < ROUND_CONSTRAINTS.MIN_TIME_LIMIT_SECONDS ||
          timeLimitSeconds > ROUND_CONSTRAINTS.MAX_TIME_LIMIT_SECONDS
        ) {
          throw new BadRequestError(
            `Rounds sheet, row ${rowNumber}: the time limit must be blank or ${ROUND_CONSTRAINTS.MIN_TIME_LIMIT_SECONDS}-${ROUND_CONSTRAINTS.MAX_TIME_LIMIT_SECONDS} seconds`
          );
        }
      }
      rounds.push({ title, timeLimitSeconds });
    });
  }

  // Rounds named only in the question rows are untimed
  for (const q of questions) {
    if (indexOf(q.roundTitle) === -1) rounds.push({ title: q.roundTitle, timeLimitSeconds: null });
  }

  questions.forEach((q) => {
    q.roundIndex = indexOf(q.roundTitle);
  });
  questions.sort((a, b) => a.roundIndex - b.roundIndex); // stable: order inside a round is kept

  // A round nobody uses would only be an empty round: leave it out
  const used = [...new Set(questions.map((q) => q.roundIndex))].sort((a, b) => a - b);
  const remap = new Map(used.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  questions.forEach((q) => {
    q.roundIndex = remap.get(q.roundIndex);
  });
  return used.map((oldIndex) => rounds[oldIndex]);
}

/**
 * Import quiz from Excel file
 *
 * POST /api/import-quiz
 * Multipart form data with 'file' field
 *
 * Query params:
 *   - preview: If 'true', returns parsed questions without creating the quiz
 *
 * Body (when not in preview mode):
 *   - decisions: Object mapping rowIndex to { action: 'use-existing'|'create-new'|'skip', existingQuestionId: number|null }
 */
export async function importQuiz(req, res, next) {
  try {
    if (!req.file) {
      throw new BadRequestError('No file uploaded');
    }

    const isPreview = req.query.preview === 'true';
    // Parse decisions from body (sent as JSON string in form data)
    let decisions = {};
    if (req.body.decisions) {
      try {
        decisions = typeof req.body.decisions === 'string'
          ? JSON.parse(req.body.decisions)
          : req.body.decisions;
      } catch (e) {
        console.error('Error parsing decisions:', e);
      }
    }

    // Parse Excel file with ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];

    // Convert worksheet to array format (similar to xlsx.utils.sheet_to_json with header: 1)
    const data = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      // ExcelJS row.values is 1-indexed, slice(1) to make it 0-indexed like xlsx
      data.push(row.values.slice(1));
    });

    // Extract quiz metadata (first 2 rows)
    if (data.length < 6) {
      throw new BadRequestError('Invalid template format. Please use the provided template.');
    }

    const title = data[0][1] || 'Untitled Quiz';
    const description = data[1][1] || '';

    // Extract questions (starting from row 5, after the index reference and header rows)
    const questions = [];
    for (let i = 5; i < data.length; i++) {
      const row = data[i];
      const rowIndex = i + 1; // 1-indexed row number for user display

      // Skip empty rows
      if (!row || !row[0]) continue;

      const questionText = row[0];
      const choices = [];

      // Collect all non-empty choices (columns 1-10)
      for (let j = 1; j <= 10; j++) {
        if (row[j] && row[j].toString().trim() !== '') {
          choices.push(row[j].toString());
        }
      }

      // Get correct answer index (column 11, since columns 1-10 are choices)
      const correctChoice = parseInt(row[11]);

      // Validate
      if (
        !questionText ||
        choices.length < 2 ||
        isNaN(correctChoice) ||
        correctChoice < 0 ||
        correctChoice >= choices.length
      ) {
        throw new BadRequestError(
          `Invalid question at row ${rowIndex}: Must have question text, at least 2 choices, and valid correct answer index`
        );
      }

      // Create question object with rowIndex for duplicate tracking
      questions.push({
        text: questionText,
        choices: choices,
        correctChoice: correctChoice,
        roundTitle: cellText(row[12]), // optional "Round" column
        rowIndex: rowIndex,
        id: `q_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      });
    }

    if (questions.length === 0) {
      throw new BadRequestError('No valid questions found in the file');
    }

    // Rounds (optional): from the Round column and the Rounds sheet
    const rounds = readImportRounds(workbook, questions);
    assertValidRounds(rounds, questions);

    // If preview mode, return parsed questions without creating
    if (isPreview) {
      return res.json({
        success: true,
        preview: true,
        title,
        description,
        questions: questions.map(q => ({
          rowIndex: q.rowIndex,
          text: q.text,
          choices: q.choices,
          correctChoice: q.correctChoice,
          round: q.roundTitle || null
        })),
        rounds,
        questionCount: questions.length,
      });
    }

    // Save quiz to database (use authenticated user's ID)
    const userId = req.user?.user_id || 1; // Fallback for backward compatibility
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Insert quiz
      const quizResult = await client.query(
        'INSERT INTO quizzes (title, description, created_by) VALUES ($1, $2, $3) RETURNING id',
        [title, description, userId]
      );
      const quizId = quizResult.rows[0].id;
      const roundIds = await insertQuizRounds(client, quizId, rounds);

      // Track statistics
      let createdCount = 0;
      let linkedCount = 0;
      let skippedCount = 0;

      // Insert each question with answers
      let questionOrder = 1;
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const decision = decisions[q.rowIndex];

        // Handle skip decision
        if (decision?.action === 'skip') {
          skippedCount++;
          continue;
        }

        // Handle use-existing decision
        if (decision?.action === 'use-existing' && decision.existingQuestionId) {
          // Verify the existing question exists
          const existingCheck = await client.query(
            'SELECT id FROM questions WHERE id = $1 AND is_archived = FALSE',
            [decision.existingQuestionId]
          );

          if (existingCheck.rows.length > 0) {
            // Link existing question to quiz (skip if already linked)
            const insertResult = await client.query(
              'INSERT INTO quiz_questions (quiz_id, question_id, question_order, round_id) VALUES ($1, $2, $3, $4) ON CONFLICT (quiz_id, question_id) DO NOTHING RETURNING question_id',
              [quizId, decision.existingQuestionId, questionOrder, roundIds[q.roundIndex] ?? null]
            );
            if (insertResult.rows.length > 0) {
              questionOrder++;
              linkedCount++;
            } else {
              skippedCount++;
            }
            continue;
          }
          // If existing question not found, fall through to create new
        }

        // Create new question (default action or create-new decision)
        const questionType = q.type || 'multiple_choice';
        const questionResult = await client.query(
          'INSERT INTO questions (question_text, question_type, created_by) VALUES ($1, $2, $3) RETURNING id',
          [q.text, questionType, userId]
        );
        const questionId = questionResult.rows[0].id;

        // Link question to quiz
        await client.query(
          'INSERT INTO quiz_questions (quiz_id, question_id, question_order, round_id) VALUES ($1, $2, $3, $4)',
          [quizId, questionId, questionOrder++, roundIds[q.roundIndex] ?? null]
        );

        // Insert answers — for short_answer questions every entry is an accepted answer, so all are "correct"
        for (let j = 0; j < q.choices.length; j++) {
          const isCorrect = questionType === 'short_answer' ? true : j === q.correctChoice;
          await client.query(
            'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
            [questionId, q.choices[j], isCorrect, j]
          );
        }

        createdCount++;
      }

      await client.query('COMMIT');

      const filename = `quiz_${quizId}.json`;
      res.json({
        success: true,
        filename,
        id: quizId,
        title,
        questionCount: questionOrder - 1, // Total questions in quiz
        roundCount: rounds.length,
        stats: {
          created: createdCount,
          linked: linkedCount,
          skipped: skippedCount,
        },
      });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err) {
    // Say what is wrong with the file: the admin page shows `error` (the default error page is HTML)
    if (err instanceof BadRequestError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
}

// Export all controller functions
export default {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  uploadImage,
  downloadTemplate,
  importQuiz,
};
