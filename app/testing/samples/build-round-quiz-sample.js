/**
 * Builds testing/samples/round-quiz-sample.xlsx: a three-round quiz in the Excel import format, for
 * trying rounds (timed and untimed) on a fresh database. Import it from Admin > Quiz Management >
 * Import. Run `node testing/samples/build-round-quiz-sample.js` to rebuild it.
 *
 * Layout (same as the downloadable template): quiz title and description in B1:B2, then one
 * question per row from row 6: text, up to 10 choices, the 0-based index of the correct choice, and
 * the round it belongs to. The "Rounds" sheet lists the rounds in order with their time limits.
 */

import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'round-quiz-sample.xlsx');

const ROUNDS = [
  { title: 'Warm-up', timeLimitSeconds: 60 }, // a quick timed round
  { title: 'Science and Nature', timeLimitSeconds: null }, // untimed: the presenter ends it (or starts a countdown)
  { title: 'Final Round', timeLimitSeconds: 90 },
];

// [round, question, choices, index of the correct choice]
const QUESTIONS = [
  ['Warm-up', 'What is the capital of France?', ['Paris', 'Rome', 'Madrid', 'Berlin'], 0],
  ['Warm-up', 'How many days are in a leap year?', ['364', '365', '366', '367'], 2],
  ['Warm-up', 'Which colour do you get by mixing blue and yellow?', ['Green', 'Orange', 'Purple', 'Brown'], 0],
  ['Warm-up', 'Is a tomato a fruit?', ['Yes', 'No'], 0],

  ['Science and Nature', 'What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2],
  ['Science and Nature', 'Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Saturn'], 1],
  ['Science and Nature', 'How many legs does a spider have?', ['Six', 'Eight', 'Ten', 'Twelve'], 1],
  ['Science and Nature', 'What is the largest mammal on Earth?', ['African elephant', 'Blue whale', 'Giraffe', 'Polar bear'], 1],
  ['Science and Nature', 'Which gas do plants absorb from the air?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], 2],

  ['Final Round', 'Who painted the Mona Lisa?', ['Michelangelo', 'Leonardo da Vinci', 'Raphael', 'Donatello', 'Botticelli', 'Titian'], 1],
  ['Final Round', 'In which year did the Berlin Wall fall?', ['1985', '1987', '1989', '1991'], 2],
  ['Final Round', 'What is the smallest prime number?', ['0', '1', '2', '3'], 2],
  ['Final Round', 'Which ocean is the largest?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
];

const thin = { style: 'thin' };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet('Quiz');

sheet.getRow(1).values = ['Quiz Title', 'Sample Round Quiz'];
sheet.getRow(2).values = ['Description', 'Three rounds (60 s, untimed, 90 s) for trying out round-based quizzes'];
for (const [cell, color] of [['A1', 'FFD9EAD3'], ['A2', 'FFD9EAD3']]) {
  sheet.getCell(cell).font = { bold: true };
  sheet.getCell(cell).fill = fill(color);
}

sheet.getRow(4).values = ['Index →', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '← Use these numbers', 'Round title, if the quiz has rounds'];
sheet.getRow(4).font = { bold: true, color: { argb: 'FF666666' } };
sheet.getRow(5).values = ['Question Text', ...'ABCDEFGHIJ'.split('').map((l) => `Choice ${l}`), 'Correct Answer (0-based index)', 'Round (optional)'];
sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
for (let col = 1; col <= 13; col++) {
  sheet.getCell(4, col).fill = fill('FFE0E0E0');
  sheet.getCell(5, col).fill = fill('FF4472C4');
  sheet.getCell(4, col).border = border;
  sheet.getCell(5, col).border = border;
}

QUESTIONS.forEach(([round, text, choices, correct], i) => {
  const row = sheet.getRow(6 + i);
  const padded = [...choices, ...Array(10 - choices.length).fill('')];
  row.values = [text, ...padded, String(correct), round];
  for (let col = 1; col <= 13; col++) sheet.getCell(6 + i, col).border = border;
});
sheet.getColumn(1).width = 52;
sheet.getColumn(13).width = 24;

const rounds = workbook.addWorksheet('Rounds');
rounds.getRow(1).values = ['Round Title', 'Time Limit (seconds, blank = untimed)'];
rounds.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
rounds.getCell('A1').fill = fill('FF4472C4');
rounds.getCell('B1').fill = fill('FF4472C4');
ROUNDS.forEach((round, i) => {
  rounds.getRow(2 + i).values = [round.title, round.timeLimitSeconds];
});
rounds.getColumn(1).width = 30;
rounds.getColumn(2).width = 38;

await workbook.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT} (${QUESTIONS.length} questions in ${ROUNDS.length} rounds)`);
