-- UP
-- 063_course_lesson_refs.sql
-- 长周期课程与常规课节改为多对多引用：一门常规课可被多门长周期课程同时挂接。
-- 既有 lessons.course_id / course_order 回填到 course_lessons；之后以本表为准。
-- lessons.course_id、course_order 列保留，不再作为挂接的唯一来源。

CREATE TABLE IF NOT EXISTS course_lessons (
  course_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  course_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (course_id, lesson_id),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_lesson ON course_lessons(lesson_id);
CREATE INDEX IF NOT EXISTS idx_course_lessons_course_order ON course_lessons(course_id, course_order);

INSERT OR IGNORE INTO course_lessons (course_id, lesson_id, course_order, created_at)
SELECT l.course_id, l.id, COALESCE(l.course_order, 0), COALESCE(l.updated_at, l.created_at, 0)
  FROM lessons l
 WHERE l.course_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM courses c WHERE c.id = l.course_id);

-- DOWN
DROP INDEX IF EXISTS idx_course_lessons_course_order;
DROP INDEX IF EXISTS idx_course_lessons_lesson;
DROP TABLE IF EXISTS course_lessons;
