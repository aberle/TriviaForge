/**
 * The round components render the right things for each state: the player's questions and progress,
 * the review with their results, the projector view, and the presenter's controls. Rendered
 * server-side from the real .vue files, so no server or browser is needed.
 */

import { startVite, ssr, suite } from './lib.js';

const server = await startVite();
const { render } = await ssr();
const t = suite('round components');
const load = async (p) => (await server.ssrLoadModule(p)).default;

const questions = [
  { index: 0, text: 'What is the capital of France?', type: 'multiple_choice', choices: ['Paris', 'Rome', 'Oslo'], imageUrl: null },
  { index: 1, text: 'The sky is blue.', type: 'true_false', choices: ['True', 'False'], imageUrl: null },
  { index: 2, text: 'Largest planet?', type: 'short_answer', choices: [], imageUrl: null },
];
const full = [
  { ...questions[0], correctChoice: 0 },
  { ...questions[1], correctChoice: 0 },
  { ...questions[2], correctChoice: -1, choices: ['Jupiter'], acceptedAnswers: [{ id: 1, answer_text: 'Jupiter' }] },
];
const standings = [{ rank: 1, name: 'Ann', roundScore: 3, totalScore: 5 }, { rank: 2, name: 'Bob', roundScore: 1, totalScore: 2 }];
const current = { roundIndex: 0, totalRounds: 2, title: 'Warmup', timeLimitSeconds: 60, clientStartedAt: new Date().toISOString(), questions };
const ended = { roundIndex: 0, totalRounds: 2, title: 'Warmup', reason: 'timeout', isLastRound: false, questions: full, standings,
  you: { answers: [0, 1, 'jupitar'], results: [true, false, true], roundScore: 2, totalScore: 2, rank: 1 } };
const rounds = [{ index: 0, title: 'Warmup', questionCount: 3, questionIndexes: [0, 1, 2], timeLimitSeconds: 60 }, { index: 1, title: 'Finals', questionCount: 2, questionIndexes: [], timeLimitSeconds: null }];

const cases = [
  ['rounds/RoundLeaderboard', { standings, highlightName: 'Bob' }, ['Ann', 'you', '+3']],
  ['rounds/RoundQuestions', { round: current, serverDraft: [0, null, 'jup'], submitted: false, progress: null, snapshotVersion: 0 }, ['Question 1', 'Submit Answers', '2 / 3 answered', 'value="jup"']],
  ['rounds/RoundQuestions', { round: { ...current, timeLimitSeconds: null }, serverDraft: null, submitted: true, progress: { submitted: 1, total: 3 }, snapshotVersion: 0 }, ['Answers submitted', '1 of 3 players', 'No time limit']],
  ['rounds/RoundReview', { ended, youName: 'Ann' }, ['this round', 'jupitar', 'Correct answer:', 'Waiting for the presenter to start the next round']],
  ['rounds/RoundReview', { ended: { ...ended, you: undefined, isLastRound: true }, youName: '' }, ['Accepted:', 'Final Standings', 'That was the last round']],
  ['rounds/RoundQuestionList', { questions: full, reveal: true, large: true }, ['Accepted:', 'Jupiter', 'correct']],
  ['rounds/RoundProjector', { phase: 'open', current, progress: { submitted: 2, total: 3 } }, ['Warmup', '2</strong> of <strong', 'Open-ended answer']],
  ['rounds/RoundProjector', { phase: 'ended', lastEnded: ended }, ['The answers', 'Leaderboard', 'Accepted:']],
  ['presenter/RoundDisplay', { quizTitle: 'Trivia', currentRoomCode: '1234', rounds, questions: full, phase: 'idle', completed: [], nextRoundIndex: 0 }, ['0 of 2 rounds played', 'Start', 'untimed']],
  ['presenter/RoundDisplay', { quizTitle: 'Trivia', currentRoomCode: '1234', rounds, questions: full, phase: 'open', current, progress: { submitted: 3, total: 3, submittedNames: ['Ann'] } }, ['LIVE', 'End Round', 'Everyone has submitted', 'Accepted:']],
  ['presenter/RoundDisplay', { quizTitle: 'Trivia', currentRoomCode: '1234', rounds, questions: full, phase: 'ended', completed: [0, 1], allCompleted: true, lastEnded: { ...ended, isLastRound: true }, quizCompleted: false }, ['Final Standings', 'Complete Quiz', 'All rounds are done']],
];

for (const [path, props, expected] of cases) {
  try {
    const html = await render(await load(`/src/components/${path}.vue`), props);
    const missing = expected.filter((text) => !html.includes(text));
    t.ok(`${path} ${JSON.stringify(Object.keys(props).slice(0, 2))}`, missing.length === 0, `missing ${JSON.stringify(missing)}`);
  } catch (e) {
    t.ok(path, false, e.message);
  }
}

await server.close();
process.exit(t.finish() ? 0 : 1);
