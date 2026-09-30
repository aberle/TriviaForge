/**
 * The Quiz Management tab: the Questions panel only appears once a quiz is selected, a quiz's title
 * and description are edited from its menu (no boxes on the page), and questions are added and edited
 * in a modal opened by "+ New Question" (which preselects the round used last).
 */

import { runSuite, Q, BASE, sleep, expandRound as expandRoundOn } from './lib/harness.js';

const TITLE = `Manage ${Date.now().toString(36)}`;

await runSuite(
  'admin quiz management',
  {
    chrome: true,
    quiz: {
      title: TITLE,
      description: 'the original description',
      rounds: [{ title: 'Round A', timeLimitSeconds: null }, { title: 'Round B', timeLimitSeconds: null }],
      questions: [Q.mc('Question One text here', ['x', 'y'], 0, 0), Q.mc('Question Two text here', ['x', 'y'], 0, 0), Q.mc('Question Three text here', ['x', 'y'], 0, 1)],
    },
  },
  async ({ ok, section, env }) => {
    const admin = await env.adminPage('/admin', { width: 1500, height: 1000 });
    await admin.waitText(TITLE);
    const dismissAlert = async () => {
      await sleep(300);
      // the "saved successfully" notice
      await admin.eval(`(() => { const b = [...document.querySelectorAll('.modal-overlay button')].find((x) => /^\\s*OK\\s*$/i.test(x.innerText)); if (b) b.click(); return true; })()`);
      await sleep(200);
    };

    // Add/Update, then Continue past the similar-question warning if the bank has one (it depends on what
    // other tests left behind), then wait for the CURRENTLY EXPANDED round (the one the editor is
    // saving into -- only one round is ever expanded at a time) to reach `count` questions
    const saveQuestion = async (count) => {
      await admin.clickText('Add', '.question-editor-buttons button');
      await admin.waitFor(`!!document.querySelector('.duplicate-warning-modal') || document.querySelectorAll('.question-item').length === ${count}`, { timeout: 10000 });
      if (await admin.visible('.duplicate-warning-modal')) {
        await admin.clickText('Continue', '.duplicate-warning-modal button');
        await admin.waitFor(`document.querySelectorAll('.question-item').length === ${count}`, { timeout: 10000 });
      }
    };

    // Only one round is ever expanded at a time; ensure a specific one is, before interacting with
    // an existing question that's inside it (a question that's just been saved or edited expands its
    // own round automatically -- see QuestionsList.vue -- but reaching an EXISTING, untouched
    // question still requires expanding its round first, same as a real admin would).
    const expandRound = (roundIdx) => expandRoundOn(admin, roundIdx);

    section('Nothing selected yet');
    ok('there is no Questions panel, no question editor and no title/description boxes', (await admin.count('.questions-sidebar')) === 0 && (await admin.count('.question-editor-panel')) === 0 && !(await admin.eval(`!!document.querySelector('input[placeholder="Quiz Title"], textarea[placeholder="Quiz Description"]')`)));
    ok('the page says to select a quiz', await admin.has('Select or create a quiz'));

    section('Selecting a quiz');
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).click(); true`);
    // Rounds start collapsed (a dedicated section below covers the collapsing feature itself); none
    // of this section's checks need a round's questions to be visible
    await admin.waitFor(`document.querySelector('.questions-list-quiz')?.innerText.includes(${JSON.stringify(TITLE)})`);
    await admin.waitFor(`document.querySelectorAll('.round-header').length === 2`);
    ok('the Questions panel appears, with "+ New Question" at its top', (await admin.visible('.questions-sidebar')) && (await admin.eval(`document.querySelector('.questions-list-header .btn-new-question')?.innerText.includes('New Question')`)));
    ok('there is still no editor on the page and no title/description boxes', (await admin.count('.question-editor-panel')) === 0 && !(await admin.eval(`!!document.querySelector('input[placeholder="Quiz Title"], textarea[placeholder="Quiz Description"]')`)));
    ok('the quiz item is marked active in the list', await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).classList.contains('quiz-item--active')`));
    ok('no other quiz is marked active', (await admin.count('.quiz-item--active')) === 1);
    ok('the Questions panel header names the selected quiz', await admin.eval(`document.querySelector('.questions-list-header h2').innerText.includes(${JSON.stringify(TITLE)})`));

    section('Editing the title and description from the quiz menu');
    await admin.eval(`document.querySelector('.quiz-item .btn-menu').click(); true`);
    ok('the quiz menu has an "Edit Title & Description" item', await admin.has('Edit Title'));
    await admin.clickText('Edit Title', '.menu-item');
    await admin.waitFor(`!!document.querySelector('#editQuizTitle')`);
    ok('it opens a dialog with the current title and description', (await admin.eval(`document.querySelector('#editQuizTitle').value`)) === TITLE && (await admin.eval(`document.querySelector('#editQuizDescription').value`)) === 'the original description');
    await admin.fill('#editQuizTitle', `${TITLE} (renamed)`);
    await admin.fill('#editQuizDescription', 'a new description');
    await admin.clickText('Save', '.edit-quiz-form button');
    await admin.waitFor(`[...document.querySelectorAll('.quiz-item')].some(q => q.innerText.includes('(renamed)'))`, { timeout: 8000 });
    const renamed = await env.getQuiz(env.quiz.id);
    ok('the title and description are saved, and the questions and rounds are untouched', renamed.title.endsWith('(renamed)') && renamed.description === 'a new description' && renamed.questions.length === 3 && renamed.rounds.length === 2, JSON.stringify([renamed.title, renamed.rounds.length, renamed.questions.length]));

    section('New Question opens a modal');
    await admin.clickText('New Question', '.btn-new-question');
    await admin.waitFor(`!!document.querySelector('.modal-overlay .question-editor-panel')`);
    ok('the editor is a modal titled New Question, with a "Add to round" dropdown', (await admin.has('New Question')) && (await admin.visible('#questionRound')) && (await admin.has('Add to round')));
    ok('the round dropdown starts on the first round (nothing added yet)', (await admin.eval(`document.querySelector('#questionRound').value`)) === '0');
    // Add a question to Round B (switching the dropdown to it also expands it -- the round the
    // editor targets is always the one shown underneath, see QuestionsList.vue)
    await admin.eval(`(() => { const sel = document.querySelector('#questionRound'); sel.value = '1'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(250);
    await admin.fill('.question-text-input', 'Question Four added in round B');
    await admin.eval(`(() => { const inputs = document.querySelectorAll('.choice-input-wrapper input'); ['first', 'second'].forEach((t, i) => { inputs[i].value = t; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); }); return true; })()`);
    await saveQuestion(2); // Round B had 1 question (Three); now 2 (Three, Four)
    await dismissAlert();
    ok('saving closes the modal and the question appears', (await admin.count('.modal-overlay .question-editor-panel')) === 0 && (await admin.has('Question Four added in round B')));
    ok('it was saved in round B', (await env.getQuiz(env.quiz.id)).questions.find((x) => x.text.includes('Question Four')).roundIndex === 1);
    await admin.clickText('New Question', '.btn-new-question');
    await admin.waitFor(`!!document.querySelector('#questionRound')`);
    ok('the next New Question has Round B (the one used last) preselected', (await admin.eval(`document.querySelector('#questionRound').value`)) === '1');
    await admin.clickText('Cancel', '.question-editor-buttons button');
    await sleep(300);

    // Last-used is still Round B (from Question Four above) -- explicitly expand Round A instead,
    // a DIFFERENT round, and confirm New Question prefers the round the admin is actually looking at.
    await expandRound(0);
    await admin.clickText('New Question', '.btn-new-question');
    await admin.waitFor(`!!document.querySelector('#questionRound')`);
    ok(
      'but if a DIFFERENT round is explicitly expanded, New Question prefers that one over last-used',
      (await admin.eval(`document.querySelector('#questionRound').value`)) === '0'
    );
    // Left open (on Round A's blank form) for the next section, same as the original flow left it open

    section('Switching question type resets choices instead of keeping leftovers');
    const choiceValues = () => admin.eval(`[...document.querySelectorAll('.choice-input-wrapper input')].map(i => i.value)`);
    const setType = (type) => admin.eval(`(() => { const sel = document.querySelector('#questionType'); sel.value = ${JSON.stringify(type)}; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    // Fill in a multiple-choice answer, then switch away and back through every type
    await admin.eval(`(() => { const i = document.querySelectorAll('.choice-input-wrapper input')[0]; i.value = 'a filled-in choice'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await setType('true_false');
    await sleep(200);
    ok('switching to True/False shows True and False, not the leftover choice', JSON.stringify(await choiceValues()) === JSON.stringify(['True', 'False']));
    await setType('short_answer');
    await sleep(200);
    ok('switching to short answer resets to a single BLANK field, not True/False', JSON.stringify(await choiceValues()) === JSON.stringify(['']), JSON.stringify(await choiceValues()));
    await setType('multiple_choice');
    await sleep(200);
    ok('switching back to multiple choice resets to 4 blanks, not the single short-answer field', JSON.stringify(await choiceValues()) === JSON.stringify(['', '', '', '']), JSON.stringify(await choiceValues()));
    // Filled-in multiple choice, straight to short answer (no detour through True/False)
    await admin.eval(`(() => { const i = document.querySelectorAll('.choice-input-wrapper input')[0]; i.value = 'another filled-in choice'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await setType('short_answer');
    await sleep(200);
    ok('multiple choice straight to short answer also resets to a single blank field', JSON.stringify(await choiceValues()) === JSON.stringify(['']), JSON.stringify(await choiceValues()));

    section('One accepted answer is enough for a typed-answer question');
    ok('the editor is already left with just the single accepted-answer field', (await admin.count('.choice-input-wrapper')) === 1);
    await admin.fill('.question-text-input', 'Name the largest planet in the solar system');
    await admin.eval(`(() => { const input = document.querySelector('.choice-input-wrapper input'); input.value = 'Jupiter'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await admin.clickText('Add', '.question-editor-buttons button');
    // The similar-question warning must appear above the editor modal (it interrupts it); Continue saves
    // anyway. Round B (still the expanded one) had 2 questions (Three, Four); now 3.
    await admin.waitFor(`!!document.querySelector('.duplicate-warning-modal') || document.querySelectorAll('.question-item').length === 3`, { timeout: 10000 });
    if (await admin.visible('.duplicate-warning-modal')) {
      ok('the similar-question warning appears above the editor modal, not behind it', await admin.eval(`(() => { const r = document.querySelector('.duplicate-warning-modal').getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return !!top && !!top.closest('.duplicate-warning-modal'); })()`));
      await admin.clickText('Continue', '.duplicate-warning-modal button');
    }
    await admin.waitFor(`document.querySelectorAll('.question-item').length === 3`, { timeout: 10000 });
    await dismissAlert();
    const saved = (await env.getQuiz(env.quiz.id)).questions.find((x) => x.text.includes('largest planet'));
    ok('it saves with just one accepted answer', saved?.type === 'short_answer' && saved.choices.filter(Boolean).join() === 'Jupiter', JSON.stringify(saved));

    section('Editing and closing');
    // "Question One" is in Round A, which isn't the currently-expanded round (Round B has been ever
    // since the earlier round-switch) -- expand it first, same as a real admin would have to.
    await expandRound(0);
    await admin.eval(`[...document.querySelectorAll('.question-item')].find((q) => q.innerText.includes('Question One')).querySelector('.question-content').click(); true`);
    await admin.waitFor(`!!document.querySelector('.modal-overlay .question-editor-panel')`);
    ok('clicking a question opens the modal to edit it (Edit Question, Update button)', (await admin.has('Edit Question')) && (await admin.eval(`document.querySelector('.question-text-input').value`)).includes('Question One') && (await admin.has('Update')));
    await admin.clickText('Cancel', '.question-editor-buttons button');
    await sleep(300);
    ok('Cancel closes it without changing anything', (await admin.count('.modal-overlay .question-editor-panel')) === 0 && (await env.getQuiz(env.quiz.id)).questions.length === 5);
    await admin.clickText('New Question', '.btn-new-question');
    await admin.waitFor(`!!document.querySelector('.question-text-input')`);
    ok('and the next New Question starts empty', (await admin.eval(`document.querySelector('.question-text-input').value`)) === '');

    section('Rounds start collapsed, and stay reachable while dragging');
    const collapseQuiz = await env.createQuiz({
      title: `Collapse ${TITLE}`,
      rounds: [{ title: 'Round A' }, { title: 'Round B' }],
      questions: [Q.mc('Collapse test question one', ['x', 'y'], 0, 0), Q.mc('Collapse test question two', ['x', 'y'], 0, 0), Q.mc('Collapse test question three', ['x', 'y'], 0, 1)],
    });
    await admin.goto(`${BASE}/admin`);
    await admin.waitFor(`[...document.querySelectorAll('.quiz-item')].some(q => q.innerText.includes(${JSON.stringify(`Collapse ${TITLE}`)}))`, { timeout: 8000 });
    await admin.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(`Collapse ${TITLE}`)})).click(); true`);
    await admin.waitFor(`document.querySelectorAll('.round-header').length === 2`);
    await sleep(500);
    ok('every round starts collapsed: no question is visible even though the quiz has some', (await admin.count('.question-item')) === 0 && (await admin.count('.btn-collapse')) === 2);
    ok('an empty-round placeholder is also hidden while collapsed', !(await admin.has('No questions in this round')));

    const collapseButtonTitles = () => admin.eval(`[...document.querySelectorAll('.btn-collapse')].map(b => b.title)`);
    const endDropHeights = () => admin.eval(`[...document.querySelectorAll('.round-end-drop')].map(el => el.getBoundingClientRect().height)`);

    const collapsedGapHeights = await endDropHeights();
    ok('a collapsed round\'s end-of-round drop zone is shrunk, so consecutive collapsed rounds sit closer together', collapsedGapHeights.every((h) => h < 30), JSON.stringify(collapsedGapHeights));

    await admin.eval(`document.querySelectorAll('.btn-collapse')[0].click(); true`);
    await sleep(200);
    ok('clicking a round\'s collapse button expands just that round', (await admin.count('.question-item')) === 2 && (await admin.eval(`document.querySelectorAll('.btn-collapse')[1].title`)) === 'Expand round');
    ok('the expanded round\'s questions sit inside their own bordered box', (await admin.count('.round-questions')) === 1);
    const expandedGapHeight = (await endDropHeights())[0];
    ok('...and that round\'s own end-of-round drop zone is back to its normal (unshrunk) size', expandedGapHeight >= 30, String(expandedGapHeight));

    section('Only one round can be expanded at a time');
    await admin.eval(`document.querySelectorAll('.btn-collapse')[1].click(); true`);
    await sleep(200);
    ok(
      'expanding Round B automatically collapses Round A',
      JSON.stringify(await collapseButtonTitles()) === JSON.stringify(['Expand round', 'Collapse round']),
      JSON.stringify(await collapseButtonTitles())
    );
    ok('only Round B\'s question is now visible', (await admin.count('.question-item')) === 1 && (await admin.count('.round-questions')) === 1);
    await admin.eval(`document.querySelectorAll('.btn-collapse')[1].click(); true`); // Round B is the one currently expanded
    await sleep(200);
    ok('clicking it again re-collapses it', (await admin.count('.question-item')) === 0);

    // A round added afterwards becomes the one expanded round (it's new, and likely empty)
    await admin.clickText('Add Round');
    await sleep(400);
    ok('a newly added round starts expanded, unlike the others', (await admin.eval(`document.querySelectorAll('.btn-collapse')[2]?.title`)) === 'Collapse round' && (await admin.has('No questions in this round')));
    ok(
      'and it is the ONLY expanded round',
      JSON.stringify(await collapseButtonTitles()) === JSON.stringify(['Expand round', 'Expand round', 'Collapse round']),
      JSON.stringify(await collapseButtonTitles())
    );

    // Drag-and-drop must still be able to reach a collapsed round: onto its header, and into its end zone
    await admin.eval(`document.querySelectorAll('.btn-collapse')[0].click(); true`); // expand Round A to pick a question from it
    await sleep(300);
    const dragOnto = (fromIdx, targetSelector, targetIdx, edge) => admin.eval(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const dt = new DataTransfer();
      const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      const src = document.querySelectorAll('.question-item')[${fromIdx}];
      fire(src, 'dragstart', 0);
      await wait(150);
      const el = document.querySelectorAll(${JSON.stringify(targetSelector)})[${targetIdx}];
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const y = ${edge === 'top' ? 'r.top + 4' : 'r.top + r.height / 2'};
      fire(el, 'dragover', y);
      await wait(150);
      fire(el, 'drop', y);
      fire(src, 'dragend', 0);
      await wait(250);
      return true;
    })()`);
    ok('dropping a question onto a collapsed round\'s header works', await dragOnto(0, '.round-header', 1, 'top'));
    await sleep(800);
    let collapseCheck = await env.getQuiz(collapseQuiz.id);
    ok('...and it lands in that round', collapseCheck.questions.find((q) => q.text.includes('question one')).roundIndex === 1, JSON.stringify(collapseCheck.questions.map((q) => q.roundIndex)));
    ok('the round stayed collapsed the whole time (no items appeared)', (await admin.count('.question-item')) === 1);
    ok('dropping a question into a collapsed round\'s end zone also works', await dragOnto(0, '.round-end-drop', 1, 'middle'));
    await sleep(800);
    collapseCheck = await env.getQuiz(collapseQuiz.id);
    ok('...and it lands there too', collapseCheck.questions.filter((q) => q.roundIndex === 1).length >= 2, JSON.stringify(collapseCheck.questions.map((q) => q.roundIndex)));

    ok('no uncaught errors', admin.realErrors().length === 0, admin.realErrors().join(' | '));
  }
);
