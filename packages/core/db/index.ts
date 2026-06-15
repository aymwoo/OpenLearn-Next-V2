import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const getDbDirname = () => {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  try {
    const metaUrl = (new Function('return import.meta.url'))();
    if (metaUrl) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch (e) {
    // Ignore error in environments where import.meta is not available
  }
  if (typeof module !== 'undefined' && (module as any).path) {
    return (module as any).path;
  }
  return process.cwd();
};
const dbPath = path.join(getDbDirname(), 'educational_os.db');

export const db = new Database(dbPath);

// Initialize schemas
db.exec(`
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
    created_at INTEGER NOT NULL
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
    status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted', 'graded'
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
    created_at INTEGER NOT NULL,
    status TEXT DEFAULT 'active'
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(student_id, class_id, semester_name)
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
`);

try {
  db.prepare('ALTER TABLE classes ADD COLUMN lab_id TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE classes ADD COLUMN class_passcode TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE students ADD COLUMN locked_lesson_id TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE students ADD COLUMN password TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE students ADD COLUMN private_notes TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE students ADD COLUMN student_number TEXT').run();
  db.prepare("UPDATE students SET student_number = 'ST_' || id WHERE student_number IS NULL OR student_number = ''").run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE lessons ADD COLUMN timeline TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE lessons ADD COLUMN progress_mode TEXT DEFAULT "manual"').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE lessons ADD COLUMN progress_conditions TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE student_lesson_progress ADD COLUMN completed_segments TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE schedules ADD COLUMN time_slot TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE schedules ADD COLUMN status TEXT DEFAULT "scheduled"').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE schedules ADD COLUMN notes TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE assignments ADD COLUMN lesson_id TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE users ADD COLUMN status TEXT DEFAULT "active"').run();
} catch (e) {
  // column already exists
}

try {
  const countObj = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (countObj && countObj.cnt === 0) {
    console.log('Seeding default users (admin & teacher)...');
    const insertStmt = db.prepare('INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const hashPassword = (pwd: string) => crypto.createHash('sha256').update(pwd).digest('hex');
    insertStmt.run('usr_admin', 'admin', hashPassword('admin'), 'administrator', 'System Admin', Date.now());
    insertStmt.run('usr_teacher', 'teacher', hashPassword('teacher'), 'teacher', 'Regular Teacher', Date.now());
  }
} catch (e) {
  console.error('Failed to seed default users:', e);
}

try {
  const countObj = db.prepare('SELECT COUNT(*) as cnt FROM ai_providers').get() as { cnt: number };
  if (countObj && countObj.cnt === 0) {
    console.log('Seeding default AI Providers...');
    const insertStmt = db.prepare('INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertStmt.run('prov_deepseek', 'Deepseek', 'https://api.deepseek.com/v1', '', 'deepseek-chat', Date.now(), Date.now());
    insertStmt.run('prov_minimax', 'Minimax', 'https://api.minimax.chat/v1', '', 'abab6.5-chat', Date.now(), Date.now());
  }
} catch (e) {
  console.error('Failed to seed default AI Providers:', e);
}

console.log('Database initialized at', dbPath);
