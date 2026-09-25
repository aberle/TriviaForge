/**
 * Shared configuration for the end-to-end tests (see ../README.md).
 * Everything is overridable with environment variables.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
export const ADMIN_USER = process.env.TEST_ADMIN_USER || 'admin';
export const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'changeme';

/** Where failure screenshots go. */
export const ARTIFACT_DIR = process.env.TEST_ARTIFACTS_DIR || path.join(os.tmpdir(), 'triviaforge-e2e');

/**
 * Find a Chrome/Chromium binary: $CHROME_PATH, then the usual install locations, then $PATH.
 * @returns {string|null}
 */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    try {
      const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .split(/\r?\n/)[0]
        .trim();
      if (found) return found;
    } catch {
      // not on PATH
    }
  }
  return null;
}
