-- ============================================
-- Supabase Migration v9: Settings Table
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration creates the settings table for storing:
-- - OCR API key (stored as veryfi_api_key for backward compatibility)
-- - Default currency
-- ============================================

-- Step 1: Create settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    veryfi_api_key TEXT,  -- Stores OCR.Space API key (legacy column name)
    default_currency TEXT DEFAULT 'EUR',
    language_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Add columns if they don't exist (for existing tables)
DO $$
BEGIN
    -- Add veryfi_api_key if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'settings' AND column_name = 'veryfi_api_key') THEN
        ALTER TABLE settings ADD COLUMN veryfi_api_key TEXT;
    END IF;

    -- Add default_currency if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'settings' AND column_name = 'default_currency') THEN
        ALTER TABLE settings ADD COLUMN default_currency TEXT DEFAULT 'EUR';
    END IF;

    -- Add language_code if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'settings' AND column_name = 'language_code') THEN
        ALTER TABLE settings ADD COLUMN language_code TEXT;
    END IF;
END $$;

-- Step 3: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);

-- Step 4: Enable Row Level Security
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "settings_select" ON settings;
DROP POLICY IF EXISTS "settings_insert" ON settings;
DROP POLICY IF EXISTS "settings_update" ON settings;
DROP POLICY IF EXISTS "settings_delete" ON settings;
DROP POLICY IF EXISTS "settings_all" ON settings;

-- Allow users to manage only their own settings
CREATE POLICY "settings_all" ON settings
    FOR ALL
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Step 6: Create trigger to auto-update updated_at
DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Migration Complete!
-- ============================================
-- The settings table now stores:
-- - veryfi_api_key: Your OCR.Space API key
-- - default_currency: Default currency for receipts
-- ============================================
