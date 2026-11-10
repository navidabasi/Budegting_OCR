-- ============================================
-- Supabase Migration v8: Field-Level Timestamps
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. field_timestamps JSONB column to receipts table
-- 2. Migration of existing receipts to initialize field timestamps
-- 3. Index for JSONB queries
-- ============================================

-- Step 1: Add field_timestamps column to receipts
-- Structure:
-- {
--   "merchant": "2024-01-15T10:30:00.000Z",
--   "date": "2024-01-15T10:30:00.000Z",
--   "total": "2024-01-15T10:30:00.000Z",
--   "currency": "2024-01-15T10:30:00.000Z",
--   "category": "2024-01-15T10:30:00.000Z",
--   "notes": "2024-01-16T14:20:00.000Z",
--   "lineItems": "2024-01-15T10:30:00.000Z",
--   "transactionType": "2024-01-15T10:30:00.000Z",
--   "groupId": null,
--   "groupName": null,
--   "groupTags": null,
--   "splitData": null,
--   "isPinned": "2024-01-18T16:45:00.000Z",
--   "recurringData": null
-- }
ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS field_timestamps JSONB DEFAULT NULL;

-- Step 2: Migrate existing receipts - set all field timestamps to updated_at
UPDATE receipts
SET field_timestamps = jsonb_build_object(
    'merchant', updated_at,
    'date', updated_at,
    'total', updated_at,
    'currency', updated_at,
    'category', updated_at,
    'notes', updated_at,
    'lineItems', updated_at,
    'transactionType', updated_at,
    'groupId', CASE WHEN group_id IS NOT NULL THEN updated_at ELSE NULL END,
    'groupName', CASE WHEN group_name IS NOT NULL THEN updated_at ELSE NULL END,
    'groupTags', CASE WHEN group_tags IS NOT NULL AND array_length(group_tags, 1) > 0 THEN updated_at ELSE NULL END,
    'splitData', CASE WHEN split_data IS NOT NULL THEN updated_at ELSE NULL END,
    'isPinned', updated_at,
    'recurringData', CASE WHEN recurring_data IS NOT NULL THEN updated_at ELSE NULL END
)
WHERE field_timestamps IS NULL;

-- Step 3: Create GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_receipts_field_timestamps ON receipts USING GIN (field_timestamps);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN receipts.field_timestamps IS 'JSONB tracking last modification timestamp per field for field-level sync conflict resolution';

-- ============================================
-- Migration Complete!
-- ============================================
