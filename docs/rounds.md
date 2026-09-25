# Multiple Rounds

A quiz can be split into rounds. In a round, players see **every question at once**, answer at their own pace, and **submit the round**. Correct answers and a leaderboard appear when the round ends. Rounds are optional: a quiz without rounds plays exactly as it always has.

## Running a round quiz

**Authoring (Admin → Quiz Management)**
1. Select a quiz and click the layers icon in the Questions header ("Split this quiz into rounds"). All questions go into Round 1.
2. Use **Add Round** to create more. Each round header has a title and a **Time limit (sec)**: leave it blank for an untimed round, or enter 10 to 3600.
3. Move a question to another round by dragging it: drop it before or after any question (a line shows where it will land, and the destination round is highlighted), onto a round's header (it goes to the top of that round), or into the dashed "Drop here" zone at the end of a round. That zone is also the way into an empty round. You can also use the selector on its card, or change **Round** in the Question Editor.
4. Reordering and shuffling stay inside a round. Deleting a round moves its questions into the neighbouring round; deleting the only round returns the quiz to a flat list. Empty rounds are skipped when played.

**Presenting**
1. Make the room live as usual. The middle column shows the rounds instead of the question list. Auto-pilot is not available for round quizzes.
2. **Start** a round. Players and the display page see all its questions at once.
3. Watch "X of N players have submitted". An untimed round ends when you click **End Round** (the button pulses once everyone has submitted), or you can start a **countdown** on it (30 s, 1, 2 or 5 min, or your own 10 to 3600 s): it ends by itself when the countdown reaches zero, and you can cancel it. A timed round ends by itself when time is up, and you can still end it early.
4. When a round ends, everyone sees the leaderboard, players also see their own results, and the display page shows the answers. Start the next round.
5. After the last round, only you see the final standings. Players still see their own round result and answers, and the display shows the answers, but neither gets the leaderboard, rank or total until you click **Complete Quiz & Save** (which then shows the final podium and saves the session). The server withholds this data rather than just hiding it on screen.

**Settling a dispute.** In Live Standings, every answer to a finished question has a **Mark correct** / **Mark wrong** button (round quizzes, until the quiz is completed). The answer then counts exactly that way everywhere, as if it had always been graded like that: scores, leaderboards, the player's own results and history, the final results, exports and the saved session (it survives a resume). Players are not told: their screens just update. Only you see an "edited" tag, and setting an answer back to what the automatic grader said clears the change.

**Playing**
- Answers are saved to the server as you go, so a dropped connection, a locked phone or a reload keeps them. **Submit Answers** sends them right away (no confirmation) and a toast says they can still be changed. You can keep changing your answers until the round ends: edits only count once you tap **Submit Updated Answers** (the screen warns that you have unsent changes, and your last submission counts until you resubmit). If a timed round runs out with unsent changes, they are submitted automatically.
- If a player taps Submit with questions left blank, the first tap only warns them: the blank questions are marked "Not answered yet" (and scrolled to), and tapping again sends the answers as they are. A timed round running out never asks; it just submits.
- When a timed round runs out, whatever is filled in is submitted automatically.
- Scoring is one point per correct answer. Players who join mid-round get the remaining time; a round a player missed scores zero for them.

## Design notes

- **No leaks while a round is open.** `playerListUpdate` is broadcast to everyone with each player's `answers`, so drafts and submissions live in `room.rounds` and are copied into `player.answers` only when the round ends. Questions sent to players have no `correctChoice` or `acceptedAnswers`, and short-answer questions send no `choices` (those are the accepted answers).
- **Reuses the existing model.** Ending a round marks its questions presented and revealed, so saving, resume, stats and exports work unchanged. The session is saved after every round.
- **`finalizeRound` is synchronous and idempotent**, shared by the presenter's End Round and the timer, so a timer racing a submit or a double click finalizes once. A late submit gets `roundSubmitted { success: false, ended: true }`.
- **Timers** live in `roundService.timers` (not on the room). The server closes a timed round `TIMER_GRACE_MS` (2 s) after `endsAt` to absorb latency; clients count down to `endsAt` and auto-submit at zero. Times are sent with `serverNow` so clients correct for clock skew.
- **Identity.** Drafts and submissions are keyed by `username`, because `room.players` is keyed by socket ID, which changes on reconnect.
- **Resume.** A round counts as completed when all its questions were revealed. A resumed room starts between rounds; a round that was open is played again. Answers a player had picked but not submitted are not persisted, so they start that round again. Players still in the room's page wait automatically and rejoin when the presenter resumes it.
- **Data.** `quiz_rounds` (per quiz), `quiz_questions.round_id`, and per-session snapshots `session_rounds` and `session_questions.round_order`, because editing a quiz recreates its question rows.

## Socket events

Client → server (payloads include `roomCode`):

| Event | Payload | Who | Notes |
|---|---|---|---|
| `startRound` | `{ roundIndex }` | presenter | Errors via `roomError`. Not while a round is open, and not for a played round. |
| `endRound` | `{ roundIndex }` | presenter | Ignored unless that round is the open one. |
| `startRoundCountdown` | `{ roundIndex, seconds }` | presenter | Only on an open, untimed round without a countdown; 10 to 3600 s. Errors via `roomError`. |
| `cancelRoundCountdown` | `{ roundIndex }` | presenter | Puts the round back to no time limit. |
| `overrideAnswer` | `{ username, questionIndex, correct }` | presenter | Round quizzes only, for a finished question the player answered, until the quiz is completed. Replies `answerOverridden` or `overrideRejected { message }`. |
| `saveRoundDraft` | `{ roundIndex, answers }` | player | No reply. Capped at 60 per 10 s per socket. |
| `submitRound` | `{ roundIndex, answers }` | player | Can be sent again until the round ends; the newest submission replaces the last. |

`answers` is positional, aligned to the round's questions: a choice index (multiple choice, true/false), the typed text (short answer, max 100 characters), or `null`.

Server → client:

| Event | Payload |
|---|---|
| `roundStarted` | `{ roundIndex, title, timeLimitSeconds, serverNow, startedAt, endsAt, totalRounds, questions: [{ index, text, type, choices, imageUrl, imageType }] }` |
| `roundTimer` | `{ roundIndex, timeLimitSeconds, countdown, serverNow, startedAt, endsAt }` (sent when a countdown starts or is cancelled; `timeLimitSeconds` is `null` again after a cancel. `roundStarted` and `roundState` carry the same fields) |
| `roundResults` | `{ lastEnded, history? }` (the same fields as in `roundState`, re-sent when a grade changes: each player gets their own corrected results, the presenter the full standings) |
| `roundSubmitted` | `{ roundIndex, success, message?, ended? }` (to the submitter, once per accepted submit) |
| `roundProgress` | `{ roundIndex, submitted, total }`; the presenter also gets `submittedNames` |
| `roundEnded` | `{ roundIndex, title, reason: 'presenter' \| 'timeout', isLastRound, totalRounds, questions: [{ index, text, type, choices, correctChoice, acceptedAnswers, ... }], standings: [{ rank, name, roundScore, totalScore }] }`; each player also gets `you: { answers, results, roundScore, totalScore, rank }` |
| `roundState` | Snapshot for joins, presenter view/refresh and resume: `{ totalRounds, rounds, phase, nextRoundIndex, completed, current, progress, lastEnded }`. A player's `current.you` has `{ draft, submitted, submittedAnswers }`: `draft` is their latest answers, `submittedAnswers` the last submission (only that counts, or the draft if they never submitted). |

`phase` is `idle` (nothing played), `open` (a round is running) or `ended` (between rounds). The presenter's `roomCreated` and `roomRestored` payloads also carry `rounds` (with `questionIndexes`).

Legacy events behave differently in a round quiz: `presentQuestion`, `revealAnswer`, `startAutoMode` and `resumeAutoMode` are rejected, and `completeQuiz` needs the presenter and no open round.

## Testing

- `npm run test:component` (from `app/`): podium ties, round components and the admin round handlers. No server needed.
- `npm run test:rounds`: the socket protocol, against a running server (`testing/rounds-test.js`).
- `npm run test:e2e`: the real UI in headless Chrome, plus a round-less quiz and the client composable, against a running server.

Setup, environment variables and the list of suites are in [app/testing/README.md](../app/testing/README.md).
