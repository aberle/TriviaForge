/**
 * TriviaForge - Backup Service
 *
 * Handles database backup and restore:
 * - Creating compressed pg_dump backups with metadata sidecar
 * - Listing, downloading, and deleting backup files
 * - Version-gated restore (blocks if backup is from a newer app version)
 * - Pruning old backups to a configurable retention limit
 */

import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import { createGzip, gunzipSync } from 'zlib';
import path from 'path';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { env } from '../config/environment.js';
import { VERSION } from '../config/version.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

export const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const MAX_BACKUPS = 10;

const COUNTED_TABLES = ['quizzes', 'questions', 'game_sessions', 'game_participants', 'users'];

// Allowlist: the format we generate — triviaforge-YYYY-MM-DDTHH-MM-SS, optionally
// with a short random suffix (used for imported backups to avoid name collisions)
const BACKUP_NAME_RE = /^triviaforge-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-[a-f0-9]{4})?$/;

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

function validateBackupName(name) {
  if (!name || !BACKUP_NAME_RE.test(name)) {
    throw new BadRequestError('Invalid backup name');
  }
}

function assertInsideBackupDir(resolvedPath) {
  const safeDir = path.resolve(BACKUP_DIR);
  if (!resolvedPath.startsWith(safeDir + path.sep) && resolvedPath !== safeDir) {
    throw new BadRequestError('Invalid backup path');
  }
}

// Parse semver string into [major, minor, patch]
function parseVersion(v) {
  return (v || '0.0.0').split('.').map(Number);
}

// Returns positive if a > b, negative if a < b, 0 if equal
function compareVersions(a, b) {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

// Convert ISO timestamp to a filename-safe slug: 2026-07-15T14-30-00
function timestampToSlug(ts) {
  return ts.replace(/:/g, '-').replace(/\..+/, '').replace('T', 'T');
}

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

async function getRowCounts() {
  const counts = {};
  for (const table of COUNTED_TABLES) {
    try {
      const result = await query(`SELECT COUNT(*) FROM ${table}`);
      counts[table] = parseInt(result.rows[0].count, 10);
    } catch {
      counts[table] = null;
    }
  }
  return counts;
}

async function getAppliedMigrations() {
  try {
    const result = await query(
      "SELECT filename FROM schema_migrations WHERE filename NOT LIKE '__app_version_%' ORDER BY filename"
    );
    return result.rows.map((r) => r.filename);
  } catch {
    return [];
  }
}

/**
 * Extract the COPY data block for a given table from a plain-format pg_dump SQL text.
 * @returns {string[]|null} tab-split data lines, or null if the table isn't in the dump
 */
function extractCopyBlock(sqlText, table) {
  const header = `COPY public.${table} (`;
  const headerLineEnd = sqlText.indexOf(`\n`, sqlText.indexOf(header));
  if (headerLineEnd === -1) return null;

  const terminatorIdx = sqlText.indexOf('\n\\.', headerLineEnd);
  if (terminatorIdx === -1) return null;

  const block = sqlText.slice(headerLineEnd + 1, terminatorIdx);
  return block === '' ? [] : block.split('\n');
}

/**
 * Parse row counts, applied migrations, and the app version marker directly out of
 * an uncompressed pg_dump SQL text — used for imported backups, since that
 * information isn't otherwise recoverable from a bare .sql.gz file.
 */
function parseDumpMetadata(sqlText) {
  const rowCounts = {};
  for (const table of COUNTED_TABLES) {
    const lines = extractCopyBlock(sqlText, table);
    rowCounts[table] = lines ? lines.length : null;
  }

  let appVersion = null;
  let migrationsApplied = [];
  const migrationHeader = 'COPY public.schema_migrations (';
  const headerIdx = sqlText.indexOf(migrationHeader);
  if (headerIdx !== -1) {
    const columns = sqlText
      .slice(headerIdx + migrationHeader.length, sqlText.indexOf(')', headerIdx))
      .split(',')
      .map((c) => c.trim());
    const filenameIdx = columns.indexOf('filename');
    const lines = extractCopyBlock(sqlText, 'schema_migrations') || [];

    if (filenameIdx !== -1) {
      for (const line of lines) {
        const filename = line.split('\t')[filenameIdx];
        const versionMatch = filename && filename.match(/^__app_version_(.+)__$/);
        if (versionMatch) {
          appVersion = versionMatch[1];
        } else if (filename) {
          migrationsApplied.push(filename);
        }
      }
      migrationsApplied.sort();
    }
  }

  return { rowCounts, appVersion, migrationsApplied };
}

/**
 * Create a new compressed database backup.
 * @param {'manual'|'scheduled'} trigger
 * @returns {Promise<Object>} backup metadata
 */
export async function createBackup(trigger = 'manual') {
  await ensureBackupDir();

  const timestamp = new Date().toISOString();
  const slug = timestampToSlug(timestamp);
  const name = `triviaforge-${slug}`;
  const sqlGzPath = path.join(BACKUP_DIR, `${name}.sql.gz`);
  const metaPath = path.join(BACKUP_DIR, `${name}.meta.json`);

  const start = Date.now();

  await new Promise((resolve, reject) => {
    const pgDump = spawn('pg_dump', [
      `--dbname=${env.databaseUrl}`,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--schema=public',
    ]);

    const gzip = createGzip({ level: 6 });
    const output = createWriteStream(sqlGzPath);

    pgDump.stdout.pipe(gzip).pipe(output);

    let stderr = '';
    pgDump.stderr.on('data', (d) => { stderr += d.toString(); });
    pgDump.on('error', reject);
    output.on('error', reject);

    pgDump.on('close', (code) => {
      if (code !== 0) reject(new Error(`pg_dump exited ${code}: ${stderr}`));
    });
    output.on('finish', resolve);
  });

  const stat = await fs.stat(sqlGzPath);
  const [rowCounts, migrationsApplied] = await Promise.all([getRowCounts(), getAppliedMigrations()]);

  const meta = {
    name,
    appVersion: VERSION,
    exportedAt: timestamp,
    trigger,
    sizeBytes: stat.size,
    rowCounts,
    migrationsApplied,
    durationMs: Date.now() - start,
  };

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  await pruneOldBackups();

  console.log(`[BACKUP] Created ${name} (${(stat.size / 1024 / 1024).toFixed(2)} MB, ${meta.durationMs}ms, trigger: ${trigger})`);
  return meta;
}

/**
 * Import a previously-downloaded .sql.gz backup file so it can be restored.
 * Used when a container/volume was rebuilt from scratch and the "backups" volume
 * (which normally holds prior backups) no longer contains anything to restore from.
 * The original app version and row counts are unknown, so the resulting entry is
 * marked as imported and always passes the restore version-gate.
 * @param {Buffer} fileBuffer - raw contents of the uploaded .sql.gz file
 * @returns {Promise<Object>} backup metadata
 */
export async function importBackup(fileBuffer) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new BadRequestError('No file uploaded');
  }
  if (!fileBuffer.subarray(0, 2).equals(GZIP_MAGIC)) {
    throw new BadRequestError('File is not a valid gzip archive (expected a .sql.gz backup)');
  }

  await ensureBackupDir();

  const timestamp = new Date().toISOString();
  const slug = timestampToSlug(timestamp);
  const suffix = crypto.randomBytes(2).toString('hex');
  const name = `triviaforge-${slug}-${suffix}`;
  const sqlGzPath = path.join(BACKUP_DIR, `${name}.sql.gz`);
  const metaPath = path.join(BACKUP_DIR, `${name}.meta.json`);

  await fs.writeFile(sqlGzPath, fileBuffer);

  let appVersion = null;
  let rowCounts = null;
  let migrationsApplied = [];
  try {
    const { appVersion: v, rowCounts: rc, migrationsApplied: m } = parseDumpMetadata(
      gunzipSync(fileBuffer).toString('utf-8')
    );
    appVersion = v;
    rowCounts = rc;
    migrationsApplied = m;
  } catch (err) {
    console.warn(`[BACKUP] Could not parse imported dump metadata: ${err.message}`);
  }

  const meta = {
    name,
    appVersion,
    exportedAt: timestamp,
    trigger: 'imported',
    sizeBytes: fileBuffer.length,
    rowCounts,
    migrationsApplied,
    imported: true,
  };

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  console.log(`[BACKUP] Imported ${name} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  return meta;
}

/**
 * List all available backups, newest first.
 * @returns {Promise<Array>}
 */
export async function listBackups() {
  await ensureBackupDir();

  const files = await fs.readdir(BACKUP_DIR);
  const metaFiles = files.filter((f) => f.endsWith('.meta.json'));

  const results = await Promise.all(
    metaFiles.map(async (file) => {
      try {
        const content = await fs.readFile(path.join(BACKUP_DIR, file), 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => new Date(b.exportedAt) - new Date(a.exportedAt));
}

/**
 * Get metadata for a single backup by name.
 * @param {string} name - backup name without extension
 * @returns {Promise<Object|null>}
 */
export async function getBackupMeta(name) {
  validateBackupName(name);
  try {
    const filePath = path.join(BACKUP_DIR, `${name}.meta.json`);
    const resolved = await fs.realpath(filePath).catch(() => filePath);
    assertInsideBackupDir(resolved);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Get the absolute path to a backup .sql.gz file for streaming download.
 * @param {string} name
 * @returns {Promise<string>}
 */
export async function getBackupFilePath(name) {
  validateBackupName(name);
  const filePath = path.join(BACKUP_DIR, `${name}.sql.gz`);
  await fs.access(filePath).catch(() => { throw new NotFoundError('Backup file'); });
  const resolved = await fs.realpath(filePath);
  assertInsideBackupDir(resolved);
  return resolved;
}

/**
 * Delete a backup and its meta sidecar.
 * @param {string} name
 */
export async function deleteBackup(name) {
  validateBackupName(name);
  const meta = await getBackupMeta(name);
  if (!meta) throw new NotFoundError('Backup');

  await Promise.all([
    fs.unlink(path.join(BACKUP_DIR, `${name}.sql.gz`)).catch(() => {}),
    fs.unlink(path.join(BACKUP_DIR, `${name}.meta.json`)).catch(() => {}),
  ]);

  console.log(`[BACKUP] Deleted ${name}`);
}

/**
 * Restore the database from a backup.
 * Blocks if the backup was created on a newer app version than currently running.
 * Terminates active DB connections, restores via psql, then exits so Docker restarts.
 * @param {string} name - backup name without extension
 */
export async function restoreBackup(name) {
  const meta = await getBackupMeta(name);
  if (!meta) throw new NotFoundError('Backup');

  if (compareVersions(meta.appVersion, VERSION) > 0) {
    throw new BadRequestError(
      `Cannot restore: backup was created on v${meta.appVersion}, but this server is running v${VERSION}. ` +
      `Restoring a newer backup onto an older app is not supported.`
    );
  }

  const sqlGzPath = await getBackupFilePath(name);

  console.log(`[BACKUP] Restore initiated — source: ${name} (${meta.appVersion ? `v${meta.appVersion}` : 'version unknown'}), current: v${VERSION}`);

  // Terminate active connections so psql can restore cleanly
  try {
    await query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
    `);
    console.log('[BACKUP] Terminated active DB connections');
  } catch (err) {
    console.warn('[BACKUP] Could not terminate connections (continuing):', err.message);
  }

  // Decompress and pipe into psql
  await new Promise((resolve, reject) => {
    const gunzip = spawn('gunzip', ['-c', sqlGzPath]);
    const psql = spawn('psql', [`--dbname=${env.databaseUrl}`, '--quiet']);

    gunzip.stdout.pipe(psql.stdin);

    let stderr = '';
    psql.stderr.on('data', (d) => { stderr += d.toString(); });
    gunzip.on('error', reject);
    psql.on('error', reject);

    psql.on('close', (code) => {
      if (code !== 0) reject(new Error(`psql restore failed (exit ${code}): ${stderr}`));
      else resolve();
    });
  });

  console.log('[BACKUP] Database restored — restarting server for migrations');
  // Brief delay so the HTTP response can be sent before exit
  setTimeout(() => process.exit(0), 500);
}

/**
 * Prune backups beyond MAX_BACKUPS, keeping the most recent ones.
 */
export async function pruneOldBackups() {
  const backups = await listBackups();
  if (backups.length <= MAX_BACKUPS) return;

  const toDelete = backups.slice(MAX_BACKUPS);
  for (const backup of toDelete) {
    await deleteBackup(backup.name).catch((err) =>
      console.warn(`[BACKUP] Failed to prune ${backup.name}:`, err.message)
    );
  }
  console.log(`[BACKUP] Pruned ${toDelete.length} old backup(s), keeping ${MAX_BACKUPS}`);
}

export default {
  BACKUP_DIR,
  createBackup,
  importBackup,
  listBackups,
  getBackupMeta,
  getBackupFilePath,
  deleteBackup,
  restoreBackup,
  pruneOldBackups,
};
