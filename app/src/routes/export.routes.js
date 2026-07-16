import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as exportController from '../controllers/export.controller.js';

const router = express.Router();

// GET  /api/admin/export/quizzes           — export all quizzes as JSON
// GET  /api/admin/export/quizzes?quizId=42 — export single quiz as JSON
router.get('/quizzes', requireAdmin, asyncHandler(exportController.exportQuizzesJSON));

// GET  /api/admin/export/questions.csv     — export all questions as flat CSV
router.get('/questions.csv', requireAdmin, asyncHandler(exportController.exportQuestionsCSV));

// POST /api/admin/export/import            — import quiz library from JSON
router.post('/import', requireAdmin, asyncHandler(exportController.importQuizzesJSON));

export default router;
