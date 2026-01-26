-- ============================================
-- Supabase Migration v7: Receipt Pinning & Recurring Payments
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. is_pinned column to receipts table
-- 2. recurring_data JSONB column for recurring payments
-- 3. Indexes for better performance
-- ============================================

-- Step 1: Add is_pinned column to receipts
ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Step 2: Add recurring_data column to receipts
-- recurring_data structure:
-- {
--   "frequency": "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
--   "nextDueDate": "2024-02-01",
--   "isActive": true,
--   "reminderDays": 3
-- }
ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS recurring_data JSONB DEFAULT NULL;

-- Step 3: Create indexes
CREATE INDEX IF NOT EXISTS idx_receipts_is_pinned ON receipts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_receipts_user_pinned ON receipts(user_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_receipts_recurring ON receipts(user_id) WHERE recurring_data IS NOT NULL;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN receipts.is_pinned IS 'Whether the receipt should appear at the top of the list';
COMMENT ON COLUMN receipts.recurring_data IS 'JSONB containing recurring payment settings (frequency, nextDueDate, isActive, reminderDays)';

-- ============================================
-- Migration Complete!
-- ============================================
