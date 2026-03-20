-- ============================================
-- Supabase Migration v11: Language Setting
-- ============================================
-- Adds per-user app language preference to settings table.

ALTER TABLE settings
ADD COLUMN IF NOT EXISTS language_code TEXT;

COMMENT ON COLUMN settings.language_code IS
'App language code selected by user (fa, ar, en, it, de, fr, es)';
