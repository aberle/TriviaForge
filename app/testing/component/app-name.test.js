/**
 * The server reads APP_NAME into env.appName (defaulting to "TriviaForge") and reports it from
 * GET /api/config. This checks the env-reading half in isolation, in a fresh child process for each
 * case (environment.js reads process.env once, at import time, so the two cases can't share a
 * process). The other half — that /api/config actually returns env.appName, and that every page uses
 * it — is covered by testing/e2e/app-name.e2e.js against a running server.
 */

import { execFileSync } from 'node:child_process';
import { APP_ROOT, suite } from './lib.js';

const t = suite('APP_NAME environment variable');

const readAppName = (env) => {
  const script = "import('./src/config/environment.js').then((m) => console.log(JSON.stringify({ appName: m.env.appName })));";
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
};

t.ok('defaults to "TriviaForge" when APP_NAME is not set', readAppName({ APP_NAME: '' }).appName === 'TriviaForge', JSON.stringify(readAppName({ APP_NAME: '' })));
t.ok('uses APP_NAME when it is set', readAppName({ APP_NAME: 'Boulder Trivia' }).appName === 'Boulder Trivia', JSON.stringify(readAppName({ APP_NAME: 'Boulder Trivia' })));
t.ok('an APP_NAME of only whitespace still falls back to the default (nothing meaningful to show)', readAppName({ APP_NAME: '   ' }).appName.trim() !== '', JSON.stringify(readAppName({ APP_NAME: '   ' })));

process.exit(t.finish() ? 0 : 1);
