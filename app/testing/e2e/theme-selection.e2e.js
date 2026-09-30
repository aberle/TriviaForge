/**
 * The "Murder!" theme (styled after The Traitors): selectable everywhere the other themes are --
 * the player page's theme selector, the display page's cycling toggle, and the admin Settings tab's
 * theme grid -- persists across a reload, and round-trips through the server for a logged-in admin
 * (which exercises the new `users_theme_check` constraint the migration adds).
 */

import { runSuite, BASE, sleep } from './lib/harness.js';

await runSuite('theme selection', { chrome: true }, async ({ ok, section, env }) => {
  section('The player page offers Murder! and applying it persists across a reload');
  const player = await env.open(`${BASE}/player`, { width: 1200, height: 900 });
  await sleep(500);
  await player.eval(`document.querySelector('.theme-toggle-btn').click(); true`);
  await sleep(300);
  const options = await player.eval(`[...document.querySelectorAll('.theme-option')].map(b => b.innerText)`);
  ok('Murder! is offered alongside the other themes', options.some((o) => o.includes('Murder')), JSON.stringify(options));
  await player.eval(`[...document.querySelectorAll('.theme-option')].find(b => b.innerText.includes('Murder')).click(); true`);
  await sleep(300);
  ok('selecting it sets data-theme="murder"', (await player.eval(`document.documentElement.getAttribute('data-theme')`)) === 'murder');
  await player.eval(`location.reload(); true`);
  await player.waitFor(`document.documentElement.getAttribute('data-theme') === 'murder'`);
  ok('...and it survives a reload (saved to localStorage)', true);
  await player.closeTab();

  section('The display page toggle can cycle to Murder! too');
  const display = await env.open(`${BASE}/display`, { width: 1200, height: 900 });
  await sleep(500);
  let dataTheme = null;
  for (let i = 0; i < 5 && dataTheme !== 'murder'; i++) {
    await display.eval(`document.querySelector('.toggle-btn').click(); true`);
    await sleep(200);
    dataTheme = await display.eval(`document.documentElement.getAttribute('data-theme')`);
  }
  ok('cycling the toggle reaches the murder theme', dataTheme === 'murder', dataTheme);
  const label = await display.eval(`document.querySelector('.toggle-btn .label')?.innerText`);
  ok('...and labels it "Murder!"', label === 'Murder!', label);
  await display.closeTab();

  section("A logged-in admin's Murder! choice round-trips through the server");
  const admin = await env.adminPage('/admin');
  await admin.waitFor(`document.querySelector('.admin-page')`);
  await sleep(500);
  await admin.eval(`[...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Settings').pop()?.click(); true`);
  await admin.waitFor(`!!document.querySelector('.theme-card')`);
  await admin.eval(`[...document.querySelectorAll('.theme-card')].find(c => c.innerText.includes('Murder')).click(); true`);
  await sleep(500);
  ok('the admin page itself switches to the murder theme', (await admin.eval(`document.documentElement.getAttribute('data-theme')`)) === 'murder');
  const saved = await (await env.api('GET', '/api/users/theme')).json();
  ok('the choice was saved to the account (round-trips through the new DB constraint)', saved.theme === 'murder', JSON.stringify(saved));

  section('The server still rejects a bogus theme value');
  const rejected = await env.api('PUT', '/api/users/theme', { theme: 'definitely-not-a-real-theme' });
  ok('an invalid theme is refused, not silently accepted', rejected.status === 422);

  // Leave the account back on a normal theme so this suite doesn't affect anyone re-using this admin
  await env.api('PUT', '/api/users/theme', { theme: 'dark' });

  ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
});
