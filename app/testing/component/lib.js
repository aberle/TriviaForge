/**
 * Shared helpers for the component tests. These need no running server, database or browser:
 * Vite loads the real .vue files for server-side rendering, and a fake backend stands in for the API.
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(APP_ROOT, 'package.json'));

/**
 * Import a dependency's ESM build by its path inside app/node_modules. It must be the same build Vite
 * loads for the components (the default CommonJS resolution would give Pinia and Vue two instances).
 */
export const dep = (file) => import(pathToFileURL(path.join(APP_ROOT, 'node_modules', file)).href);

export async function startVite() {
  const { createServer } = await import(require.resolve('vite'));
  return createServer({ root: APP_ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
}

export async function ssr() {
  const { createSSRApp, h } = await dep('vue/index.mjs');
  const { renderToString } = await dep('vue/server-renderer/index.mjs');
  return { createSSRApp, h, render: (component, props) => renderToString(createSSRApp({ render: () => h(component, props) })) };
}

/** A tiny pass/fail counter with the same output shape as the e2e suites. */
export function suite(name) {
  let pass = 0;
  let fail = 0;
  console.log(`\n=== ${name} ===`);
  return {
    ok(label, condition, detail = '') {
      condition ? pass++ : fail++;
      console.log(`  ${condition ? '✅' : '❌'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    },
    finish() {
      console.log(`${fail ? '❌' : '✅'} ${name}: ${pass} passed, ${fail} failed`);
      return fail === 0;
    },
  };
}
