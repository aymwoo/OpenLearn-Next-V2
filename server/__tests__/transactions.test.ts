/**
 * DATA-INT-01: 多步写操作事务化回归测试。
 *
 * 验证两件事：
 * 1. 学生级联删除（12 表）在单事务内完成，删除后无孤儿残留；
 * 2. 班级导入整批事务 —— 任一学生落库失败（student_number UNIQUE 冲突）整体回滚，
 *    不残留半截班级（事务化之前会留下已插入的班级行）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { registerAdminRoutes } from '../routes/admin.js';
import { registerRosterRoutes } from '../routes/roster.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

// generateStudentNumber 可被强制返回指定学号（回滚测试用它制造 UNIQUE 冲突）
const { mockState } = vi.hoisted(() => ({ mockState: { force: null as string | null } }));
vi.mock('../routes/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../routes/shared.js')>();
  return {
    ...actual,
    generateStudentNumber: (db: any) => (mockState.force ? mockState.force : actual.generateStudentNumber(db)),
  };
});

const db = kernelContainer.db;
const TEACHER_ID = 'usr-tx-teacher';
const TEACHER_NAME = 'tx_teacher';

let app: express.Express;
let token = '';

const post = (path: string, body?: Record<string, unknown>, withToken = true) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withToken ? { Cookie: `edu_os_token=${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });

const del = (path: string) =>
  fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { Cookie: `edu_os_token=${token}` },
  });

let baseUrl = '';

/** 向学生级联删除涉及的 11 张子表各插入一行 */
function seedStudentChildRows(studentId: string) {
  const now = Date.now();
  // 测试库跨运行持久，先清理本用例的残留行
  db.prepare('DELETE FROM class_students WHERE class_id = ? OR student_id = ?').run('cls-tx-1', studentId);
  for (const t of CHILD_TABLES) {
    const where = t === 'plugin_peer_reviews' ? 'reviewer_id' : 'student_id';
    db.prepare(`DELETE FROM ${t} WHERE ${where} = ?`).run(studentId);
  }
  db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
    'cls-tx-1',
    studentId,
    now,
  );
  db.prepare(
    'INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at) VALUES (?, ?, 1, 100, ?)',
  ).run(studentId, 'lesson-tx-1', now);
  db.prepare(
    'INSERT INTO assignments (id, class_id, lesson_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('ast-tx-1', 'cls-tx-1', 'lesson-tx-1', 'tx 作业', now);
  db.prepare(
    'INSERT INTO assignment_submissions (assignment_id, student_id, submitted_at, status) VALUES (?, ?, ?, ?)',
  ).run('ast-tx-1', studentId, now, 'submitted');
  db.prepare('INSERT INTO attendance (schedule_id, student_id, status, recorded_at) VALUES (?, ?, ?, ?)').run(
    'sched-tx-1',
    studentId,
    'present',
    now,
  );
  db.prepare('INSERT INTO exam_scores (exam_id, student_id, score, recorded_at) VALUES (?, ?, ?, ?)').run(
    'exam-tx-1',
    studentId,
    88,
    now,
  );
  db.prepare(
    'INSERT INTO student_semester_reports (id, student_id, class_id, semester_name, attendance_score, progress_score, assignment_score, exam_score, total_score, grade_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('rep-tx-1', studentId, 'cls-tx-1', '2026-1', 90, 90, 90, 90, 90, 'A', now, now);
  db.prepare('INSERT INTO student_rollcalls (id, student_id, class_id, picked_time) VALUES (?, ?, ?, ?)').run(
    'rc-tx-1',
    studentId,
    'cls-tx-1',
    now,
  );
  db.prepare(
    'INSERT INTO plugin_submissions (id, student_id, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
  ).run('psub-tx-1', studentId, now, now);
  db.prepare(
    'INSERT INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('prev-tx-1', 'psub-tx-1', studentId, 5, now);
  db.prepare(
    'INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES (?, ?, ?, ?, ?)',
  ).run('cls-tx-1', studentId, 'lab-tx-1', 0, 0);
  db.prepare('INSERT INTO student_read_notifications (student_id, notification_id) VALUES (?, ?)').run(
    studentId,
    'notif-tx-1',
  );
}

const CHILD_TABLES = [
  'class_students',
  'student_lesson_progress',
  'assignment_submissions',
  'attendance',
  'exam_scores',
  'student_semester_reports',
  'student_rollcalls',
  'plugin_submissions',
  'plugin_peer_reviews',
  'student_seats',
  'student_read_notifications',
] as const;

function countRows(table: string, where: string, value: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} = ?`).get(value) as { n: number };
  return row.n;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const noopLimiter = (_req: any, _res: any, next: () => void) => next();
  registerAdminRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);
  registerRosterRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);

  const http = await import('http');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  (globalThis as any).__txServer = server;

  // 教师账号 + 登录拿 token（requireAuth 需要）
  const now = Date.now();
  db.prepare('DELETE FROM users WHERE id = ?').run(TEACHER_ID);
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(TEACHER_ID, TEACHER_NAME, bcrypt.hashSync('TxTeacher-Pw1', 10), 'teacher', '事务测试教师', now);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entrance: 'teacher', username: TEACHER_NAME, password: 'TxTeacher-Pw1' }),
  });
  expect(login.status).toBe(200);
  token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
  expect(token).toBeTruthy();
});

afterAll(async () => {
  db.prepare('DELETE FROM users WHERE id = ?').run(TEACHER_ID);
  db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run(`%${TEACHER_ID}%`);
  const server = (globalThis as any).__txServer;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('DATA-INT-01: 学生级联删除事务化', () => {
  it('删除学生后 12 张表均无残留（单事务级联）', async () => {
    const studentId = 'stu-tx-cascade';
    const now = Date.now();
    // 测试库跨运行持久：清理固定 ID 的种子残留
    db.prepare('DELETE FROM assignments WHERE id = ?').run('ast-tx-1');
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      studentId,
      'STU-TX-0001',
      '级联删除学生',
      '',
      now,
    );
    db.prepare('INSERT OR IGNORE INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      'cls-tx-1',
      '事务测试班',
      now,
    );
    seedStudentChildRows(studentId);

    const res = await del(`/api/students/${studentId}`);
    expect(res.status).toBe(200);

    for (const table of CHILD_TABLES) {
      const where = table === 'plugin_peer_reviews' ? 'reviewer_id' : 'student_id';
      expect(countRows(table, where, studentId)).toBe(0);
    }
    expect(countRows('students', 'id', studentId)).toBe(0);

    db.prepare('DELETE FROM classes WHERE id = ?').run('cls-tx-1');
    db.prepare('DELETE FROM assignments WHERE id = ?').run('ast-tx-1');
  });
});

describe('DATA-INT-01: 班级导入整批事务', () => {
  it('学生落库失败（student_number UNIQUE 冲突）→ 班级不残留（回滚验证）', async () => {
    // 强制 generateStudentNumber 返回已占用的 S001 → 首个新学生插入即 UNIQUE 失败
    const now = Date.now();
    db.prepare('DELETE FROM students WHERE student_number = ?').run('S001');
    db.prepare('DELETE FROM classes WHERE name = ?').run('导入回滚班');
    db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'stu-tx-s001',
      'S001',
      '占位学生',
      '',
      now,
    );
    mockState.force = 'S001';
    try {
      const res = await post('/api/classes/import', {
        classes: [{ name: '导入回滚班', students: [{ name: '新学生' }] }],
      });
      expect(res.status).toBeGreaterThanOrEqual(400); // 落库失败，非 success

      // 事务回滚：班级行不残留
      const classRow = db.prepare('SELECT COUNT(*) AS n FROM classes WHERE name = ?').get('导入回滚班') as {
        n: number;
      };
      expect(classRow.n).toBe(0);
    } finally {
      mockState.force = null;
      db.prepare('DELETE FROM students WHERE id = ?').run('stu-tx-s001');
    }
  });

  it('正常导入路径不受事务包裹影响', async () => {
    db.prepare('DELETE FROM classes WHERE name = ?').run('导入正常班');
    const res = await post('/api/classes/import', {
      classes: [{ name: '导入正常班', students: [{ name: '正常学生甲' }, { name: '正常学生乙' }] }],
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.imported).toHaveLength(1);
    expect(body.imported[0].studentsCount).toBe(2);

    const classRow = db.prepare('SELECT id FROM classes WHERE name = ?').get('导入正常班') as { id: string };
    expect(classRow).toBeTruthy();
    const studentIds = (
      db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classRow.id) as any[]
    ).map((r) => r.student_id);
    expect(studentIds).toHaveLength(2);

    // 清理
    for (const sid of studentIds) {
      db.prepare('DELETE FROM students WHERE id = ?').run(sid);
    }
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classRow.id);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classRow.id);
  });
});

describe('PERF-N1: eval-grades 批量归并与逐条查询等价', () => {
  it('两条提交各自的互评/评分正确聚合（IN + Map 归并结果等价）', async () => {
    const { registerLessonsRoutes } = await import('../routes/lessons.js');
    registerLessonsRoutes({ app, io: undefined } as any);

    const now = Date.now();
    const lessonId = 'lesson-perf-n1';
    // 测试库跨运行持久：清理固定 ID 种子残留
    db.prepare('DELETE FROM plugin_peer_reviews WHERE submission_id IN (?, ?)').run('psub-p1', 'psub-p2');
    db.prepare('DELETE FROM plugin_grades WHERE submission_id IN (?, ?)').run('psub-p1', 'psub-p2');
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run('stu-p1', 'stu-p2', 'stu-p3');
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('stu-p1', 'STU-P1', '学生一', '', now);
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('stu-p2', 'STU-P2', '学生二', '', now);
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('stu-p3', 'STU-P3', '学生三', '', now);
    db.prepare('INSERT INTO plugin_submissions (id, lesson_id, student_id, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
      'psub-p1',
      lessonId,
      'stu-p1',
      now,
      now,
    );
    db.prepare('INSERT INTO plugin_submissions (id, lesson_id, student_id, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(
      'psub-p2',
      lessonId,
      'stu-p2',
      now,
      now,
    );
    // p1: 两条互评 (80+90 → 均分 85)，有评分 77
    db.prepare(
      'INSERT INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('prev-p1', 'psub-p1', 'stu-p2', 80, now);
    db.prepare(
      'INSERT INTO plugin_peer_reviews (id, submission_id, reviewer_id, score, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run('prev-p2', 'psub-p1', 'stu-p3', 90, now);
    db.prepare(
      'INSERT INTO plugin_grades (id, submission_id, calculated_final_score, status, graded_at) VALUES (?, ?, ?, ?, ?)',
    ).run('pgr-p1', 'psub-p1', 77, 'graded', now);

    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/eval-grades`, {
      headers: { Cookie: `edu_os_token=${token}` },
    });
    expect(res.status).toBe(200);
    const result: any = await res.json();

    const r1 = result.find((r: any) => r.id === 'psub-p1');
    expect(r1.peerReviews).toHaveLength(2);
    expect(r1.peerAverageScore).toBe(85);
    expect(r1.grade.calculated_final_score).toBe(77);

    const r2 = result.find((r: any) => r.id === 'psub-p2');
    expect(r2.peerReviews).toHaveLength(0);
    expect(r2.peerAverageScore).toBe(0);
    expect(r2.grade).toBeNull();

    // 清理
    db.prepare('DELETE FROM plugin_peer_reviews WHERE submission_id IN (?, ?)').run('psub-p1', 'psub-p2');
    db.prepare('DELETE FROM plugin_grades WHERE submission_id = ?').run('psub-p1');
    db.prepare('DELETE FROM plugin_submissions WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?, ?)').run('stu-p1', 'stu-p2', 'stu-p3');
  });
});
