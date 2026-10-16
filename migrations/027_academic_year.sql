-- UP
-- 学年维度 (academic_year)：允许按学年过滤、统计、导出；NULL 表示「未分类」。

ALTER TABLE schedules ADD COLUMN academic_year TEXT;
ALTER TABLE assignments ADD COLUMN academic_year TEXT;
ALTER TABLE assignment_submissions ADD COLUMN academic_year TEXT;
ALTER TABLE exams ADD COLUMN academic_year TEXT;
ALTER TABLE exam_scores ADD COLUMN academic_year TEXT;
ALTER TABLE attendance ADD COLUMN academic_year TEXT;
ALTER TABLE student_semester_reports ADD COLUMN academic_year TEXT;
ALTER TABLE student_lesson_progress ADD COLUMN academic_year TEXT;
ALTER TABLE classroom_sessions ADD COLUMN academic_year TEXT;

ALTER TABLE site_settings ADD COLUMN current_academic_year TEXT;
ALTER TABLE site_settings ADD COLUMN academic_start_month INTEGER DEFAULT 9;

CREATE INDEX IF NOT EXISTS idx_schedules_academic_year ON schedules(academic_year);
CREATE INDEX IF NOT EXISTS idx_assignments_academic_year ON assignments(academic_year);
CREATE INDEX IF NOT EXISTS idx_attendance_academic_year ON attendance(academic_year);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_academic_year ON classroom_sessions(academic_year);

-- DOWN
DROP INDEX IF EXISTS idx_classroom_sessions_academic_year;
DROP INDEX IF EXISTS idx_attendance_academic_year;
DROP INDEX IF EXISTS idx_assignments_academic_year;
DROP INDEX IF EXISTS idx_schedules_academic_year;
