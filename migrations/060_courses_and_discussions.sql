-- UP
-- 060_courses_and_discussions.sql
-- Gitee IKVO15 P2：课程层（courses 一级实体）与最小讨论区。
-- lessons.course_id 已在 058 预留；本迁移补充课程表、选课、课节排序，以及课程/课节讨论。
-- 讨论区为自建最小可用实现，不做投票、分组或富文本编辑器。

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_user_id TEXT NOT NULL,
  term TEXT,
  visibility TEXT NOT NULL DEFAULT 'enrolled'
    CHECK (visibility IN ('private', 'enrolled', 'public')),
  thumbnail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_owner ON courses(owner_user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_courses_visibility ON courses(visibility);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  class_id TEXT,
  student_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (class_id IS NOT NULL OR student_id IS NOT NULL),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_course_enroll_class
  ON course_enrollments(course_id, class_id)
  WHERE class_id IS NOT NULL AND student_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_enroll_student
  ON course_enrollments(course_id, student_id)
  WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_course_enroll_class_lookup
  ON course_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_course_enroll_student_lookup
  ON course_enrollments(student_id);

-- 课节在课程中的排序；既有 course_id 行默认 0，由服务在挂接时写入。
ALTER TABLE lessons ADD COLUMN course_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS discussion_threads (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  lesson_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_user_id TEXT,
  author_student_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (course_id IS NOT NULL OR lesson_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_discussion_threads_course ON discussion_threads(course_id, pinned, updated_at);
CREATE INDEX IF NOT EXISTS idx_discussion_threads_lesson ON discussion_threads(lesson_id, updated_at);

CREATE TABLE IF NOT EXISTS discussion_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_id TEXT,
  body TEXT NOT NULL,
  author_user_id TEXT,
  author_student_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  FOREIGN KEY (thread_id) REFERENCES discussion_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discussion_posts_thread ON discussion_posts(thread_id, created_at);

CREATE TABLE IF NOT EXISTS discussion_reports (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  post_id TEXT,
  reporter_user_id TEXT,
  reporter_student_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'upheld')),
  created_at INTEGER NOT NULL,
  CHECK (thread_id IS NOT NULL OR post_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_discussion_reports_status ON discussion_reports(status);

-- DOWN
DROP TABLE IF EXISTS discussion_reports;
DROP TABLE IF EXISTS discussion_posts;
DROP TABLE IF EXISTS discussion_threads;
DROP INDEX IF EXISTS idx_course_enroll_student_lookup;
DROP INDEX IF EXISTS idx_course_enroll_class_lookup;
DROP INDEX IF EXISTS idx_course_enroll_student;
DROP INDEX IF EXISTS idx_course_enroll_class;
DROP TABLE IF EXISTS course_enrollments;
DROP TABLE IF EXISTS courses;
-- SQLite 3.35+ 支持 DROP COLUMN
ALTER TABLE lessons DROP COLUMN course_order;
