/**
 * The presenter can start a countdown on an UNTIMED round; the round then ends by itself when it
 * runs out (players' unsent answers are submitted), like a timed round. The countdown can be
 * cancelled, survives a player's refresh, and timed rounds don't offer it.
 */

import { runSuite, Q, BASE, pick, sleep } from './lib/harness.js';

const TITLE = `Countdown ${Date.now().toString(36)}`;

await runSuite(
  'round countdown',
  {
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Untimed', timeLimitSeconds: null }, { title: 'Timed', timeLimitSeconds: 60 }],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0, 0),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1, 0),
        Q.mc('Which planet is known as the Red Planet?', ['Venus', 'Mars'], 1, 1),
      ],
    },
    timeoutMs: 240000,
  },
  async ({ ok, section, env }) => {
    section('Setting up');
    const presenter = await env.adminPage('/presenter');
    await presenter.waitFor(`[...document.querySelectorAll('.presenter-sidebar option')].some(o => o.textContent.includes(${JSON.stringify(TITLE)}))`);
    await presenter.eval(`(() => { const sel = document.querySelector('.presenter-sidebar select'); const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(TITLE)})); sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(200);
    await presenter.clickText('Make Live');
    await presenter.waitText('0 of 2 rounds played');
    const room = await presenter.eval(`(([...document.querySelectorAll('*')].find(e => e.children.length < 4 && e.innerText?.includes('TriviaForge Presenter') && /\\d{4}/.test(e.innerText)) || {}).innerText || '').match(/\\d{4}/)?.[0]`);
    const display = await env.open(`${BASE}/display?room=${room}`, { width: 1600, height: 900 });
    await display.waitText('Connected to room');
    const ann = await env.player('Ann', { room });
    const bob = env.bot();
    bob.emit('joinRoom', { roomCode: room, username: 'bob_cd', displayName: 'Bob', playerID: bob.playerID });
    await presenter.waitText('2 player(s)');

    section('An untimed round offers a countdown');
    await presenter.clickText('Start');
    await ann.waitText('Round 1 of 2');
    ok('the player sees no time limit at first', await ann.has('No time limit'));
    ok('the presenter is offered countdown presets', (await presenter.has('Auto-end in')) && (await presenter.has('30s')) && (await presenter.has('5 min')));

    section('Only the presenter, and only sensible values');
    const before = bob.mark();
    bob.emit('startRoundCountdown', { roomCode: room, roundIndex: 0, seconds: 30 });
    const denied = await bob.waitFor('roomError', { since: before });
    ok('a player cannot start a countdown', /presenter/i.test(denied) && bob.all('roundTimer', before).length === 0, String(denied));
    await sleep(300);
    ok('...and nothing changed on the player screen', await ann.has('No time limit'));
    await presenter.fill('.rd-countdown-custom input', '5');
    ok('a countdown under 10 seconds cannot be started from the form', await presenter.eval(`[...document.querySelectorAll('.rd-countdown-custom button')].every(b => b.disabled)`));
    await presenter.fill('.rd-countdown-custom input', '');

    section('Starting and cancelling a countdown');
    await presenter.clickText('1 min');
    await ann.waitFor(`!!document.querySelector('.timer-bar')`);
    ok('the player now sees a countdown, and no more "No time limit"', (await ann.visible('.timer-bar')) && !(await ann.has('No time limit')));
    await display.waitFor(`!!document.querySelector('.timer-bar')`);
    ok('the display shows the countdown too', await display.visible('.timer-bar'));
    ok('the presenter can cancel it, and the presets are gone', (await presenter.has('Cancel countdown')) && !(await presenter.has('Auto-end in')));
    const again = bob.mark();
    bob.emit('startRoundCountdown', { roomCode: room, roundIndex: 0, seconds: 30 });
    await bob.waitFor('roomError', { since: again });

    await pick(ann, 0, 'Rome'); // an answer that must survive the countdown
    await ann.eval('location.reload(); true');
    await ann.waitFor(`!!document.querySelector('.timer-bar')`, { timeout: 15000 });
    ok('a refresh in the middle of a countdown keeps the countdown', await ann.visible('.timer-bar'));

    await presenter.clickText('Cancel countdown');
    await ann.waitText('No time limit');
    ok('cancelling puts the round back to no time limit for the player', !(await ann.visible('.timer-bar')));
    await display.waitFor(`!document.querySelector('.timer-bar')`);
    ok('...and on the display', !(await display.visible('.timer-bar')));
    ok('...and the presenter is offered the presets again', await presenter.has('Auto-end in'));

    section('The round ends by itself');
    await pick(ann, 0, 'Paris');
    await pick(ann, 1, 'Eight');
    // The player leaves their answers unsent: the countdown must submit them
    await presenter.fill('.rd-countdown-custom input', '10');
    await presenter.clickText('Start', '.rd-countdown-custom button');
    await ann.waitFor(`!!document.querySelector('.timer-bar')`);
    const startedAt = Date.now();
    await ann.waitText('this round', { timeout: 25000 });
    const took = (Date.now() - startedAt) / 1000;
    ok('the round ended on its own after about 10 seconds', took > 6 && took < 20, `${took.toFixed(1)}s`);
    ok("the player's unsent answers were submitted for them and counted (2 / 2)", await ann.has('2 / 2'));
    ok("the review says time's up", await ann.has("time's up"));
    await presenter.waitText('Leaderboard after Round 1');
    ok('the presenter sees the leaderboard, with no countdown left over', !(await presenter.has('Cancel countdown')));

    section('A timed round has no countdown controls');
    await presenter.clickText('Start');
    await ann.waitText('Round 2 of 2');
    await ann.waitFor(`!!document.querySelector('.timer-bar')`);
    ok('the timer runs from the round setting', await ann.visible('.timer-bar'));
    ok("the presenter isn't offered a countdown", !(await presenter.has('Auto-end in')) && !(await presenter.has('Cancel countdown')));
    const timed = bob.mark();
    bob.emit('startRoundCountdown', { roomCode: room, roundIndex: 1, seconds: 30 });
    await bob.waitFor('roomError', { since: timed });

    ok('no uncaught errors on any page', [presenter, display, ann].every((p) => p.realErrors().length === 0), [presenter, display, ann].flatMap((p) => p.realErrors()).join(' | '));
  }
);
