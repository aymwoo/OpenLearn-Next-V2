-- UP
-- 作业中心（Assignment Hub）
--
-- 背景：白板上的「课堂作业任务」教学对象此前只有一个模拟上传按钮，而平台真正的
-- 提交/互评/评分链路（plugin_submissions / plugin_peer_reviews / plugin_grades）
-- 只按 lesson_id 记录、且重交会覆盖历史。本次把作业提升为一等实体：
--   plugin_assignments       作业实体（可同时挂 lesson_id + class_id + 白板元素 id）
--   plugin_submission_versions 每次提交留档（重交不丢历史）
--   plugin_assignment_files   上传文件元数据（实体文件落盘，下载端点据此鉴权）
--   plugin_peer_review_tasks  互评任务分配（谁评谁 / 匿名 / 截止）
-- 并给 plugin_submissions 增加 assignment_id、plugin_grades / plugin_peer_reviews
-- 补充作业维度与发布字段。

CREATE TABLE IF NOT EXISTS plugin_assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT,
  lesson_id TEXT,
  element_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  due_at INTEGER,
  allow_late INTEGER NOT NULL DEFAULT 1,
  allow_text INTEGER NOT NULL DEFAULT 1,
  allow_link INTEGER NOT NULL DEFAULT 0,
  max_files INTEGER NOT NULL DEFAULT 10,
  max_file_size INTEGER NOT NULL DEFAULT 20971520,
  allowed_ext TEXT NOT NULL DEFAULT '',
  peer_review_mode TEXT NOT NULL DEFAULT 'assigned',
  peer_review_count INTEGER NOT NULL DEFAULT 2,
  peer_review_due_at INTEGER,
  teacher_weight REAL NOT NULL DEFAULT 0.6,
  peer_weight REAL NOT NULL DEFAULT 0.4,
  status TEXT NOT NULL DEFAULT 'published',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_assignments_element ON plugin_assignments(element_id);
CREATE INDEX IF NOT EXISTS idx_plugin_assignments_lesson ON plugin_assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_plugin_assignments_class ON plugin_assignments(class_id);

-- plugin_submissions 需要从「按 lesson 唯一」改为「按 assignment 唯一」，
-- SQLite 无法删除表级 UNIQUE 约束，因此重建表并保留旧数据（旧数据 assignment_id 为 NULL）。
CREATE TABLE IF NOT EXISTS plugin_submissions_new (
  id TEXT PRIMARY KEY,
  assignment_id TEXT,
  lesson_id TEXT,
  student_id TEXT NOT NULL,
  file_path TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO plugin_submissions_new
  (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
SELECT id, NULL, lesson_id, student_id, file_path, version, created_at, updated_at FROM plugin_submissions;

DROP TABLE IF EXISTS plugin_submissions;
ALTER TABLE plugin_submissions_new RENAME TO plugin_submissions;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_submissions_assignment_student ON plugin_submissions(assignment_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_submissions_legacy ON plugin_submissions(lesson_id, student_id) WHERE assignment_id IS NULL;

CREATE TABLE IF NOT EXISTS plugin_submission_versions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  assignment_id TEXT,
  student_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  files_json TEXT NOT NULL DEFAULT '[]',
  text_content TEXT,
  link_url TEXT,
  is_late INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  UNIQUE(submission_id, version)
);

CREATE INDEX IF NOT EXISTS idx_plugin_submission_versions_submission ON plugin_submission_versions(submission_id);

CREATE TABLE IF NOT EXISTS plugin_assignment_files (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  submission_id TEXT,
  version_id TEXT,
  student_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  sha256 TEXT,
  uploaded_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plugin_assignment_files_owner ON plugin_assignment_files(assignment_id, student_id);

CREATE TABLE IF NOT EXISTS plugin_peer_review_tasks (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(submission_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_peer_review_tasks_reviewer ON plugin_peer_review_tasks(reviewer_id, status);

ALTER TABLE plugin_peer_reviews ADD COLUMN assignment_id TEXT;
ALTER TABLE plugin_peer_reviews ADD COLUMN task_id TEXT;
ALTER TABLE plugin_peer_reviews ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plugin_peer_reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'submitted';
ALTER TABLE plugin_peer_reviews ADD COLUMN updated_at INTEGER;

ALTER TABLE plugin_grades ADD COLUMN assignment_id TEXT;
ALTER TABLE plugin_grades ADD COLUMN peer_average_score REAL;
ALTER TABLE plugin_grades ADD COLUMN source TEXT NOT NULL DEFAULT 'teacher';
ALTER TABLE plugin_grades ADD COLUMN published_at INTEGER;
ALTER TABLE plugin_grades ADD COLUMN graded_by TEXT;

-- DOWN
DROP INDEX IF EXISTS idx_plugin_peer_review_tasks_reviewer;
DROP TABLE IF EXISTS plugin_peer_review_tasks;
DROP INDEX IF EXISTS idx_plugin_assignment_files_owner;
DROP TABLE IF EXISTS plugin_assignment_files;
DROP INDEX IF EXISTS idx_plugin_submission_versions_submission;
DROP TABLE IF EXISTS plugin_submission_versions;

DROP INDEX IF EXISTS idx_plugin_submissions_legacy;
DROP INDEX IF EXISTS idx_plugin_submissions_assignment_student;
CREATE TABLE IF NOT EXISTS plugin_submissions_legacy (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(lesson_id, student_id)
);
INSERT OR IGNORE INTO plugin_submissions_legacy (id, lesson_id, student_id, file_path, version, created_at, updated_at)
SELECT id, COALESCE(lesson_id, assignment_id), student_id, COALESCE(file_path, ''), version, created_at, updated_at
FROM plugin_submissions;
DROP TABLE IF EXISTS plugin_submissions;
ALTER TABLE plugin_submissions_legacy RENAME TO plugin_submissions;

DROP INDEX IF EXISTS idx_plugin_assignments_class;
DROP INDEX IF EXISTS idx_plugin_assignments_lesson;
DROP INDEX IF EXISTS idx_plugin_assignments_element;
DROP TABLE IF EXISTS plugin_assignments;
