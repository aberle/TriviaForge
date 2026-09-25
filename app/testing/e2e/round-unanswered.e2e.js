/**
 * Submitting a round with questions left blank: the first tap warns and marks the blank questions
 * (and scrolls to the first); tapping again sends the answers as they are. A complete round submits
 * straight away, and the timer running out never asks.
 */

import { runSuite, Q, pick, sleep } from './lib/harness.js';

await runSuite(
  'unanswered questions warning',
  {
    quiz: {
      title: `Blanks ${Date.now().toString(36)}`,
      rounds: [{ title: 'Long round', timeLimitSeconds: null }, { title: 'Complete round', timeLimitSeconds: null }, { title: 'Timed', timeLimitSeconds: 15 }],
      questions: [
        Q.mc('What is the capital of France?', ['Paris', 'Rome', 'Oslo'], 0, 0),
        Q.tf('The sky is blue on a clear day.', 0),
        Q.sa('Name the largest planet in our solar system', ['Jupiter'], 0),
        Q.mc('Which planet is known as the Red Planet?', ['Venus', 'Mars'], 1, 0),
        Q.mc('How many legs does a spider have?', ['Six', 'Eight'], 1, 1),
        Q.mc('What is the smallest prime number?', ['1', '2', '3'], 1, 1),
        Q.mc('Which ocean is the largest?', ['Atlantic', 'Pacific'], 1, 2),
        Q.mc('In which year did the Berlin Wall fall?', ['1987', '1989'], 1, 2),
      ],
    },
    timeoutMs: 180000,
  },
  async ({ ok, section, env }) => {
    const room = env.room;
    const pres = env.presenter;
    const submittedCount = () => pres.all('roundProgress').at(-1)?.submitted ?? 0;
    const state = (page) => page.eval(`({
      marked: [...document.querySelectorAll('.question-card')].map((c) => c.classList.contains('needs-answer')),
      warning: document.querySelector('.unanswered-warning')?.innerText.replace(/\\s+/g, ' ') || null,
      button: document.querySelector('.submit-btn')?.innerText.trim(),
    })`);

    const ann = await env.player('Ann', { room, height: 700 });
    pres.emit('startRound', { roomCode: room, roundIndex: 0 });
    await ann.waitText('Round 1 of 3');

    section('A round with blanks');
    await pick(ann, 0, 'Paris');
    await ann.clickText('Submit Answers');
    await sleep(600);
    let s = await state(ann);
    ok('the first tap does not submit: the warning names the blank questions', /3 questions are still unanswered/i.test(s.warning || '') && /Question 2, Question 3, Question 4/.test(s.warning || ''), JSON.stringify(s));
    ok('only the blank questions are marked, with a "Not answered yet" tag', s.marked.join() === 'false,true,true,true' && (await ann.count('.needs-answer-tag')) === 3, JSON.stringify(s.marked));
    ok('a notice appears wherever the player has scrolled to', await ann.has('tap submit again to send anyway'));
    ok('the button offers to submit anyway', s.button === 'Submit Answers Anyway', s.button);
    ok('nothing was sent to the server', submittedCount() === 0 && !(await ann.has('Answers submitted!')));
    ok('the first blank question is scrolled into view', await ann.eval(`(() => { const r = document.querySelector('.question-card.needs-answer').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 5; })()`));

    section('Filling them in');
    await pick(ann, 1, 'True');
    await sleep(300);
    s = await state(ann);
    ok('an answered question loses its mark and the count goes down', s.marked.join() === 'false,false,true,true' && /2 questions are still unanswered/i.test(s.warning || '') && /Question 3, Question 4/.test(s.warning || ''), JSON.stringify(s));

    section('Sending it anyway');
    await ann.clickText('Anyway');
    await ann.waitText('Answers submitted!');
    ok('the second tap submits the answers as they are', submittedCount() === 1);
    s = await state(ann);
    ok('the unanswered questions stay marked, as a reminder', s.marked.filter(Boolean).length === 2);
    await ann.fill('.short-answer-input', 'Jupiter');
    await pick(ann, 3, 'Mars');
    await sleep(400);
    s = await state(ann);
    ok('once they are answered the marks and the warning go away', s.warning === null && s.marked.every((m) => !m), JSON.stringify(s));
    await ann.clickText('Submit Updated Answers');
    await sleep(600);
    ok('updated answers with nothing blank go straight through', (await ann.count('.unanswered-warning')) === 0 && (await ann.has('Answers submitted!')));

    section('A complete round');
    pres.emit('endRound', { roomCode: room, roundIndex: 0 });
    await ann.waitText('this round');
    pres.emit('startRound', { roomCode: room, roundIndex: 1 });
    await ann.waitText('Round 2 of 3');
    await pick(ann, 0, 'Eight');
    await pick(ann, 1, '2');
    await ann.clickText('Submit Answers');
    await ann.waitText('Answers submitted!');
    ok('no warning when everything is answered', (await ann.count('.unanswered-warning')) === 0 && (await ann.count('.needs-answer')) === 0);

    section('The timer never asks');
    pres.emit('endRound', { roomCode: room, roundIndex: 1 });
    await ann.waitText('this round');
    pres.emit('startRound', { roomCode: room, roundIndex: 2 });
    await ann.waitText('Round 3 of 3');
    await pick(ann, 0, 'Pacific'); // one of two answered, nothing submitted
    await ann.waitText('this round', { timeout: 30000 });
    ok('a round that runs out with blanks is submitted automatically, without a warning', (await ann.has('1 / 2')) && (await ann.count('.unanswered-warning')) === 0 && !(await ann.has('tap submit again')));

    ok('no uncaught errors', ann.realErrors().length === 0, ann.realErrors().join(' | '));
  }
);
