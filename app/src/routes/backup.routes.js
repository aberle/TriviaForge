import express from 'express';
import multer from 'multer';
import path from 'path';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as backupController from '../controllers/backup.controller.js';

const router = express.Router();

// Configure multer for backup file imports (.sql.gz)
const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.gz') {
      cb(null, true);
    } else {
      cb(new Error('Only .sql.gz backup files are allowed'));
    }
  },
});

// GET  /api/admin/backups          — list all backups
router.get('/', requireAdmin, asyncHandler(backupController.getBackups));

// POST /api/admin/backups          — trigger manual backup
router.post('/', requireAdmin, asyncHandler(backupController.triggerBackup));

// POST /api/admin/backups/import   — import a previously-downloaded .sql.gz file
router.post('/import', requireAdmin, backupUpload.single('file'), asyncHandler(backupController.importBackup));

// GET  /api/admin/backups/:name/download  — download .sql.gz file
router.get('/:name/download', requireAdmin, asyncHandler(backupController.downloadBackup));

// POST /api/admin/backups/:name/restore   — restore from backup
router.post('/:name/restore', requireAdmin, asyncHandler(backupController.restoreBackup));

// DELETE /api/admin/backups/:name  — delete a backup
router.delete('/:name', requireAdmin, asyncHandler(backupController.deleteBackup));

export default router;
