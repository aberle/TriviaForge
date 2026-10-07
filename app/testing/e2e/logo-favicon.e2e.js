/**
 * LOGO_URL and FAVICON_URL (deployment-configured, like APP_NAME) put a custom logo on the login page
 * and the player landing page's navbar, and swap the browser tab's favicon. This suite only runs
 * anything meaningful against a server started with them set (see ../README.md); otherwise it just
 * checks the defaults stay in place (the fallback icon, the default /favicon.ico).
 */

import { runSuite, BASE, sleep } from './lib/harness.js';

await runSuite('logo and favicon', { chrome: true }, async ({ ok, env }) => {
  const config = await (await fetch(`${BASE}/api/config`)).json();
  const logoUrl = config.logoUrl || '';
  const faviconUrl = config.faviconUrl || '';
  console.log(`  (server LOGO_URL: ${JSON.stringify(logoUrl)}, FAVICON_URL: ${JSON.stringify(faviconUrl)})`);

  const checkLogo = async (path, selector, label) => {
    const page = await env.open(`${BASE}${path}`, { width: 1200, height: 900 });
    await sleep(700);
    const img = await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el ? { present: true, src: el.src } : { present: false };
    })()`);
    if (logoUrl) {
      ok(`${label} shows the configured logo image`, img.present && img.src === logoUrl, JSON.stringify(img));
    } else {
      ok(`${label} has no logo image when none is configured (falls back to the default icon)`, !img.present, JSON.stringify(img));
    }
    await page.closeTab();
  };

  await checkLogo('/', '.login-logo', 'the login page');
  await checkLogo('/player', '.navbar-brand .brand-logo', 'the player landing page');

  const faviconPage = await env.open(`${BASE}/`, { width: 1200, height: 900 });
  await sleep(500);
  const faviconHref = await faviconPage.eval(`document.querySelector('link[rel="icon"]')?.getAttribute('href')`);
  if (faviconUrl) {
    ok('the favicon is swapped to the configured one', faviconHref === faviconUrl, faviconHref);
  } else {
    ok('the favicon stays the default when none is configured', faviconHref === '/favicon.ico', faviconHref);
  }
  ok('no uncaught errors', faviconPage.realErrors().length === 0, faviconPage.realErrors().join(' | '));
  await faviconPage.closeTab();
});
