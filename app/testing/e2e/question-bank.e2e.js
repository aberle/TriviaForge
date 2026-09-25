/**
 * Saving a quiz must not litter the question bank with copies. Before, every save re-created every
 * question, and the old copies of questions that had been played stayed behind in the bank (as
 * unused "duplicates") because played sessions still refer to them. Now unchanged questions keep their
 * row (and tags), and questions no quiz uses any more are only kept as history, never listed.
 * API only: no browser needed.
 */

import { runSuite, Q, sleep } from './lib/harness.js';

const TAG = Date.now().toString(36);

await runSuite(
  'question bank duplicates',
  {
    chrome: false,
    quiz: {
      title: `Bank ${TAG}`,
      rounds: [{ title: 'A' }, { title: 'B' }],
      questions: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => Q.mc(`Bank ${TAG} question ${n} text goes here`, ['x', 'y'], 0, i < 2 ? 0 : 1)),
    },
  },
  async ({ ok, section, env }) => {
    const json = async (method, path, body) => (await env.api(method, path, body)).json();
    const bank = async () => (await json('GET', `/api/questions/bank?search=${encodeURIComponent(`Bank ${TAG}`)}&limit=100`)).questions;
    const word = (text) => text.split(' ')[3];
    const summary = async () => (await bank()).map((q) => `${word(q.question_text)}#${q.id}`).sort().join(' ');
    const save = (quiz) => env.api('PUT', `/api/quizzes/quiz_${env.quiz.id}.json`, { title: quiz.title || `Bank ${TAG}`, description: 'd', rounds: quiz.rounds, questions: quiz.questions });
    const play = async (quizId, ...indexes) => {
      const room = await env.newRoom(quizId);
      const player = env.bot();
      player.emit('joinRoom', { roomCode: room, username: `bank_${TAG}`, displayName: 'Bank', playerID: player.playerID });
      await player.waitFor('answerHistoryRestored');
      for (const i of indexes) {
        const mark = player.mark();
        env.presenter.emit('presentQuestion', { roomCode: room, questionIndex: i });
        await player.waitFor('questionPresented', { since: mark, pred: (p) => p.questionIndex === i });
        player.emit('submitAnswer', { roomCode: room, choice: 0 });
        await sleep(300);
        env.presenter.emit('revealAnswer', { roomCode: room });
        await player.waitFor('questionRevealed', { since: mark, pred: (p) => p.questionIndex === i });
      }
      player.close();
      await sleep(300);
      env.presenter.emit('closeRoom', { roomCode: room, userId: 1, isRootAdmin: true });
      await sleep(1000);
    };

    const original = await summary();
    ok('the bank has one row per question', (await bank()).length === 4, original);

    section('Edits that do not change a question');
    let quiz = await env.getQuiz(env.quiz.id);
    await save({ rounds: quiz.rounds, questions: quiz.questions.slice().reverse().map((q) => ({ ...q, roundIndex: 0 })) });
    ok('reordering and moving between rounds keeps every question row', (await summary()) === original, await summary());
    await save({ title: `Bank ${TAG} renamed`, rounds: [], questions: (await env.getQuiz(env.quiz.id)).questions });
    ok('renaming the quiz and removing its rounds does too', (await summary()) === original, await summary());

    section('Tags stay on questions when the quiz is saved');
    const tag = await json('POST', '/api/tags', { name: `tag-${TAG}`, tag_type: 'custom', color: '#336699' });
    const tagId = tag.tag?.id ?? tag.id ?? tag.data?.id;
    const first = (await bank()).find((q) => word(q.question_text) === 'Bravo');
    await json('PUT', `/api/questions/${first.id}/tags`, { tagIds: [tagId] });
    quiz = await env.getQuiz(env.quiz.id);
    await save({ rounds: [], questions: quiz.questions.slice().reverse() });
    const tagged = (await bank()).find((q) => word(q.question_text) === 'Bravo');
    ok('a tagged question keeps its tag after the quiz is reordered', tagged?.tags?.some((t) => t.id === tagId), JSON.stringify(tagged?.tags));

    section('Played, then edited');
    quiz = await env.getQuiz(env.quiz.id);
    const idsBefore = await summary();
    await play(env.quiz.id, 0, 1); // the room is created after the last save: it holds the current question ids
    await save({ rounds: [], questions: quiz.questions.slice().reverse() });
    ok('reordering a quiz that has been played adds no copies', (await summary()) === idsBefore, await summary());

    quiz = await env.getQuiz(env.quiz.id);
    const played = quiz.questions[0]; // the question that was played first is changed
    const oldText = played.text;
    const edited = quiz.questions.map((q) => (q.id === played.id ? { ...q, text: `${q.text} (edited)` } : q));
    await save({ rounds: [], questions: edited });
    const after = await bank();
    ok('an edited question appears once, with its new text', after.filter((q) => q.question_text.includes(word(oldText))).length === 1 && after.some((q) => q.question_text.endsWith('(edited)')), await summary());
    ok('the old version is not listed in the bank', !after.some((q) => q.question_text === oldText));
    const dup = await json('POST', '/api/questions/check-duplicates', { questionText: oldText });
    const flagged = [dup.exactMatch, ...(dup.similarQuestions || [])].filter(Boolean).map((q) => q.id);
    ok('and the leftover copy is not offered as a duplicate of the text', !flagged.includes(played.id), JSON.stringify(flagged));

    const sessions = (await json('GET', '/api/sessions')).filter((s) => s.quizId === env.quiz.id);
    const detail = sessions.length ? await json('GET', `/api/sessions/${sessions[0].filename}`) : null;
    ok('the played session still shows the question as it was asked', !!detail && JSON.stringify(detail).includes(oldText), `${sessions.length} session(s)`);

    section('Removing a played question');
    quiz = await env.getQuiz(env.quiz.id);
    const removed = quiz.questions.find((q) => !q.text.endsWith('(edited)'));
    await save({ rounds: [], questions: quiz.questions.filter((q) => q.id !== removed.id) });
    ok('it leaves the bank, and no other question is copied', !(await bank()).some((q) => q.question_text === removed.text) && (await bank()).length === 3, await summary());

    section('A question shared with another quiz');
    const shared = (await bank()).find((q) => word(q.question_text) === 'Charlie' || word(q.question_text) === 'Delta');
    const other = await json('POST', '/api/questions/from-quiz-selection', { title: `Other ${TAG}`, questionIds: [shared.id] });
    ok('a quiz can be built from bank questions', !!other.quiz?.id, JSON.stringify(other).slice(0, 160));
    quiz = await env.getQuiz(env.quiz.id);
    await save({ rounds: [], questions: quiz.questions.filter((q) => q.id !== shared.id) });
    const stillThere = (await bank()).find((q) => q.id === shared.id);
    ok('removing it from the first quiz does not delete it from the second', !!stillThere && Number(stillThere.usage_count) === 1, JSON.stringify(stillThere && [stillThere.id, stillThere.usage_count]));
    await env.api('DELETE', `/api/quizzes/quiz_${other.quiz.id}.json`);
  }
);
