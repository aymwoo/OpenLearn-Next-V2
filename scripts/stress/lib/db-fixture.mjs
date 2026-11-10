/**
 * scripts/stress/lib/db-fixture.mjs
 * 压测数据库初始化与数据底座注入：标准 Pragma 设置、全量 Schema 迁移与真实教学场景测试数据播种
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migrator = require(path.resolve('dist/cli-migrator.cjs'));

/**
 * 应用主写连接 Pragma 参数（对齐 packages/core/db/index.ts:196）
 */
export function applyPragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -64000'); // 64MB 专用缓存
  db.pragma('temp_store = MEMORY'); // 内存临时表与排序
  try {
    db.pragma('mmap_size = 268435456'); // 256MB 内存映射 I/O
  } catch {
    // 忽略特定平台受限环境下的 mmap 异常
  }
}

/**
 * 应用只读连接 Pragma 参数（对齐 packages/core/db/index.ts:211）
 */
export function applyReadPragmas(db) {
  db.pragma('query_only = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -32000'); // 32MB 只读缓存
  db.pragma('temp_store = MEMORY');
  try {
    db.pragma('mmap_size = 268435456');
  } catch {
    // 忽略受限环境
  }
}

/**
 * 初始化全新压测数据库并执行全量迁移
 */
export function setupStressDatabase(dbPath, migrationsDir = path.resolve('migrations')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // 避免写入外部真实备份目录
  const tempBackupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(tempBackupDir, { recursive: true });
  process.env.BACKUP_DIR = tempBackupDir;

  const db = new Database(dbPath);
  applyPragmas(db);

  // 执行全量迁移
  const migrations = migrator.loadMigrationsFromDirectory(migrationsDir);
  migrator.runMigrations(db, migrations, { strictLedger: true });

  return db;
}

/**
 * 注入用于 100~300 并发压测的基底数据
 */
export function seedStressFixture(db, { studentCount = 300, classCount = 10, lessonCount = 10 } = {}) {
  const now = Date.now();

  const insertSeed = db.transaction(() => {
    // 1. 管理员与教师账号
    const insertUser = db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    insertUser.run(
      'usr_admin',
      'admin',
      '$2a$10$wT1r5eX1lYhQx8Y2J7UGe.6uQvYqF2Iu4GzVd8lP0M1k5eW3oQ9aO',
      'administrator',
      'System Administrator',
      now,
    );
    insertUser.run(
      'usr_teacher',
      'teacher',
      '$2a$10$wT1r5eX1lYhQx8Y2J7UGe.6uQvYqF2Iu4GzVd8lP0M1k5eW3oQ9aO',
      'teacher',
      'Main Teacher',
      now,
    );

    // 2. 班级数据
    const insertClass = db.prepare(`
      INSERT OR REPLACE INTO classes (id, name, description, created_at, owner_user_id)
      VALUES (?, ?, '压测演示班级', ?, 'usr_teacher')
    `);
    for (let c = 1; c <= classCount; c++) {
      const classId = `cls_${String(c).padStart(2, '0')}`;
      insertClass.run(classId, `示范班级 ${c} 班`, now);
    }

    // 3. 学生数据与选课映射
    const insertStudent = db.prepare(`
      INSERT OR REPLACE INTO students (id, student_number, name, password, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertClassStudent = db.prepare(`
      INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at)
      VALUES (?, ?, ?)
    `);
    const insertClientSession = db.prepare(`
      INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);

    for (let s = 1; s <= studentCount; s++) {
      const studentId = `std_${String(s).padStart(3, '0')}`;
      const studentNumber = `S${String(s).padStart(4, '0')}`;
      const studentName = `学生${String(s).padStart(3, '0')}`;
      // 密码默认 123456 的 bcrypt 密文
      const pwdHash = '$2b$10$ep5s7y7p0QeYV20u.h8l9.lA89nFk1s9w3tY/Kj1e9d1g7b2w3x8y';
      insertStudent.run(studentId, studentNumber, studentName, pwdHash, now);

      // 分配到班级（轮询）
      const classIdx = ((s - 1) % classCount) + 1;
      const classId = `cls_${String(classIdx).padStart(2, '0')}`;
      insertClassStudent.run(classId, studentId, now);

      // 预先准备好已登录的有效 Session Token
      const sessionData = JSON.stringify({
        role: 'student',
        userId: studentId,
        studentId,
        studentNumber,
        name: studentName,
        classId,
      });
      const token = `token_${studentId}`;
      insertClientSession.run(token, sessionData, now, now + 7 * 86400 * 1000);
    }

    // 4. 课程与课件数据
    const insertLesson = db.prepare(`
      INSERT OR REPLACE INTO lessons (id, title, content, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, 'usr_teacher', ?, ?)
    `);
    const dummyContent = JSON.stringify([
      { id: 'slide-1', title: '课堂导入与目标', type: 'presentation' },
      { id: 'slide-2', title: '互动随堂探究', type: 'interactive' },
      { id: 'slide-3', title: '实践作业与小结', type: 'summary' },
    ]);

    for (let l = 1; l <= lessonCount; l++) {
      const lessonId = `les_${String(l).padStart(2, '0')}`;
      insertLesson.run(lessonId, `初中信息科技·第 ${l} 课 算法与数据基础`, dummyContent, now, now);
    }

    // 5. 课堂实时会话 (Classroom Sessions)
    const insertSession = db.prepare(`
      INSERT OR REPLACE INTO classroom_sessions (id, lesson_id, class_id, teacher_id, stage, checkin_code, created_at)
      VALUES (?, ?, ?, 'usr_teacher', 'IN_CLASS_TEACHING', '1024', ?)
    `);
    for (let l = 1; l <= lessonCount; l++) {
      const lessonId = `les_${String(l).padStart(2, '0')}`;
      const classIdx = ((l - 1) % classCount) + 1;
      const classId = `cls_${String(classIdx).padStart(2, '0')}`;
      insertSession.run(`cs_session_${l}`, lessonId, classId, now);
    }

    // 6. 作业与初始答题记录 (Assignments & Submissions)
    const insertAssignment = db.prepare(`
      INSERT OR REPLACE INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
      VALUES (?, ?, ?, ?, '课堂实践作业，验证高频并发提交。', '作业要求与答题指引', ?)
    `);
    const insertSubmission = db.prepare(`
      INSERT OR REPLACE INTO assignment_submissions (assignment_id, student_id, content, score, graded_at, submitted_at, status)
      VALUES (?, ?, '初始随堂测验作答内容', ?, ?, ?, 'graded')
    `);

    for (let a = 1; a <= lessonCount; a++) {
      const asgId = `asg_${String(a).padStart(2, '0')}`;
      const lessonId = `les_${String(a).padStart(2, '0')}`;
      const classIdx = ((a - 1) % classCount) + 1;
      const classId = `cls_${String(classIdx).padStart(2, '0')}`;
      insertAssignment.run(asgId, classId, lessonId, `随堂测评 ${a}：基础能力考核`, now);

      // 为部分学生播种初始提交记录，供聚合报表与查询
      for (let s = 1; s <= 20; s++) {
        const studentId = `std_${String(s).padStart(3, '0')}`;
        insertSubmission.run(asgId, studentId, 85 + (s % 15), now, now);
      }
    }
  });

  insertSeed();
}
