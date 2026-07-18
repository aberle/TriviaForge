# Open-Ended (Short Answer) Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins author `short_answer` questions where players type a free-text response, auto-graded by fuzzy string matching against admin-supplied accepted answers, working across live multiplayer, solo play, presenter/display, and exports.

**Architecture:** The existing `short_answer` enum value in `questions.question_type` (reserved since schema v1, never wired up) becomes a real, fully-implemented question type. The `answers` table is reused to store accepted-answer synonyms (all `is_correct = TRUE`). A new `matchShortAnswer()` helper (built on the existing Levenshtein-based `similarity.js`) replaces index-equality checks (`playerChoice === question.correctChoice`) at every call site that currently assumes multiple-choice/true-false semantics, branching on `question.type`. `participant_answers` gains a nullable `answer_text` column to hold the player's raw typed submission, since free text has no natural row in `answers` to point to.

**Tech Stack:** Node.js/Express backend, Socket.IO for live multiplayer, PostgreSQL, Vue 3 Composition API (`<script setup>`, plain JS) frontend, PDFKit for PDF export. No test runner exists in this project (`app/package.json` has no `test` script, no test files outside `node_modules`) — verification throughout this plan is manual (dev server + browser) or via small throwaway Node scripts for pure functions, matching this project's existing QA approach (see `TODO.md` "Testing Priorities").

## Global Constraints

- Question type value is exactly `short_answer` (already valid per the `questions.question_type` CHECK constraint in `app/init/01-tables.sql:38` — do not add a migration for this).
- Default similarity threshold is `0.85` (0-1 scale, same scale as `calculateSimilarity()` in `app/src/utils/similarity.js`).
- New `app_settings` key is exactly `short_answer_match_threshold`, stored as a string (same pattern as `answer_display_time`).
- `participant_answers.answer_id` becomes nullable; `participant_answers.answer_text TEXT` is new and nullable, populated only for `short_answer` submissions.
- No partial credit, no manual presenter grading, no multi-line input, no AI/LLM grading — these are explicitly out of scope per the design spec (`docs/superpowers/specs/2026-07-18-open-ended-answers-design.md`).
- `/api/debug/*` endpoints (`app/server.js` ~2929-3900) are internal dev-testing tooling, not part of user-facing gameplay — this plan does not modify them.
- Timeout auto-submit is client-driven: the player's own countdown pushes whatever text is currently in the input box through the normal submit path when it hits zero; there is no new server-initiated request.

---

### Task 1: Database migration

**Files:**
- Create: `app/init/18-short-answer-questions.sql`

**Interfaces:**
- Produces: nullable `participant_answers.answer_id`, new `participant_answers.answer_text TEXT` column, new `app_settings` row with key `short_answer_match_threshold`.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- Migration 18: Short Answer (Open-Ended) Questions
-- ============================================================================
-- Enables the 'short_answer' question_type (already valid per the CHECK
-- constraint on questions.question_type since the original schema).
-- Free-text submissions have no natural row in `answers` to point to, so
-- answer_id becomes nullable and a new answer_text column holds the raw
-- typed response.
-- ============================================================================

ALTER TABLE participant_answers ALTER COLUMN answer_id DROP NOT NULL;

ALTER TABLE participant_answers ADD COLUMN IF NOT EXISTS answer_text TEXT;

INSERT INTO app_settings (setting_key, setting_value, description)
VALUES (
  'short_answer_match_threshold',
  '0.85',
  'Minimum similarity (0-1) for auto-grading open-ended answers against accepted answers'
)
ON CONFLICT (setting_key) DO NOTHING;
```

- [ ] **Step 2: Verify the migration applies cleanly**

Run: `docker compose up -d db app` (or however this project's local dev stack is started — check `docker-compose.yml` at repo root) then check logs for the migration runner:

Run: `docker compose logs app | grep -i "18-short-answer"`
Expected: a log line showing migration `18-short-answer-questions.sql` applied successfully, no errors.

- [ ] **Step 3: Verify column and setting exist**

Run: `docker compose exec db psql -U postgres -d triviaforge -c "\d participant_answers"` — confirm `answer_id` shows `nullable` and `answer_text` (`text`) is present.
Run: `docker compose exec db psql -U postgres -d triviaforge -c "SELECT * FROM app_settings WHERE setting_key = 'short_answer_match_threshold';"` — confirm one row with value `0.85`.

- [ ] **Step 4: Commit**

```bash
git add app/init/18-short-answer-questions.sql
git commit -m "feat: add DB migration for short-answer question support"
```

---

### Task 2: Grading helper — `matchShortAnswer()`

**Files:**
- Modify: `app/src/utils/similarity.js`

**Interfaces:**
- Consumes: `normalizeText(text)` and `calculateSimilarity(text1, text2)`, both already defined in this file.
- Produces: `matchShortAnswer(playerText, acceptedAnswers, threshold)` → `{ isCorrect: boolean, matchedAnswerId: number|null, similarity: number }`. `acceptedAnswers` is an array of `{ id, answer_text }` (or `{ id, text }` — see Step 1, this plan standardizes on `answer_text` to match the DB column name and how `answers` rows are shaped everywhere else in this codebase).

- [ ] **Step 1: Add `matchShortAnswer` to `similarity.js`**

Add this function after `findDuplicateGroups` (before the final `export` block):

```js
/**
 * Grade a free-text answer against a list of accepted answers
 *
 * @param {string} playerText - The player's typed submission
 * @param {Array<{id: number, answer_text: string}>} acceptedAnswers - Accepted answer rows for the question
 * @param {number} threshold - Minimum similarity (0-1) to count as correct, default 0.85
 * @returns {{isCorrect: boolean, matchedAnswerId: number|null, similarity: number}}
 */
function matchShortAnswer(playerText, acceptedAnswers, threshold = 0.85) {
  if (!playerText || !acceptedAnswers || acceptedAnswers.length === 0) {
    return { isCorrect: false, matchedAnswerId: null, similarity: 0 }
  }

  let best = { isCorrect: false, matchedAnswerId: null, similarity: 0 }

  for (const accepted of acceptedAnswers) {
    const similarity = calculateSimilarity(playerText, accepted.answer_text)
    if (similarity > best.similarity) {
      best = {
        isCorrect: similarity >= threshold,
        matchedAnswerId: similarity >= threshold ? accepted.id : null,
        similarity: Math.round(similarity * 100) / 100
      }
    }
  }

  return best
}
```

- [ ] **Step 2: Update the file's export block**

Change:
```js
export {
  normalizeText,
  levenshteinDistance,
  calculateSimilarity,
  generateTextHash,
  findSimilarQuestions,
  findDuplicateGroups
}
```
to:
```js
export {
  normalizeText,
  levenshteinDistance,
  calculateSimilarity,
  generateTextHash,
  findSimilarQuestions,
  findDuplicateGroups,
  matchShortAnswer
}
```

- [ ] **Step 3: Verify with a throwaway script (no test runner exists in this project)**

Create a temporary file `app/verify-match-short-answer.mjs`:

```js
import { matchShortAnswer } from './src/utils/similarity.js';

const accepted = [
  { id: 1, answer_text: 'Paris' },
  { id: 2, answer_text: 'City of Light' }
];

console.log(matchShortAnswer('paris', accepted, 0.85));
// Expected: { isCorrect: true, matchedAnswerId: 1, similarity: 1 }

console.log(matchShortAnswer('pariss', accepted, 0.85));
// Expected: isCorrect: true (one-char typo, similarity ~0.83-0.9 depending on rounding) OR
// isCorrect: false if below threshold — either is fine, just confirm it doesn't throw and similarity is close to 1

console.log(matchShortAnswer('London', accepted, 0.85));
// Expected: { isCorrect: false, matchedAnswerId: null, similarity: <low number> }

console.log(matchShortAnswer('', accepted, 0.85));
// Expected: { isCorrect: false, matchedAnswerId: null, similarity: 0 }

console.log(matchShortAnswer('Paris', [], 0.85));
// Expected: { isCorrect: false, matchedAnswerId: null, similarity: 0 }
```

Run: `cd app && node verify-match-short-answer.mjs`
Expected: four object logs matching the comments above, no errors thrown.

- [ ] **Step 4: Delete the throwaway script**

```bash
rm app/verify-match-short-answer.mjs
```

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/similarity.js
git commit -m "feat: add matchShortAnswer grading helper to similarity.js"
```

---

### Task 3: Room-building — include accepted answers for short-answer questions

**Files:**
- Modify: `app/src/services/quiz.service.js:117-132` (`formatQuizForRoom`)
- Modify: `app/server.js:1558-1572` (createRoom/viewRoom quizData builder)
- Modify: `app/server.js:1719-1733` (resumeSession quizData builder)

**Interfaces:**
- Produces: each `question` object in `room.quizData.questions` gains an `acceptedAnswers: [{id, answer_text}]` array when `type === 'short_answer'`; `correctChoice` is left as `-1` (meaningless for this type, but keeps the object shape consistent so nothing downstream that blindly reads `correctChoice` crashes).

- [ ] **Step 1: Update `formatQuizForRoom` in `quiz.service.js`**

Replace lines 117-132:
```js
  formatQuizForRoom(quiz, quizFilename) {
    return {
      filename: quizFilename,
      title: quiz.title,
      description: quiz.description,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type || 'multiple_choice',
        imageUrl: q.imageUrl || null,
        imageType: q.imageType || null,
        choices: q.choices.map((c) => c.text),
        correctChoice: q.choices.findIndex((c) => c.isCorrect),
      })),
    };
  }
```
with:
```js
  formatQuizForRoom(quiz, quizFilename) {
    return {
      filename: quizFilename,
      title: quiz.title,
      description: quiz.description,
      questions: quiz.questions.map((q) => {
        const type = q.type || 'multiple_choice';
        const base = {
          id: q.id,
          text: q.text,
          type,
          imageUrl: q.imageUrl || null,
          imageType: q.imageType || null,
          choices: q.choices.map((c) => c.text),
          correctChoice: type === 'short_answer' ? -1 : q.choices.findIndex((c) => c.isCorrect),
        };
        if (type === 'short_answer') {
          base.acceptedAnswers = q.choices.map((c, idx) => ({ id: c.id ?? idx, answer_text: c.text }));
        }
        return base;
      }),
    };
  }
```

Note: `q.choices[].id` must be the `answers.id` row id for `matchedAnswerId` traceability to work later (Task 4). Check `getQuizById` (same file, above this method) — confirm it selects `a.id AS choice_id` (or similar) and includes it on each choice object. If it does not, add `id: row.answer_id` (or whatever the query aliases it) to the choice-mapping in `getQuizById` so `c.id` is populated. Read the query before editing to match its actual column aliases.

- [ ] **Step 2: Apply the identical pattern to `server.js:1558-1572`**

Replace:
```js
      const quizData = {
        filename: quizFilename,
        title: quiz.title,
        description: quiz.description,
        questions: quiz.questions.map(q => ({
          id: q.id,
          text: q.text,
          type: q.type || 'multiple_choice',
          imageUrl: q.imageUrl || null,
          imageType: q.imageType || null,
          choices: q.choices.map(c => c.text),
          correctChoice: q.choices.findIndex(c => c.isCorrect)
        }))
      };
```
with:
```js
      const quizData = {
        filename: quizFilename,
        title: quiz.title,
        description: quiz.description,
        questions: quiz.questions.map(q => {
          const type = q.type || 'multiple_choice';
          const base = {
            id: q.id,
            text: q.text,
            type,
            imageUrl: q.imageUrl || null,
            imageType: q.imageType || null,
            choices: q.choices.map(c => c.text),
            correctChoice: type === 'short_answer' ? -1 : q.choices.findIndex(c => c.isCorrect)
          };
          if (type === 'short_answer') {
            base.acceptedAnswers = q.choices.map((c, idx) => ({ id: c.id ?? idx, answer_text: c.text }));
          }
          return base;
        })
      };
```

- [ ] **Step 3: Apply the identical pattern to `server.js:1719-1733`**

Same replacement as Step 2, applied to the resumeSession block (the `quizData.questions` map there is byte-for-byte identical to the one in Step 2).

- [ ] **Step 4: Verify by starting a room with a short-answer question**

This can't be fully verified until Task 11 (Question Editor UI) exists to create a short-answer question. Defer full verification to Task 11's Step 4, but confirm now that the file has no syntax errors:

Run: `cd app && node --check server.js`
Expected: no output (success).
Run: `cd app && node --check src/services/quiz.service.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add app/src/services/quiz.service.js app/server.js
git commit -m "feat: include acceptedAnswers in room quizData for short-answer questions"
```

---

### Task 4: Live multiplayer answer submission — grade short-answer submissions

**Files:**
- Modify: `app/server.js:2377-2503` (`submitAnswer` socket handler)
- Modify: `app/server.js:2506-2537` (`revealAnswer` socket handler)
- Modify: `app/server.js:2266-2300` (`answerHistoryRestored` on join/reconnect)

**Interfaces:**
- Consumes: `matchShortAnswer` from `app/src/utils/similarity.js` (Task 2), `question.acceptedAnswers` (Task 3), `quizOptions.shortAnswerMatchThreshold` (added in Task 6 — until Task 6 lands, hardcode `0.85` here and revisit).
- Produces: `player.choice` and `player.answers[questionIndex]` hold a `string` for `short_answer` questions (the raw typed text) instead of a `number` index. `player.correctAnswerIds` (new, keyed by question index) records the matched accepted-answer id for traceability — not required by any other task, but cheap to add for future debugging.

- [ ] **Step 1: Add the import**

At the top of `server.js`, find the existing imports and add (check what's already imported from `similarity.js` first — the duplicate-detection code already imports some functions from it, so extend that import rather than adding a second one):

```js
import { matchShortAnswer } from './src/utils/similarity.js';
```

(If `similarity.js` is already imported under a different name/path alias, extend that existing import line with `, matchShortAnswer` instead of adding a new line.)

- [ ] **Step 2: Branch `submitAnswer` on question type**

In `server.js:2418-2470` inside the `if (room.players[socket.id])` block, after the "already answered" guard (line 2436-2443) and before `player.choice = choice;` (line 2445), the assignment stays the same — `choice` is already whatever the client sent (number for MC/TF, string for short_answer), so no change needed to the assignment itself. The correctness check that reads `player.choice` happens later in `revealAnswer`, not here — `submitAnswer` only records the raw answer, it does not grade it. Confirm this by re-reading lines 2445-2470: there is no `correctChoice` comparison in `submitAnswer` today. **No code change needed in `submitAnswer` itself** — leave it as-is. Skip to Step 3.

- [ ] **Step 3: Branch `revealAnswer` grading on question type**

Replace `server.js:2521-2527`:
```js
    const results = Object.values(room.players)
      .filter(p => !p.isSpectator)
      .map(p => ({
        name: p.name,
        choice: p.choice,
        is_correct: p.choice === question.correctChoice
      }));
```
with:
```js
    const results = Object.values(room.players)
      .filter(p => !p.isSpectator)
      .map(p => {
        if (question.type === 'short_answer') {
          const threshold = quizOptions.shortAnswerMatchThreshold ?? 0.85;
          const match = matchShortAnswer(p.choice, question.acceptedAnswers || [], threshold);
          return { name: p.name, choice: p.choice, is_correct: match.isCorrect };
        }
        return { name: p.name, choice: p.choice, is_correct: p.choice === question.correctChoice };
      });
```

- [ ] **Step 4: Branch `answerHistoryRestored` on question type**

Replace `server.js:2276-2297`:
```js
      const answerHistory = Object.entries(playerAnswers).map(([questionIndex, choice]) => {
        const idx = parseInt(questionIndex);
        const question = room.quizData.questions[idx];
        const isRevealed = room.revealedQuestions && room.revealedQuestions.includes(idx);
        const isCorrect = isRevealed ? choice === question.correctChoice : null;

        const historyItem = {
          questionIndex: idx,
          choice,
          isRevealed,
          text: question.text,
          choices: question.choices
        };

        // Only include correctChoice and isCorrect for revealed questions
        if (isRevealed) {
          historyItem.correctChoice = question.correctChoice;
          historyItem.isCorrect = isCorrect;
        }

        return historyItem;
      });
```
with:
```js
      const answerHistory = Object.entries(playerAnswers).map(([questionIndex, choice]) => {
        const idx = parseInt(questionIndex);
        const question = room.quizData.questions[idx];
        const isRevealed = room.revealedQuestions && room.revealedQuestions.includes(idx);

        let isCorrect = null;
        if (isRevealed) {
          if (question.type === 'short_answer') {
            const threshold = quizOptions.shortAnswerMatchThreshold ?? 0.85;
            isCorrect = matchShortAnswer(choice, question.acceptedAnswers || [], threshold).isCorrect;
          } else {
            isCorrect = choice === question.correctChoice;
          }
        }

        const historyItem = {
          questionIndex: idx,
          choice,
          isRevealed,
          text: question.text,
          choices: question.choices
        };

        // Only include correctChoice and isCorrect for revealed questions
        if (isRevealed) {
          historyItem.correctChoice = question.correctChoice;
          historyItem.isCorrect = isCorrect;
        }

        return historyItem;
      });
```

- [ ] **Step 5: Syntax check**

Run: `cd app && node --check server.js`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add app/server.js
git commit -m "feat: grade short-answer submissions in live multiplayer reveal and history restore"
```

---

### Task 5: Live multiplayer — player/room progress REST endpoints

**Files:**
- Modify: `app/server.js:742-805` (`/api/player/progress/:roomCode`)
- Modify: `app/server.js:808-867` (`/api/room/progress/:roomCode`)

**Interfaces:**
- Consumes: `matchShortAnswer` (already imported in Task 4), `quizOptions.shortAnswerMatchThreshold`.

- [ ] **Step 1: Branch the per-player progress endpoint**

Replace `server.js:782-786`:
```js
      // Determine if answer was correct (only if revealed)
      let isCorrect = false;
      if (wasRevealed && playerChoice !== null) {
        isCorrect = playerChoice === question.correctChoice;
      }
```
with:
```js
      // Determine if answer was correct (only if revealed)
      let isCorrect = false;
      if (wasRevealed && playerChoice !== null) {
        if (question.type === 'short_answer') {
          const threshold = quizOptions.shortAnswerMatchThreshold ?? 0.85;
          isCorrect = matchShortAnswer(playerChoice, question.acceptedAnswers || [], threshold).isCorrect;
        } else {
          isCorrect = playerChoice === question.correctChoice;
        }
      }
```

- [ ] **Step 2: Branch the room-wide progress endpoint**

Replace `server.js:826-840`:
```js
        if (room.revealedQuestions && Array.isArray(room.revealedQuestions)) {
          room.revealedQuestions.forEach(questionIndex => {
            const question = room.quizData.questions[questionIndex];
            const playerChoice = player.answers && player.answers[questionIndex] !== undefined
              ? player.answers[questionIndex]
              : null;

            if (playerChoice !== null) {
              answeredCount++;
              if (playerChoice === question.correctChoice) {
                correctCount++;
              }
            }
          });
        }
```
with:
```js
        if (room.revealedQuestions && Array.isArray(room.revealedQuestions)) {
          room.revealedQuestions.forEach(questionIndex => {
            const question = room.quizData.questions[questionIndex];
            const playerChoice = player.answers && player.answers[questionIndex] !== undefined
              ? player.answers[questionIndex]
              : null;

            if (playerChoice !== null) {
              answeredCount++;
              const threshold = quizOptions.shortAnswerMatchThreshold ?? 0.85;
              const isCorrect = question.type === 'short_answer'
                ? matchShortAnswer(playerChoice, question.acceptedAnswers || [], threshold).isCorrect
                : playerChoice === question.correctChoice;
              if (isCorrect) {
                correctCount++;
              }
            }
          });
        }
```

- [ ] **Step 3: Syntax check and commit**

Run: `cd app && node --check server.js`
Expected: no output (success).

```bash
git add app/server.js
git commit -m "feat: grade short-answer submissions in progress REST endpoints"
```

---

### Task 6: Global settings — match threshold in Admin > Quiz Options

**Files:**
- Modify: `app/server.js:521-607` (`GET`/`POST /api/options`)
- Modify: `app/server.js:883` (`quizOptions` default object) and `app/server.js:899-912` (`loadQuizOptions`)
- Modify: `app/src/components/admin/QuizOptionsPanel.vue`
- Modify: `app/src/pages/AdminPage.vue` (options tab wiring, ~line 122-128 and ~1545-1569)

**Interfaces:**
- Produces: `quizOptions.shortAnswerMatchThreshold` (number, 0-1) available in `server.js` for the grading branches added in Tasks 4-5 (replace the `?? 0.85` fallbacks used there once this lands — see Step 6).

- [ ] **Step 1: Extend `GET /api/options`**

Replace `server.js:521-550`:
```js
app.get('/api/options', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('answer_display_time', 'default_question_timer', 'default_reveal_delay', 'server_url')`
    );

    // Build options object from results
    const settings = {};
    for (const row of result.rows) {
      if (row.setting_key === 'server_url') {
        settings[row.setting_key] = row.setting_value;
      } else {
        settings[row.setting_key] = parseInt(row.setting_value);
      }
    }

    res.json({
      answerDisplayTime: settings.answer_display_time || 30,
      defaultQuestionTimer: settings.default_question_timer || 30,
      defaultRevealDelay: settings.default_reveal_delay || 5,
      serverUrl: settings.server_url || '',
      detectedIp: LOCAL_IP,
      activeServerUrl: getServerUrl(),
    });
  } catch (err) {
    console.error('Error fetching options:', err);
    res.json({ answerDisplayTime: 30, defaultQuestionTimer: 30, defaultRevealDelay: 5 }); // Return defaults on error
  }
});
```
with:
```js
app.get('/api/options', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('answer_display_time', 'default_question_timer', 'default_reveal_delay', 'server_url', 'short_answer_match_threshold')`
    );

    // Build options object from results
    const settings = {};
    for (const row of result.rows) {
      if (row.setting_key === 'server_url') {
        settings[row.setting_key] = row.setting_value;
      } else if (row.setting_key === 'short_answer_match_threshold') {
        settings[row.setting_key] = parseFloat(row.setting_value);
      } else {
        settings[row.setting_key] = parseInt(row.setting_value);
      }
    }

    res.json({
      answerDisplayTime: settings.answer_display_time || 30,
      defaultQuestionTimer: settings.default_question_timer || 30,
      defaultRevealDelay: settings.default_reveal_delay || 5,
      serverUrl: settings.server_url || '',
      shortAnswerMatchThreshold: settings.short_answer_match_threshold ?? 0.85,
      detectedIp: LOCAL_IP,
      activeServerUrl: getServerUrl(),
    });
  } catch (err) {
    console.error('Error fetching options:', err);
    res.json({ answerDisplayTime: 30, defaultQuestionTimer: 30, defaultRevealDelay: 5, shortAnswerMatchThreshold: 0.85 }); // Return defaults on error
  }
});
```

- [ ] **Step 2: Extend `POST /api/options`**

In `server.js:553-563`, add after the `defaultRevealDelay` validation block:
```js
    if (shortAnswerMatchThreshold !== undefined && (shortAnswerMatchThreshold < 0.5 || shortAnswerMatchThreshold > 1)) {
      return res.status(400).json({ error: 'Short answer match threshold must be between 0.5 and 1' });
    }
```
and update the destructure on line 555 from:
```js
    const { answerDisplayTime, defaultQuestionTimer, defaultRevealDelay, serverUrl } = req.body;
```
to:
```js
    const { answerDisplayTime, defaultQuestionTimer, defaultRevealDelay, serverUrl, shortAnswerMatchThreshold } = req.body;
```

In `server.js:576-588`, add after the `serverUrl` block:
```js
    if (shortAnswerMatchThreshold !== undefined) {
      settingsToUpdate.push({ key: 'short_answer_match_threshold', value: shortAnswerMatchThreshold, desc: 'Minimum similarity (0-1) for auto-grading open-ended answers' });
    }
```

- [ ] **Step 3: Extend the in-memory `quizOptions` cache**

Replace `server.js:883`:
```js
let quizOptions = { answerDisplayTime: 30, serverUrl: '' }; // Default options
```
with:
```js
let quizOptions = { answerDisplayTime: 30, serverUrl: '', shortAnswerMatchThreshold: 0.85 }; // Default options
```

Find `loadQuizOptions` (referenced at `server.js:600`, defined around line 899-912 per the earlier grep of `answer_display_time`). Read that function first, then extend its `WHERE setting_key IN (...)` list to include `'short_answer_match_threshold'` and add a branch:
```js
        if (row.setting_key === 'short_answer_match_threshold') {
          quizOptions.shortAnswerMatchThreshold = parseFloat(row.setting_value);
        }
```
matching the existing `if (row.setting_key === 'answer_display_time')` branch's structure exactly.

- [ ] **Step 4: Replace the `?? 0.85` fallbacks from Tasks 4-5 with the loaded value**

The three call sites added in Task 4 (`server.js` revealAnswer, answerHistoryRestored) and Task 5 (both progress endpoints) already read `quizOptions.shortAnswerMatchThreshold ?? 0.85`. No code change needed here — this step just confirms those reads now resolve to the admin-configured value once `loadQuizOptions` populates it, instead of always falling back to the hardcoded default.

- [ ] **Step 5: Add the UI control to `QuizOptionsPanel.vue`**

Add a new prop and emit, plus a new options box, following the exact pattern of the existing "Answer Display Timeout" box (`app/src/components/admin/QuizOptionsPanel.vue:6-22`):

```html
      <h3>Short Answer Match Threshold</h3>
      <p class="option-description">
        How closely a player's typed answer must match an accepted answer to be graded correct
        (higher = stricter). Applies to Open-Ended / Short Answer questions.
      </p>

      <div class="timeout-input-wrapper">
        <input
          :value="shortAnswerMatchThreshold"
          @input="$emit('update:shortAnswerMatchThreshold', Number($event.target.value))"
          type="number"
          min="0.5"
          max="1"
          step="0.05"
        />
        <span>(0.5 - 1.0)</span>
      </div>
```
placed inside `.options-box` after the existing quick-buttons block (line 29) and before the shared `<button @click="$emit('saveOptions')">` (line 31) — both settings share one Save button.

Update the `defineProps`/`defineEmits` block (lines 41-47):
```js
defineProps({
  answerDisplayTime: { type: Number, required: true },
  shortAnswerMatchThreshold: { type: Number, required: true },
  saveMessage: { type: String, default: '' },
  saveMessageType: { type: String, default: 'success' }
});

defineEmits(['update:answerDisplayTime', 'update:shortAnswerMatchThreshold', 'setQuickTimeout', 'saveOptions']);
```

- [ ] **Step 6: Wire it up in `AdminPage.vue`**

Add a new ref near `const answerDisplayTime = ref(30)` (line 580):
```js
const shortAnswerMatchThreshold = ref(0.85)
```

Update the template usage (lines 122-128):
```html
        <QuizOptionsPanel
          v-model:answerDisplayTime="answerDisplayTime"
          v-model:shortAnswerMatchThreshold="shortAnswerMatchThreshold"
          :saveMessage="optionsSaveMessage"
          :saveMessageType="optionsSaveMessageType"
          @setQuickTimeout="setQuickTimeout"
          @saveOptions="saveQuizOptions"
        />
```

Update `loadOptions` (line 1546-1553):
```js
const loadOptions = async () => {
  try {
    const response = await get('/api/options')
    answerDisplayTime.value = response.data.answerDisplayTime || 30
    shortAnswerMatchThreshold.value = response.data.shortAnswerMatchThreshold ?? 0.85
  } catch (err) {
    console.error('Error loading options:', err)
  }
}
```

Update `saveQuizOptions` (line 1559-1569):
```js
const saveQuizOptions = async () => {
  try {
    await post('/api/options', { answerDisplayTime: answerDisplayTime.value, shortAnswerMatchThreshold: shortAnswerMatchThreshold.value })
    optionsSaveMessage.value = 'Options saved successfully'
    optionsSaveMessageType.value = 'success'
    setTimeout(() => { optionsSaveMessage.value = '' }, 3000)
  } catch (err) {
    optionsSaveMessage.value = 'Error saving options: ' + err.message
    optionsSaveMessageType.value = 'error'
  }
}
```

- [ ] **Step 7: Manual verification**

Run: `docker compose up -d` then open Admin > Quiz Options tab in the browser.
Expected: a new "Short Answer Match Threshold" box showing `0.85`, editable, saves without error, and reloading the page shows the saved value persisted (confirms round-trip through `app_settings`).

- [ ] **Step 8: Commit**

```bash
git add app/server.js app/src/components/admin/QuizOptionsPanel.vue app/src/pages/AdminPage.vue
git commit -m "feat: add admin-configurable short-answer match threshold setting"
```

---

### Task 7: Solo play — grade short-answer submissions

**Files:**
- Modify: `app/src/controllers/solo.controller.js`

**Interfaces:**
- Consumes: `matchShortAnswer` from `app/src/utils/similarity.js` (Task 2).
- Produces: `submitSoloAnswer` accepts `answerText` (string) in the request body alongside the existing `answerIndex` (number) — the client sends whichever is relevant to the question type.

- [ ] **Step 1: Add the import**

At the top of `solo.controller.js`, add:
```js
import { matchShortAnswer } from '../utils/similarity.js';
```

- [ ] **Step 2: Branch `submitSoloAnswer` on question type**

Replace `solo.controller.js:298-376` (the whole function body from the JSDoc through the `INSERT INTO participant_answers` call) with:

```js
/**
 * Submit an answer for the current question
 * Body: { questionId, answerIndex, answerText, participantId }
 * Returns: { isCorrect, correctChoice, nextQuestion }
 */
export async function submitSoloAnswer(req, res, next) {
  const { id: sessionId } = req.params;
  const { questionId, answerIndex, answerText, participantId } = req.body;

  if (questionId === undefined || !participantId || (answerIndex === undefined && answerText === undefined)) {
    return next(new BadRequestError('questionId, participantId, and either answerIndex or answerText are required'));
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Verify session exists and is in progress
    const sessionResult = await client.query(
      `SELECT gs.id, gs.quiz_id, gs.status
       FROM game_sessions gs
       WHERE gs.id = $1 AND gs.session_type = 'solo'`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new NotFoundError('Solo session not found');
    }

    const session = sessionResult.rows[0];

    if (session.status === 'completed') {
      await client.query('ROLLBACK');
      throw new BadRequestError('Session is already completed');
    }

    // Verify participant belongs to this session
    const participantCheck = await client.query(
      `SELECT id FROM game_participants WHERE id = $1 AND game_session_id = $2`,
      [participantId, sessionId]
    );

    if (participantCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new BadRequestError('Invalid participant');
    }

    // Check if already answered this question
    const existingAnswer = await client.query(
      `SELECT id FROM participant_answers WHERE participant_id = $1 AND question_id = $2`,
      [participantId, questionId]
    );

    if (existingAnswer.rows.length > 0) {
      await client.query('ROLLBACK');
      throw new BadRequestError('Question already answered');
    }

    // Look up question type
    const questionTypeResult = await client.query(
      `SELECT question_type FROM questions WHERE id = $1`,
      [questionId]
    );
    if (questionTypeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new BadRequestError('Question not found');
    }
    const questionType = questionTypeResult.rows[0].question_type;

    let isCorrect;
    let correctChoice = null;

    if (questionType === 'short_answer') {
      const acceptedAnswersResult = await client.query(
        `SELECT id, answer_text FROM answers WHERE question_id = $1`,
        [questionId]
      );
      const thresholdResult = await client.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'short_answer_match_threshold'`
      );
      const threshold = thresholdResult.rows.length > 0 ? parseFloat(thresholdResult.rows[0].setting_value) : 0.85;

      const match = matchShortAnswer(answerText, acceptedAnswersResult.rows, threshold);
      isCorrect = match.isCorrect;

      // Record the answer — answer_id is the matched accepted answer if any, else NULL; answer_text always holds the raw submission
      await client.query(
        `INSERT INTO participant_answers (participant_id, question_id, answer_id, answer_text, is_correct, answered_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [participantId, questionId, match.matchedAnswerId, answerText, isCorrect]
      );
    } else {
      // Get correct answer for this question
      const correctAnswerResult = await client.query(
        `SELECT a.display_order
         FROM answers a
         WHERE a.question_id = $1 AND a.is_correct = TRUE`,
        [questionId]
      );

      if (correctAnswerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new BadRequestError('Question not found');
      }

      correctChoice = correctAnswerResult.rows[0].display_order;
      isCorrect = answerIndex === correctChoice;

      // Record the answer
      await client.query(
        `INSERT INTO participant_answers (participant_id, question_id, answer_id, is_correct, answered_at)
         SELECT $1, $2, a.id, $3, NOW()
         FROM answers a
         WHERE a.question_id = $2 AND a.display_order = $4`,
        [participantId, questionId, isCorrect, answerIndex]
      );
    }
```

The remainder of the function (marking `session_questions` presented/revealed, updating `game_participants.score`, fetching the next question, fetching correct-answer text, committing, and the response body) stays exactly as it is today at `solo.controller.js:378-452` — those lines don't reference `answerIndex`/`correctChoice` in a way that breaks for short-answer, since `isCorrect` is now computed correctly above regardless of type. Re-read lines 378-452 after this edit to confirm the closing brace of the new `if/else` block lines up correctly before that code (the `if (isCorrect) { ... }` score-update block on line 387 should immediately follow the closing `}` of the type branch you just added).

- [ ] **Step 3: Branch `getSoloResults` for short-answer display**

In `solo.controller.js:547-575`, the `answersResult` query joins `a_correct` on `is_correct = TRUE`, which for `short_answer` questions returns an arbitrary accepted-answer row (since all of them have `is_correct = TRUE`) rather than "the" correct answer — that's fine for display purposes (it'll show one valid accepted answer as an example), but `selected_answer`/`selected_index` come from `a_selected` joined via `pa.answer_id`, which is `NULL` for unmatched short-answer submissions. Add a `pa.answer_text` column to the query and prefer it for display:

Replace `solo.controller.js:547-563`:
```js
      const answersResult = await client.query(
        `SELECT
          qq.question_order,
          qs.question_text,
          pa.is_correct,
          a_selected.answer_text as selected_answer,
          a_selected.display_order as selected_index,
          a_correct.answer_text as correct_answer,
          a_correct.display_order as correct_index
         FROM quiz_questions qq
         JOIN questions qs ON qq.question_id = qs.id
         LEFT JOIN participant_answers pa ON pa.question_id = qs.id AND pa.participant_id = $1
         LEFT JOIN answers a_selected ON pa.answer_id = a_selected.id
         JOIN answers a_correct ON a_correct.question_id = qs.id AND a_correct.is_correct = TRUE
         WHERE qq.quiz_id = $2
         ORDER BY qq.question_order`,
        [participant.id, session.quiz_id]
      );

      const questions = answersResult.rows.map((row, idx) => ({
        index: idx,
        text: row.question_text,
        answered: row.selected_answer !== null,
        isCorrect: row.is_correct || false,
        selectedAnswer: row.selected_answer,
        selectedIndex: row.selected_index,
        correctAnswer: row.correct_answer,
        correctIndex: row.correct_index
      }));
```
with:
```js
      const answersResult = await client.query(
        `SELECT
          qq.question_order,
          qs.question_text,
          qs.question_type,
          pa.is_correct,
          pa.answer_text as submitted_text,
          a_selected.answer_text as selected_answer,
          a_selected.display_order as selected_index,
          a_correct.answer_text as correct_answer,
          a_correct.display_order as correct_index
         FROM quiz_questions qq
         JOIN questions qs ON qq.question_id = qs.id
         LEFT JOIN participant_answers pa ON pa.question_id = qs.id AND pa.participant_id = $1
         LEFT JOIN answers a_selected ON pa.answer_id = a_selected.id
         JOIN answers a_correct ON a_correct.question_id = qs.id AND a_correct.is_correct = TRUE
         WHERE qq.quiz_id = $2
         ORDER BY qq.question_order`,
        [participant.id, session.quiz_id]
      );

      const questions = answersResult.rows.map((row, idx) => {
        const isShortAnswer = row.question_type === 'short_answer';
        const selectedAnswer = isShortAnswer ? row.submitted_text : row.selected_answer;
        return {
          index: idx,
          text: row.question_text,
          type: row.question_type,
          answered: selectedAnswer !== null,
          isCorrect: row.is_correct || false,
          selectedAnswer,
          selectedIndex: row.selected_index,
          correctAnswer: row.correct_answer,
          correctIndex: row.correct_index
        };
      });
```

- [ ] **Step 4: Syntax check**

Run: `cd app && node --check src/controllers/solo.controller.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add app/src/controllers/solo.controller.js
git commit -m "feat: grade short-answer submissions in solo play"
```

---

### Task 8: Question creation/update/import — accepted answers are all correct

**Files:**
- Modify: `app/src/controllers/quiz.controller.js:260-266` (createQuiz)
- Modify: `app/src/controllers/quiz.controller.js:437-443` (updateQuiz)
- Modify: `app/src/controllers/quiz.controller.js:919-925` (bulk import)

**Interfaces:**
- Consumes: `questionType` (already computed at each call site, e.g. `const questionType = q.type || 'multiple_choice';`).

- [ ] **Step 1: Fix the createQuiz answers-insert loop**

Replace `quiz.controller.js:260-266`:
```js
      // Insert answers
      for (let j = 0; j < (q.choices || []).length; j++) {
        const isCorrect = j === q.correctChoice;
        await client.query(
          'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
          [questionId, q.choices[j], isCorrect, j]
        );
      }
```
with:
```js
      // Insert answers — for short_answer questions every entry is an accepted answer, so all are "correct"
      for (let j = 0; j < (q.choices || []).length; j++) {
        const isCorrect = questionType === 'short_answer' ? true : j === q.correctChoice;
        await client.query(
          'INSERT INTO answers (question_id, answer_text, is_correct, display_order) VALUES ($1, $2, $3, $4)',
          [questionId, q.choices[j], isCorrect, j]
        );
      }
```

- [ ] **Step 2: Apply the identical fix to updateQuiz**

Same replacement, applied to `quiz.controller.js:437-443` (identical code, `questionType` is in scope from line 421 in that function).

- [ ] **Step 3: Apply the identical fix to the bulk import loop**

Same replacement, applied to `quiz.controller.js:919-925` (identical code, `questionType` is in scope from line 905 in that function).

- [ ] **Step 4: Syntax check**

Run: `cd app && node --check src/controllers/quiz.controller.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add app/src/controllers/quiz.controller.js
git commit -m "feat: mark all accepted answers as correct when creating/updating/importing short-answer questions"
```

---

### Task 9: Admin — Question Editor UI for short-answer questions

**Files:**
- Modify: `app/src/components/admin/QuestionEditor.vue`

**Interfaces:**
- Consumes: existing `questionType`, `choices`, `correctChoice` props and `updateChoice`/`addChoice`/`removeChoice`/`saveQuestion` emits — no new props/emits needed, this task only changes template rendering and labels based on `questionType === 'short_answer'`.

- [ ] **Step 1: Add the dropdown option**

In `QuestionEditor.vue:15-16`, add a third `<option>`:
```html
        <option value="multiple_choice">Multiple Choice</option>
        <option value="true_false">True / False</option>
        <option value="short_answer">Open-Ended / Short Answer</option>
```

- [ ] **Step 2: Relabel the choices section for short-answer questions**

Replace `QuestionEditor.vue:92-99`:
```html
    <div class="choices-header">
      <h3>Choices</h3>
      <div class="choice-buttons" v-if="questionType !== 'true_false'">
        <button @click="$emit('addChoice')" class="btn-add">+ Add</button>
        <button @click="$emit('removeChoice')" class="btn-remove">- Remove</button>
      </div>
      <span v-else class="true-false-hint">Fixed choices for True/False</span>
    </div>
```
with:
```html
    <div class="choices-header">
      <h3>{{ questionType === 'short_answer' ? 'Accepted Answers' : 'Choices' }}</h3>
      <div class="choice-buttons" v-if="questionType !== 'true_false'">
        <button @click="$emit('addChoice')" class="btn-add">+ Add</button>
        <button @click="$emit('removeChoice')" class="btn-remove">- Remove</button>
      </div>
      <span v-else class="true-false-hint">Fixed choices for True/False</span>
    </div>
    <p v-if="questionType === 'short_answer'" class="short-answer-hint">
      List every acceptable answer or common variation (e.g. "Paris", "City of Light").
    </p>
```

- [ ] **Step 3: Adjust the choice input placeholder for short-answer mode**

In `QuestionEditor.vue:127-134`, change the `:placeholder` binding:
```html
        <input
          :value="choice"
          @input="$emit('updateChoice', idx, $event.target.value)"
          type="text"
          :placeholder="questionType === 'short_answer' ? `Accepted answer ${idx + 1}` : `Choice ${idx + 1}`"
          :readonly="questionType === 'true_false'"
          :class="{ 'readonly': questionType === 'true_false' }"
        />
```

- [ ] **Step 4: Hide the "Correct Answer" dropdown for short-answer questions**

Replace `QuestionEditor.vue:138-148`:
```html
    <div class="correct-choice-wrapper">
      <label for="correctChoice">Correct Answer:</label>
      <select
        :value="correctChoice"
        @change="$emit('update:correctChoice', Number($event.target.value))"
      >
        <option v-for="(choice, idx) in choices" :key="idx" :value="idx">
          {{ choice || `Choice ${idx + 1}` }}
        </option>
      </select>
    </div>
```
with:
```html
    <div class="correct-choice-wrapper" v-if="questionType !== 'short_answer'">
      <label for="correctChoice">Correct Answer:</label>
      <select
        :value="correctChoice"
        @change="$emit('update:correctChoice', Number($event.target.value))"
      >
        <option v-for="(choice, idx) in choices" :key="idx" :value="idx">
          {{ choice || `Choice ${idx + 1}` }}
        </option>
      </select>
    </div>
```

(There is no "every entry is correct" toggle needed per the approved design — the absence of the dropdown for this type communicates that all entries count, backed by the hint text added in Step 2.)

- [ ] **Step 5: Add the hint text style**

Add to the `<style scoped>` block, near `.true-false-hint` (`QuestionEditor.vue:348-352`):
```css
.short-answer-hint {
  margin: 0 0 0.5rem 0;
  color: var(--text-tertiary);
  font-size: 0.85rem;
  font-style: italic;
}
```

- [ ] **Step 6: Manual verification**

Run the dev server, go to Admin > Question Bank (or wherever `QuestionEditor` is mounted — check `AdminPage.vue` for the parent), select "Open-Ended / Short Answer" from the type dropdown.
Expected: choices section relabels to "Accepted Answers" with the hint text, "Correct Answer" dropdown disappears, "+ Add"/"- Remove" buttons still work, saving a question with at least one accepted answer succeeds (confirms Task 8's insert path).

- [ ] **Step 7: Commit**

```bash
git add app/src/components/admin/QuestionEditor.vue
git commit -m "feat: add Open-Ended/Short Answer type to Question Editor"
```

---

### Task 10: Player — free-text input and confirm modal

**Files:**
- Modify: `app/src/components/modals/AnswerConfirmModal.vue`
- Modify: `app/src/components/player/QuestionDisplay.vue`
- Modify: `app/src/pages/PlayerPage.vue`

**Interfaces:**
- Produces: `QuestionDisplay` emits `selectAnswer` with either a `number` (MC/TF choice index, unchanged) or a `string` (short-answer typed text); `AnswerConfirmModal` gains a `isFreeText` prop so it renders the raw text instead of indexing into `choices`.

- [ ] **Step 1: Generalize `AnswerConfirmModal.vue` for free text**

Replace the `props` and `answerText`/`answerLetter` computed properties (`AnswerConfirmModal.vue:38-65`):
```js
const props = defineProps({
  /** Whether the modal is open */
  isOpen: {
    type: Boolean,
    required: true
  },
  /** Index of the selected answer (0-based) — ignored when isFreeText is true */
  selectedIndex: {
    type: Number,
    default: null
  },
  /** Array of answer choice texts — ignored when isFreeText is true */
  choices: {
    type: Array,
    default: () => []
  },
  /** When true, selectedText is shown verbatim instead of indexing into choices */
  isFreeText: {
    type: Boolean,
    default: false
  },
  /** The player's typed text — only used when isFreeText is true */
  selectedText: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['confirm', 'cancel']);

// Computed properties for display
const answerLetter = computed(() => {
  return String.fromCharCode(65 + props.selectedIndex); // A, B, C, D
});

const answerText = computed(() => {
  return props.isFreeText ? props.selectedText : (props.choices[props.selectedIndex] || '');
});
```

Update the template (`AnswerConfirmModal.vue:4-9`):
```html
        <p class="selection-label">You {{ isFreeText ? 'typed' : 'selected' }}:</p>
        <div class="selected-answer-display">
          <strong v-if="!isFreeText" class="answer-letter">{{ answerLetter }}.</strong>
          <span class="answer-text">{{ answerText }}</span>
        </div>
```

- [ ] **Step 2: Add the short-answer input layout to `QuestionDisplay.vue`**

Replace `QuestionDisplay.vue:24-62` (the `v-if="isTrueFalse"` / `v-else` choice blocks) by adding a third branch before them:

```html
    <!-- Short Answer Question Layout -->
    <div v-if="currentQuestion?.type === 'short_answer'" class="short-answer-container">
      <input
        v-model="shortAnswerText"
        type="text"
        maxlength="100"
        class="short-answer-input"
        placeholder="Type your answer..."
        :disabled="answeredCurrentQuestion || answerRevealed"
        @keyup.enter="submitShortAnswer"
      />
      <button
        class="short-answer-submit"
        :disabled="answeredCurrentQuestion || answerRevealed || !shortAnswerText.trim()"
        @click="submitShortAnswer"
      >
        Submit Answer
      </button>
    </div>

    <!-- True/False Question Layout -->
    <div v-else-if="isTrueFalse" class="true-false-container">
```
(the rest of the True/False block is unchanged — just change its `v-if` to `v-else-if` since it now follows the new short-answer branch)

And change `QuestionDisplay.vue:46`'s multiple-choice block from `<div v-else class="choices-container">` to `<div v-else-if="!isTrueFalse" class="choices-container">` (it was already the fallback `v-else` after true/false; now it needs to explicitly exclude short-answer too since there are three branches).

Update the reveal feedback block (`QuestionDisplay.vue:64-68`) to handle short-answer (no single `correctChoice` index to read):
```html
    <div v-if="answerRevealed" class="answer-feedback" :class="{ correct: playerGotCorrect, incorrect: !playerGotCorrect }">
      <span v-if="playerGotCorrect"><AppIcon name="check" size="md" /> Correct!</span>
      <span v-else><AppIcon name="x" size="md" /> Incorrect.</span>
      <template v-if="currentQuestion?.type === 'short_answer'">
        Accepted answers: <strong>{{ (currentQuestion?.acceptedAnswers || []).map(a => a.answer_text).join(', ') }}</strong>
      </template>
      <template v-else>
        The correct answer was: <strong>{{ currentQuestion?.choices[currentQuestion?.correctChoice] }}</strong>
      </template>
    </div>
```

- [ ] **Step 3: Add `shortAnswerText` state, submit handler, and timeout auto-submit**

There are two distinct ways an answer leaves this component: a manual submit (goes through `PlayerPage`'s confirm modal, same as MC/TF today) and a timeout auto-submit (per the approved design, bypasses the confirm modal entirely and pushes whatever text is currently typed). These need two separate emitted events so `PlayerPage` can route them differently — reusing `selectAnswer` for both would conflate "player wants to review before submitting" with "time's up, submit now."

In the `<script setup>` block of `QuestionDisplay.vue`, add after the existing `isTrueFalse` computed (`QuestionDisplay.vue:92-98`):
```js
const shortAnswerText = ref('');

// Clear the input whenever a new question comes in
watch(() => props.currentQuestion?.id, () => {
  shortAnswerText.value = '';
});

const submitShortAnswer = () => {
  if (props.answeredCurrentQuestion || props.answerRevealed || !shortAnswerText.value.trim()) return;
  emit('selectAnswer', shortAnswerText.value.trim());
};

// Timeout auto-submit bypasses the confirm modal entirely — push whatever text is
// currently typed (including empty) straight through via a separate event.
const handleTimerExpired = () => {
  if (props.currentQuestion?.type === 'short_answer' && !props.answeredCurrentQuestion && !props.answerRevealed) {
    emit('autoSubmitAnswer', shortAnswerText.value.trim());
  }
};
```
Add `ref` and `watch` to the existing `import { computed } from 'vue';` line, making it `import { computed, ref, watch } from 'vue';`.

Update `defineEmits(['selectAnswer'])` (`QuestionDisplay.vue:90`) to `defineEmits(['selectAnswer', 'autoSubmitAnswer']);`.

Wire the timer's `expired` event in the template (`QuestionDisplay.vue:4-10`):
```html
    <CountdownTimer
      v-if="autoMode && timerDuration && timerStartedAt && !answerRevealed"
      :startedAt="timerStartedAt"
      :duration="timerDuration"
      :active="!answerRevealed"
      :paused="timerPaused"
      @expired="handleTimerExpired"
    />
```

- [ ] **Step 4: Add short-answer input styles**

Add to the `<style scoped>` block, near `.choices-container` (`QuestionDisplay.vue:144-150`):
```css
.short-answer-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
  box-sizing: border-box;
}

.short-answer-input {
  padding: 1rem 1.25rem;
  font-size: 1.1rem;
  background: var(--bg-overlay-20);
  border: 3px solid var(--border-color);
  border-radius: 15px;
  color: var(--text-primary);
  box-sizing: border-box;
}

.short-answer-input:focus {
  border-color: var(--info-light);
  outline: none;
}

.short-answer-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.short-answer-submit {
  padding: 1rem;
  font-size: 1.1rem;
  font-weight: bold;
  background: var(--primary-bg-40);
  border: 1px solid var(--primary-light);
  border-radius: 15px;
  color: var(--info-light);
  cursor: pointer;
  transition: all 0.2s;
}

.short-answer-submit:hover:not(:disabled) {
  background: var(--primary-bg-60);
}

.short-answer-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 5: Update `PlayerPage.vue`'s answer flow for text answers**

Replace `selectAnswer` (`PlayerPage.vue:1173-1193`):
```js
const selectAnswer = async (idx) => {
  if (answeredCurrentQuestion.value || answerRevealed.value) {
    console.log(`[ANSWER] Blocked - already answered (${answeredCurrentQuestion.value}) or revealed (${answerRevealed.value})`)
    return
  }

  // CRITICAL: Block answer submission until joinRoom is fully processed by server
  // This prevents answers from being lost when user reconnects and immediately tries to answer
  if (joinRoomInProgress.value) {
    console.warn('[ANSWER] ❌ BLOCKED - joinRoom still in progress. User will see "Reconnecting..." message')
    statusMessage.value = 'Reconnecting... please wait'
    statusMessageType.value = 'warning'
    return
  }

  console.log(`[ANSWER] Player selected answer ${idx}, showing confirmation modal`)
  // Store the selected answer and show confirmation modal
  pendingAnswerIndex.value = idx
  selectedAnswer.value = idx // Show visual selection
  showAnswerConfirmModal.value = true
}
```
with:
```js
const selectAnswer = async (answer) => {
  if (answeredCurrentQuestion.value || answerRevealed.value) {
    console.log(`[ANSWER] Blocked - already answered (${answeredCurrentQuestion.value}) or revealed (${answerRevealed.value})`)
    return
  }

  // CRITICAL: Block answer submission until joinRoom is fully processed by server
  // This prevents answers from being lost when user reconnects and immediately tries to answer
  if (joinRoomInProgress.value) {
    console.warn('[ANSWER] ❌ BLOCKED - joinRoom still in progress. User will see "Reconnecting..." message')
    statusMessage.value = 'Reconnecting... please wait'
    statusMessageType.value = 'warning'
    return
  }

  const isShortAnswer = currentQuestion.value?.type === 'short_answer'
  console.log(`[ANSWER] Player ${isShortAnswer ? 'typed' : 'selected'} answer "${answer}", showing confirmation modal`)
  pendingAnswerIndex.value = answer
  selectedAnswer.value = isShortAnswer ? null : answer // Visual selection only applies to MC/TF choice buttons
  showAnswerConfirmModal.value = true
}
```

This handles the manual-submit path only — `QuestionDisplay` now emits a separate `autoSubmitAnswer` event for the timeout path (Step 3), wired to a new `autoSubmitShortAnswer` function below, so `selectAnswer` never needs to special-case an empty string.

Replace `confirmAnswer` (`PlayerPage.vue:1195-1218`):
```js
const confirmAnswer = () => {
  const idx = pendingAnswerIndex.value
  if (idx === null) return

  console.log(`[ANSWER] ✅ Submitting confirmed answer ${idx} for question ${currentQuestion.value.index}`)
  answeredCurrentQuestion.value = true
  answeredQuestions.add(currentQuestion.value.index)

  // Update history
  const historyItem = questionHistory.value.find(q => q.index === currentQuestion.value.index)
  if (historyItem) {
    historyItem.playerChoice = idx
    // Clear missedWhileAway flag since player actually answered
    historyItem.missedWhileAway = false
  }

  socket.emit('submitAnswer', { roomCode: currentRoomCode.value, choice: idx })
  statusMessage.value = 'Answer submitted! ✓'
  statusMessageType.value = 'success'

  // Close modal and clear pending answer
  showAnswerConfirmModal.value = false
  pendingAnswerIndex.value = null
}
```
with:
```js
const confirmAnswer = () => {
  const answer = pendingAnswerIndex.value
  if (answer === null) return

  console.log(`[ANSWER] ✅ Submitting confirmed answer "${answer}" for question ${currentQuestion.value.index}`)
  answeredCurrentQuestion.value = true
  answeredQuestions.add(currentQuestion.value.index)

  // Update history
  const historyItem = questionHistory.value.find(q => q.index === currentQuestion.value.index)
  if (historyItem) {
    historyItem.playerChoice = answer
    // Clear missedWhileAway flag since player actually answered
    historyItem.missedWhileAway = false
  }

  socket.emit('submitAnswer', { roomCode: currentRoomCode.value, choice: answer })
  statusMessage.value = 'Answer submitted! ✓'
  statusMessageType.value = 'success'

  // Close modal and clear pending answer
  showAnswerConfirmModal.value = false
  pendingAnswerIndex.value = null
}
```

For the timeout path (auto-submit, bypassing the confirm modal per the approved design — including an empty string, which is treated as no answer), add a new function near `confirmAnswer`:
```js
const autoSubmitShortAnswer = (text) => {
  if (answeredCurrentQuestion.value || answerRevealed.value || !currentQuestion.value) return

  console.log(`[ANSWER] ⏱ Timeout auto-submitting "${text}" for question ${currentQuestion.value.index}`)
  answeredCurrentQuestion.value = true
  answeredQuestions.add(currentQuestion.value.index)

  const historyItem = questionHistory.value.find(q => q.index === currentQuestion.value.index)
  if (historyItem) {
    historyItem.playerChoice = text
    historyItem.missedWhileAway = false
  }

  socket.emit('submitAnswer', { roomCode: currentRoomCode.value, choice: text })
  statusMessage.value = text ? 'Answer submitted! ✓' : 'Time expired — no answer submitted'
  statusMessageType.value = text ? 'success' : 'warning'
}
```

Wire the new event next to the existing `@selectAnswer="selectAnswer"` on the `<QuestionDisplay>` mount (`PlayerPage.vue:81`):
```html
          @selectAnswer="selectAnswer"
          @autoSubmitAnswer="autoSubmitShortAnswer"
```

- [ ] **Step 6: Update the `AnswerConfirmModal` usage in `PlayerPage.vue`**

`pendingAnswerIndex` now holds either a `number` (MC/TF) or a `string` (short-answer text), set by `selectAnswer` in Step 5. At `PlayerPage.vue:164-...` where `AnswerConfirmModal` is mounted, add the new props, reading `pendingAnswerIndex` directly for `selectedText` (no conditional needed — it's simply unused when `isFreeText` is false):
```html
    <AnswerConfirmModal
      :isOpen="showAnswerConfirmModal"
      :selectedIndex="pendingAnswerIndex"
      :choices="currentQuestion?.choices || []"
      :isFreeText="currentQuestion?.type === 'short_answer'"
      :selectedText="pendingAnswerIndex"
      @confirm="confirmAnswer"
      @cancel="cancelAnswer"
    />
```
(Read the existing `<AnswerConfirmModal>` block first to preserve whatever props/bindings are already there beyond `isOpen` — grep showed `isOpen`, and the component requires `selectedIndex`/`choices`; add the two new ones alongside without removing existing bindings.)

- [ ] **Step 7: Manual verification**

Start a live room with a short-answer question, join as a player.
Expected: a text input and "Submit Answer" button appear instead of choice buttons; typing and clicking Submit opens the confirm modal showing the typed text (no letter prefix); confirming submits and locks the input; letting the auto-mode timer run out with unsubmitted text auto-submits without showing the confirm modal; reveal shows "Accepted answers: ..." instead of a single correct choice.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/modals/AnswerConfirmModal.vue app/src/components/player/QuestionDisplay.vue app/src/pages/PlayerPage.vue
git commit -m "feat: add free-text answer input, confirm modal, and timeout auto-submit for short-answer questions"
```

---

### Task 11: Presenter — question breakdown for short-answer questions

**Files:**
- Modify: `app/src/components/admin/QuestionBreakdown.vue`

**Interfaces:**
- Consumes: `question.type`, `question.acceptedAnswers` (array of `{id, answer_text}` — same shape produced in Task 3), `player.answers[qIdx]` (a string for short-answer questions).

- [ ] **Step 1: Branch the accepted-answers display**

Replace `QuestionBreakdown.vue:16-25`:
```html
      <div class="question-choices">
        <div
          v-for="(choice, cIdx) in question.choices"
          :key="cIdx"
          :class="['choice-item', { 'choice-correct': cIdx === question.correctChoice }]"
        >
          <strong>{{ String.fromCharCode(65 + cIdx) }}.</strong> {{ choice }}
          <span v-if="cIdx === question.correctChoice" class="correct-indicator"><AppIcon name="check" size="sm" /> Correct</span>
        </div>
      </div>
```
with:
```html
      <div v-if="question.type === 'short_answer'" class="question-choices">
        <div v-for="acc in question.acceptedAnswers" :key="acc.id" class="choice-item choice-correct">
          {{ acc.answer_text }}
          <span class="correct-indicator"><AppIcon name="check" size="sm" /> Accepted</span>
        </div>
      </div>
      <div v-else class="question-choices">
        <div
          v-for="(choice, cIdx) in question.choices"
          :key="cIdx"
          :class="['choice-item', { 'choice-correct': cIdx === question.correctChoice }]"
        >
          <strong>{{ String.fromCharCode(65 + cIdx) }}.</strong> {{ choice }}
          <span v-if="cIdx === question.correctChoice" class="correct-indicator"><AppIcon name="check" size="sm" /> Correct</span>
        </div>
      </div>
```

- [ ] **Step 2: Branch the player-responses grid**

Replace `QuestionBreakdown.vue:31-53`:
```html
        <div v-if="expandedQuestions.has(qIdx)" class="player-responses-grid">
          <div
            v-for="player in playerResults"
            :key="player.name"
            :class="['player-response', {
              'response-correct': player.answers[qIdx] === question.correctChoice,
              'response-incorrect': player.answers[qIdx] !== undefined && player.answers[qIdx] !== question.correctChoice,
              'response-unanswered': player.answers[qIdx] === undefined
            }]"
          >
            <span class="player-name">{{ player.name }}:</span>
            <span class="player-answer">
              <template v-if="player.answers[qIdx] !== undefined">
                {{ String.fromCharCode(65 + player.answers[qIdx]) }}
                <AppIcon v-if="player.answers[qIdx] === question.correctChoice" name="check" size="sm" class="answer-result" />
                <AppIcon v-else name="x" size="sm" class="answer-result" />
              </template>
              <template v-else>
                <em>No answer</em>
              </template>
            </span>
          </div>
        </div>
```
with:
```html
        <div v-if="expandedQuestions.has(qIdx)" class="player-responses-grid">
          <div
            v-for="player in playerResults"
            :key="player.name"
            :class="['player-response', {
              'response-correct': isPlayerCorrect(question, player, player.answers[qIdx]),
              'response-incorrect': player.answers[qIdx] !== undefined && player.answers[qIdx] !== '' && !isPlayerCorrect(question, player, player.answers[qIdx]),
              'response-unanswered': player.answers[qIdx] === undefined || player.answers[qIdx] === ''
            }]"
          >
            <span class="player-name">{{ player.name }}:</span>
            <span class="player-answer">
              <template v-if="player.answers[qIdx] !== undefined && player.answers[qIdx] !== ''">
                <template v-if="question.type === 'short_answer'">
                  {{ player.answers[qIdx] }}
                </template>
                <template v-else>
                  {{ String.fromCharCode(65 + player.answers[qIdx]) }}
                </template>
                <AppIcon v-if="isPlayerCorrect(question, player, player.answers[qIdx])" name="check" size="sm" class="answer-result" />
                <AppIcon v-else name="x" size="sm" class="answer-result" />
              </template>
              <template v-else>
                <em>No answer</em>
              </template>
            </span>
          </div>
        </div>
```

- [ ] **Step 3: Add the `isPlayerCorrect` helper**

This component receives `playerResults` from its parent (`SessionDetailModal.vue`, per the earlier grep results) — the grading for short-answer players must already be computed there (it comes from the session data saved server-side, not recomputed client-side, since `matchShortAnswer` needs the accepted-answers list and threshold that aren't passed into this component). This relies on `question.shortAnswerCorrectness` (a `{ [playerName]: boolean }` map) being part of the session data, which is produced in Task 12 (session save) — until Task 12 lands, this degrades to always showing "incorrect" for short-answer responses (safe, no crash, just inaccurate until both tasks are in).

Add to `<script setup>` (`QuestionBreakdown.vue:63-70`):

```js
import AppIcon from '@/components/common/AppIcon.vue';

defineProps({
  questions: { type: Array, required: true },
  playerResults: { type: Array, required: true },
  presentedQuestions: { type: Array, default: () => [] },
  expandedQuestions: { type: Set, required: true }
});

defineEmits(['toggleQuestion']);

function isPlayerCorrect(question, player, answer) {
  if (answer === undefined || answer === '') return false;
  if (question.type === 'short_answer') {
    return question.shortAnswerCorrectness?.[player.name] === true;
  }
  return answer === question.correctChoice;
}
```

- [ ] **Step 4: Manual verification (after Task 12 lands)**

Open a completed session with a short-answer question in the Session Detail modal, expand "Player Responses".
Expected: each player's typed text is shown with a correct/incorrect checkmark matching what was graded during the game.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/admin/QuestionBreakdown.vue
git commit -m "feat: show typed responses and accepted answers in session question breakdown"
```

---

### Task 12: Session save — persist short-answer correctness for breakdown/export

**Files:**
- Modify: `app/src/services/session.service.js` (`saveSession`, referenced from `TODO.md` v5.9.0 notes and `server.js:2557` — read the function fully before editing, its exact current line range wasn't captured during design research)

**Interfaces:**
- Produces: saved session JSON gains `questions[].shortAnswerCorrectness: {[playerName]: boolean}` for `short_answer` questions, consumed by Task 11's `QuestionBreakdown.vue` and Task 13's export services.

- [ ] **Step 1: Read `session.service.js` in full**

Before editing, read the entire file to find where `questions` and `playerResults` are assembled for the saved session JSON (this is what `QuestionBreakdown.vue`, CSV export, and PDF export all ultimately consume). Confirm the exact shape of `question.choices`/`question.correctChoice` as currently written into the saved session, and where `player.answers` is copied in.

- [ ] **Step 2: Add short-answer correctness computation**

Wherever the saved session's `questions` array is built (mirroring the shape `room.quizData.questions` already has, per Task 3 — `question.type`, `question.acceptedAnswers` should already be present since it's copied from `room.quizData`), add a short-answer branch that computes `shortAnswerCorrectness` from each player's `answers[qIdx]` using `matchShortAnswer` (import from `app/src/utils/similarity.js`), the same way `revealAnswer` does in Task 4. Use the room's `quizOptions`-equivalent threshold if `session.service.js` has access to it, otherwise default to `0.85` (this file may not have direct access to the live `quizOptions` — check how `saveSession` currently receives its `room` argument and whether `room` object has the threshold attached; if not, pass it through as an added parameter from the `server.js` call site at line 2557, `saveSession(roomCode, currentRoom)`, threading `quizOptions.shortAnswerMatchThreshold` in as a third argument).

Since the exact current structure of this function cannot be fully determined without reading it (deferred to Step 1 above), the concrete code change is: for each `short_answer` question, build
```js
const shortAnswerCorrectness = {};
for (const player of playersInSession) {
  const answer = player.answers?.[questionIndex];
  if (answer !== undefined && answer !== '') {
    shortAnswerCorrectness[player.name] = matchShortAnswer(answer, question.acceptedAnswers || [], threshold).isCorrect;
  }
}
question.shortAnswerCorrectness = shortAnswerCorrectness;
```
placed in whatever loop already builds each `question` entry for the saved JSON, using that loop's existing variable names for "the current question" and "the list of players" rather than the placeholder names used here.

- [ ] **Step 3: Manual verification**

Play through a short room with one short-answer question end to end (present, submit, reveal, complete quiz), then inspect the saved session (via Admin > Sessions > view details, or by checking the saved JSON file/DB row directly).
Expected: the saved session's short-answer question has a `shortAnswerCorrectness` map with each answering player's name and a boolean.

- [ ] **Step 4: Commit**

```bash
git add app/src/services/session.service.js
git commit -m "feat: persist short-answer correctness in saved session data"
```

---

### Task 13: Exports — CSV and PDF short-answer variants

**Files:**
- Modify: `app/src/services/export.service.js:49-76` (CSV `generateCSV`)
- Modify: `app/src/services/pdfExport.service.js` (question-accuracy chart ~line 301-322, per-question choices ~line 383-408, per-question stats ~line 413-419, player-response sort/grid ~line 453-509)

**Interfaces:**
- Consumes: `question.type`, `question.acceptedAnswers`, `question.shortAnswerCorrectness` (from Task 12).

- [ ] **Step 1: Branch the CSV question-breakdown section**

Replace `export.service.js:49-76`:
```js
  // Question Breakdown section
  lines.push('QUESTION BREAKDOWN');
  lines.push('#,Question,Correct Answer,Correct Count,Incorrect Count,Unanswered');

  sessionData.questions.forEach((question, qIdx) => {
    // Count correct/incorrect answers for this question
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    sessionData.playerResults.forEach((player) => {
      const answer = player.answers[qIdx];
      if (answer === undefined) {
        unansweredCount++;
      } else if (answer === question.correctChoice) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const correctLetter = String.fromCharCode(65 + question.correctChoice);
    const correctText = question.choices[question.correctChoice] || '';

    lines.push(
      `${qIdx + 1},${escapeCSV(question.text)},${correctLetter}. ${escapeCSV(correctText)},${correctCount},${incorrectCount},${unansweredCount}`
    );
  });

  return lines.join('\n');
```
with:
```js
  // Question Breakdown section
  lines.push('QUESTION BREAKDOWN');
  lines.push('#,Question,Correct Answer,Correct Count,Incorrect Count,Unanswered');

  sessionData.questions.forEach((question, qIdx) => {
    const isShortAnswer = question.type === 'short_answer';
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    sessionData.playerResults.forEach((player) => {
      const answer = player.answers[qIdx];
      if (answer === undefined || answer === '') {
        unansweredCount++;
      } else if (isShortAnswer ? question.shortAnswerCorrectness?.[player.name] : answer === question.correctChoice) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const correctAnswerLabel = isShortAnswer
      ? (question.acceptedAnswers || []).map(a => a.answer_text).join(' / ')
      : `${String.fromCharCode(65 + question.correctChoice)}. ${question.choices[question.correctChoice] || ''}`;

    lines.push(
      `${qIdx + 1},${escapeCSV(question.text)},${escapeCSV(correctAnswerLabel)},${correctCount},${incorrectCount},${unansweredCount}`
    );
  });

  return lines.join('\n');
```

- [ ] **Step 2: Syntax check and commit CSV change**

Run: `cd app && node --check src/services/export.service.js`
Expected: no output (success).

```bash
git add app/src/services/export.service.js
git commit -m "feat: show accepted answers and correctness in CSV export for short-answer questions"
```

- [ ] **Step 3: Branch the PDF question-accuracy chart**

Replace `pdfExport.service.js:301-311`:
```js
    sessionData.questions.forEach((q, qi) => {
      if (y > PAGE.height - 50) { doc.addPage(); drawPageHeader(doc); y = 50; }
      let correct = 0;
      let total = 0;
      sessionData.playerResults.forEach((p) => {
        const ans = p.answers[qi];
        if (ans !== undefined) {
          total++;
          if (ans === q.correctChoice) correct++;
        }
      });
```
with:
```js
    sessionData.questions.forEach((q, qi) => {
      if (y > PAGE.height - 50) { doc.addPage(); drawPageHeader(doc); y = 50; }
      let correct = 0;
      let total = 0;
      sessionData.playerResults.forEach((p) => {
        const ans = p.answers[qi];
        if (ans !== undefined && ans !== '') {
          total++;
          const isCorrect = q.type === 'short_answer' ? q.shortAnswerCorrectness?.[p.name] : ans === q.correctChoice;
          if (isCorrect) correct++;
        }
      });
```

- [ ] **Step 4: Branch the PDF per-question answer-choices block**

Replace `pdfExport.service.js:377-408` (the `q.choices.forEach` block) — wrap the whole block in a type check:
```js
    // ── Answer choices ──
    // Layout: [6px pad] [18px letter] [choice text ... ] [68px correct badge] [6px pad]
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    const BADGE_W = 68;
    const choiceTextW = CONTENT_W - 18 - BADGE_W - 20; // letter + badge + padding

    if (q.type === 'short_answer') {
      (q.acceptedAnswers || []).forEach((acc) => {
        if (y > PAGE.height - 60) { doc.addPage(); drawPageHeader(doc); y = 50; }
        drawRect(doc, PAGE.margin, y, CONTENT_W, 20, '#D1FAE5', 3);
        drawBorder(doc, PAGE.margin, y, CONTENT_W, 20, BRAND.success, 3);
        doc.font('Helvetica').fillColor('#065F46')
          .text(acc.answer_text, PAGE.margin + 8, y + 6, { width: CONTENT_W - 90, lineBreak: false });
        doc.font('Helvetica-Bold').fillColor(BRAND.success)
          .text('Accepted', PAGE.margin + CONTENT_W - BADGE_W - 4, y + 6, { width: BADGE_W, align: 'right', lineBreak: false });
        y += 23;
      });
    } else {
      q.choices.forEach((choice, ci) => {
        if (y > PAGE.height - 60) { doc.addPage(); drawPageHeader(doc); y = 50; }
        const isCorrect = ci === q.correctChoice;
        const bgColor = isCorrect ? '#D1FAE5' : BRAND.bg;
        const borderColor = isCorrect ? BRAND.success : BRAND.border;
        const textColor = isCorrect ? '#065F46' : BRAND.text;

        drawRect(doc, PAGE.margin, y, CONTENT_W, 20, bgColor, 3);
        drawBorder(doc, PAGE.margin, y, CONTENT_W, 20, borderColor, 3);

        // Letter label
        doc.fontSize(9).font('Helvetica-Bold').fillColor(textColor)
          .text(`${letters[ci]}.`, PAGE.margin + 6, y + 6, { width: 18, lineBreak: false });

        // Choice text — width capped so it never reaches the badge column
        doc.font('Helvetica').fillColor(textColor)
          .text(choice, PAGE.margin + 24, y + 6, { width: choiceTextW, lineBreak: false });

        // Correct badge — pinned to the right edge
        if (isCorrect) {
          const badgeX = PAGE.margin + CONTENT_W - BADGE_W - 4;
          doc.font('Helvetica-Bold').fillColor(BRAND.success)
            .text('Correct', badgeX, y + 6, { width: BADGE_W, align: 'right', lineBreak: false });
        }
        y += 23;
      });
    }
```

- [ ] **Step 5: Branch the PDF per-question stats block**

Replace `pdfExport.service.js:413-419`:
```js
    // ── Per-question stats ──
    let correct = 0, incorrect = 0, unanswered = 0;
    sessionData.playerResults.forEach((p) => {
      const ans = p.answers[qi];
      if (ans === undefined) unanswered++;
      else if (ans === q.correctChoice) correct++;
      else incorrect++;
    });
```
with:
```js
    // ── Per-question stats ──
    let correct = 0, incorrect = 0, unanswered = 0;
    sessionData.playerResults.forEach((p) => {
      const ans = p.answers[qi];
      if (ans === undefined || ans === '') {
        unanswered++;
      } else {
        const isCorrect = q.type === 'short_answer' ? q.shortAnswerCorrectness?.[p.name] : ans === q.correctChoice;
        if (isCorrect) correct++; else incorrect++;
      }
    });
```

- [ ] **Step 6: Branch the PDF player-response sort and grid**

Replace `pdfExport.service.js:453-458`:
```js
    const sorted = [...sessionData.playerResults].sort((a, b) => {
      const aCorrect = a.answers[qi] === q.correctChoice;
      const bCorrect = b.answers[qi] === q.correctChoice;
      if (bCorrect !== aCorrect) return bCorrect ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
```
with:
```js
    const isCorrectFor = (player) => {
      const ans = player.answers[qi];
      if (ans === undefined || ans === '') return false;
      return q.type === 'short_answer' ? !!q.shortAnswerCorrectness?.[player.name] : ans === q.correctChoice;
    };

    const sorted = [...sessionData.playerResults].sort((a, b) => {
      const aCorrect = isCorrectFor(a);
      const bCorrect = isCorrectFor(b);
      if (bCorrect !== aCorrect) return bCorrect ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
```

Replace `pdfExport.service.js:485-490`:
```js
      const ans = player.answers[qi];
      const answered = ans !== undefined;
      const isCorrect = ans === q.correctChoice;
      const dotColor = !answered ? BRAND.muted : isCorrect ? BRAND.success : BRAND.danger;
      const dotLabel = !answered ? '-' : isCorrect ? '+' : 'x';
      const answerLetter = answered ? letters[ans] || '?' : '-';
```
with:
```js
      const ans = player.answers[qi];
      const answered = ans !== undefined && ans !== '';
      const isCorrect = isCorrectFor(player);
      const dotColor = !answered ? BRAND.muted : isCorrect ? BRAND.success : BRAND.danger;
      const dotLabel = !answered ? '-' : isCorrect ? '+' : 'x';
      const answerLetter = !answered ? '-' : (q.type === 'short_answer' ? String(ans).slice(0, 3) : (letters[ans] || '?'));
```

(`String(ans).slice(0, 3)` keeps the fixed-width `LETTER_W = 28` column from overflowing with a full typed answer — the player's full text is already legible from the CSV/session-detail view, this PDF grid is a compact glance, not the source of truth.)

- [ ] **Step 7: Syntax check**

Run: `cd app && node --check src/services/pdfExport.service.js`
Expected: no output (success).

- [ ] **Step 8: Manual verification**

Export a completed session (with a short-answer question) as both CSV and PDF from Admin > Sessions.
Expected: CSV shows accepted answers joined with " / " in the "Correct Answer" column and correct counts matching what was graded live; PDF shows a green "Accepted" list instead of lettered choices on the per-question page, and the player-response grid shows a truncated text snippet instead of a choice letter with correct/incorrect coloring intact.

- [ ] **Step 9: Commit**

```bash
git add app/src/services/pdfExport.service.js
git commit -m "feat: show accepted answers and correctness in PDF export for short-answer questions"
```

---

## Self-Review Notes

- **Spec coverage:** All four spec sections (data model/grading, admin editor, player/presenter UI, exports/stats) have corresponding tasks (1-2 → data model; 9 → editor; 10-11 → player/presenter; 12-13 → exports). The timeout-auto-submit addendum from the user's follow-up question is covered in Task 10 Steps 3 and 5-6 (client-side push via a new `autoSubmitAnswer` event, separate from the confirm-modal `selectAnswer` flow).
- **Known soft spot:** Task 11 and Task 13 depend on Task 12's `shortAnswerCorrectness` field existing in saved session data, but Task 12 could not fully pin down `session.service.js`'s current structure without reading it first (flagged explicitly in Task 12 Step 1 — the implementer must read before writing, not guess). Execute Task 12 before Task 11/13's manual verification steps, though the tasks can be coded in file order since Task 11/13's Vue/JS changes don't error without the field (it's read with `?.` optional chaining throughout, degrading to "incorrect" rather than crashing).
- **Debug endpoints excluded:** `/api/debug/*` room-builders (`server.js` ~3020-3490) still assume MC/TF `correctChoice` semantics and will misbehave if pointed at a short-answer question. This is called out explicitly in Global Constraints as out of scope — they're dev-only tooling, not part of the feature's user-facing surface.
