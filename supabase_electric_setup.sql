-- ============================================
-- Supabase Electric SQL Setup
-- ============================================
-- Run this in your Supabase SQL Editor to enable Electric sync
-- ============================================

-- Step 1: Enable the required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 2: Enable logical replication for Electric
-- Note: This requires Supabase Pro plan or higher for full Electric support
-- For development, you can use Electric's HTTP sync which works with any Supabase plan

-- Step 3: Create publication for Electric (if using full Electric sync)
-- This allows Electric to track changes to these tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'electric_publication') THEN
        CREATE PUBLICATION electric_publication FOR TABLE
            receipts,
            groups,
            user_categories,
            settings,
            user_layouts;
    END IF;
END $$;

-- Step 4: Add Electric sync trigger function
CREATE OR REPLACE FUNCTION electric_notify_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Notify Electric about the change
    PERFORM pg_notify(
        'electric_changes',
        json_build_object(
            'table', TG_TABLE_NAME,
            'operation', TG_OP,
            'id', CASE
                WHEN TG_OP = 'DELETE' THEN OLD.id
                ELSE NEW.id
            END
        )::text
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create triggers for each table
DROP TRIGGER IF EXISTS electric_notify_receipts ON receipts;
CREATE TRIGGER electric_notify_receipts
    AFTER INSERT OR UPDATE OR DELETE ON receipts
    FOR EACH ROW EXECUTE FUNCTION electric_notify_change();

DROP TRIGGER IF EXISTS electric_notify_groups ON groups;
CREATE TRIGGER electric_notify_groups
    AFTER INSERT OR UPDATE OR DELETE ON groups
    FOR EACH ROW EXECUTE FUNCTION electric_notify_change();

DROP TRIGGER IF EXISTS electric_notify_user_categories ON user_categories;
CREATE TRIGGER electric_notify_user_categories
    AFTER INSERT OR UPDATE OR DELETE ON user_categories
    FOR EACH ROW EXECUTE FUNCTION electric_notify_change();

DROP TRIGGER IF EXISTS electric_notify_settings ON settings;
CREATE TRIGGER electric_notify_settings
    AFTER INSERT OR UPDATE OR DELETE ON settings
    FOR EACH ROW EXECUTE FUNCTION electric_notify_change();

DROP TRIGGER IF EXISTS electric_notify_user_layouts ON user_layouts;
CREATE TRIGGER electric_notify_user_layouts
    AFTER INSERT OR UPDATE OR DELETE ON user_layouts
    FOR EACH ROW EXECUTE FUNCTION electric_notify_change();

-- ============================================
-- Electric HTTP Sync Alternative (Works without Pro plan)
-- ============================================
-- If you're not using full Electric sync, you can use the HTTP Shape API
-- which works with any Supabase plan. The app is configured to use this
-- approach by default.

-- For HTTP Shape API, ensure RLS policies are properly configured:
-- (These should already exist from previous migrations)

-- Verify RLS is enabled
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_layouts ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Setup Complete!
-- ============================================
-- Your Supabase database is now configured for Electric sync.
--
-- For full Electric sync (Pro plan):
-- 1. Enable logical replication in Supabase dashboard
-- 2. Set VITE_ELECTRIC_URL in your .env to your Electric service URL
--
-- For HTTP sync (any plan):
-- The app will automatically use Supabase's HTTP API with local PGlite
-- for offline-first storage with background sync.
-- ============================================
