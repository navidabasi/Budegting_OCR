-- ============================================
-- Supabase Migration v4: Enhanced Features
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. transaction_type column to receipts (income/expense)
-- 2. group_id and group_name columns to receipts
-- 3. split_data JSONB column to receipts
-- 4. user_categories table for custom categories
-- ============================================

-- Step 1: Add transaction_type column to receipts
ALTER TABLE receipts 
ADD COLUMN IF NOT EXISTS transaction_type TEXT DEFAULT 'expense';

-- Update existing receipts to be expenses
UPDATE receipts 
SET transaction_type = 'expense' 
WHERE transaction_type IS NULL;

-- Step 2: Add grouping columns to receipts
ALTER TABLE receipts 
ADD COLUMN IF NOT EXISTS group_id UUID,
ADD COLUMN IF NOT EXISTS group_name TEXT,
ADD COLUMN IF NOT EXISTS group_tags TEXT[];

-- Step 3: Add split_data column to receipts
ALTER TABLE receipts 
ADD COLUMN IF NOT EXISTS split_data JSONB DEFAULT NULL;

-- Step 4: Create user_categories table
CREATE TABLE IF NOT EXISTS user_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Step 5: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_receipts_transaction_type ON receipts(transaction_type);
CREATE INDEX IF NOT EXISTS idx_receipts_group_id ON receipts(group_id);
CREATE INDEX IF NOT EXISTS idx_user_categories_user_id ON user_categories(user_id);

-- Step 6: Enable RLS on user_categories
ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies for user_categories
DROP POLICY IF EXISTS "user_categories_all" ON user_categories;
CREATE POLICY "user_categories_all" ON user_categories 
  FOR ALL 
  TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Step 8: Create trigger to auto-update updated_at for user_categories
DROP TRIGGER IF EXISTS update_user_categories_updated_at ON user_categories;
CREATE TRIGGER update_user_categories_updated_at
    BEFORE UPDATE ON user_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Migration Complete!
-- ============================================

