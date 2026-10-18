-- UP
-- 课前破冰心情打卡持久化与去重（Issue #131）
-- 记录班级、课节、学生的心情打卡状态，支持当日/当堂重复打卡幂等更新

CREATE TABLE IF NOT EXISTS icebreaker_checkins (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  lesson_id TEXT,
  scope_key TEXT NOT NULL,
  student_id TEXT NOT NULL,
  mood TEXT NOT NULL,
  checkin_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_icebreaker_scope_student
  ON icebreaker_checkins(class_id, scope_key, student_id);

CREATE INDEX IF NOT EXISTS idx_icebreaker_lookup
  ON icebreaker_checkins(class_id, lesson_id, checkin_date);

-- DOWN
DROP INDEX IF EXISTS idx_icebreaker_lookup;
DROP INDEX IF EXISTS idx_icebreaker_scope_student;
DROP TABLE IF EXISTS icebreaker_checkins;
