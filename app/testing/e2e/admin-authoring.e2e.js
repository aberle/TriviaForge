/**
 * Authoring a quiz with rounds in the admin page (real browser, real drag events):
 * round headers and badges, renaming a round without losing its time limit, and dragging
 * questions between rounds (before/after a question, onto a round header, into an empty round or a
 * round's end zone), with the indicators shown while dragging.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TITLE = `Authoring ${Date.now().toString(36)}`;

await runSuite(
  'admin authoring',
  {
    quiz: {
      title: TITLE,
      rounds: [{ title: 'A', timeLimitSeconds: 90 }, { title: 'B', timeLimitSeconds: null }, { title: 'C', timeLimitSeconds: null }],
      questions: ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => Q.mc(`Question ${n} text here`, ['x', 'y'], 0, i < 3 ? 0 : 1)),
    },
  },
  async ({ ok, section, env }) => {
    // The quiz's questions grouped by round, as the API stores them: "0:[One,Two] 1:[Three]"
    const layout = async (id = env.quiz.id) => {
      const quiz = await env.getQuiz(id);
      const byRound = {};
      quiz.questions.forEach((q) => (byRound[q.roundIndex ?? '-'] ||= []).push(q.text.split(' ')[1]));
      return Object.entries(byRound).map(([r, names]) => `${r}:[${names.join(',')}]`).join(' ');
    };

    const admin = await env.adminPage('/admin');
    await admin.waitText(TITLE);
    const openQuiz = async (title, questionCount) => {
      await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(title)})).click(); true`);
      await admin.waitFor(`document.querySelectorAll('.question-item').length === ${questionCount}`);
      await sleep(300);
    };

    section('Round headers');
    ok('the quiz list shows a rounds badge', await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)}))?.innerText.toLowerCase().includes('3 rounds')`));
    await openQuiz(TITLE, 5);
    ok('each round has a header, and questions sit under their round', (await admin.count('.round-header')) === 3 && (await admin.eval(`document.querySelectorAll('.round-group')[0].querySelectorAll('.question-item').length`)) === 3);
    ok('a timed round shows its limit and an untimed round shows it blank', (await admin.eval(`[...document.querySelectorAll('.round-time-input')].map(i => i.value).join('|')`)) === '90||');
    ok('the question editor has a Round selector', await admin.visible('#questionRound'));

    section('Renaming a round');
    await admin.fill('.round-group:nth-of-type(1) .round-title-input', 'Warmup');
    await sleep(1300);
    const renamed = await env.getQuiz(env.quiz.id);
    ok('renaming saves the new title and keeps the time limit', renamed.rounds[0].title === 'Warmup' && renamed.rounds[0].timeLimitSeconds === 90, JSON.stringify(renamed.rounds));

    section('Dragging questions between rounds');
    // Dispatch real HTML5 drag events. target: { q, pos } = a question (upper/lower half),
    // { round, where: 'start' } = a round header, { round, where: 'end' } = a round's end drop zone
    const drag = (from, target, { hold = false } = {}) => admin.eval(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const dt = new DataTransfer();
      const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      const src = document.querySelectorAll('.question-item')[${from}];
      fire(src, 'dragstart', 0);
      await wait(120); // the page re-renders with the drop zones
      const t = ${JSON.stringify(target)};
      let el, y = 0;
      if (t.q !== undefined) { el = document.querySelectorAll('.question-item')[t.q]; const r = el.getBoundingClientRect(); y = t.pos === 'before' ? r.top + 3 : r.bottom - 3; }
      else if (t.where === 'start') el = document.querySelectorAll('.round-header')[t.round];
      else el = document.querySelectorAll('.round-end-drop')[t.round];
      if (!el) return 'no target element';
      fire(el, 'dragover', y);
      await wait(120);
      if (${hold}) return 'holding';
      fire(el, 'drop', y);
      fire(src, 'dragend', 0);
      await wait(200);
      return 'ok';
    })()`);
    const settle = async () => {
      await sleep(1800);
      await admin.waitFor(`document.querySelectorAll('.question-item').length === 5`);
    };

    ok('starting layout', (await layout()) === '0:[One,Two,Three] 1:[Four,Five]');
    await drag(3, { q: 0, pos: 'before' });
    await settle();
    ok('drop BEFORE a question in another round', (await layout()) === '0:[Four,One,Two,Three] 1:[Five]', await layout());
    await drag(1, { q: 4, pos: 'after' });
    await settle();
    ok('drop AFTER a question in another round', (await layout()) === '0:[Four,Two,Three] 1:[Five,One]', await layout());
    await drag(1, { round: 1, where: 'start' });
    await settle();
    ok("drop onto another round's HEADER: the question goes to the top of that round", (await layout()) === '0:[Four,Three] 1:[Two,Five,One]', await layout());
    await drag(1, { round: 2, where: 'start' });
    await settle();
    ok('drop into an EMPTY round (via its header)', (await layout()) === '0:[Four] 1:[Two,Five,One] 2:[Three]', await layout());
    await drag(0, { round: 2, where: 'end' });
    await settle();
    ok("drop into a round's END drop zone", (await layout()) === '1:[Two,Five,One] 2:[Three,Four]', await layout());
    await drag(2, { q: 0, pos: 'before' });
    await settle();
    ok('reordering inside a round still works', (await layout()) === '1:[One,Two,Five] 2:[Three,Four]', await layout());
    const before = await layout();
    await drag(0, { q: 0, pos: 'before' });
    await sleep(1200);
    ok('dropping a question on itself changes nothing', (await layout()) === before);

    section('Real mouse drags (from every round)');
    // A tall window keeps every round on screen so the drop points are reachable
    await admin.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 2400, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    await admin.eval('window.scrollTo(0, 0); true');
    const at = (selector, index, edge) => `(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: ${edge === 'top' ? 'r.top + 4' : edge === 'bottom' ? 'r.bottom - 4' : 'r.y + r.height / 2'} }; })()`;
    const realDrag = async (from, selector, index, edge) => {
      const result = await admin.realDrag({ selector: '.question-item', index: from }, at(selector, index, edge));
      await sleep(1800);
      await admin.waitFor(`document.querySelectorAll('.question-item').length === 5`);
      return result;
    };

    const real = await env.createQuiz({
      title: `Real ${TITLE}`,
      rounds: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      questions: ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => Q.mc(`Question ${n} text here`, ['x', 'y'], 0, [0, 0, 1, 2, 2][i])),
    });
    await admin.goto(`${BASE}/admin`);
    await admin.waitText(`Real ${TITLE}`);
    await openQuiz(`Real ${TITLE}`, 5);
    await admin.eval('window.scrollTo(0, 0); true');
    const now = () => layout(real.id);
    ok('starting layout', (await now()) === '0:[One,Two] 1:[Three] 2:[Four,Five]');

    let r = await realDrag(4, '.question-item', 0, 'top'); // Five, in the LAST round, before the first question
    ok('a question from a later round can be picked up: the browser does not cancel the drag', r.started && !r.cancelled, JSON.stringify(r));
    ok('...and lands before the first question of the first round', (await now()) === '0:[Five,One,Two] 1:[Three] 2:[Four]', await now());
    r = await realDrag(4, '.question-item', 3, 'bottom'); // Four, alone in the last round, after Three
    ok('picking up the only question of the last round works', r.started && !r.cancelled && (await now()) === '0:[Five,One,Two] 1:[Three,Four]', `${JSON.stringify(r)} ${await now()}`);
    r = await realDrag(2, '.round-header', 2, 'middle'); // Two, onto the header of the now-empty last round
    ok('dropping onto the header of an empty round with the mouse works', r.started && !r.cancelled && (await now()) === '0:[Five,One] 1:[Three,Four] 2:[Two]', `${JSON.stringify(r)} ${await now()}`);
    r = await realDrag(0, '.round-end-drop', 1, 'middle'); // Five, into the end zone of round B
    ok("dropping into a round's end zone with the mouse works", r.started && !r.cancelled && (await now()) === '0:[One] 1:[Three,Four,Five] 2:[Two]', `${JSON.stringify(r)} ${await now()}`);
    let allStarted = true;
    for (let i = 0; i < 6; i++) {
      r = await realDrag(i % 2 ? 0 : 4, '.question-item', i % 2 ? 4 : 0, i % 2 ? 'bottom' : 'top');
      allStarted = allStarted && r.started && !r.cancelled;
    }
    ok('six more drags in a row all work (nothing gets stuck)', allStarted);

    section('Feedback while dragging');
    await drag(0, { q: 4, pos: 'after' }, { hold: true });
    await sleep(200);
    const ui = await admin.eval(`({ line: !!document.querySelector('.question-item.drop-after'), highlighted: document.querySelectorAll('.round-group.drag-target').length, zones: document.querySelectorAll('.round-end-drop').length })`);
    ok('an insertion line shows, the destination round is highlighted, and every round has a drop zone', ui.line && ui.highlighted === 1 && ui.zones === 3, JSON.stringify(ui));
    await admin.eval(`document.querySelectorAll('.question-item')[0].dispatchEvent(new DragEvent('dragend', { bubbles: true })); true`);
    await sleep(300);
    ok('the indicators disappear when the drag ends', (await admin.count('.round-end-drop.armed, .drop-before, .drop-after, .drag-target')) === 0);

    section('A quiz without rounds');
    const flat = await env.createQuiz({ title: `Flat ${TITLE}`, questions: ['One', 'Two', 'Three'].map((n) => Q.mc(`Question ${n} text here`, ['x', 'y'], 0, undefined)) });
    await admin.goto(`${BASE}/admin`);
    await admin.waitText(`Flat ${TITLE}`);
    await openQuiz(`Flat ${TITLE}`, 3);
    await drag(2, { q: 0, pos: 'before' });
    await sleep(1800);
    ok('drag to reorder still works', (await layout(flat.id)) === '-:[Three,One,Two]', await layout(flat.id));
    ok('no uncaught errors on the admin page', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
