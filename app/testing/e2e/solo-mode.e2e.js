/**
 * Solo play only exists when the server runs with SOLO_MODE=true. This suite adapts to the server it
 * is pointed at: with the flag off it checks that Solo is gone everywhere (links, page, API); with it
 * on it checks that Solo works. Run it against both to cover both modes (see ../README.md).
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

await runSuite(
  'solo mode flag',
  {
    quiz: { title: `Solo flag ${Date.now().toString(36)}`, questions: [Q.mc('What is the capital of France?', ['Paris', 'Rome'], 0), Q.tf('The sky is blue.')] },
  },
  async ({ ok, section, env }) => {
    const config = await (await fetch(`${BASE}/api/config`)).json();
    const enabled = config.soloMode === true;
    console.log(`  (server has SOLO_MODE ${enabled ? 'ON' : 'off'})`);

    const soloLinks = (page) => page.count('a[href="/solo"]');
    // Wait for /api/config to be applied, then count (links appear only once the server says so)
    const settled = async (page) => {
      await sleep(900);
      return soloLinks(page);
    };

    section('The API');
    const list = await fetch(`${BASE}/api/solo/quizzes`);
    const body = await list.json().catch(() => ({}));
    if (enabled) ok('the solo API works', list.ok);
    else ok('the solo API answers 404 "not enabled"', list.status === 404 && body.code === 'SOLO_DISABLED', `${list.status} ${JSON.stringify(body)}`);
    if (!enabled) {
      const create = await fetch(`${BASE}/api/solo/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quizId: env.quiz.id }) });
      ok('a solo game cannot be started through the API either', create.status === 404, String(create.status));
    }

    section('Links on every page');
    const pages = [
      ['the login page', await env.open(`${BASE}/`)],
      ['the player page', await env.open(`${BASE}/player`)],
      ['the stats page', await env.open(`${BASE}/stats`)],
      ['the admin page', await env.adminPage('/admin')],
      ['the presenter page', await env.adminPage('/presenter')],
    ];
    for (const [name, page] of pages) {
      const n = await settled(page);
      ok(enabled ? `${name} has a Solo link` : `${name} has no Solo link`, enabled ? n > 0 : n === 0, `${n} link(s)`);
    }

    section('The solo page');
    const solo = await env.open(`${BASE}/solo`);
    await sleep(1500);
    const path = await solo.eval('location.pathname');
    if (enabled) ok('/solo opens the solo page', path === '/solo', path);
    else ok('/solo redirects to the login page', path === '/', path);

    section('Quiz badges in the admin page');
    const admin = pages.find(([n]) => n === 'the admin page')[1];
    await admin.waitText('Solo flag');
    const badges = await admin.count('.badge-solo');
    ok(enabled ? 'quizzes show their Solo badge' : 'no quiz shows a Solo badge', enabled ? badges > 0 : badges === 0, `${badges} badge(s)`);
    ok('no uncaught errors', pages.every(([, p]) => p.realErrors().length === 0), pages.flatMap(([, p]) => p.realErrors()).join(' | '));
  }
);
