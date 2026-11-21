-- UP
-- 072_learning_surfaces.sql
--
-- LearningSurface：教学内容 / 活动容器的稳定身份与学生 attempt 状态底座。
--
-- 设计见 docs/architecture/learning-surface.md。本迁移只做加法：
--   ① learning_surfaces：容器（白板元素 / 学案活动）→ 内容引用的映射；
--   ② learning_surface_attempts：学生 × Surface × 尝试的统一状态。
--
-- 容器侧字段（白板元素 data.surfaceId、lesson_activities.surface_id）在阶段 3 接入；
-- 旧作业表（assignments / plugin_submissions 等）在阶段 2 迁移，本迁移不改动它们。

CREATE TABLE IF NOT EXISTS learning_surfaces (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  content_ref_json TEXT NOT NULL,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 一个容器最多一个 Surface
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_surfaces_kind_owner
  ON learning_surfaces(kind, owner_id);

-- 按课时查活跃 Surface
CREATE INDEX IF NOT EXISTS idx_learning_surfaces_lesson_active
  ON learning_surfaces(lesson_id, deleted_at);

CREATE TABLE IF NOT EXISTS learning_surface_attempts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  surface_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  renderer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  auto_score REAL,
  score REAL,
  max_score REAL,
  completion REAL,
  state_json TEXT,
  is_preview INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER,
  graded_at INTEGER,
  graded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_surface_attempts_unique
  ON learning_surface_attempts(surface_id, student_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_learning_surface_attempts_lesson_student
  ON learning_surface_attempts(lesson_id, student_id);

CREATE INDEX IF NOT EXISTS idx_learning_surface_attempts_surface_preview
  ON learning_surface_attempts(surface_id, is_preview);

-- DOWN
DROP INDEX IF EXISTS idx_learning_surface_attempts_surface_preview;
DROP INDEX IF EXISTS idx_learning_surface_attempts_lesson_student;
DROP INDEX IF EXISTS idx_learning_surface_attempts_unique;
DROP TABLE IF EXISTS learning_surface_attempts;

DROP INDEX IF EXISTS idx_learning_surfaces_lesson_active;
DROP INDEX IF EXISTS idx_learning_surfaces_kind_owner;
DROP TABLE IF EXISTS learning_surfaces;
