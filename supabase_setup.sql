-- ============================================
-- Supabase Setup SQL for Receipt Manager
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================

-- Step 1: Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 2: Drop existing tables if they exist (for clean setup)
-- WARNING: This will delete all existing data!
-- Comment out these lines if you want to keep existing data
-- DROP TABLE IF EXISTS settings CASCADE;
-- DROP TABLE IF EXISTS receipts CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- Step 3: Create receipts table
-- Note: We don't use foreign key constraints to auth.users (not allowed in Supabase)
-- RLS policies provide the security instead
CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL, -- References auth.users(id) via RLS, not FK constraint
  merchant TEXT,
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  total DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  category TEXT,
  notes TEXT,
  line_items JSONB DEFAULT '[]'::jsonb,
  is_demo BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create settings table
-- Note: We don't use foreign key constraints to auth.users (not allowed in Supabase)
-- RLS policies provide the security instead
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL, -- References auth.users(id) via RLS, not FK constraint
  veryfi_api_key TEXT,
  default_currency TEXT DEFAULT 'USD',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 5: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id);

-- Step 6: Enable Row Level Security
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Step 7: Drop old policies if they exist
DROP POLICY IF EXISTS "Users can view own receipts" ON receipts;
DROP POLICY IF EXISTS "Users can insert own receipts" ON receipts;
DROP POLICY IF EXISTS "Users can update own receipts" ON receipts;
DROP POLICY IF EXISTS "Users can delete own receipts" ON receipts;
DROP POLICY IF EXISTS "Users can view own settings" ON settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON settings;
DROP POLICY IF EXISTS "Users can update own settings" ON settings;
DROP POLICY IF EXISTS "Allow all operations on receipts" ON receipts;
DROP POLICY IF EXISTS "Allow all operations on settings" ON settings;

-- Step 8: Create RLS policies using Supabase Auth
-- These policies use auth.uid() which gets the current authenticated user's ID

-- Receipts policies
CREATE POLICY "Users can view own receipts" ON receipts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own receipts" ON receipts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own receipts" ON receipts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own receipts" ON receipts
  FOR DELETE USING (auth.uid() = user_id);

-- Settings policies
CREATE POLICY "Users can view own settings" ON settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON settings
  FOR UPDATE USING (auth.uid() = user_id);

-- Step 9: Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Step 10: Create triggers to auto-update updated_at
DROP TRIGGER IF EXISTS update_receipts_updated_at ON receipts;
CREATE TRIGGER update_receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Setup Complete!
-- ============================================
-- Your Supabase database is now configured with:
-- 1. Receipts table with RLS policies
-- 2. Settings table with RLS policies
-- 3. Automatic updated_at timestamps
-- 4. RLS policies enforce user_id relationships (no FK constraints needed)
-- 
-- Note: Foreign key constraints to auth.users are not allowed in Supabase.
-- RLS policies provide the same security by ensuring users can only access
-- their own data using auth.uid() = user_id checks.
-- ============================================

