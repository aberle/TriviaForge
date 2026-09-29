/**
 * Dragging a question in the admin Questions panel auto-scrolls the panel when the cursor nears its
 * top or bottom edge, so a question can be dragged into a round that starts off-screen. Also covers a
 * round name long enough to need the "Move to round" dropdown's tooltip, and that it doesn't get
 * visually clipped in a way that breaks the layout.
 *
 * The auto-scroll checks dispatch synthetic DragEvents (like the plain drag tests in
 * admin-authoring.e2e.js), not a real OS-level drag: Chromium has its own native auto-scroll for a
 * real drag session, which would make a mutation test of our own auto-scroll code a false pass.
 * Dispatching events directly isolates the app's own logic. A later section still drives a real mouse
 * drag to confirm the end-to-end result (dropping into a round that started off-screen) actually works.
 */

import { runSuite, Q, BASE, sleep, expandRound as expandRoundOn } from './lib/harness.js';

const TITLE = `Autoscroll ${Date.now().toString(36)}`;
const ROUND_COUNT = 8;
const LONG_ROUND_NAME = 'A round with a name so long it would overflow a narrow dropdown box';

await runSuite(
  'admin drag auto-scroll',
  {
    quiz: {
      title: TITLE,
      rounds: Array.from({ length: ROUND_COUNT }, (_, i) => ({ title: i === ROUND_COUNT - 1 ? LONG_ROUND_NAME : `Round ${i + 1}`, timeLimitSeconds: null })),
      questions: Array.from({ length: ROUND_COUNT }, (_, i) => Q.mc(`Question ${i + 1} goes in its own round`, ['x', 'y'], 0, i)),
    },
    timeoutMs: 120000,
  },
  async ({ ok, section, env }) => {
    // A normal-ish window height, short enough that the Questions panel needs its own scrollbar
    const admin = await env.adminPage('/admin', { width: 1400, height: 850 });
    await admin.waitText(TITLE);
    // Rounds start collapsed, and only one is ever expanded at a time (that feature has its own
    // suite); this one is about the round-select dropdown and dragging individual questions, so each
    // section expands whichever round it needs.
    const openQuiz = async (title, roundCount) => {
      await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(title)})).click(); true`);
      await admin.waitFor(`document.querySelector('.questions-list-quiz')?.innerText.includes(${JSON.stringify(title)})`);
      await admin.waitFor(`document.querySelectorAll('.round-header').length === ${roundCount}`);
      await sleep(300);
    };
    const expandRound = (roundIdx, questionCount) => expandRoundOn(admin, roundIdx, questionCount);
    await openQuiz(TITLE, ROUND_COUNT);

    section('The round dropdown handles a long round name');
    // The long name belongs to the LAST round; expand it to see its question's "Move to round" select
    await expandRound(ROUND_COUNT - 1, 1);
    const dropdown = await admin.eval(`(() => {
      const selects = [...document.querySelectorAll('.round-select')];
      const last = selects[selects.length - 1];
      const cs = getComputedStyle(last);
      const row = last.closest('.question-actions');
      return {
        title: last.title,
        clipsOverflow: cs.overflowX === 'hidden' || cs.overflowX === 'clip',
        ellipsis: cs.textOverflow === 'ellipsis',
        maxWidthPx: parseFloat(cs.maxWidth),
        rowWraps: row ? row.scrollWidth > row.clientWidth + 2 : null,
      };
    })()`);
    ok('the select clips a long round name (with an ellipsis) instead of stretching the box', dropdown.clipsOverflow && dropdown.ellipsis, JSON.stringify(dropdown));
    ok("it's wide enough to show a reasonable amount of a round's name, not just a couple of letters", dropdown.maxWidthPx >= 150, JSON.stringify(dropdown));
    ok('the full round name is still available as a tooltip', dropdown.title.includes(LONG_ROUND_NAME), dropdown.title);
    ok("clipping it doesn't force the row to wrap or overflow", dropdown.rowWraps === false, JSON.stringify(dropdown));

    section('The panel needs its own scrollbar');
    // The rest of this suite drags round 1's question, so expand it now (collapsing round 8)
    await expandRound(0, 1);
    const scrolls = await admin.eval(`(() => { const el = document.querySelector('.questions-list'); return el.scrollHeight > el.clientHeight + 5; })()`);
    ok('the questions list is taller than its visible area', scrolls);

    // A synthetic drag, isolated from any real OS-level drag session: starts the drag on a question,
    // then repeatedly dispatches 'dragover' at a fixed viewport point, without ever dropping. Chromium's
    // own native auto-scroll-during-a-real-drag can't apply here (there is no real drag session for it
    // to see), so any scrolling that happens is entirely the app's own code.
    const holdSyntheticDragAt = async (fromIdx, x, y, { rounds = 15, gapMs = 100 } = {}) => {
      await admin.eval(`window.__dragDt = new DataTransfer(); document.querySelectorAll('.question-item')[${fromIdx}].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dragDt })); true`);
      await sleep(120);
      for (let i = 0; i < rounds; i++) {
        await admin.eval(`document.elementFromPoint(${x}, ${y})?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dragDt, clientX: ${x}, clientY: ${y} })); true`);
        await sleep(gapMs);
      }
    };
    const endSyntheticDrag = () => admin.eval(`document.querySelectorAll('.question-item')[0]?.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.__dragDt })); true`);
    const scrollTop = () => admin.eval(`document.querySelector('.questions-list').scrollTop`);
    const edgePoint = (edge) => admin.eval(`(() => { const r = document.querySelector('.questions-list').getBoundingClientRect(); return { x: r.left + r.width / 2, y: ${edge === 'bottom' ? 'r.bottom - 15' : 'r.top + 15'} }; })()`);

    section('Holding a drag near the bottom edge scrolls the panel down');
    await admin.eval(`document.querySelector('.questions-list').scrollTop = 0; true`);
    let before = await scrollTop();
    ok('starts scrolled to the top', before === 0, String(before));
    let edge = await edgePoint('bottom');
    await holdSyntheticDragAt(0, edge.x, edge.y);
    let after = await scrollTop();
    ok('it scrolls down on its own, without the drag ever moving again after the first hover', after > before + 40, `before=${before} after=${after}`);
    await endSyntheticDrag();
    await sleep(200);

    section('...and near the top edge scrolls it back up');
    await admin.eval(`document.querySelector('.questions-list').scrollTop = document.querySelector('.questions-list').scrollHeight; true`);
    before = await scrollTop();
    edge = await edgePoint('top');
    await holdSyntheticDragAt(0, edge.x, edge.y);
    after = await scrollTop();
    ok('it scrolls up on its own', after < before - 40, `before=${before} after=${after}`);
    await endSyntheticDrag();
    await sleep(200);

    section('It stops as soon as the drag ends');
    await admin.eval(`document.querySelector('.questions-list').scrollTop = 0; true`);
    edge = await edgePoint('bottom');
    await holdSyntheticDragAt(0, edge.x, edge.y, { rounds: 3 });
    await endSyntheticDrag();
    const justAfterEnd = await scrollTop();
    await sleep(700);
    const wellAfterEnd = await scrollTop();
    ok('scrolling does not keep going after the drag ends', justAfterEnd === wellAfterEnd, `${justAfterEnd} -> ${wellAfterEnd}`);

    section('A real mouse drag can reach a round that starts off-screen');
    await admin.eval(`document.querySelector('.questions-list').scrollTop = 0; true`);
    await sleep(200);
    const begun = await admin.beginDrag('.question-item', 0); // Question 1, in Round 1
    ok('the drag starts', begun.started, JSON.stringify(begun));
    edge = await edgePoint('bottom');
    const lastHeaderInfo = `(() => {
      const headers = [...document.querySelectorAll('.round-header')];
      const target = headers[headers.length - 1];
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.top >= 0 && r.bottom <= innerHeight };
    })()`;
    await admin.dragOverPoint(edge.x, edge.y);
    let lastHeader = await admin.eval(lastHeaderInfo);
    for (let waited = 0; waited < 5000 && !lastHeader.visible; waited += 150) {
      await admin.dragOverPoint(edge.x, edge.y);
      await sleep(150);
      lastHeader = await admin.eval(lastHeaderInfo);
    }
    ok("the last round's header eventually scrolls into view while the drag is held near the edge", lastHeader.visible, JSON.stringify(lastHeader));
    // Move to the middle of the panel first and let any scrolling momentum settle, then re-read the
    // header's position (auto-scroll may have nudged it slightly further while it was in flight)
    const middle = await admin.eval(`(() => { const r = document.querySelector('.questions-list').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await admin.dragOverPoint(middle.x, middle.y);
    await sleep(250);
    lastHeader = await admin.eval(lastHeaderInfo);
    await admin.dragOverPoint(lastHeader.x, lastHeader.y);
    await sleep(150);
    const { cancelled } = await admin.endDrag(lastHeader.x, lastHeader.y);
    ok('the drag was not cancelled, and the drop lands on that round', !cancelled);
    await sleep(1800);
    // Round 1 is still the expanded round (dropping onto another round's header doesn't change which
    // round is expanded); its one question just moved away, so it's now empty
    await admin.waitFor(`document.querySelectorAll('.question-item').length === 0`);
    const quiz = await env.getQuiz(env.quiz.id);
    const moved = quiz.questions.find((q) => q.text.startsWith('Question 1 '));
    ok('Question 1 ended up in the last round, which was off-screen when the drag began', moved.roundIndex === ROUND_COUNT - 1, JSON.stringify(moved));

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
