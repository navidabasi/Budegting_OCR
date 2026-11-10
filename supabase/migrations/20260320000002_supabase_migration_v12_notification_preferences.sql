-- ============================================
-- Supabase Migration v12: Notification Preferences
-- ============================================
-- Adds per-user notification preferences to settings table.

ALTER TABLE settings
ADD COLUMN IF NOT EXISTS notification_preferences JSONB;

COMMENT ON COLUMN settings.notification_preferences IS
'Notification preferences JSON: enabled, paymentDueAlertsEnabled, dailyExpenseReminderEnabled, dailyExpenseReminderTime, configuredAt, lastSetupPromptAt';
