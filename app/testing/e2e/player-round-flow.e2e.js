/**
 * The player's screens while playing a round quiz, on a phone-sized browser:
 * answer selection is obvious, Progress works mid-round, answers can be changed and resubmitted,
 * question text can't be highlighted, and the top bar shows the quiz name (not a question count).
 */

import { runSuite, Q, pick, submitAnswers, sleep } from './lib/harness.js';

const TITLE = `Movie Night ${Date.now().toString(36)}`;

await runSuite(
  'player round flow',
  {
    quiz: {
      title: TITLE,
      rounds: [
        { title: 'One', timeLimitSeconds: null },
        { title: 'Two', timeLimitSeconds: null },
        { title: 'Three', timeLimitSeconds: 12 },
      ],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0, 0),
        Q.tf('The sky is blue on a clear day.', 0),
        Q.sa('Name the largest planet in our solar system', ['Jupiter'], 0),
        Q.mc('Capital of Italy?', ['Paris', 'Rome'], 1, 1),
        Q.mc('Capital of Spain?', ['Madrid', 'Rome'], 0, 2),
      ],
    },
  },
  async ({ ok, section, env }) => {
    const { presenter, room } = env;
    const startRound = (roundIndex) => presenter.emit('startRound', { roomCode: room, roundIndex });
    const endRound = (roundIndex) => presenter.emit('endRound', { roomCode: room, roundIndex });

    const p = await env.player('Ann');

    section('Top bar');
    const bar = await p.eval(`document.querySelector('.brand-title').innerText.trim()`);
    ok('in a room the top bar shows the quiz name, not "TriviaForge Player"', bar === TITLE || bar.startsWith(TITLE.slice(0, 6)), bar);
    ok('there is no "answered / total" question counter in the top bar', !(await p.eval(`!!document.querySelector('.question-counter')`)));
    ok('Progress is empty before any round ("No questions answered yet")', await (async () => {
      await p.eval(`document.querySelector('#progressBtn').click(); true`);
      await sleep(400);
      const empty = await p.has('No questions answered yet');
      await p.eval(`document.querySelector('.modal-overlay')?.click(); true`);
      return empty;
    })());

    section('Round 1: selecting answers');
    startRound(0);
    await p.waitText('Round 1 of 3');
    await pick(p, 0, 'Paris');
    await pick(p, 1, 'True');
    ok('the chosen answers are highlighted (selected class + check mark)', (await p.count('.choice-btn.selected, .tf-btn.selected')) === 2 && (await p.count('.selected-mark')) === 2);

    // Hovering must not hide the highlight (the hover style once overrode it)
    const { x, y } = await p.center('.choice-btn.selected');
    await p.mouse('mouseMoved', x, y);
    await sleep(300);
    const hovered = await p.eval(`(() => { const b = document.querySelector('.choice-btn.selected'); return { hover: b.matches(':hover'), bg: getComputedStyle(b).backgroundColor }; })()`);
    await p.mouse('mouseMoved', 2, 2);
    await sleep(300);
    const away = await p.eval(`getComputedStyle(document.querySelector('.choice-btn.selected')).backgroundColor`);
    ok('the highlight stays the same while the pointer is over the answer', hovered.hover && hovered.bg === away, JSON.stringify({ hovered, away }));

    section('Question text cannot be highlighted');
    const userSelect = (sel) => p.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).userSelect`);
    ok('question text and answers are user-select: none', (await userSelect('.question-text')) === 'none' && (await userSelect('.choice-btn')) === 'none');
    const tripleClick = async (sel) => {
      await p.eval('window.getSelection().removeAllRanges(); true');
      const pos = await p.center(sel);
      for (const n of [1, 2, 3]) {
        await p.mouse('mousePressed', pos.x, pos.y, { clickCount: n });
        await p.mouse('mouseReleased', pos.x, pos.y, { clickCount: n });
      }
      await sleep(150);
      return p.eval('window.getSelection().toString()');
    };
    ok('triple-clicking a question selects nothing', (await tripleClick('.question-text')) === '');
    ok('control: text outside the question area (the top bar) can still be selected', (await tripleClick('.brand-title')).length > 0);
    ok('the short-answer box stays editable', (await userSelect('.short-answer-input')) === 'text');
    const box = await p.center('.short-answer-input');
    await p.mouse('mousePressed', box.x, box.y, { clickCount: 1 });
    await p.mouse('mouseReleased', box.x, box.y, { clickCount: 1 });
    await p.send('Input.insertText', { text: 'jupitar' });
    await sleep(300);
    ok('...and typing into it works', (await p.eval(`document.querySelector('.short-answer-input').value`)) === 'jupitar');
    await p.eval(`document.querySelector('.short-answer-input').blur(); true`);

    section('Round 1: submit, edit, resubmit');
    await p.clickText('Submit Answers');
    await p.waitText('Answers submitted!');
    ok('the first submit asks for no confirmation and shows a toast', !(await p.eval(`!!document.querySelector('.modal-overlay, [role=dialog]')`)) && (await p.has('You can still change them and submit updated answers')));
    const state = () => p.eval(`({ dirty: !!document.querySelector('.submitted-banner.dirty'), button: [...document.querySelectorAll('.submit-btn')].map(b => b.innerText.trim()).join('|') || null, banner: document.querySelector('.submitted-banner')?.innerText.replace(/\\s+/g, ' ').trim() ?? null })`);
    let s = await state();
    ok('after submitting there is no submit button and the answers are still editable', s.button === null && (await p.count('.choice-btn:disabled')) === 0, JSON.stringify(s));
    await pick(p, 0, 'Rome');
    await sleep(400);
    s = await state();
    ok('changing an answer shows the unsent-changes warning and "Submit Updated Answers"', s.dirty && s.button === 'Submit Updated Answers', JSON.stringify(s));
    await pick(p, 0, 'Paris');
    await sleep(300);
    ok('changing back clears the warning', !(await state()).dirty);
    await pick(p, 0, 'Oslo'); // an edit that is never submitted
    await sleep(1300);
    endRound(0);
    await p.waitText('this round');
    ok('the unsent edit did not count: the submission (Paris) did', (await p.has('A. Paris')) && !(await p.has('C. Oslo')));

    section('Progress mid-round');
    startRound(1);
    await p.waitText('Round 2 of 3');
    await p.eval(`document.querySelector('#progressBtn').click(); true`);
    await sleep(500);
    const history = await p.eval(`[...document.querySelectorAll('.round-heading, .history-item')].map(e => e.innerText.trim().replace(/\\s+/g, ' ')).join('\\n')`);
    ok('Progress lists the finished round with results', /Round 1: One/.test(history) && /Your answer: A\. Paris/.test(history) && /jupitar/.test(history), history);
    ok('...and shows the open round as "In progress" without revealing anything', /Round 2: Two/.test(history) && /In progress/.test(history));
    const modalSelection = async () => {
      await p.eval(`const i = document.activeElement; if (i && i.blur) i.blur(); true`);
      await p.eval('window.getSelection().removeAllRanges(); true');
      const pos = await p.center('.history-question');
      for (const n of [1, 2, 3]) {
        await p.mouse('mousePressed', pos.x, pos.y, { clickCount: n });
        await p.mouse('mouseReleased', pos.x, pos.y, { clickCount: n });
      }
      return p.eval('window.getSelection().toString()');
    };
    ok('question text in Progress cannot be highlighted either', (await modalSelection()) === '');
    await p.eval(`document.querySelector('.modal-overlay')?.click(); document.querySelector('.modal-close, .close-btn')?.click(); true`);

    section('Round 2: resubmit, and it survives a refresh');
    await sleep(300);
    await pick(p, 0, 'Paris'); // wrong
    await submitAnswers(p);
    await pick(p, 0, 'Rome');  // the right one, unsent
    await sleep(1300);
    await p.goto(await p.eval('location.href')); // refresh
    await p.waitText('Round 2 of 3', { timeout: 15000 });
    await sleep(1200);
    s = await state();
    ok('after a refresh the edited answer and the unsent-changes state are still there', s.dirty && (await p.count('.choice-btn.selected')) === 1 && s.button === 'Submit Updated Answers', JSON.stringify(s));
    await p.clickText('Submit Updated Answers');
    await sleep(700);
    ok('resubmitting clears the warning and confirms with a toast', !(await state()).dirty && (await p.has('Updated answers submitted')));
    endRound(1);
    await p.waitText('this round');
    ok('the resubmitted answer counted', (await p.has('B. Rome')) && (await p.has('1 / 1')));

    section('Round 3 (timed): unsent changes are submitted when time runs out');
    startRound(2);
    await p.waitText('Round 3 of 3');
    await pick(p, 0, 'Rome'); // wrong
    await submitAnswers(p);
    await pick(p, 0, 'Madrid'); // right, never resubmitted by hand
    await sleep(400);
    ok('there are unsent changes before the timer ends', (await state()).dirty);
    await p.waitText('this round', { timeout: 30000 });
    ok('on expiry the unsent change was submitted automatically (and no extra toast)', (await p.has('A. Madrid')) && (await p.has('1 / 1')) && !(await p.has('Updated answers submitted')));

    ok('no uncaught errors on the player page', p.realErrors().length === 0, p.realErrors().join(' | '));
  }
);
