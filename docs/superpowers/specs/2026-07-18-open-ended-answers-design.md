# Open-Ended (Short Answer) Questions — Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation planning

## Context

TriviaForge currently supports two question types: `multiple_choice` and `true_false`. A user requested the ability for players to type a free-text answer instead of picking from a list. A third question type, `short_answer`, was reserved in the database's `question_type` CHECK constraint since the original schema (`app/init/01-tables.sql`) but never implemented — no UI, no answer-submission path, no grading logic exists for it today.

This is the first of two independently-scoped feature requests from the same conversation (the other being a Jeopardy-style board game mode). This spec covers open-ended answers only.

The core design challenge: TriviaForge's answer model is deeply index-based. `participant_answers.answer_id` is a `NOT NULL` foreign key into a per-question `answers` table, and in-memory room state (`server.js`) compares a numeric `player.choice` against `question.correctChoice` at ~10 call sites across live Socket.IO play, solo REST play, and auto-mode timeout handling. Free-text answers have no natural row to point to, so this spec threads a text-based path through that index-based architecture without breaking multiple-choice/true-false.

## Scope boundary

**In scope:**
- New `short_answer` question type, fully wired: admin authoring, live multiplayer play, solo play, presenter/display reveal, exports, stats.
- Automatic grading via fuzzy string matching against admin-supplied accepted answers.
- Timeout auto-submits whatever partial text the player has typed, if any.

**Explicitly out of scope:**
- Presenter manual-override grading. Auto-match is the only grading path — partly because it must work in solo play, where there is no presenter.
- Partial credit or different point weighting. Same binary correct/incorrect scoring as multiple-choice/true-false today.
- Multi-line/paragraph answers. This targets short factual answers (a name, a place, a date), not essay-length responses — a single-line input is the right shape, and fuzzy matching degrades badly against longer free-form text.
- AI/LLM-based grading. No such dependency exists in the app today; out of scope for this pass.

## 1. Data model & grading engine

### Schema changes

New migration `app/init/18-short-answer-questions.sql`:

- `questions.question_type` — no change needed. `'short_answer'` is already a valid value per the existing CHECK constraint.
- `answers` table — reused as-is for `short_answer` questions. Each row is one *accepted answer or synonym* (e.g. "Paris", "City of Light"). All rows for a short-answer question have `is_correct = TRUE`; `display_order` continues to control list order in the editor's existing drag-reorder UI.
- `participant_answers.answer_id` — becomes **nullable** (currently `NOT NULL`). A free-text submission with no match has no row to point to.
- `participant_answers.answer_text TEXT` — new nullable column. Stores the player's raw typed submission. `NULL` for multiple-choice/true-false rows; populated only for `short_answer` rows. When a fuzzy match succeeds, `answer_id` is set to the matched accepted-answer row's id (for traceability/reporting); when no match is found, `answer_id` stays `NULL` and `answer_text` still records what was typed.
- New `app_settings` row: key `short_answer_match_threshold`, default `'0.85'`. Editable in Admin → Settings, same pattern as the existing `answer_display_time` setting.

### Grading logic

New export in `app/src/utils/similarity.js` (reusing its existing `normalizeText` and `calculateSimilarity`, the same functions duplicate-question-detection already relies on):

```js
matchShortAnswer(playerText, acceptedAnswers, threshold)
  → { isCorrect, matchedAnswerId, similarity }
```

`acceptedAnswers` is the list of `{id, answer_text}` rows for the question. The function normalizes and fuzzy-compares `playerText` against each accepted answer, returning the best match if any exceeds `threshold`.

This replaces the `playerChoice === question.correctChoice` comparison at each of the following call sites, branching on `question.type`:

- Socket.IO live answer submission in `server.js`. In-memory `player.choice` is generalized to `player.answer`: a numeric index for `multiple_choice`/`true_false`, a string for `short_answer`.
- Solo play REST submission in `solo.controller.js` (`POST` answer handler around line 357).
- Auto-mode timeout handling in `server.js` (~line 3466). For `multiple_choice`/`true_false` this path currently assigns a `randomChoice` on timeout; for `short_answer` it does not guess — see timeout behavior below.

### Timeout behavior

If a player hasn't manually submitted when their countdown reaches zero, the client (not the server) auto-submits whatever text is currently in the input box through the same submission call a manual submit would use. This reuses the existing per-player client-side countdown in `QuestionDisplay.vue` — no new server-initiated request/response pattern.

- Non-empty text at timeout → submitted and graded normally via `matchShortAnswer`, exactly as if the player had pressed submit.
- Empty text at timeout → treated as no answer submitted (incorrect), matching today's behavior when a player never selects a choice.

## 2. Admin: Question Editor

- The question type dropdown (`app/src/components/admin/QuestionEditor.vue`) gains a third option: **"Open-Ended / Short Answer"**.
- When selected, the existing add/remove/drag-reorder choice-list UI (currently used for multiple-choice options) is reused and relabeled **"Accepted Answers"**. Each entry is one acceptable spelling/synonym. There is no per-entry "mark as correct" toggle — every entry is correct by definition — replaced with a short helper hint: *"List every acceptable answer or common variation."*
- Validation: at least one accepted answer required, reusing `validateAnswerChoice` per entry (same length rules as multiple-choice options today).
- Question Bank's existing type filter/badge (`QuestionBankFilters.vue`, `QuestionBankTable.vue`) requires no change — it already reads `question_type` generically.

## 3. Player & presenter experience

### Player (`QuestionDisplay.vue`)

- `short_answer` questions render a single-line `FormInput` instead of the choice grid. Max length matches short factual answers (e.g. 100 chars).
- The existing `AnswerConfirmModal` step still applies — shows the typed text back to the player for confirm/cancel before locking in.
- On reveal, instead of highlighting a choice, the player sees the list of accepted answers plus their own submitted text, marked correct/incorrect.

### Presenter/Display (`QuizDisplay.vue`, `DisplayPage.vue`)

- No live preview of typed answers while the question is open — consistent with current behavior, where multiple-choice picks also aren't shown live, only the "X/Y answered" progress count.
- After reveal, the choice-distribution bar chart is replaced with a simple list of accepted answers.
- The per-question breakdown (session detail modal, `QuestionBreakdown.vue`) gets a text variant for `short_answer` questions: each player's typed response with a correct/incorrect badge, instead of a bar chart of choice picks.

### Solo play

Works without further changes beyond the shared grading path — this is a direct consequence of choosing auto-match grading, since solo play has no presenter to grade answers manually.

## 4. Exports & stats

- PDF per-question pages and CSV export rows (`export.service.js`) get a `short_answer` variant showing the typed response text instead of a choice letter/grid.
- Stats/accuracy calculations (`stats.controller.js`) are unchanged — they operate on the boolean `is_correct` column regardless of question type.
- Quiz library JSON export/import already supports multiple answer rows per question generically; `short_answer` questions round-trip through it without additional changes, since accepted answers are stored the same way multiple-choice options are.

## Open questions for implementation planning

None outstanding — all decisions above were confirmed during design review.
