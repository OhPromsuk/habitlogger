-- Run this SQL in your Supabase SQL Editor to add sorting support
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;
