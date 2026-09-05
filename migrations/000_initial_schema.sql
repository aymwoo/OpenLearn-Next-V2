-- UP
-- OpenLearn Core Initial Schema

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  correlationId TEXT
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  timeline TEXT,
  progress_mode TEXT DEFAULT 'manual',
  progress_conditions TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS whiteboard_elements (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manifest TEXT NOT NULL,
  source_code TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  loader_version TEXT DEFAULT 'vm',
  zip_package BLOB,
  file_path TEXT DEFAULT NULL,
  updated_at INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS pending_commands (
  id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS processes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  task_type TEXT,
  payload TEXT,
  state TEXT,
  logs TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vfs_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  lab_id TEXT,
  class_passcode TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_number TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  password TEXT,
  locked_lesson_id TEXT,
  private_notes TEXT,
  avatar TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS class_students (
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS student_lesson_progress (
  student_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  completed_segments TEXT,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  lesson_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  content TEXT,
  score INTEGER,
  feedback TEXT,
  submitted_at INTEGER NOT NULL,
  graded_at INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted',
  PRIMARY KEY (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  time_slot TEXT,
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  schedule_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, student_id)
);

CREATE TABLE IF NOT EXISTS system_resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS computer_labs (
  id TEXT PRIMARY KEY,
  room_number TEXT NOT NULL,
  rows INTEGER NOT NULL,
  cols INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_seats (
  class_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  lab_id TEXT NOT NULL,
  row_idx INTEGER NOT NULL,
  col_idx INTEGER NOT NULL,
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  avatar TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_sessions (
  id TEXT PRIMARY KEY,
  session_data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_read_notifications (
  student_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  PRIMARY KEY (student_id, notification_id)
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key TEXT,
  model_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  max_score INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_scores (
  exam_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  score REAL,
  notes TEXT,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_grade_weights (
  class_id TEXT PRIMARY KEY,
  attendance_weight REAL NOT NULL DEFAULT 0.15,
  progress_weight REAL NOT NULL DEFAULT 0.25,
  assignment_weight REAL NOT NULL DEFAULT 0.35,
  exam_weight REAL NOT NULL DEFAULT 0.25,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_semester_reports (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  semester_name TEXT NOT NULL,
  attendance_score REAL NOT NULL,
  progress_score REAL NOT NULL,
  assignment_score REAL NOT NULL,
  exam_score REAL NOT NULL,
  total_score REAL NOT NULL,
  grade_level TEXT NOT NULL,
  teacher_evaluation TEXT,
  ai_evaluation TEXT,
  dimension_scores TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(student_id, class_id, semester_name)
);

CREATE TABLE IF NOT EXISTS student_point_logs (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  dimension_id TEXT NOT NULL,
  plugin_id TEXT,
  delta_points REAL NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS courseware (
  id TEXT PRIMARY KEY,
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  entry TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS courseware_attempt (
  id TEXT PRIMARY KEY,
  courseware_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_raw (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_result (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  score REAL,
  comment TEXT,
  completion REAL,
  extra_json TEXT
);

CREATE TABLE IF NOT EXISTS mfe_remotes (
  name TEXT PRIMARY KEY,
  entry TEXT NOT NULL,
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_submissions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(lesson_id, student_id)
);

CREATE TABLE IF NOT EXISTS plugin_peer_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(submission_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS plugin_grades (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  teacher_score INTEGER,
  teacher_comment TEXT,
  teacher_weight REAL NOT NULL DEFAULT 0.6,
  peer_weight REAL NOT NULL DEFAULT 0.4,
  calculated_final_score INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  graded_at INTEGER
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_whiteboard_lesson ON whiteboard_elements(lesson_id);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);
CREATE INDEX IF NOT EXISTS idx_schedules_class_date ON schedules(class_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_courseware_attempt_cw_st ON courseware_attempt(courseware_id, student_id);
CREATE INDEX IF NOT EXISTS idx_submission_result_attempt ON submission_result(attempt_id);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, timestamp);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_schedule ON attendance(schedule_id);

-- DOWN
DROP INDEX IF EXISTS idx_attendance_schedule;
DROP INDEX IF EXISTS idx_assignments_class;
DROP INDEX IF EXISTS idx_events_type_time;
DROP INDEX IF EXISTS idx_submission_result_attempt;
DROP INDEX IF EXISTS idx_courseware_attempt_cw_st;
DROP INDEX IF EXISTS idx_schedules_class_date;
DROP INDEX IF EXISTS idx_class_students_student;
DROP INDEX IF EXISTS idx_class_students_class;
DROP INDEX IF EXISTS idx_whiteboard_lesson;
DROP TABLE IF EXISTS plugin_grades;
DROP TABLE IF EXISTS plugin_peer_reviews;
DROP TABLE IF EXISTS plugin_submissions;
DROP TABLE IF EXISTS mfe_remotes;
DROP TABLE IF EXISTS submission_result;
DROP TABLE IF EXISTS submission_raw;
DROP TABLE IF EXISTS courseware_attempt;
DROP TABLE IF EXISTS courseware;
DROP TABLE IF EXISTS student_point_logs;
DROP TABLE IF EXISTS student_semester_reports;
DROP TABLE IF EXISTS class_grade_weights;
DROP TABLE IF EXISTS exam_scores;
DROP TABLE IF EXISTS exams;
DROP TABLE IF EXISTS ai_providers;
DROP TABLE IF EXISTS student_read_notifications;
DROP TABLE IF EXISTS client_sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS student_seats;
DROP TABLE IF EXISTS computer_labs;
DROP TABLE IF EXISTS system_resources;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS assignment_submissions;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS student_lesson_progress;
DROP TABLE IF EXISTS class_students;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS vfs_nodes;
DROP TABLE IF EXISTS processes;
DROP TABLE IF EXISTS pending_commands;
DROP TABLE IF EXISTS plugin_storage;
DROP TABLE IF EXISTS plugins;
DROP TABLE IF EXISTS whiteboard_elements;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS events;
