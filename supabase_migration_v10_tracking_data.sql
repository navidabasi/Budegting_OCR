-- ============================================
-- Supabase Migration v10: Tracked Payments
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. tracking_data JSONB column to receipts
-- 2. Index for tracked receipts queries
-- ============================================

ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS tracking_data JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_tracking_data
ON receipts USING GIN (tracking_data)
WHERE tracking_data IS NOT NULL;

COMMENT ON COLUMN receipts.tracking_data IS 'JSONB containing tracked payment status (open/done), completion timestamp, and recurring source linkage';

-- ============================================
-- Migration Complete!
-- ============================================
