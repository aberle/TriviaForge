-- Migration 21: Add the "murder" theme (styled after The Traitors) to the allowed theme values
-- Idempotent: safe to re-run

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_theme_check;

ALTER TABLE users
ADD CONSTRAINT users_theme_check
CHECK (theme IN ('light', 'dark', 'grey', 'system', 'murder'));

COMMENT ON COLUMN users.theme IS 'User theme preference: light, dark, grey, system, or murder';
