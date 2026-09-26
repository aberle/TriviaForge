-- Migration 20: Hidden standings mode
-- A room for a round quiz can be run so that nobody sees results or standings until the quiz is
-- completed. The mode is saved with the session so a resumed session keeps it.

ALTER TABLE game_sessions
    ADD COLUMN IF NOT EXISTS hidden_standings BOOLEAN NOT NULL DEFAULT FALSE;
