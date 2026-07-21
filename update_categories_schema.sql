-- 1. Create categories table
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_default(),
    name TEXT NOT NULL,
    color_hsl TEXT DEFAULT '210, 80%, 60%',
    icon TEXT DEFAULT '📁',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add category_id to activities table
ALTER TABLE activities ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

-- 3. Grant permissions for categories table
GRANT ALL ON categories TO anon;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;

-- Insert Default Standard Categories if none exist
INSERT INTO categories (name, color_hsl, icon) VALUES
('นอนพักผ่อน', '270, 70%, 60%', '😴'),
('ดูแลสุขภาพ', '140, 70%, 50%', '🥗'),
('งานและการเรียน', '210, 80%, 55%', '💼'),
('งานอดิเรก & พักผ่อน', '30, 85%, 55%', '🎮'),
('งานบ้าน & กิจวัตร', '200, 60%, 50%', '🧹');
