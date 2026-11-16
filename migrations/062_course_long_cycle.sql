-- UP
-- 062_course_long_cycle.sql
-- 长周期课程标记与课程级课次自动归档阈值。
-- 既有 courses 行均由原「课程层（长周期课程）」创建，回填为长周期。

ALTER TABLE courses ADD COLUMN is_long_cycle INTEGER NOT NULL DEFAULT 1
  CHECK (is_long_cycle IN (0, 1));

ALTER TABLE courses ADD COLUMN auto_archive_after_ms INTEGER;

UPDATE courses SET is_long_cycle = 1 WHERE is_long_cycle IS NULL OR is_long_cycle != 1;

-- DOWN
ALTER TABLE courses DROP COLUMN auto_archive_after_ms;
ALTER TABLE courses DROP COLUMN is_long_cycle;
