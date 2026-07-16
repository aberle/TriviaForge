/**
 * TriviaForge - Backup Controller
 *
 * Handles database backup and restore API endpoints.
 * All routes require admin authentication.
 */

import * as backupService from '../services/backup.service.js';
import { sendSuccess } from '../utils/responses.js';

/**
 * GET /api/admin/backups
 * List all available backups, newest first.
 */
export async function getBackups(req, res, next) {
  try {
    const backups = await backupService.listBackups();
    sendSuccess(res, backups, 'Backups retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/backups
 * Trigger a manual backup immediately.
 */
export async function triggerBackup(req, res, next) {
  try {
    const meta = await backupService.createBackup('manual');
    sendSuccess(res, meta, 'Backup created successfully');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/backups/:name/download
 * Stream the .sql.gz backup file to the browser as a download.
 */
export async function downloadBackup(req, res, next) {
  try {
    const { name } = req.params;
    const filePath = await backupService.getBackupFilePath(name);
    // res.download sets Content-Disposition safely; name is already validated in getBackupFilePath
    res.download(filePath, `${name}.sql.gz`);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/backups/:name/restore
 * Restore the database from the named backup.
 * Blocks if the backup version is newer than the running app.
 * Server restarts automatically after restore via process.exit(0).
 */
export async function restoreBackup(req, res, next) {
  try {
    const { name } = req.params;

    // Send response before restore begins — server will exit mid-flight otherwise
    res.json({ success: true, message: 'Restore initiated. Server will restart in a moment.' });

    // Run restore after response is flushed
    setImmediate(() => {
      backupService.restoreBackup(name).catch((err) => {
        console.error('[BACKUP] Restore failed:', err.message);
      });
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/backups/:name
 * Delete a backup and its metadata sidecar.
 */
export async function deleteBackup(req, res, next) {
  try {
    const { name } = req.params;
    await backupService.deleteBackup(name);
    sendSuccess(res, null, 'Backup deleted');
  } catch (err) {
    next(err);
  }
}
