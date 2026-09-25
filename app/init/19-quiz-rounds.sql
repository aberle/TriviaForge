-- Migration 19: Quiz rounds
-- Lets a quiz be split into rounds. Within a round, players see every question at once,
-- answer at their own pace, and submit the round. Rounds are optional: a quiz with no
-- quiz_rounds rows plays exactly as before.

-- Rounds belong to a quiz. round_order is 1-based (like quiz_questions.question_order).
-- time_limit_seconds NULL means untimed (the presenter ends the round).
CREATE TABLE IF NOT EXISTS quiz_rounds (
    id SERIAL PRIMARY KEY,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    round_order INTEGER NOT NULL,
    title VARCHAR(100) NOT NULL DEFAULT '',
    time_limit_seconds INTEGER NULL
        CHECK (time_limit_seconds IS NULL OR time_limit_seconds BETWEEN 10 AND 3600),
    UNIQUE (quiz_id, round_order)
);

-- A question's round. NULL for quizzes without rounds.
ALTER TABLE quiz_questions
    ADD COLUMN IF NOT EXISTS round_id INTEGER NULL REFERENCES quiz_rounds(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_questions_round ON quiz_questions(round_id);

-- Per-session snapshot of the rounds that were played. Session history cannot join the live
-- quiz_rounds table because editing a quiz recreates its question rows.
CREATE TABLE IF NOT EXISTS session_rounds (
    id SERIAL PRIMARY KEY,
    game_session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    round_order INTEGER NOT NULL,
    title VARCHAR(100) NOT NULL DEFAULT '',
    time_limit_seconds INTEGER NULL,
    UNIQUE (game_session_id, round_order)
);

-- Which round (1-based session_rounds.round_order) a session question belonged to.
ALTER TABLE session_questions ADD COLUMN IF NOT EXISTS round_order INTEGER NULL;
