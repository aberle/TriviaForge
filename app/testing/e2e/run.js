/**
 * Runs the end-to-end suites one after another against a running server and prints a summary.
 *
 *   npm run test:e2e                 # everything
 *   npm run test:e2e -- reconnect    # only suites whose file name contains "reconnect"
 *   npm run test:e2e -- --no-browser # only the suites that don't need Chrome
 *
 * Logs in as the admin once and shares the token with the suites (the login endpoint is rate
 * limited unless the server runs with DEBUG_MODE=true). See ../README.md for setup.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, ADMIN_USER, ADMIN_PASSWORD, findChrome } from './lib/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { file: 'player-round-flow.e2e.js', browser: true },
  { file: 'results-and-standings.e2e.js', browser: true },
  { file: 'join-and-identity.e2e.js', browser: true },
  { file: 'reconnect.e2e.js', browser: true },
  { file: 'admin-authoring.e2e.js', browser: true },
  { file: 'solo-mode.e2e.js', browser: true },
  { file: 'presenter-display-flow.e2e.js', browser: true },
  { file: 'legacy-live-game.e2e.js', browser: false },
  { file: 'resume-session.e2e.js', browser: false },
  { file: 'question-bank.e2e.js', browser: false },
  { file: 'use-rounds-composable.e2e.js', browser: false },
];

const args = process.argv.slice(2);
const noBrowser = args.includes('--no-browser');
const filters = args.filter((a) => !a.startsWith('--'));

async function main() {
  // Is the server up, and which mode is it in?
  let config;
  try {
    config = await (await fetch(`${BASE}/api/config`)).json();
  } catch {
    console.error(`❌ Can't reach a TriviaForge server at ${BASE}.\n   Start it first, or point TEST_BASE_URL at it (see testing/README.md).`);
    process.exit(2);
  }

  let token = process.env.TEST_ADMIN_TOKEN;
  if (!token) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    });
    if (!res.ok) {
      console.error(`❌ Admin login failed (${res.status}). Set TEST_ADMIN_USER / TEST_ADMIN_PASSWORD to match the server's ADMIN_PASSWORD.`);
      process.exit(2);
    }
    token = (await res.json()).token;
  }

  const chrome = findChrome();
  console.log(`Server: ${BASE}  (guest-only mode: ${config.guestOnly ? 'ON' : 'off'})`);
  console.log(`Chrome: ${chrome || 'NOT FOUND (browser suites will be skipped; set CHROME_PATH)'}`);

  const selected = SUITES.filter((s) => !filters.length || filters.some((f) => s.file.includes(f)));
  const results = [];

  for (const suite of selected) {
    if (suite.browser && (noBrowser || !chrome)) {
      results.push({ ...suite, status: 'skipped' });
      continue;
    }
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, suite.file)], {
        stdio: 'inherit',
        env: { ...process.env, TEST_ADMIN_TOKEN: token },
      });
      child.on('exit', (c) => resolve(c ?? 1));
    });
    results.push({ ...suite, status: code === 0 ? 'passed' : 'FAILED' });
  }

  console.log('\n================ Summary ================');
  for (const r of results) {
    const icon = { passed: '✅', FAILED: '❌', skipped: '⏭️ ' }[r.status];
    console.log(`${icon} ${r.file}  ${r.status}`);
  }
  const failed = results.filter((r) => r.status === 'FAILED').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  if (skipped) console.log(`\n⚠️  ${skipped} browser suite(s) were skipped, so the UI was NOT fully tested.`);
  process.exit(failed ? 1 : 0);
}

main();
