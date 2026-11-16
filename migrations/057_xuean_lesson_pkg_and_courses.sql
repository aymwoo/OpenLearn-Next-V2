-- UP
-- 057_xuean_lesson_pkg_and_courses.sql
-- Issue IKVO15：学案式课时包 + 课程层统一模型（P0 数据模型）
-- 新增：courses / course_enrollments / lesson_activities / lesson_activity_blocks / activity_progress
-- 修改：lessons 新增可空 course_id（既有数据零迁移）
-- 设计要点：
--   ① 活动与 timeline 并列而非嵌套，活动完成不自动推进课堂门禁
--   ② student_lesson_progress 保留为汇总层，主口径迁到 activity_progress
--   ③ verified 区分自报与验证，防自刷；peer_review / group_mode 为 P1 预留
--   ④ courses 表 P0 先建壳，P2 正式使用；lessons.course_id 可空挂起

-- ── 课程层（P0 建壳，P2 激活）──────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id TEXT NOT NULL,
  term TEXT,
  visibility TEXT DEFAULT 'private',
  thumbnail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  course_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  class_id TEXT,
  enrolled_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_course_enrollments_class
  ON course_enrollments(class_id);

-- ── lessons 挂 course_id（可空，零迁移）────────────────────────────
ALTER TABLE lessons ADD COLUMN course_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lessons_course
  ON lessons(course_id);

-- ── 学案核心：活动序列 + 首页块 + 活动级进度 ────────────────────────
CREATE TABLE IF NOT EXISTS lesson_activities (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  config_json TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  visible INTEGER NOT NULL DEFAULT 1,
  peer_review INTEGER NOT NULL DEFAULT 0,
  group_mode TEXT DEFAULT 'none',
  submission_type TEXT,
  rubric_json TEXT,
  release_at INTEGER,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lesson_activities_lesson_order
  ON lesson_activities(lesson_id, order_index);

CREATE TABLE IF NOT EXISTS lesson_activity_blocks (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  block_type TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  content_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lesson_activity_blocks_lesson_order
  ON lesson_activity_blocks(lesson_id, order_index);

CREATE TABLE IF NOT EXISTS activity_progress (
  activity_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  graded_at INTEGER,
  last_activity_at INTEGER,
  PRIMARY KEY (activity_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_progress_student
  ON activity_progress(student_id);

CREATE INDEX IF NOT EXISTS idx_activity_progress_status
  ON activity_progress(status);

-- DOWN
DROP INDEX IF EXISTS idx_activity_progress_status;
DROP INDEX IF EXISTS idx_activity_progress_student;
DROP TABLE IF EXISTS activity_progress;

DROP INDEX IF EXISTS idx_lesson_activity_blocks_lesson_order;
DROP TABLE IF EXISTS lesson_activity_blocks;

DROP INDEX IF EXISTS idx_lesson_activities_lesson_order;
DROP TABLE IF EXISTS lesson_activities;

DROP INDEX IF EXISTS idx_lessons_course;
-- SQLite ALTER TABLE DROP COLUMN 需要 3.35+；降级处理：重建不带 course_id 的 lessons
-- 生产环境 3.35+ 直接用 ALTER TABLE 即可；兼容保留重建路径
ALTER TABLE lessons DROP COLUMN course_id;

DROP INDEX IF EXISTS idx_course_enrollments_class;
DROP TABLE IF EXISTS course_enrollments;
DROP TABLE IF EXISTS courses;
