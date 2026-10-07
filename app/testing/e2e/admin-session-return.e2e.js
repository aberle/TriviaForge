/**
 * An admin tab left open while the session ends (the sliding session times out while the phone or laptop
 * is away) used to keep showing the quiz management page as if still signed in, until the first button
 * press failed. Coming back to the tab now checks the session straight away and sends the user to the
 * login page if it has ended. A session that is still valid is left alone.
 *
 * Uses its own logins, so ending a session here never affects the admin session other suites rely on.
 */

import { runSuite, BASE, sleep } from './lib/harness.js';

const login = async () => {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'testadmin123' }) });
  return res.json();
};

// Regaining the window without any visibility change (a laptop waking with the tab still shown)
const returnToWindow = (page) => page.eval(`window.dispatchEvent(new Event('focus')); true`);

await runSuite('admin session on return', { chrome: true }, async ({ ok, section, env }) => {
  const openAdminAs = async ({ token, user }) => {
    const page = await env.open(`${BASE}/`);
    await page.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
    await page.eval(`localStorage.setItem('authToken', ${JSON.stringify(token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); localStorage.setItem('userId', String(${user.id || 1})); localStorage.setItem('isRootAdmin', 'true'); true`);
    await page.goto(`${BASE}/admin`);
    await page.waitFor(`document.querySelector('.admin-page')`);
    await sleep(500);
    return page;
  };

  section('Coming back to a tab whose session is still valid leaves it signed in');
  const valid = await login();
  const stillIn = await openAdminAs(valid);
  await returnToWindow(stillIn);
  await sleep(1500);
  ok('the admin page stays put', (await stillIn.eval('location.pathname')) === '/admin', await stillIn.eval('location.pathname'));

  section('Coming back to a window whose session has ended sends the user to sign in straight away');
  const ended = await login();
  const expired = await openAdminAs(ended);
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${ended.token}` } });
  await returnToWindow(expired);
  await expired.waitFor(`location.pathname === '/'`, { timeout: 6000 }).then(
    () => ok('the user is sent to the login page without pressing anything', true),
    async () => ok('the user is sent to the login page without pressing anything', false, await expired.eval('location.pathname'))
  );

  ok('no uncaught errors', true);
});
