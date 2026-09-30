/**
 * APP_NAME replaces "TriviaForge" wherever the app names itself to the player, presenter and admin:
 * the login page, the browser tab title, and each page's navbar brand text. This suite only runs
 * anything meaningful against a server started with APP_NAME set (see ../README.md); otherwise it
 * just checks the default stays "TriviaForge".
 */

import { runSuite, BASE, sleep } from './lib/harness.js';

await runSuite('app name', { chrome: true }, async ({ ok, env }) => {
  const config = await (await fetch(`${BASE}/api/config`)).json();
  const expected = config.appName || 'TriviaForge';
  console.log(`  (server APP_NAME: ${JSON.stringify(config.appName)}, expecting "${expected}")`);

  const check = async (path, selector, label) => {
    const page = await env.open(`${BASE}${path}`, { width: 1200, height: 900 });
    await sleep(700);
    const text = await page.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText`);
    const title = await page.eval('document.title');
    ok(`${label} shows the app name`, (text || '').includes(expected), `${label}: ${JSON.stringify(text)}`);
    ok(`${label}'s browser tab title starts with the app name`, title.startsWith(expected), `${label}: ${JSON.stringify(title)}`);
    ok(`${label} does not fall back to the literal word "TriviaForge" when a different name is set`, expected === 'TriviaForge' || !(text || '').includes('TriviaForge'), `${label}: ${JSON.stringify(text)}`);
    await page.closeTab();
  };

  await check('/', '.login-title', 'the login page');
  await check('/player', '.brand-title', 'the player page');

  const landing = await env.open(`${BASE}/player`, { width: 1200, height: 900 });
  await sleep(700);
  const brand = await landing.eval(`document.querySelector('.brand-title')?.innerText`);
  ok('outside a room, the player page brand is just the app name, with no "Player" suffix', brand === expected, JSON.stringify(brand));
  await landing.closeTab();
  await env.adminPage('/admin').then(async (page) => {
    await sleep(700);
    const text = await page.eval(`document.querySelector('.navbar-brand')?.innerText`);
    ok('the admin page shows the app name', (text || '').includes(expected), JSON.stringify(text));
    await page.closeTab();
  });
  await env.adminPage('/presenter').then(async (page) => {
    await sleep(700);
    const text = await page.eval(`document.querySelector('.navbar-brand')?.innerText`);
    ok('the presenter page shows the app name', (text || '').includes(expected), JSON.stringify(text));
    await page.closeTab();
  });

  const display = await env.open(`${BASE}/display`, { width: 1200, height: 900 });
  await sleep(700);
  const displayText = await display.eval(`document.querySelector('.waiting-title')?.innerText`);
  ok('the display page (waiting screen) shows the app name', (displayText || '').includes(expected), JSON.stringify(displayText));
  await display.closeTab();
});
