-- OhDiary Goals (Habits) Schema Migration
-- Run this in Supabase SQL Editor

-- Table: goals
CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    name TEXT NOT NULL,
    color_hsl TEXT NOT NULL DEFAULT '210, 85%, 55%',
    icon TEXT DEFAULT '🎯',
    
    -- Goal type: check (boolean), timer (duration), number (numeric)
    goal_type TEXT NOT NULL DEFAULT 'check' CHECK (goal_type IN ('check', 'timer', 'number')),
    
    -- Question prompt shown in log dialog
    question TEXT,
    
    -- Unit label (e.g., "นาที", "miles", "pages")
    unit TEXT,
    
    -- Target value (in seconds for timer type, in unit for number type, in count for check type)
    target_value NUMERIC DEFAULT 1,
    
    -- Target direction: at_least (อย่างน้อย) or at_most (ไม่เกิน/Limit)
    target_type TEXT NOT NULL DEFAULT 'at_least' CHECK (target_type IN ('at_least', 'at_most')),
    
    -- Frequency: daily, weekly, monthly
    frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    
    -- Sort order for drag-and-drop reordering
    sort_order INTEGER DEFAULT 0,
    
    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE NULL
);

-- Table: goal_activities (which activities belong to this goal)
CREATE TABLE IF NOT EXISTS goal_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id UUID REFERENCES goals(id) ON DELETE CASCADE NOT NULL,
    activity_id UUID REFERENCES activities(id) ON DELETE CASCADE NOT NULL,
    UNIQUE(goal_id, activity_id)
);

-- Table: goal_categories (if whole group/category is selected)
CREATE TABLE IF NOT EXISTS goal_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id UUID REFERENCES goals(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE NOT NULL,
    UNIQUE(goal_id, category_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_goals_deleted_at ON goals(deleted_at);
CREATE INDEX IF NOT EXISTS idx_goal_activities_goal_id ON goal_activities(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_categories_goal_id ON goal_categories(goal_id);

-- ─── Grant Permissions (required for anon key access) ───────────────
GRANT ALL ON TABLE goals TO anon;
GRANT ALL ON TABLE goals TO authenticated;
GRANT ALL ON TABLE goal_activities TO anon;
GRANT ALL ON TABLE goal_activities TO authenticated;
GRANT ALL ON TABLE goal_categories TO anon;
GRANT ALL ON TABLE goal_categories TO authenticated;

-- Grant sequence usage for UUID generation
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Disable RLS (same pattern as existing tables)
ALTER TABLE goals DISABLE ROW LEVEL SECURITY;
ALTER TABLE goal_activities DISABLE ROW LEVEL SECURITY;
ALTER TABLE goal_categories DISABLE ROW LEVEL SECURITY;


