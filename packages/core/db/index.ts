import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/** 使用 bcrypt 哈希密码 */
export function hashPassword(pwd: string): string {
  return bcrypt.hashSync(pwd, BCRYPT_ROUNDS);
}

/** 验证密码（支持 bcrypt 和旧 SHA-256 双模式） */
export function verifyPassword(pwd: string, storedHash: string): { valid: boolean; needsUpgrade: boolean } {
  // bcrypt 哈希以 $2a$ / $2b$ / $2y$ 开头
  if (storedHash.startsWith('$2')) {
    return { valid: bcrypt.compareSync(pwd, storedHash), needsUpgrade: false };
  }
  // 旧 SHA-256 哈希
  const sha256Hash = crypto.createHash('sha256').update(pwd).digest('hex');
  if (sha256Hash === storedHash) {
    return { valid: true, needsUpgrade: true };
  }
  return { valid: false, needsUpgrade: false };
}

// Use import.meta.url directly — it's available at module scope in tsx ESM.
// The old getDbDirname() heuristic (__dirname → new Function hack → cwd)
// fell back to process.cwd() (project root), causing the DB to be created
// in the wrong directory and the server to open a stale file descriptor.
let dbPath: string;
if (process.env.OPENLEARN_DB_PATH) {
  dbPath = process.env.OPENLEARN_DB_PATH;
  mkdirSync(path.dirname(dbPath), { recursive: true });
} else if (process.env.VITEST) {
  const poolId = process.env.VITEST_POOL_ID || process.pid;
  const testDbDir = path.join(os.tmpdir(), 'openlearn_test_dbs');
  mkdirSync(testDbDir, { recursive: true });
  dbPath = path.join(testDbDir, `openlearn_test_${poolId}.db`);
} else {
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    dbPath = path.join(__dirname, 'educational_os.db');
  } else {
    dbPath = path.join(__dirname, '../packages/core/db/educational_os.db');
  }
}

export function createDatabase(customPath?: string): Database.Database {
  const targetPath = customPath || dbPath;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const instance = new Database(targetPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('synchronous = NORMAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}

export const db = new Database(dbPath);

// WAL mode: 读写并行，写不阻塞读，写并发吞提升 3-5x
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Initialize schemas
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    correlationId TEXT,
    -- 课堂维度：由 Kernel#initAuditLog 从 payload 的 lessonId 提取，
    -- 用于「按课节重放整堂课」。老库由 migrations/006 补列。
    lesson_id TEXT
  );

  CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    timeline TEXT,
    progress_mode TEXT DEFAULT 'manual',
    progress_conditions TEXT,
    creator_id TEXT,
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
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
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

  -- ── 作业中心（Assignment Hub）──────────────────────────────────────────
  -- plugin_assignments 是作业实体：白板上的「课堂作业任务」教学对象只是它的
  -- 一个投影片段（element_id），class_id 让它同时出现在班级作业成绩页。
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

  -- 一个作业一个学生一行（assignment_id 非空时）；保留 lesson_id 列以兼容旧数据
  CREATE TABLE IF NOT EXISTS plugin_submissions (
    id TEXT PRIMARY KEY,
    assignment_id TEXT,
    lesson_id TEXT,
    student_id TEXT NOT NULL,
    file_path TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- 每次提交都留档（重交不覆盖历史）
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

  -- 上传的实体文件（磁盘存储 + 元数据），下载端点按此表鉴权
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

  -- 互评任务（谁评谁 / 匿名 / 截止），由分配策略生成
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

  CREATE TABLE IF NOT EXISTS plugin_peer_reviews (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    comment TEXT,
    created_at INTEGER NOT NULL,
    assignment_id TEXT,
    task_id TEXT,
    anonymous INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'submitted',
    updated_at INTEGER,
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
    graded_at INTEGER,
    assignment_id TEXT,
    peer_average_score REAL,
    source TEXT NOT NULL DEFAULT 'teacher',
    published_at INTEGER,
    graded_by TEXT
  );

  -- Performance Indexes
  CREATE INDEX IF NOT EXISTS idx_whiteboard_lesson ON whiteboard_elements(lesson_id);
  CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
  CREATE INDEX IF NOT EXISTS idx_class_students_student ON class_students(student_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_class_date ON schedules(class_id, scheduled_date);
  CREATE INDEX IF NOT EXISTS idx_courseware_attempt_cw_st ON courseware_attempt(courseware_id, student_id);
  CREATE INDEX IF NOT EXISTS idx_submission_result_attempt ON submission_result(attempt_id);
  CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, timestamp);
  -- 课堂事件统一经总线发布后 events 成为课堂事实日志，按时间窗口 / correlationId /
  -- 课节三种维度查询都需要索引支撑（老库由 migrations/006 补齐）。
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlationId);
  CREATE INDEX IF NOT EXISTS idx_assignments_class ON assignments(class_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_schedule ON attendance(schedule_id);

  -- 作业中心索引
  CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_assignments_element ON plugin_assignments(element_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_assignments_lesson ON plugin_assignments(lesson_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_assignments_class ON plugin_assignments(class_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_submission_versions_submission ON plugin_submission_versions(submission_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_assignment_files_owner ON plugin_assignment_files(assignment_id, student_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_peer_review_tasks_reviewer ON plugin_peer_review_tasks(reviewer_id, status);
`);

// plugin_submissions 的作业中心索引：
// 老库里这张表还是「UNIQUE(lesson_id, student_id) + 无 assignment_id」的旧形态，
// 重建发生在 migrations/005_assignment_hub.sql（服务器启动时执行，晚于本文件的 schema 块）。
// 所以这里的索引创建必须容错：老库会失败并静默跳过，随后由 005 迁移建好。
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_submissions_assignment_student ON plugin_submissions(assignment_id, student_id)');
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_submissions_legacy ON plugin_submissions(lesson_id, student_id) WHERE assignment_id IS NULL',
  );
} catch {
  // 旧形态表缺少 assignment_id，等 005 迁移重建后再建索引
}

try {
  db.exec('ALTER TABLE lessons ADD COLUMN creator_id TEXT');
} catch {
  // Column already exists — ignore error
}

// Phase 5: Worker isolation mode support — execution_mode column for plugins table
try {
  db.exec(`ALTER TABLE plugins ADD COLUMN execution_mode TEXT DEFAULT 'inline'`);
} catch {
  // Column already exists — ignore error
}

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
  db.prepare(
    "UPDATE students SET student_number = 'ST_' || id WHERE student_number IS NULL OR student_number = ''",
  ).run();
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
  db.prepare("ALTER TABLE plugins ADD COLUMN loader_version TEXT DEFAULT 'vm'").run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE plugins ADD COLUMN zip_package BLOB').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE plugins ADD COLUMN file_path TEXT DEFAULT NULL').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE plugins ADD COLUMN updated_at INTEGER DEFAULT NULL').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE users ADD COLUMN avatar TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE students ADD COLUMN avatar TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE events ADD COLUMN lesson_id TEXT').run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('CREATE INDEX IF NOT EXISTS idx_events_lesson_time ON events(lesson_id, timestamp)').run();
} catch (e) {
  // index already exists
}

try {
  const countObj = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (countObj && countObj.cnt === 0) {
    console.log('Seeding default users (admin & teacher) with bcrypt...');
    const insertStmt = db.prepare(
      'INSERT INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertStmt.run('usr_admin', 'admin', hashPassword('admin'), 'administrator', 'System Admin', Date.now());
    insertStmt.run('usr_teacher', 'teacher', hashPassword('teacher'), 'teacher', 'Regular Teacher', Date.now());
    console.warn(
      '[SECURITY WARNING] Default users initialized (admin/admin, teacher/teacher). In production environments, immediately change these passwords via POST /api/auth/change-password!',
    );
  }
} catch (e) {
  console.error('Failed to seed default users:', e);
}

try {
  const countObj = db.prepare('SELECT COUNT(*) as cnt FROM ai_providers').get() as { cnt: number };
  if (countObj && countObj.cnt === 0) {
    console.log('Seeding default AI Providers...');
    const insertStmt = db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insertStmt.run(
      'prov_deepseek',
      'Deepseek',
      'https://api.deepseek.com/v1',
      '',
      'deepseek-chat',
      Date.now(),
      Date.now(),
    );
    insertStmt.run(
      'prov_minimax',
      'Minimax',
      'https://api.minimax.chat/v1',
      '',
      'abab6.5-chat',
      Date.now(),
      Date.now(),
    );
  }
} catch (e) {
  console.error('Failed to seed default AI Providers:', e);
}

// MFE remotes 种子数据已移除（v5.0 架构重构：白板/课件内聚为本地模块）

console.log('Database initialized at', dbPath);
