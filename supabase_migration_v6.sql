-- Migration v6: Add user_layouts table for customizable dashboard

-- Create user_layouts table
CREATE TABLE IF NOT EXISTS user_layouts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    layout JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_layouts_user_id ON user_layouts(user_id);

-- Enable RLS
ALTER TABLE user_layouts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own layouts
CREATE POLICY "Users can view their own layouts"
    ON user_layouts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own layouts"
    ON user_layouts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own layouts"
    ON user_layouts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own layouts"
    ON user_layouts FOR DELETE
    USING (auth.uid() = user_id);

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_layouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_layouts_updated_at
    BEFORE UPDATE ON user_layouts
    FOR EACH ROW
    EXECUTE FUNCTION update_user_layouts_updated_at();
