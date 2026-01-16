-- ============================================
-- Supabase Migration v5: Groups Table
-- ============================================
-- Run this in your Supabase SQL Editor
-- ============================================
-- This migration adds:
-- 1. groups table for folder-like group management
-- 2. color and is_pinned fields for enhanced UX
-- 3. Migration of existing groups from receipts
-- ============================================

-- Step 1: Create groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3b82f6', -- Default blue color
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Step 2: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_groups_user_id ON groups(user_id);
CREATE INDEX IF NOT EXISTS idx_groups_is_pinned ON groups(is_pinned);
CREATE INDEX IF NOT EXISTS idx_groups_user_pinned ON groups(user_id, is_pinned);

-- Step 3: Enable RLS on groups
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policies for groups
DROP POLICY IF EXISTS "groups_all" ON groups;
CREATE POLICY "groups_all" ON groups 
  FOR ALL 
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Step 5: Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create trigger for updated_at
DROP TRIGGER IF EXISTS groups_updated_at ON groups;
CREATE TRIGGER groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW
  EXECUTE FUNCTION update_groups_updated_at();

-- Step 7: Migrate existing groups from receipts to groups table
-- This creates groups based on unique groupId/groupName combinations in receipts
INSERT INTO groups (user_id, name, color, is_pinned, created_at, updated_at)
SELECT DISTINCT
  r.user_id,
  r.group_name,
  '#3b82f6' as color, -- Default blue color
  FALSE as is_pinned,
  MIN(r.created_at) as created_at,
  MAX(r.updated_at) as updated_at
FROM receipts r
WHERE r.group_id IS NOT NULL 
  AND r.group_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM groups g 
    WHERE g.user_id = r.user_id 
    AND g.name = r.group_name
  )
GROUP BY r.user_id, r.group_name;

-- Step 8: Update receipts.group_id to reference groups.id
-- Match receipts to groups by user_id and group_name
-- Compare UUID to UUID (both columns are UUID type)
UPDATE receipts r
SET group_id = g.id
FROM groups g
WHERE r.user_id = g.user_id
  AND r.group_name = g.name
  AND r.group_id IS NOT NULL
  AND r.group_id != g.id;

-- Step 9: Add comment for documentation
COMMENT ON TABLE groups IS 'User-created groups for organizing receipts with colors and pinning';
COMMENT ON COLUMN groups.color IS 'Hex color code for group display (e.g., #3b82f6)';
COMMENT ON COLUMN groups.is_pinned IS 'Whether the group should appear at the top of the list';
