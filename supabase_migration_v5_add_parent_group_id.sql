-- ============================================
-- Supabase Migration: Add parent_group_id to groups table
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. parent_group_id column to groups table for nested groups support
-- ============================================

-- Step 1: Add parent_group_id column to groups table
ALTER TABLE groups 
ADD COLUMN IF NOT EXISTS parent_group_id UUID;

-- Step 2: Add foreign key constraint (optional, but recommended)
-- This ensures that parent_group_id references a valid group
ALTER TABLE groups
ADD CONSTRAINT fk_groups_parent_group 
FOREIGN KEY (parent_group_id) 
REFERENCES groups(id) 
ON DELETE SET NULL;

-- Step 3: Create index for better performance when querying nested groups
CREATE INDEX IF NOT EXISTS idx_groups_parent_group_id ON groups(parent_group_id);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN groups.parent_group_id IS 'Reference to parent group for nested group hierarchy (NULL for top-level groups)';

-- ============================================
-- Migration Complete!
-- ============================================
