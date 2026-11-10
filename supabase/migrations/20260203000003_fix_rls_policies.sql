-- Fix RLS Policies for Receipts and Settings
-- Run this entire block in Supabase SQL Editor

BEGIN;

-- Drop all existing policies
DROP POLICY IF EXISTS "receipts_select_policy" ON receipts;
DROP POLICY IF EXISTS "receipts_insert_policy" ON receipts;
DROP POLICY IF EXISTS "receipts_update_policy" ON receipts;
DROP POLICY IF EXISTS "receipts_delete_policy" ON receipts;
DROP POLICY IF EXISTS "settings_select_policy" ON settings;
DROP POLICY IF EXISTS "settings_insert_policy" ON settings;
DROP POLICY IF EXISTS "settings_update_policy" ON settings;
DROP POLICY IF EXISTS "receipts_all" ON receipts;
DROP POLICY IF EXISTS "settings_all" ON settings;

-- Enable RLS
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Create unified policies (simpler and more reliable)
CREATE POLICY "receipts_all" ON receipts 
  FOR ALL 
  TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_all" ON settings 
  FOR ALL 
  TO authenticated 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

COMMIT;

