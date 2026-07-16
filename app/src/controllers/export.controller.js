/**
 * TriviaForge - Export/Import Controller
 *
 * Quiz and question library export and import:
 * - JSON export: full quiz structure with questions, answers, and tags
 * - CSV export: flat questions list for spreadsheet editing
 * - JSON import: create quizzes from an exported file, with duplicate detection
 */

import { query } from '../config/database.js';
import { VERSION } from '../config/version.js';
import { generateTextHash } from '../utils/similarity.js';
import { sendSuccess } from '../utils/responses.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch all questions for a quiz, with answers and tags.
 */
async function fetchQuizQuestions(quizId) {
  const result = await query(
    `SELECT q.id, q.question_text, q.question_type, q.image_url,
            qq.question_order,
            COALESCE(
              json_agg(DISTINCT jsonb_build_object('name', t.name)) FILTER (WHERE t.name IS NOT NULL),
              '[]'
            ) AS tags
     FROM quiz_questions qq
     JOIN questions q ON q.id = qq.question_id
     LEFT JOIN question_tags qt ON qt.question_id = q.id
     LEFT JOIN tags t ON t.id = qt.tag_id
     WHERE qq.quiz_id = $1
     GROUP BY q.id, q.question_text, q.question_type, q.image_url, qq.question_order
     ORDER BY qq.question_order`,
    [quizId]
  );

  return Promise.all(
    result.rows.map(async (q) => {
      const answers = await query(
        'SELECT answer_text, is_correct, display_order FROM answers WHERE question_id = $1 ORDER BY display_order',
        [q.id]
      );
      return {
        questionText: q.question_text,
        questionType: q.question_type,
        imageUrl: q.image_url || null,
        tags: (q.tags || []).map((t) => t.name).filter(Boolean),
        answers: answers.rows.map((a) => ({
          text: a.answer_text,
          isCorrect: a.is_correct,
          order: a.display_order,
        })),
      };
    })
  );
}

/**
 * Find or create a tag by name. Returns the tag id.
 */
async function findOrCreateTag(name) {
  const result = await query(
    `INSERT INTO tags (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name.trim()]
  );
  return result.rows[0].id;
}

/**
 * Build a minimal CSV string from rows and headers.
 */
function buildCSV(headers, rows) {
  const escape = (val) => {
    const str = val == null ? '' : String(val);
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };
  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }
  return lines.join('\r\n');
}

// ─── Export handlers ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/export/quizzes
 * GET /api/admin/export/quizzes?quizId=42
 *
 * Export quiz library as JSON. Includes all questions, answers, and tags.
 * If quizId is provided, exports only that quiz.
 */
export async function exportQuizzesJSON(req, res, next) {
  try {
    const { quizId } = req.query;

    let quizRows;
    if (quizId) {
      const result = await query(
        'SELECT * FROM quizzes WHERE id = $1 AND is_active = TRUE',
        [parseInt(quizId, 10)]
      );
      if (result.rows.length === 0) throw new NotFoundError('Quiz');
      quizRows = result.rows;
    } else {
      const result = await query(
        'SELECT * FROM quizzes WHERE is_active = TRUE ORDER BY title'
      );
      quizRows = result.rows;
    }

    const quizzes = await Promise.all(
      quizRows.map(async (quiz) => ({
        title: quiz.title,
        description: quiz.description || '',
        availableLive: quiz.available_live,
        availableSolo: quiz.available_solo,
        showResults: quiz.show_results,
        answerDisplayTimeout: quiz.answer_display_timeout,
        questions: await fetchQuizQuestions(quiz.id),
      }))
    );

    const totalQuestions = quizzes.reduce((sum, q) => sum + q.questions.length, 0);

    const exportData = {
      exportVersion: '1',
      exportedAt: new Date().toISOString(),
      appVersion: VERSION,
      quizCount: quizzes.length,
      questionCount: totalQuestions,
      quizzes,
    };

    const slug = quizId ? `quiz-${quizId}` : 'library';
    const filename = `triviaforge-${slug}-${Date.now()}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/export/questions.csv
 *
 * Export all active questions as a flat CSV file.
 * Columns: Quiz Title(s), Question, Type, Choice A-D, Correct, Tags
 */
export async function exportQuestionsCSV(req, res, next) {
  try {
    // Fetch all questions with their quiz memberships and answers
    const result = await query(
      `SELECT
         q.id, q.question_text, q.question_type, q.image_url,
         COALESCE(string_agg(DISTINCT qz.title, ' | ' ORDER BY qz.title), '') AS quiz_titles,
         COALESCE(string_agg(DISTINCT t.name, '; ' ORDER BY t.name), '')       AS tag_names
       FROM questions q
       LEFT JOIN quiz_questions qq ON qq.question_id = q.id
       LEFT JOIN quizzes qz ON qz.id = qq.quiz_id AND qz.is_active = TRUE
       LEFT JOIN question_tags qt ON qt.question_id = q.id
       LEFT JOIN tags t ON t.id = qt.tag_id
       WHERE q.is_archived = FALSE
       GROUP BY q.id, q.question_text, q.question_type, q.image_url
       ORDER BY q.id`
    );

    const headers = ['Quiz(es)', 'Question', 'Type', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Correct', 'Tags', 'Image URL'];
    const rows = [];

    for (const q of result.rows) {
      const answers = await query(
        'SELECT answer_text, is_correct, display_order FROM answers WHERE question_id = $1 ORDER BY display_order',
        [q.id]
      );
      const choices = ['', '', '', ''];
      let correct = '';
      const letters = ['A', 'B', 'C', 'D'];
      answers.rows.forEach((a, i) => {
        if (i < 4) {
          choices[i] = a.answer_text;
          if (a.is_correct) correct = letters[i];
        }
      });

      rows.push([
        q.quiz_titles,
        q.question_text,
        q.question_type,
        ...choices,
        correct,
        q.tag_names,
        q.image_url || '',
      ]);
    }

    const csv = buildCSV(headers, rows);
    const filename = `triviaforge-questions-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM for Excel UTF-8 compatibility
  } catch (err) {
    next(err);
  }
}

// ─── Import handler ────────────────────────────────────────────────────────────

/**
 * POST /api/admin/export/import
 * Body: exported JSON object (from exportQuizzesJSON)
 *
 * Imports quizzes from an exported JSON file.
 * Questions with an existing text_hash are reused rather than duplicated.
 * Returns a summary: quizzes created, questions created, duplicates reused.
 */
export async function importQuizzesJSON(req, res, next) {
  try {
    const data = req.body;

    if (!data || !Array.isArray(data.quizzes)) {
      throw new BadRequestError('Invalid export file: expected { quizzes: [...] }');
    }

    if (data.quizzes.length === 0) {
      throw new BadRequestError('Export file contains no quizzes');
    }

    const summary = { quizzesCreated: 0, questionsCreated: 0, questionsReused: 0 };

    for (const quiz of data.quizzes) {
      if (!quiz.title) continue;

      // Create the quiz
      const quizResult = await query(
        `INSERT INTO quizzes (title, description, available_live, available_solo, show_results, answer_display_timeout)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          quiz.title,
          quiz.description || '',
          quiz.availableLive ?? true,
          quiz.availableSolo ?? true,
          quiz.showResults ?? true,
          quiz.answerDisplayTimeout || 30,
        ]
      );
      const quizId = quizResult.rows[0].id;
      summary.quizzesCreated++;

      let order = 0;
      for (const question of quiz.questions || []) {
        if (!question.questionText) continue;

        const hash = generateTextHash(question.questionText);

        // Reuse existing question if text matches exactly
        const existing = await query(
          'SELECT id FROM questions WHERE text_hash = $1 LIMIT 1',
          [hash]
        );

        let questionId;
        if (existing.rows.length > 0) {
          questionId = existing.rows[0].id;
          summary.questionsReused++;
        } else {
          // Insert new question
          const qResult = await query(
            `INSERT INTO questions (question_text, question_type, image_url, text_hash)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [question.questionText, question.questionType || 'multiple_choice', question.imageUrl || null, hash]
          );
          questionId = qResult.rows[0].id;
          summary.questionsCreated++;

          // Insert answers
          for (const answer of question.answers || []) {
            await query(
              'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
              [questionId, answer.text, answer.isCorrect ?? false, answer.order ?? 0]
            );
          }

          // Attach tags
          for (const tagName of question.tags || []) {
            if (!tagName) continue;
            const tagId = await findOrCreateTag(tagName);
            await query(
              'INSERT INTO question_tags (question_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [questionId, tagId]
            );
          }
        }

        // Link question to quiz
        await query(
          'INSERT INTO quiz_questions (quiz_id, question_id, question_order) VALUES ($1, $2, $3)',
          [quizId, questionId, order++]
        );
      }
    }

    const msg =
      `Imported ${summary.quizzesCreated} quiz${summary.quizzesCreated !== 1 ? 'zes' : ''}, ` +
      `${summary.questionsCreated} new question${summary.questionsCreated !== 1 ? 's' : ''}, ` +
      `${summary.questionsReused} reused from existing library`;

    sendSuccess(res, summary, msg);
  } catch (err) {
    next(err);
  }
}
