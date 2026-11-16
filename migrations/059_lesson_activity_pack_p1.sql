-- UP
-- 059_lesson_activity_pack_p1.sql
-- Gitee IKVO15 P1：跨课节互评、进度催办。学案包导入导出与教师预览不新增表。
-- 互评成绩独立存放，不写入 activity_progress.score，避免与课件/测验/作业成绩双算。

CREATE TABLE IF NOT EXISTS activity_peer_review_cycles (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  lesson_id TEXT,
  title TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  reviews_per_student INTEGER NOT NULL DEFAULT 2,
  rubric_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_peer_cycle_lesson ON activity_peer_review_cycles(lesson_id);
CREATE INDEX IF NOT EXISTS idx_peer_cycle_course ON activity_peer_review_cycles(course_id);

CREATE TABLE IF NOT EXISTS activity_peer_review_assignments (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  reviewer_student_id TEXT NOT NULL,
  reviewee_student_id TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'rejected')),
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (reviewer_student_id != reviewee_student_id),
  UNIQUE (cycle_id, activity_id, reviewer_student_id, reviewee_student_id),
  FOREIGN KEY (cycle_id) REFERENCES activity_peer_review_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES lesson_activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_peer_assign_activity ON activity_peer_review_assignments(activity_id, status);
CREATE INDEX IF NOT EXISTS idx_peer_assign_reviewer ON activity_peer_review_assignments(reviewer_student_id, status);
CREATE INDEX IF NOT EXISTS idx_peer_assign_cycle ON activity_peer_review_assignments(cycle_id);

CREATE TABLE IF NOT EXISTS activity_peer_reviews (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  reviewer_student_id TEXT NOT NULL,
  reviewee_student_id TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  scores_json TEXT NOT NULL DEFAULT '{}',
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'teacher_confirmed', 'teacher_overridden', 'rejected')),
  teacher_feedback TEXT,
  teacher_id TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (assignment_id) REFERENCES activity_peer_review_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES activity_peer_review_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_id) REFERENCES lesson_activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_peer_reviews_cycle ON activity_peer_reviews(cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_peer_reviews_activity ON activity_peer_reviews(activity_id);

CREATE TABLE IF NOT EXISTS activity_peer_review_reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  reporter_student_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'upheld')),
  created_at INTEGER NOT NULL,
  UNIQUE (review_id, reporter_student_id),
  FOREIGN KEY (review_id) REFERENCES activity_peer_reviews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_peer_reports_status ON activity_peer_review_reports(status);

CREATE TABLE IF NOT EXISTS activity_nudges (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  activity_id TEXT,
  student_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_activity_nudges_student ON activity_nudges(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_nudges_activity ON activity_nudges(activity_id, student_id, created_at);

-- DOWN
DROP TABLE IF EXISTS activity_nudges;
DROP TABLE IF EXISTS activity_peer_review_reports;
DROP TABLE IF EXISTS activity_peer_reviews;
DROP TABLE IF EXISTS activity_peer_review_assignments;
DROP TABLE IF EXISTS activity_peer_review_cycles;
