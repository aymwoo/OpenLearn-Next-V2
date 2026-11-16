-- UP
-- 061_lesson_programming_and_artifacts.sql
-- Gitee IKVO15：学案编程活动（Scratch / Python / 流程图 / 思维导图）与活动作品草稿；
-- 导入后悬空资源可重新关联（不改表结构，只扩展 type 约束）。
-- 扩 CHECK 须重建 lesson_activities；activity_peer_review_* 有外键指向该表，迁移期间关闭外键。

PRAGMA foreign_keys = OFF;

CREATE TABLE lesson_activities_new (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('reading', 'courseware', 'quiz', 'submission', 'programming')),
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

INSERT INTO lesson_activities_new (
  id, lesson_id, order_index, type, title, config_json, required, visible,
  peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at
)
SELECT
  id, lesson_id, order_index, type, title, config_json, required, visible,
  peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at
FROM lesson_activities;

DROP TABLE lesson_activities;
ALTER TABLE lesson_activities_new RENAME TO lesson_activities;

CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_order ON lesson_activities(lesson_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_visible ON lesson_activities(lesson_id, visible);

ALTER TABLE activity_progress ADD COLUMN artifact_json TEXT;

PRAGMA foreign_keys = ON;

-- DOWN
PRAGMA foreign_keys = OFF;

CREATE TABLE lesson_activities_old (
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

INSERT INTO lesson_activities_old (
  id, lesson_id, order_index, type, title, config_json, required, visible,
  peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at
)
SELECT
  id, lesson_id, order_index, type, title, config_json, required, visible,
  peer_review, group_mode, submission_type, rubric_json, release_at, due_at, created_at, updated_at
FROM lesson_activities
WHERE type IN ('reading', 'courseware', 'quiz', 'submission');

DROP TABLE lesson_activities;
ALTER TABLE lesson_activities_old RENAME TO lesson_activities;
CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_order ON lesson_activities(lesson_id, order_index);
CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_visible ON lesson_activities(lesson_id, visible);

-- SQLite cannot cheaply drop a column in all versions used here; leave artifact_json if present.

PRAGMA foreign_keys = ON;
