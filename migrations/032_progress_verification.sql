-- UP
-- 032_progress_verification.sql
-- 学习进度区分「学生自报」与「已验证」：成绩只计入已验证进度。
--   verified = 1            由教师/管理员、课件自动录入或受信插件写入
--   verified_progress_percent 该次验证对应的进度值（学生自报只改展示值，不覆盖此列）
--
-- 历史数据：修复前所有进度都直接计入成绩，为保持既有成绩口径，全部回填为已验证。

ALTER TABLE student_lesson_progress ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE student_lesson_progress ADD COLUMN verified_progress_percent INTEGER;

UPDATE student_lesson_progress
SET verified = 1, verified_progress_percent = progress_percent;

-- DOWN
ALTER TABLE student_lesson_progress DROP COLUMN verified_progress_percent;
ALTER TABLE student_lesson_progress DROP COLUMN verified;
