/**
 * The admin-configurable "Default Theme for Player Clients" setting (Theme Settings tab, below the
 * admin's own personal theme grid): the theme a guest/player/display client gets when it has no
 * personal preference of its own yet (no localStorage, no saved account theme). It's a single global
 * app_settings row (default_player_theme), read publicly via GET /api/config (guests can't call an
 * admin-only endpoint) and written by the admin via the existing generic GET/POST /api/options.
 *
 * This suite mutates that GLOBAL setting (not a quiz-scoped sandbox like most suites), so it restores
 * the original value in a finally block regardless of pass/fail.
 */

import { runSuite, BASE, sleep } from './lib/harness.js';

await runSuite('admin default theme', { chrome: true }, async ({ ok, section, env }) => {
  const original = (await (await env.api('GET', '/api/options')).json()).defaultPlayerTheme || 'grey';

  try {
    section('The admin can set and save it from the Settings tab, and it round-trips through the database');
    const admin = await env.adminPage('/admin');
    await admin.waitFor(`document.querySelector('.admin-page')`);
    await sleep(500);
    await admin.eval(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Settings').pop()?.click(); true`);
    await admin.waitFor(`!!document.querySelector('.default-theme-select')`);
    await sleep(300);
    ok('it loads the current default', (await admin.eval(`document.querySelector('.default-theme-select').value`)) === original, original);

    await admin.eval(`(() => { const s = document.querySelector('.default-theme-select'); s.value = 'murder'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await admin.eval(`[...document.querySelectorAll('.default-theme-row button')].find(b => b.textContent.trim() === 'Save')?.click(); true`);
    await admin.waitText('Default player theme saved');
    ok('saving shows a confirmation message', true);

    await admin.eval(`location.reload(); true`);
    await admin.waitFor(`document.querySelector('.admin-page')`);
    await sleep(500);
    await admin.eval(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Settings').pop()?.click(); true`);
    await admin.waitFor(`!!document.querySelector('.default-theme-select')`);
    // The select starts on its ref's initial value ('grey') until the panel's own fetchOptions() GET
    // resolves -- poll instead of asserting right after a fixed sleep, which is occasionally too short.
    await admin.waitFor(`document.querySelector('.default-theme-select')?.value === 'murder'`, { timeout: 8000 });
    ok('...and it survives a reload (saved to the database, not just an in-memory value)', true);

    section('The server rejects a bogus theme value');
    const rejected = await env.api('POST', '/api/options', { defaultPlayerTheme: 'not-a-real-theme' });
    ok('refused with 400, not silently accepted', rejected.status === 400);

    section('GET /api/config -- what an unauthenticated player/display client actually reads -- reflects the change immediately');
    const config = await (await fetch(`${BASE}/api/config`)).json();
    ok('defaultTheme is murder', config.defaultTheme === 'murder', JSON.stringify(config));

    section('A brand-new guest, with no saved preference at all, picks up the admin default');
    const player = await env.open(`${BASE}/player`, { width: 1200, height: 900 });
    await player.eval(`localStorage.clear(); true`);
    await player.eval(`location.reload(); true`);
    await sleep(800);
    ok('the player page applies murder', (await player.eval(`document.documentElement.getAttribute('data-theme')`)) === 'murder');
    await player.closeTab();

    const display = await env.open(`${BASE}/display`, { width: 1200, height: 900 });
    await display.eval(`localStorage.clear(); true`);
    await display.eval(`location.reload(); true`);
    await sleep(800);
    ok('the display page applies murder too', (await display.eval(`document.documentElement.getAttribute('data-theme')`)) === 'murder');

    section("A client with its own saved theme (localStorage) is never overridden by the admin default");
    await display.eval(`localStorage.setItem('trivia_theme', 'light'); true`);
    await display.eval(`location.reload(); true`);
    await sleep(800);
    ok('the display page keeps its own saved theme (light), ignoring the admin default (murder)', (await display.eval(`document.documentElement.getAttribute('data-theme')`)) === 'light');
    await display.closeTab();

    section('It never applies to the login page (or, by the same code path, admin/presenter) -- only PLAYER and DISPLAY');
    const login = await env.open(`${BASE}/`, { width: 1200, height: 900 });
    await login.eval(`localStorage.clear(); true`);
    await login.eval(`location.reload(); true`);
    await sleep(800);
    ok('a fresh, unauthenticated visit to the login page still gets its own hardcoded default (dark), not the player-facing admin default (murder)', (await login.eval(`document.documentElement.getAttribute('data-theme')`)) !== 'murder', await login.eval(`document.documentElement.getAttribute('data-theme')`));
    await login.closeTab();

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  } finally {
    // Global setting: always put it back, whether or not the assertions above passed
    await env.api('POST', '/api/options', { defaultPlayerTheme: original });
  }
});
