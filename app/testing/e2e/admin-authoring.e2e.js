/**
 * Authoring a quiz with rounds in the admin page (real browser, real drag events):
 * round headers and badges, renaming a round without losing its time limit, and dragging
 * questions between rounds (before/after a question, onto a round header, into an empty round or a
 * round's end zone), with the indicators shown while dragging.
 */

import { runSuite, Q, BASE, sleep, expandRound as expandRoundOn } from './lib/harness.js';

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
    // Rounds start collapsed, and only one is ever expanded at a time (a dedicated suite covers the
    // collapsing feature itself). `openQuiz` just waits for the round headers -- always visible
    // regardless of collapse state -- and each section expands whichever round it needs.
    const openQuiz = async (title, roundCount) => {
      await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(title)})).click(); true`);
      await admin.waitFor(`document.querySelector('.questions-list-quiz')?.innerText.includes(${JSON.stringify(title)})`);
      if (roundCount > 0) await admin.waitFor(`document.querySelectorAll('.round-header').length === ${roundCount}`);
      await sleep(300);
    };
    const expandRound = (roundIdx, questionCount) => expandRoundOn(admin, roundIdx, questionCount);

    section('Round headers');
    ok('the quiz list shows a rounds badge', await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)}))?.innerText.toLowerCase().includes('3 rounds')`));
    await openQuiz(TITLE, 3);
    await expandRound(0, 3);
    ok('each round has a header, and questions sit under their round', (await admin.count('.round-header')) === 3 && (await admin.eval(`document.querySelectorAll('.round-group')[0].querySelectorAll('.question-item').length`)) === 3);
    ok('a timed round shows its limit and an untimed round shows it blank', (await admin.eval(`[...document.querySelectorAll('.round-time-input')].map(i => i.value).join('|')`)) === '90||');

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
    // Waits for the CURRENTLY EXPANDED round (the one just dragged from/within) to settle at
    // `count` items. Only one round is ever expanded at a time, so a cross-round drop always shrinks
    // the source round rather than growing a simultaneously-visible destination.
    const settle = async (count) => {
      await sleep(1800);
      await admin.waitFor(`document.querySelectorAll('.question-item').length === ${count}`);
    };

    await expandRound(0, 3); // A: [One,Two,Three]
    ok('starting layout', (await layout()) === '0:[One,Two,Three] 1:[Four,Five]');
    await drag(2, { q: 0, pos: 'before' }); // Three before One (within round A)
    await settle(3);
    ok('drop BEFORE a question in the same round', (await layout()) === '0:[Three,One,Two] 1:[Four,Five]', await layout());
    await drag(0, { q: 2, pos: 'after' }); // Three after Two: back to the original order
    await settle(3);
    ok('drop AFTER a question in the same round', (await layout()) === '0:[One,Two,Three] 1:[Four,Five]', await layout());
    // Precise before/after positioning only works within the one expanded round; moving a question
    // INTO a different (collapsed) round can only target its header (top) or end zone (bottom),
    // since there's no visible item in it to position relative to.
    await drag(0, { round: 1, where: 'start' }); // One -> round B's header
    await settle(2); // round A: [Two,Three]
    ok("drop onto another round's HEADER: the question goes to the top of that round", (await layout()) === '0:[Two,Three] 1:[One,Four,Five]', await layout());
    await drag(0, { round: 2, where: 'start' }); // Two -> empty round C's header
    await settle(1); // round A: [Three]
    ok('drop into an EMPTY round (via its header)', (await layout()) === '0:[Three] 1:[One,Four,Five] 2:[Two]', await layout());
    await drag(0, { round: 2, where: 'end' }); // Three -> round C's end zone
    await settle(0); // round A: empty
    ok("drop into a round's END drop zone", (await layout()) === '1:[One,Four,Five] 2:[Two,Three]', await layout());

    await expandRound(1, 3); // B: [One,Four,Five]
    await drag(2, { q: 0, pos: 'before' }); // Five before One
    await settle(3);
    ok('reordering inside a round still works', (await layout()) === '1:[Five,One,Four] 2:[Two,Three]', await layout());
    const before = await layout();
    await drag(0, { q: 0, pos: 'before' }); // Five onto itself
    await sleep(1200);
    ok('dropping a question on itself changes nothing', (await layout()) === before);

    section('Real mouse drags (from every round)');
    // A tall window keeps every round on screen so the drop points are reachable
    await admin.send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 2400, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    await admin.eval('window.scrollTo(0, 0); true');
    const at = (selector, index, edge) => `(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: r.x + r.width / 2, y: ${edge === 'top' ? 'r.top + 4' : edge === 'bottom' ? 'r.bottom - 4' : 'r.y + r.height / 2'} }; })()`;
    // Waits for the currently expanded round's own item count, mirroring `settle` above
    const realDrag = async (from, selector, index, edge, expectAfter) => {
      const result = await admin.realDrag({ selector: '.question-item', index: from }, at(selector, index, edge));
      await sleep(1800);
      if (expectAfter !== undefined) await admin.waitFor(`document.querySelectorAll('.question-item').length === ${expectAfter}`);
      return result;
    };

    const real = await env.createQuiz({
      title: `Real ${TITLE}`,
      rounds: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      questions: ['One', 'Two', 'Three', 'Four', 'Five'].map((n, i) => Q.mc(`Question ${n} text here`, ['x', 'y'], 0, [0, 0, 1, 2, 2][i])),
    });
    await admin.goto(`${BASE}/admin`);
    await admin.waitText(`Real ${TITLE}`);
    await openQuiz(`Real ${TITLE}`, 3);
    await admin.eval('window.scrollTo(0, 0); true');
    const now = () => layout(real.id);
    ok('starting layout', (await now()) === '0:[One,Two] 1:[Three] 2:[Four,Five]');

    await expandRound(2, 2); // C: [Four,Five]
    let r = await realDrag(1, '.round-header', 0, 'middle', 1); // Five, in the LAST round, onto the first round's header
    ok('a question from a later round can be picked up: the browser does not cancel the drag', r.started && !r.cancelled, JSON.stringify(r));
    ok('...and lands at the top of the first round', (await now()) === '0:[Five,One,Two] 1:[Three] 2:[Four]', await now());
    r = await realDrag(0, '.round-end-drop', 1, 'middle', 0); // Four, alone in round C, into round B's end zone
    ok('picking up the only question of a round works', r.started && !r.cancelled && (await now()) === '0:[Five,One,Two] 1:[Three,Four]', `${JSON.stringify(r)} ${await now()}`);

    await expandRound(0, 3); // A: [Five,One,Two]
    r = await realDrag(2, '.round-header', 2, 'middle', 2); // Two, onto the header of the now-empty round C
    ok('dropping onto the header of an empty round with the mouse works', r.started && !r.cancelled && (await now()) === '0:[Five,One] 1:[Three,Four] 2:[Two]', `${JSON.stringify(r)} ${await now()}`);
    r = await realDrag(0, '.round-end-drop', 1, 'middle', 1); // Five, into the end zone of round B
    ok("dropping into a round's end zone with the mouse works", r.started && !r.cancelled && (await now()) === '0:[One] 1:[Three,Four,Five] 2:[Two]', `${JSON.stringify(r)} ${await now()}`);

    await expandRound(1, 3); // B: [Three,Four,Five]
    let allStarted = true;
    for (let i = 0; i < 6; i++) {
      r = await realDrag(0, '.question-item', 2, i % 2 ? 'top' : 'bottom', 3); // reorder within round B, back and forth
      allStarted = allStarted && r.started && !r.cancelled;
    }
    ok('six more drags in a row all work (nothing gets stuck)', allStarted);

    section('Feedback while dragging');
    // Still on round B (3 items); an insertion line and round highlight work the same regardless of
    // which round is expanded, and every round (collapsed or not) still shows a drop zone while a
    // drag is in progress.
    await drag(0, { q: 2, pos: 'after' }, { hold: true });
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
    await openQuiz(`Flat ${TITLE}`, 0); // no rounds: no round headers, and its questions are never collapsed
    await admin.waitFor(`document.querySelectorAll('.question-item').length === 3`);
    await drag(2, { q: 0, pos: 'before' });
    await sleep(1800);
    ok('drag to reorder still works', (await layout(flat.id)) === '-:[Three,One,Two]', await layout(flat.id));
    ok('no uncaught errors on the admin page', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
