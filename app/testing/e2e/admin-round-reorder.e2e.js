/**
 * Reordering whole rounds on the Quiz Management page: the move-to-first/up/down/to-last buttons and
 * dragging a round by its handle, both of which must carry every question in the round along to its
 * new position (roundIndex is a positional pointer, not a stable id -- see moveRound in AdminPage.vue).
 * A drag can land on either half of any round's header (top = before it, bottom = after it), so every
 * position is reachable, not just landing exactly on top of another round; and it must not leak into
 * the unrelated question-drop "Drop here to add to X" highlight on a round's end-of-round zone (a real
 * bug: that zone didn't know about round drags at all, so hovering it mid-round-drag armed it and,
 * since nothing tied to a round drag ever cleared it, left it stuck showing after the drop completed).
 * Also covers the "Round N" numbering badge (always sequential, independent of custom titles, and
 * itself clickable to expand/collapse the round) and that the round header row -- drag handle, title,
 * and the reorder buttons now on their own row underneath -- still fits at mobile width, even with a
 * long title (the same overflow bug fixed for individual questions).
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TITLE = `Round Reorder ${Date.now().toString(36)}`;

await runSuite(
  'admin round reorder',
  {
    chrome: true,
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
      questions: [
        Q.mc('Alpha round question text here', ['x', 'y'], 0, 0),
        Q.mc('Beta round question text here', ['x', 'y'], 0, 1),
        Q.mc('Gamma round question text here', ['x', 'y'], 0, 2),
      ],
    },
  },
  async ({ ok, section, env }) => {
    const admin = await env.adminPage('/admin', { width: 1500, height: 1000 });
    await admin.waitText(TITLE);
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).click(); true`);
    await admin.waitFor(`document.querySelectorAll('.round-header').length === 3`);

    const roundTitles = () => admin.eval(`[...document.querySelectorAll('.round-title-input')].map(i => i.value)`);
    const roundNumbers = () => admin.eval(`[...document.querySelectorAll('.round-number')].map(s => s.innerText)`);
    const disabledStates = () =>
      admin.eval(`[...document.querySelectorAll('.round-header')].map(h => [...h.querySelectorAll('.round-reorder-buttons button')].map(b => b.disabled))`);
    const clickRoundButton = (headerIdx, title) =>
      admin.eval(`(() => { document.querySelectorAll('.round-header')[${headerIdx}].querySelector('button[title=${JSON.stringify(title)}]').click(); return true; })()`);
    const waitForOrder = (order) => admin.waitFor(`[...document.querySelectorAll('.round-title-input')].map(i => i.value).join('|') === ${JSON.stringify(order.join('|'))}`, { timeout: 8000 });
    // questionsByTitlePrefix: { Alpha: roundIndex, Beta: roundIndex, Gamma: roundIndex } from the server
    const roundIndexesByPrefix = async () => {
      const quiz = await env.getQuiz(env.quiz.id);
      const of = (prefix) => quiz.questions.find((q) => q.text.startsWith(prefix))?.roundIndex;
      return { Alpha: of('Alpha'), Beta: of('Beta'), Gamma: of('Gamma') };
    };

    section('Rounds are numbered sequentially, independent of their custom titles');
    ok('titles load in the order they were created', JSON.stringify(await roundTitles()) === JSON.stringify(['Alpha', 'Beta', 'Gamma']), JSON.stringify(await roundTitles()));
    ok('the "Round N" badges are just position-based, not tied to the titles', JSON.stringify(await roundNumbers()) === JSON.stringify(['Round 1', 'Round 2', 'Round 3']), JSON.stringify(await roundNumbers()));

    section('Move buttons reorder a round and its questions follow, while numbering stays sequential');
    await clickRoundButton(0, 'Move Down'); // Alpha, Beta, Gamma -> Beta, Alpha, Gamma
    await waitForOrder(['Beta', 'Alpha', 'Gamma']);
    ok('Move Down on the first round swaps it with the second', true);
    ok('the numbering badges are unaffected by the reorder (still just 1, 2, 3)', JSON.stringify(await roundNumbers()) === JSON.stringify(['Round 1', 'Round 2', 'Round 3']), JSON.stringify(await roundNumbers()));
    let byPrefix = await roundIndexesByPrefix();
    ok(
      "each round's own questions followed it to its new position (roundIndex remapped, not left pointing at the old position)",
      byPrefix.Beta === 0 && byPrefix.Alpha === 1 && byPrefix.Gamma === 2,
      JSON.stringify(byPrefix)
    );

    section('Move buttons are correctly disabled at each boundary');
    let states = await disabledStates();
    ok('the first round has Move to First and Move Up disabled, Move Down and Move to Last enabled', JSON.stringify(states[0]) === JSON.stringify([true, true, false, false]), JSON.stringify(states));
    ok('the middle round has nothing disabled', JSON.stringify(states[1]) === JSON.stringify([false, false, false, false]), JSON.stringify(states));
    ok('the last round has Move Down and Move to Last disabled, the other two enabled', JSON.stringify(states[2]) === JSON.stringify([false, false, true, true]), JSON.stringify(states));

    section('Move to Last works too, from a non-adjacent position');
    await clickRoundButton(0, 'Move to Last'); // Beta, Alpha, Gamma -> Alpha, Gamma, Beta
    await waitForOrder(['Alpha', 'Gamma', 'Beta']);
    byPrefix = await roundIndexesByPrefix();
    ok('Move to Last on the first round sends it (and its question) all the way to the end', byPrefix.Alpha === 0 && byPrefix.Gamma === 1 && byPrefix.Beta === 2, JSON.stringify(byPrefix));

    section('Dragging a round by its handle onto another one\'s header reorders it, and its question follows too');
    // Which half of the target header the pointer is over decides before/after -- dropping on the
    // BOTTOM half means "insert after this round".
    const dragRoundAfter = (fromIdx, toIdx) =>
      admin.eval(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const dt = new DataTransfer();
        const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        const handle = document.querySelectorAll('.btn-drag-handle')[${fromIdx}];
        fire(handle, 'dragstart', 0);
        await wait(150);
        const header = document.querySelectorAll('.round-header')[${toIdx}];
        const r = header.getBoundingClientRect();
        const y = r.bottom - 4;
        fire(header, 'dragover', y);
        await wait(150);
        fire(header, 'drop', y);
        fire(handle, 'dragend', 0);
        await wait(250);
        return true;
      })()`);
    // Current order: Alpha, Gamma, Beta. Dropping index 0 (Alpha) on the BOTTOM half of index 2's
    // header (Beta) inserts Alpha right after Beta -- worked out by hand to be Gamma, Beta, Alpha.
    await dragRoundAfter(0, 2);
    await waitForOrder(['Gamma', 'Beta', 'Alpha']);
    ok('the drag produced the expected order', true);
    byPrefix = await roundIndexesByPrefix();
    ok('...and every question followed its own round to the new position', byPrefix.Gamma === 0 && byPrefix.Beta === 1 && byPrefix.Alpha === 2, JSON.stringify(byPrefix));
    ok('numbering is still just sequential positions after a drag too', JSON.stringify(await roundNumbers()) === JSON.stringify(['Round 1', 'Round 2', 'Round 3']), JSON.stringify(await roundNumbers()));

    section("Dropping on a header's TOP half inserts BEFORE it -- every position is reachable, not just landing exactly on a round");
    const dragRoundBefore = (fromIdx, toIdx) =>
      admin.eval(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const dt = new DataTransfer();
        const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
        const handle = document.querySelectorAll('.btn-drag-handle')[${fromIdx}];
        fire(handle, 'dragstart', 0);
        await wait(150);
        const header = document.querySelectorAll('.round-header')[${toIdx}];
        const r = header.getBoundingClientRect();
        const y = r.top + 4;
        fire(header, 'dragover', y);
        await wait(150);
        fire(header, 'drop', y);
        fire(handle, 'dragend', 0);
        await wait(250);
        return true;
      })()`);
    // Current order: Gamma, Beta, Alpha. Dropping index 2 (Alpha, currently LAST) on the TOP half of
    // index 0's header (Beta, currently FIRST) inserts Alpha right before it -- becoming the new first
    // round -- worked out by hand to be Alpha, Gamma, Beta.
    await dragRoundBefore(2, 0);
    await waitForOrder(['Alpha', 'Gamma', 'Beta']);
    ok('dropping on a header\'s top half moved the dragged round (from the very end) to the very front', true);

    section('Dragging a round over another round\'s end-of-round drop zone does not show, or leave behind, the unrelated question-only "Drop here to add to X" highlight');
    const endDropState = () => admin.eval(`[...document.querySelectorAll('.round-end-drop')].map(el => ({ armed: el.classList.contains('armed'), active: el.classList.contains('drop-active') }))`);
    await admin.eval(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      const handle = document.querySelectorAll('.btn-drag-handle')[0];
      fire(handle, 'dragstart');
      await wait(150);
      const endZone = document.querySelectorAll('.round-end-drop')[0];
      fire(endZone, 'dragover'); // hovering it mid-round-drag must be a complete no-op
      await wait(200);
      fire(handle, 'dragend');
      await wait(200);
      return true;
    })()`);
    const afterHover = await endDropState();
    ok(
      'every end-of-round drop zone stays fully inert (not armed, not highlighted) after a round was dragged over one',
      afterHover.every((s) => !s.armed && !s.active),
      JSON.stringify(afterHover)
    );

    section('Clicking the "Round N" badge also expands/collapses the round, same as its chevron');
    const isExpanded = (idx) => admin.eval(`document.querySelectorAll('.btn-collapse')[${idx}].getAttribute('aria-expanded') === 'true'`);
    ok('round 0 starts collapsed (every round starts collapsed when a quiz is selected)', !(await isExpanded(0)));
    await admin.eval(`document.querySelectorAll('.round-number')[0].click(); true`);
    await sleep(300);
    ok('clicking its "Round N" badge expands it', await isExpanded(0));
    await admin.eval(`document.querySelectorAll('.round-number')[0].click(); true`);
    await sleep(300);
    ok('clicking it again collapses it', !(await isExpanded(0)));

    section('The round header row -- drag handle, title, and reorder buttons on their own row underneath -- stays on one line at mobile width, even with a long title');
    await admin.eval(`(() => {
      const input = document.querySelectorAll('.round-title-input')[0];
      input.value = 'A round with a name so long it would overflow a narrow dropdown box';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await admin.waitFor(`document.querySelectorAll('.round-title-input')[0].value.includes('so long')`, { timeout: 8000 });
    await admin.setViewport(390, 844, true);
    await sleep(400);
    // A wrapped row would be roughly double a single line's height (plus the row's own gap); a
    // single line stays well under that regardless of which child happens to be tallest. Comparing
    // children's `top` doesn't work here: align-items:center vertically centers items of different
    // heights on the SAME line at different `top` values, which looks like a wrap but isn't.
    const headerRowHeights = await admin.eval(`[...document.querySelectorAll('.round-header-top')].map(row => Math.round(row.getBoundingClientRect().height))`);
    ok('every round header top row (drag handle, badge, title, delete) stays a single line tall', headerRowHeights.every((h) => h < 45), JSON.stringify(headerRowHeights));
    const reorderRowHeights = await admin.eval(`[...document.querySelectorAll('.round-reorder-buttons')].map(row => Math.round(row.getBoundingClientRect().height))`);
    ok('...and the reorder-buttons row underneath it also stays a single line tall', reorderRowHeights.every((h) => h < 45), JSON.stringify(reorderRowHeights));
    const titleInputWidths = await admin.eval(`[...document.querySelectorAll('.round-title-input')].map(i => Math.round(i.getBoundingClientRect().width))`);
    ok('the title input keeps a usable minimum width rather than being squeezed to near-nothing', titleInputWidths.every((w) => w >= 60), JSON.stringify(titleInputWidths));

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
