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
