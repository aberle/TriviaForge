/**
 * Importing a quiz from Excel with rounds: an optional "Round" column on each question and an
 * optional "Rounds" sheet with the time limits. Includes the sample file in testing/samples/, and a
 * file without rounds (which must keep working as before). API only: no browser needed.
 */

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from './lib/harness.js';

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../samples/round-quiz-sample.xlsx');

/** A workbook in the import layout: rows are [question, choices[], correctIndex, roundTitle?] */
async function workbookBuffer({ title, rows, rounds }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quiz');
  sheet.getRow(1).values = ['Quiz Title', title];
  sheet.getRow(2).values = ['Description', 'built by a test'];
  sheet.getRow(5).values = ['Question Text'];
  rows.forEach(([text, choices, correct, round], i) => {
    sheet.getRow(6 + i).values = [text, ...choices, ...Array(10 - choices.length).fill(''), String(correct), round ?? ''];
  });
  if (rounds) {
    const roundsSheet = workbook.addWorksheet('Rounds');
    roundsSheet.getRow(1).values = ['Round Title', 'Time Limit (seconds, blank = untimed)'];
    rounds.forEach(([name, limit], i) => (roundsSheet.getRow(2 + i).values = [name, limit]));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

await runSuite('excel import with rounds', { chrome: false }, async ({ ok, section, env }) => {
  const importFile = async (buffer, { preview = false } = {}) => {
    const res = await env.upload('/api/import-quiz', 'quiz.xlsx', buffer, { query: preview ? '?preview=true' : '' });
    const text = await res.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (res.ok && body.id) env.trackQuiz(body.id);
    return { status: res.status, body };
  };
  const q = (n, round) => [`Question ${n} in an import test`, ['Right', 'Wrong', 'Also wrong'], 0, round];

  section('The sample file');
  const sample = fs.readFileSync(SAMPLE);
  const preview = await importFile(sample, { preview: true });
  ok('a preview lists 13 questions and 3 rounds', preview.body.questionCount === 13 && preview.body.rounds?.length === 3, JSON.stringify(preview.body.rounds));
  const imported = await importFile(sample);
  ok('importing it creates the quiz with 3 rounds', imported.status === 200 && imported.body.roundCount === 3 && imported.body.questionCount === 13, JSON.stringify(imported.body).slice(0, 200));
  const quiz = await env.getQuiz(imported.body.id);
  ok('the rounds keep their order and time limits (60 s, untimed, 90 s)', quiz.rounds.map((r) => `${r.title}:${r.timeLimitSeconds}`).join('|') === 'Warm-up:60|Science and Nature:null|Final Round:90', JSON.stringify(quiz.rounds));
  const counts = [0, 1, 2].map((i) => quiz.questions.filter((x) => x.roundIndex === i).length).join();
  ok('and the questions land in the right rounds (4, 5, 4)', counts === '4,5,4', counts);
  ok('correct answers come through', quiz.questions[0].text.includes('France') && quiz.questions[0].choices[quiz.questions[0].correctChoice] === 'Paris');

  section('Round handling');
  const grouped = await importFile(
    await workbookBuffer({ title: 'Grouped', rows: [q(1, 'B'), q(2, 'A'), q(3, 'B'), q(4, 'A')], rounds: [['A', 45], ['B', null], ['Never used', 30]] })
  );
  const groupedQuiz = await env.getQuiz(grouped.body.id);
  ok('questions are grouped by round, in the order of the Rounds sheet', groupedQuiz.questions.map((x) => `${x.text.match(/\d/)[0]}@${x.roundIndex}`).join() === '2@0,4@0,1@1,3@1', groupedQuiz.questions.map((x) => x.text.match(/\d/)[0] + '@' + x.roundIndex).join());
  ok('a round nobody uses is left out, and the limit is kept', groupedQuiz.rounds.length === 2 && groupedQuiz.rounds[0].timeLimitSeconds === 45, JSON.stringify(groupedQuiz.rounds));

  const noSheet = await importFile(await workbookBuffer({ title: 'No sheet', rows: [q(1, 'Round X'), q(2, 'Round Y')] }));
  const noSheetQuiz = await env.getQuiz(noSheet.body.id);
  ok('without a Rounds sheet, rounds come from the Round column and are untimed', noSheetQuiz.rounds.map((r) => `${r.title}:${r.timeLimitSeconds}`).join() === 'Round X:null,Round Y:null', JSON.stringify(noSheetQuiz.rounds));

  const mixed = await importFile(await workbookBuffer({ title: 'Mixed', rows: [q(1, 'A'), q(2, '')] }));
  ok('some questions with a round and some without is refused, naming the row', mixed.status === 400 && /row 7/i.test(mixed.body.error || mixed.body.message || ''), `${mixed.status} ${JSON.stringify(mixed.body)}`);
  const badLimit = await importFile(await workbookBuffer({ title: 'Bad limit', rows: [q(1, 'A')], rounds: [['A', 5]] }));
  ok('a time limit under 10 seconds is refused', badLimit.status === 400 && /time limit/i.test(badLimit.body.error || badLimit.body.message || ''), `${badLimit.status} ${JSON.stringify(badLimit.body)}`);

  section('A quiz without rounds');
  const plain = await importFile(await workbookBuffer({ title: 'Plain', rows: [q(1), q(2), q(3)] }));
  const plainQuiz = await env.getQuiz(plain.body.id);
  ok('imports exactly as before: no rounds', plain.status === 200 && plainQuiz.rounds.length === 0 && plainQuiz.questions.length === 3, JSON.stringify(plain.body).slice(0, 160));

  section('The downloadable template');
  const template = await (await env.api('GET', '/api/quiz-template')).arrayBuffer().catch(() => null);
  const templateBook = new ExcelJS.Workbook();
  if (template) await templateBook.xlsx.load(Buffer.from(template));
  ok('has the Round column and a Rounds sheet', templateBook.worksheets.map((s) => s.name).join() === 'Quiz,Rounds' && String(templateBook.worksheets[0].getCell(5, 13).value).startsWith('Round'), templateBook.worksheets.map((s) => s.name).join());
  const templateImport = await importFile(Buffer.from(template));
  ok('and the untouched template still imports (as a quiz without rounds)', templateImport.status === 200 && templateImport.body.roundCount === 0, JSON.stringify(templateImport.body).slice(0, 160));
});
