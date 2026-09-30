/**
 * Two admins with the same quiz open at once: when one adds a question, it shows up for the other
 * without a manual refresh. The server broadcasts 'quizChanged' over a socket to every logged-in
 * admin session after each quiz mutation (quiz.controller.js -> adminBroadcast.service.js -> the
 * 'admins' room every admin socket joins on connect -- see server.js's io.use() socket auth).
 *
 * Also covers the safety net: if the OTHER admin has the question editor open (a draft in progress)
 * when the change arrives, the refresh must not clobber it -- it defers until that modal closes.
 */

import { runSuite, Q, BASE, sleep } from './lib/harness.js';

const TITLE = `Live Quiz Updates ${Date.now().toString(36)}`;

await runSuite(
  'admin live quiz updates',
  {
    chrome: true,
    quiz: {
      title: TITLE,
      rounds: [{ title: 'Round A' }],
      questions: [Q.mc('Original question', ['x', 'y'], 0, 0)],
    },
  },
  async ({ ok, section, env }) => {
    const openOnQuiz = async () => {
      const page = await env.adminPage('/admin', { width: 1500, height: 1000 });
      await page.waitText(TITLE);
      await page.eval(`[...document.querySelectorAll('.quiz-item')].find(q => q.innerText.includes(${JSON.stringify(TITLE)})).click(); true`);
      await page.waitFor(`document.querySelectorAll('.round-header').length === 1`);
      await sleep(400);
      return page;
    };

    section('Admin A adds a question; Admin B (same quiz, not editing anything) sees it live, no refresh needed');
    const adminA = await openOnQuiz();
    const adminB = await openOnQuiz();

    await adminA.eval(`document.querySelectorAll('.round-number')[0].click(); true`);
    await sleep(300);
    await adminA.eval(`document.querySelector('.btn-new-question').click(); true`);
    await adminA.waitFor(`!!document.querySelector('.question-text-input')`);
    await adminA.fill('.question-text-input', 'A brand new question added live');
    await adminA.eval(`(() => { const inputs = document.querySelectorAll('.choice-input-wrapper input'); ['one', 'two'].forEach((t, i) => { inputs[i].value = t; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); }); return true; })()`);
    await adminA.eval(`[...document.querySelectorAll('.question-editor-buttons button')].find(b => b.textContent.trim() === 'Add')?.click(); true`);
    await adminA.waitFor(`document.querySelectorAll('.question-item').length === 2`, { timeout: 10000 });

    await adminB.eval(`document.querySelectorAll('.round-number')[0].click(); true`); // expand to see the round's questions
    await adminB.waitFor(`document.querySelectorAll('.question-item').length === 2`, { timeout: 8000 });
    ok('B picked up A\'s new question without any manual refresh', await adminB.has('A brand new question added live'));

    section('Admin B has the question editor open (a draft in progress) when a change arrives -- it must not get clobbered');
    await adminB.eval(`[...document.querySelectorAll('.question-item')].find(q => q.innerText.includes('Original question'))?.querySelector('.question-content').click(); true`);
    await adminB.waitFor(`!!document.querySelector('.question-text-input')`);
    await adminB.fill('.question-text-input', 'Original question -- being edited right now');

    await adminA.eval(`document.querySelector('.btn-new-question').click(); true`);
    await adminA.waitFor(`!!document.querySelector('.question-text-input')`);
    await adminA.fill('.question-text-input', 'A second question added while B was editing');
    await adminA.eval(`(() => { const inputs = document.querySelectorAll('.choice-input-wrapper input'); ['three', 'four'].forEach((t, i) => { inputs[i].value = t; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); }); return true; })()`);
    await adminA.eval(`[...document.querySelectorAll('.question-editor-buttons button')].find(b => b.textContent.trim() === 'Add')?.click(); true`);
    await adminA.waitFor(`document.querySelectorAll('.question-item').length === 3`, { timeout: 10000 });
    await sleep(1000); // give the broadcast time to arrive at B while its modal is still open

    const bStateWhilePending = await adminB.eval(`(() => ({
      modalOpen: !!document.querySelector('.question-text-input'),
      draftText: document.querySelector('.question-text-input')?.value,
      backgroundQuestionCount: document.querySelectorAll('.question-item').length,
    }))()`);
    ok('B\'s editor is still open', bStateWhilePending.modalOpen, JSON.stringify(bStateWhilePending));
    ok('...and its draft text was not overwritten by the incoming refresh', bStateWhilePending.draftText === 'Original question -- being edited right now', JSON.stringify(bStateWhilePending));
    ok(
      '...and the list behind the modal has NOT refreshed yet either (still 2, not 3) -- the update is truly deferred, not just invisible',
      bStateWhilePending.backgroundQuestionCount === 2,
      JSON.stringify(bStateWhilePending)
    );

    section('Closing B\'s editor applies the deferred refresh');
    await adminB.eval(`[...document.querySelectorAll('.question-editor-buttons button')].find(b => b.textContent.trim() === 'Cancel')?.click(); true`);
    await adminB.waitFor(`document.querySelectorAll('.question-item').length === 3`, { timeout: 8000 });
    ok('B now shows all 3 questions (the deferred change applied once its modal closed)', true);
    ok('...and B\'s own edit was correctly cancelled, not saved', await adminB.has('Original question') && !(await adminB.has('being edited right now')));

    section('The broadcast never reaches a non-admin socket (a plain player/guest bot, no admin token)');
    const bot = env.bot();
    await sleep(300); // let it connect before the mark below
    const since = bot.mark();
    await env.api('PUT', `/api/quizzes/${env.quiz.filename}`, { title: TITLE, description: 'touched to trigger a broadcast' });
    await sleep(600);
    const received = bot.all('quizChanged', since);
    ok('a non-admin socket never receives quizChanged', received.length === 0, JSON.stringify(received));

    ok('no uncaught errors (A)', adminA.realErrors().length === 0, adminA.realErrors().join(' | '));
    ok('no uncaught errors (B)', adminB.realErrors().length === 0, adminB.realErrors().join(' | '));
  }
);
