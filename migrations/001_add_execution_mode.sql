-- UP
-- Phase 5: Worker isolation mode support — execution_mode column for plugins table
ALTER TABLE plugins ADD COLUMN execution_mode TEXT DEFAULT 'inline';

-- DOWN
-- Note: SQLite does not support DROP COLUMN in earlier versions without table recreation.
