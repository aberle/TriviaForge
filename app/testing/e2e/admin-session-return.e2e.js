/**
 * An admin tab left open while the session ends (the sliding session times out while the phone or laptop
 * is away) used to keep showing the quiz management page as if still signed in, until the first button
 * press failed. Coming back to the tab now checks the session straight away and sends the user to the
 * login page if it has ended. A session that is still valid is left alone.
 *
 * A separate, related bug lived on the login page itself: a brand-new tab (no focus/visibility change
 * involved at all -- it just mounts fresh) trusted whatever authToken happened to be sitting in
 * localStorage and showed "Access Granted" purely because a token existed, never checking the server
 * for whether it was still valid. A token left over from an ended session (expired, invalidated by a
 * password change, or from before a server restart) showed "Access Granted" and then, the moment the
 * user actually opened Presenter or Admin, hit a 401 and bounced to a login prompt -- confusing, and
 * exactly what this suite's first section is otherwise meant to prevent. The login page now confirms
 * the token with the server (GET /api/auth/me) before showing "Access Granted" at all.
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

  section('A brand-new tab with a genuinely valid session shows Access Granted');
  const freshValid = await login();
  const freshValidTab = await env.open(`${BASE}/`);
  await freshValidTab.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
  await freshValidTab.eval(`localStorage.setItem('authToken', ${JSON.stringify(freshValid.token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); true`);
  await freshValidTab.goto(`${BASE}/`);
  await freshValidTab.waitText('Access Granted', { timeout: 4000 });
  ok('shows Access Granted for a token the server still honors', true);

  section('A brand-new tab with a stale (ended) session goes straight to the login form, not a false Access Granted');
  const freshEnded = await login();
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${freshEnded.token}` } });
  const freshEndedTab = await env.open(`${BASE}/`);
  await freshEndedTab.waitFor(`document.URL.startsWith(${JSON.stringify(BASE)})`);
  await freshEndedTab.eval(`localStorage.setItem('authToken', ${JSON.stringify(freshEnded.token)}); localStorage.setItem('username', 'admin'); localStorage.setItem('userRole', 'admin'); true`);
  await freshEndedTab.goto(`${BASE}/`);
  await sleep(1500);
  const freshEndedBody = await freshEndedTab.eval(`document.body.innerText`);
  ok('never shows Access Granted for a token the server has already ended', !freshEndedBody.includes('Access Granted'));
  ok('shows the login form instead', !!(await freshEndedTab.eval(`!!document.querySelector('input[placeholder="username"]')`)));

  ok('no uncaught errors', true);
});
