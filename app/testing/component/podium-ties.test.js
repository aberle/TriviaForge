/**
 * The final-results podium: tied players share a step (competition ranking), so two players tied for
 * first both stand on the 1st step and the next step is 3rd.
 */

import { startVite, ssr, suite } from './lib.js';

const server = await startVite();
const { render } = await ssr();
const GameResults = (await server.ssrLoadModule('/src/components/player/GameResults.vue')).default;
const t = suite('podium ties');

const players = (scores) => scores.map(([name, score]) => ({ name, score, totalAnswered: 4 }));
// "2nd[B] 1st[A] 3rd[C]": the steps left to right, with the names standing on each
const steps = async (scores) => {
  const html = await render(GameResults, { players: players(scores), totalQuestions: 4 });
  const slots = [...html.matchAll(/<div class="[^"]*podium-slot[^"]*"[^>]*>(.*?)<span class="podium-rank-label"[^>]*>(.*?)<\/span>/gs)];
  return slots
    .map((m) => `${m[2]}[${[...m[1].matchAll(/class="[^"]*podium-name[^"]*"[^>]*>([^<]*)</g)].map((x) => x[1]).filter(Boolean).join(',')}]`)
    .join(' ');
};
const expectSteps = async (label, scores, expected) => {
  const got = await steps(scores);
  t.ok(`${label}: ${expected}`, got === expected, `got ${got}`);
};

await expectSteps('two tied for 1st, two tied for 3rd', [['Ann', 3], ['Bob', 3], ['Cy', 2], ['Dee', 2], ['Eve', 0]], '1st[Ann,Bob] 3rd[Cy,Dee]');
await expectSteps('no ties keeps the classic 2nd/1st/3rd layout', [['A', 3], ['B', 2], ['C', 1], ['D', 0]], '2nd[B] 1st[A] 3rd[C]');
await expectSteps('three-way tie for 1st leaves no lower steps', [['A', 3], ['B', 3], ['C', 3], ['D', 1]], '1st[A,B,C]');
await expectSteps('tie for 2nd', [['A', 3], ['B', 2], ['C', 2], ['D', 1]], '2nd[B,C] 1st[A]');
await expectSteps('a single player', [['Solo', 4]], '1st[Solo]');
await expectSteps('everyone tied', [['A', 2], ['B', 2], ['C', 2], ['D', 2]], '1st[A,B,C,D]');
await expectSteps('a big tie caps the names shown', Array.from({ length: 8 }, (_, i) => [`P${i + 1}`, 3]), '1st[P1,P2,P3,P4,P5,+3 more]');

const empty = await render(GameResults, { players: [], totalQuestions: 4 });
t.ok('no players: no podium, an empty state', !empty.includes('podium-scene') && empty.includes('No results'));

const full = await render(GameResults, { players: players([['Ann', 3], ['Bob', 3], ['Cy', 2], ['Dee', 2], ['Eve', 0]]), totalQuestions: 4, highlightName: 'Cy' });
const ranks = [...full.matchAll(/class="remaining-rank[^"]*"[^>]*>(\d+)</g)].map((m) => m[1]).join(',');
t.ok('the full leaderboard uses competition ranks (1,1,3,3,5)', ranks === '1,1,3,3,5', ranks);
t.ok("the viewing player's row is highlighted", full.includes('remaining-row--you'));

await server.close();
process.exit(t.finish() ? 0 : 1);
