-- UP
-- 058_lesson_activity_pack.sql
-- Gitee IKVO15 P0：课时级学案包（活动序列 + 活动级进度 + 学案首页区块）。
-- 迁移号使用 058：未合并的 !7（IKVNIX 长周期课次）已占用 057，避免双 PR 落地时序号冲突。
-- lessons.course_id 为可空预留列，供以后课程层挂接，既有数据无需迁移。
-- 本迁移不创建 courses 表，不改动 timeline / 门禁相关表。

ALTER TABLE lessons ADD COLUMN course_id TEXT;
CREATE INDEX IF NOT EXISTS idx_lessons_course_id ON lessons(course_id);

CREATE TABLE IF NOT EXISTS lesson_activities (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reading', 'courseware', 'quiz', 'submission')),
  title TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  visible INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0, 1)),
  peer_review INTEGER NOT NULL DEFAULT 0 CHECK (peer_review IN (0, 1)),
  group_mode INTEGER NOT NULL DEFAULT 0 CHECK (group_mode IN (0, 1)),
  submission_type TEXT,
  rubric_json TEXT,
  release_at INTEGER,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_order ON lesson_activities(lesson_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_visible ON lesson_activities(lesson_id, visible);

CREATE TABLE IF NOT EXISTS lesson_activity_blocks (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (
    block_type IN (
      'learning_goals',
      'key_points',
      'resources',
      'operation_tips',
      'work_appreciation',
      'freeform'
    )
  ),
  order_index INTEGER NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lesson_activity_blocks_lesson_order ON lesson_activity_blocks(lesson_id, order_index);

CREATE TABLE IF NOT EXISTS activity_progress (
  student_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted', 'graded')),
  progress_percent INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  score REAL,
  feedback TEXT,
  graded_at INTEGER,
  last_activity_at INTEGER,
  PRIMARY KEY (student_id, activity_id),
  FOREIGN KEY (activity_id) REFERENCES lesson_activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_progress_activity ON activity_progress(activity_id, status);
CREATE INDEX IF NOT EXISTS idx_activity_progress_student ON activity_progress(student_id);

-- DOWN
DROP TABLE IF EXISTS activity_progress;
DROP TABLE IF EXISTS lesson_activity_blocks;
DROP TABLE IF EXISTS lesson_activities;
DROP INDEX IF EXISTS idx_lessons_course_id;
ALTER TABLE lessons DROP COLUMN course_id;
