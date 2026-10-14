-- UP
-- 教学环节门槛：按学生记录在某一环节上的停留，以及教师对「某学生 × 某环节」的放行。
-- 签到若没有排课行，lesson_checkins 仍留下课节级到课事实，供 checked_in 条件读取。

CREATE TABLE IF NOT EXISTS segment_visits (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  left_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_segment_visits_lookup
  ON segment_visits(lesson_id, student_id, segment_id);

CREATE TABLE IF NOT EXISTS segment_gate_overrides (
  lesson_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, segment_id, student_id)
);

CREATE TABLE IF NOT EXISTS lesson_checkins (
  lesson_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  checked_in_at INTEGER NOT NULL,
  PRIMARY KEY (lesson_id, student_id)
);

-- DOWN
DROP TABLE IF EXISTS lesson_checkins;
DROP TABLE IF EXISTS segment_gate_overrides;
DROP TABLE IF EXISTS segment_visits;
