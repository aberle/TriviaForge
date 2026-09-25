/**
 * The admin page's round handlers (enable/add/delete rounds, move and reorder questions, drag and
 * drop, saving) driven on the real AdminPage.vue against a fake in-memory backend.
 */

import { APP_ROOT, dep, startVite, suite } from './lib.js';

const dom = () => ({ addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return { style: {}, setAttribute() {}, click() {} }; }, body: { appendChild() {}, removeChild() {} }, documentElement: { setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, style: {} } });
globalThis.window = { location: { origin: 'http://test', pathname: '/admin' }, ...dom(), matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }), innerWidth: 1400 };
globalThis.document = dom();
globalThis.history = { state: {}, pushState() {}, replaceState() {} };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const { default: axios } = await dep('axios/index.js');
const { validateRounds } = await import(`${APP_ROOT}/src/utils/validators.js`);
const { createSSRApp, h, nextTick } = await dep('vue/index.mjs');
const { renderToString } = await dep('vue/server-renderer/index.mjs');
const { createPinia } = await dep('pinia/dist/pinia.mjs');
const { createRouter, createMemoryHistory } = await dep('vue-router/dist/vue-router.mjs');

// ---- fake backend ----
const q = (text, i) => ({ id: i + 1, text, type: 'multiple_choice', choices: ['a', 'b'], correctChoice: 0, imageUrl: null, imageType: null });
const quiz = { filename: 'quiz_1.json', title: 'Demo', description: '', rounds: [], questions: ['Q one text', 'Q two text', 'Q three text', 'Q four text', 'Q five text'].map(q) };
const puts = [];
axios.defaults.adapter = async (config) => {
  const method = config.method.toLowerCase();
  const body = config.data ? JSON.parse(config.data) : undefined;
  const res = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config });
  if (config.url === '/api/csrf-token') return res({ csrfToken: 't' });
  if (config.url === '/api/quizzes' && method === 'get') return res([{ id: 1, filename: quiz.filename, title: quiz.title, description: '', questionCount: quiz.questions.length, roundCount: quiz.rounds.length }]);
  if (config.url === `/api/quizzes/${quiz.filename}` && method === 'get') return res(JSON.parse(JSON.stringify(quiz)));
  if (config.url === `/api/quizzes/${quiz.filename}` && method === 'put') {
    puts.push(body);
    const check = validateRounds(body.rounds, body.questions);
    if (!check.valid) { const err = new Error(check.error); err.response = { status: 400, data: {} }; throw err; }
    quiz.title = body.title; quiz.rounds = body.rounds || [];
    quiz.questions = body.questions.map((x, i) => ({ id: i + 1, imageUrl: null, imageType: null, ...x, roundIndex: quiz.rounds.length ? x.roundIndex : null }));
    return res({ ok: true });
  }
  if (config.url === '/api/questions/check-duplicates') return res({ hasDuplicates: false, exactMatch: null, similarQuestions: [] });
  return res({});
};

const server = await startVite();
const AdminPage = (await server.ssrLoadModule('/src/pages/AdminPage.vue')).default;

let vm;
const app = createSSRApp({ render: () => h(AdminPage) });
app.mixin({ created() { if (this.$.type === AdminPage) vm = this; } });
app.use(createPinia());
app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] }));
await renderToString(app);
const s = vm.$.setupState;

const t = suite('admin round handlers');
const ok = t.ok;
const state = () => `${s.currentRounds.map((r) => `${r.title}/${r.timeLimitSeconds ?? '-'}`).join('|')} :: ${s.currentQuestions.map((x) => `${x.text.split(' ')[1]}@${x.roundIndex ?? '-'}`).join(',')}`;
const idxOf = (word) => s.currentQuestions.findIndex((x) => x.text.split(' ')[1] === word);
const confirmDialog = async (promise) => { await nextTick(); await new Promise((r) => setTimeout(r, 10)); s.handleDialogConfirm(); return promise; };

await s.loadQuizzes();
await s.selectQuiz(s.quizzes[0]);
ok('loads a round-less quiz', s.currentRounds.length === 0 && s.currentQuestions.length === 5, state());

await s.enableRounds();
ok('enableRounds: one round, all questions in it', s.currentRounds.length === 1 && s.currentQuestions.every((x) => x.roundIndex === 0), state());
ok('enableRounds sent rounds + roundIndex', puts.at(-1).rounds.length === 1 && puts.at(-1).questions.every((x) => x.roundIndex === 0));

await s.addRound(); await s.addRound();
ok('addRound x2 → 3 rounds, default titles', s.currentRounds.map((r) => r.title).join() === 'Round 1,Round 2,Round 3', state());

await s.moveQuestionToRound({ idx: idxOf('four'), roundIdx: 1 });
await s.moveQuestionToRound({ idx: idxOf('five'), roundIdx: 2 });
ok('moveQuestionToRound', s.currentQuestions.map((x) => x.roundIndex).join() === '0,0,0,1,2', state());

await s.updateRound({ roundIdx: 0, timeLimitSeconds: 45 });
ok('set a time limit', s.currentRounds[0].timeLimitSeconds === 45, state());
await s.updateRound({ roundIdx: 0, title: 'Warmup' });
ok('renaming keeps the time limit', s.currentRounds[0].title === 'Warmup' && s.currentRounds[0].timeLimitSeconds === 45, state());
await s.updateRound({ roundIdx: 0, timeLimitSeconds: null });
ok('null time limit → untimed', s.currentRounds[0].timeLimitSeconds === null && s.currentRounds[0].title === 'Warmup', state());
const putsBefore = puts.length;
await s.updateRound({ roundIdx: 0, timeLimitSeconds: 5 });
ok('invalid time limit is rejected client-side (no PUT)', puts.length === putsBefore && s.currentRounds[0].timeLimitSeconds === null);

const beforeBoundary = puts.length;
await s.moveQuestionUp(idxOf('four'));
ok('moveUp on the first question of a round is a no-op', puts.length === beforeBoundary);
await s.moveQuestionDown(idxOf('three'));
ok('moveDown on the last question of a round is a no-op', puts.length === beforeBoundary);
await s.moveQuestionDown(0);
ok('moveDown swaps inside the round', s.currentQuestions.slice(0, 3).map((x) => x.text.split(' ')[1]).join() === 'two,one,three', state());
await s.moveQuestionToLast(0);
ok('moveToLast stays inside the round', s.currentQuestions.slice(0, 3).map((x) => x.text.split(' ')[1]).join() === 'one,three,two' && s.currentQuestions.map((x) => x.roundIndex).join() === '0,0,0,1,2', state());
await s.moveQuestionToFirst(2);
ok('moveToFirst stays inside the round', s.currentQuestions.slice(0, 3).map((x) => x.text.split(' ')[1]).join() === 'two,one,three', state());

// drag q(idx0) onto the question in round 2 (idx 4)
s.handleDragStart(idxOf('two'));
await s.handleDrop({ preventDefault() {} }, { type: 'question', idx: idxOf('five'), position: 'after' });
await new Promise((r) => setTimeout(r, 80)); // handleDrop reloads without awaiting
ok('dropping on another round moves the question there', s.currentQuestions.find((x) => x.text.includes(' two ')).roundIndex === 2 && s.currentQuestions.map((x) => x.roundIndex).join() === '0,0,1,2,2', state());

await s.shuffleQuestions();
await new Promise((r) => setTimeout(r, 80));
const counts = [0, 1, 2].map((r) => s.currentQuestions.filter((x) => x.roundIndex === r).length).join();
ok('shuffle keeps each round\'s questions in the round', counts === '2,1,2' && s.currentQuestions.map((x) => x.roundIndex).join() === '0,0,1,2,2', `${counts} ${state()}`);

// new question lands in the chosen round
s.questionText = 'Brand new question';
s.choices = ['x', 'y', '', ''];
s.correctChoice = 1;
s.questionRoundIndex = 1;
await s.saveQuestion();
await new Promise((r) => setTimeout(r, 80)); // saveQuestion reloads without awaiting
const added = s.currentQuestions.find((x) => x.text === 'Brand new question');
ok('a new question is saved into the selected round', added?.roundIndex === 1 && s.currentQuestions.map((x) => x.roundIndex).join() === '0,0,1,1,2,2', state());

// delete the middle round: its questions join the previous round, later rounds shift down
const lenBefore = s.currentQuestions.length;
await confirmDialog(s.deleteRound(1));
ok('deleteRound merges into the previous round and reindexes', s.currentRounds.length === 2 && s.currentQuestions.length === lenBefore && Math.max(...s.currentQuestions.map((x) => x.roundIndex)) === 1, state());
await confirmDialog(s.deleteRound(0));
ok('deleting the first round merges into the next', s.currentRounds.length === 1 && s.currentQuestions.every((x) => x.roundIndex === 0), state());
await confirmDialog(s.deleteRound(0));
ok('deleting the only round returns to a flat quiz', s.currentRounds.length === 0 && s.currentQuestions.length === lenBefore && puts.at(-1).questions.every((x) => !('roundIndex' in x)), state());

// title edit on a round quiz must not drop rounds
await s.enableRounds(); await s.addRound();
s.quizTitle = 'Renamed quiz';
await s.saveQuizTitle();
ok('saving the quiz title keeps its rounds', quiz.rounds.length === 2 && puts.at(-1).rounds.length === 2 && quiz.title === 'Renamed quiz', state());

await server.close();
process.exit(t.finish() ? 0 : 1);
