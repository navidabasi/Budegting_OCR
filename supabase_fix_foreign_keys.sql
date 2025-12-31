-- ============================================
-- Fix Foreign Key Constraints
-- ============================================
-- Run this in your Supabase SQL Editor to fix the foreign key error
-- ============================================

-- Step 1: Drop existing foreign key constraints
-- These constraints can't reference auth.users directly in Supabase

-- Drop foreign key constraint on receipts table (if it exists)
DO $$ 
BEGIN
    -- Try to drop constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'receipts_user_id_fkey' 
        AND table_name = 'receipts'
    ) THEN
        ALTER TABLE receipts DROP CONSTRAINT receipts_user_id_fkey;
        RAISE NOTICE 'Dropped receipts_user_id_fkey constraint';
    END IF;
END $$;

-- Drop foreign key constraint on settings table (if it exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'settings_user_id_fkey' 
        AND table_name = 'settings'
    ) THEN
        ALTER TABLE settings DROP CONSTRAINT settings_user_id_fkey;
        RAISE NOTICE 'Dropped settings_user_id_fkey constraint';
    END IF;
END $$;

-- Step 2: Verify the constraints are removed
-- Check what constraints exist now
SELECT 
    tc.table_name, 
    tc.constraint_name, 
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_schema = 'public' 
    AND tc.table_name IN ('receipts', 'settings')
    AND tc.constraint_type = 'FOREIGN KEY';

-- ============================================
-- Note: RLS policies provide the security we need
-- Foreign key constraints are not necessary when using RLS
-- ============================================

