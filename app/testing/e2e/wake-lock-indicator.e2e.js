/**
 * The floating wake-lock icon on the player page: tapping it always shows a status alert, whether
 * wake lock is active, unsupported, failed, or not yet requested. It used to silently do nothing when
 * active -- exactly the state a real HTTPS deployment normally sits in -- because the click handler's
 * whole body was gated behind "if not active". localhost is treated as a secure context, so wake lock
 * genuinely activates here (unlike a plain-HTTP LAN IP), letting this suite exercise the real ACTIVE
 * path, not just a mocked one.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

await runSuite(
  'wake lock indicator',
  { quiz: { title: `Wake Lock ${Date.now().toString(36)}`, questions: [Q.mc('Q1', ['x', 'y'], 0)] } },
  async ({ ok, section, env }) => {
    section('The wake lock genuinely activates on localhost (a secure context, unlike a plain-HTTP LAN IP)');
    const player = await env.player('WakelockTester', { width: 390, height: 844 });
    await sleep(1500); // give the Wake Lock API request time to resolve

    const state = await player.eval(`(() => ({
      hasIndicator: !!document.querySelector('.wake-lock-floating'),
      isInactive: document.querySelector('.wake-lock-floating')?.classList.contains('wake-lock-inactive'),
    }))()`);
    ok('the indicator is present once in a room', state.hasIndicator, JSON.stringify(state));
    ok('wake lock is genuinely active', state.isInactive === false, JSON.stringify(state));

    section('Clicking it while ACTIVE shows a status alert (it used to silently do nothing)');
    await player.eval(`window.__alertCalls = []; window.alert = (msg) => window.__alertCalls.push(msg); true`);
    await player.eval(`document.querySelector('.wake-lock-floating').click(); true`);
    await sleep(200);
    const alerts = await player.eval(`window.__alertCalls`);
    ok('the click triggered exactly one alert', alerts.length === 1, JSON.stringify(alerts));
    ok('...and it correctly reports the ACTIVE status', alerts[0]?.includes('STATUS: ACTIVE'), alerts[0]);

    ok('no uncaught errors', player.realErrors().length === 0, player.realErrors().join(' | '));
  }
);
