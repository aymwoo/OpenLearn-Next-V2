-- UP
-- Interactive Classroom & Lesson Lifecycle Runtime Tables

CREATE TABLE IF NOT EXISTS lesson_quiz_submissions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT,
  answer TEXT NOT NULL,
  score REAL DEFAULT 0,
  is_correct INTEGER DEFAULT 0,
  time_spent_ms INTEGER DEFAULT 0,
  submitted_at INTEGER NOT NULL,
  -- CONCUR-01：唯一键必须含 lesson_id。否则同一 element_id 被多个课节
  -- 复用时（课程复制 / 同模板多节课），后一节课的作答会覆盖前一节课的记录。
  UNIQUE(lesson_id, element_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lqs_lesson_element ON lesson_quiz_submissions(lesson_id, element_id);
CREATE INDEX IF NOT EXISTS idx_lqs_lesson_student ON lesson_quiz_submissions(lesson_id, student_id);
CREATE INDEX IF NOT EXISTS idx_lqs_student ON lesson_quiz_submissions(student_id);

CREATE TABLE IF NOT EXISTS classroom_sessions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  class_id TEXT,
  teacher_id TEXT NOT NULL,
  stage TEXT DEFAULT 'PRE_CLASS_READY',
  current_segment_id TEXT,
  checkin_code TEXT,
  focus_mode INTEGER DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER,
  settings_json TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_lesson ON classroom_sessions(lesson_id, stage);

CREATE TABLE IF NOT EXISTS classroom_quick_polls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  question_type TEXT NOT NULL,
  title TEXT,
  options_json TEXT NOT NULL,
  correct_option TEXT,
  status TEXT DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cqp_session ON classroom_quick_polls(session_id, status);

CREATE TABLE IF NOT EXISTS classroom_poll_votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT,
  selected_option TEXT NOT NULL,
  voted_at INTEGER NOT NULL,
  UNIQUE(poll_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cpv_poll ON classroom_poll_votes(poll_id);

CREATE TABLE IF NOT EXISTS classroom_buzzers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'READY',
  winner_student_id TEXT,
  winner_student_name TEXT,
  winner_response_time_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classroom_exit_tickets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT,
  rating INTEGER,
  puzzled_concept TEXT,
  feedback TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cet_session ON classroom_exit_tickets(session_id);

CREATE TABLE IF NOT EXISTS classroom_pacing_signals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cps_session ON classroom_pacing_signals(session_id, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_cps_session;
DROP TABLE IF EXISTS classroom_pacing_signals;
DROP INDEX IF EXISTS idx_cet_session;
DROP TABLE IF EXISTS classroom_exit_tickets;
DROP TABLE IF EXISTS classroom_buzzers;
DROP INDEX IF EXISTS idx_cpv_poll;
DROP TABLE IF EXISTS classroom_poll_votes;
DROP INDEX IF EXISTS idx_cqp_session;
DROP TABLE IF EXISTS classroom_quick_polls;
DROP INDEX IF EXISTS idx_cs_lesson;
DROP TABLE IF EXISTS classroom_sessions;
DROP INDEX IF EXISTS idx_lqs_lesson_student;
DROP INDEX IF EXISTS idx_lqs_student;
DROP INDEX IF EXISTS idx_lqs_lesson_element;
DROP TABLE IF EXISTS lesson_quiz_submissions;
