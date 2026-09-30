-- Migration 22: Default theme for player/display clients
-- Lets the admin set the theme guests and players see before they've ever picked one of their
-- own; localStorage and a signed-in account's own choice still take priority over this.

INSERT INTO app_settings (setting_key, setting_value, description)
VALUES ('default_player_theme', 'grey', 'Default theme for player/display clients with no personal preference saved yet')
ON CONFLICT (setting_key) DO NOTHING;
