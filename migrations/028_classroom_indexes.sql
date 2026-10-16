-- UP
-- 补齐课堂互动与会话高频查询/级联删除索引
CREATE INDEX IF NOT EXISTS idx_classroom_buzzers_session ON classroom_buzzers(session_id);
CREATE INDEX IF NOT EXISTS idx_classroom_buzzers_lesson ON classroom_buzzers(lesson_id);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_class ON classroom_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_created_at ON classroom_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_classroom_sessions_teacher ON classroom_sessions(teacher_id);

-- DOWN
DROP INDEX IF EXISTS idx_classroom_sessions_teacher;
DROP INDEX IF EXISTS idx_classroom_sessions_created_at;
DROP INDEX IF EXISTS idx_classroom_sessions_class;
DROP INDEX IF EXISTS idx_classroom_buzzers_lesson;
DROP INDEX IF EXISTS idx_classroom_buzzers_session;
