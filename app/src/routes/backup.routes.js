import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as backupController from '../controllers/backup.controller.js';

const router = express.Router();

// GET  /api/admin/backups          — list all backups
router.get('/', requireAdmin, asyncHandler(backupController.getBackups));

// POST /api/admin/backups          — trigger manual backup
router.post('/', requireAdmin, asyncHandler(backupController.triggerBackup));

// GET  /api/admin/backups/:name/download  — download .sql.gz file
router.get('/:name/download', requireAdmin, asyncHandler(backupController.downloadBackup));

// POST /api/admin/backups/:name/restore   — restore from backup
router.post('/:name/restore', requireAdmin, asyncHandler(backupController.restoreBackup));

// DELETE /api/admin/backups/:name  — delete a backup
router.delete('/:name', requireAdmin, asyncHandler(backupController.deleteBackup));

export default router;
