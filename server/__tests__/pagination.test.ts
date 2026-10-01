/**
 * A7: 列表端点分页信封测试。
 *
 * 五个集合级列表端点（/api/lessons、/api/students、/api/classes、/api/schedules、
 * /api/courseware/attempts）响应统一为 { data, total, page, pageSize }；
 * pageSize='all' 返回全量；page/pageSize 非法值回退/clamp。
 * 复用 transactions.test.ts 的接线模式（真实路由注册 + 登录取 token）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { registerAdminRoutes } from '../routes/admin.js';
import { registerRosterRoutes } from '../routes/roster.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerSchedulesRoutes } from '../routes/schedules.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

const db = kernelContainer.db;
let app: express.Express;
let baseUrl = '';
let token = '';

const get = (path: string) => fetch(`${baseUrl}${path}`, { headers: { Cookie: `edu_os_token=${token}` } });

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const noopLimiter = (_req: any, _res: any, next: () => void) => next();
  registerAdminRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);
  registerRosterRoutes({ app, io: undefined, loginLimiter: noopLimiter } as any);
  registerLessonsRoutes({ app, io: undefined } as any);
  registerSchedulesRoutes({ app, io: undefined } as any);

  const http = await import('http');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  (globalThis as any).__pgServer = server;

  const now = Date.now();
  const teacherId = 'usr-pg-teacher';
  db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  db.prepare(
    'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(teacherId, 'pg_teacher', bcrypt.hashSync('PgTeacher-Pw1', 10), 'teacher', '分页测试教师', now);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entrance: 'teacher', username: 'pg_teacher', password: 'PgTeacher-Pw1' }),
  });
  token = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
  expect(token).toBeTruthy();

  // 种子：3 个学生、3 个班级、1 个 lesson，创建时间递增保证顺序确定
  db.prepare('DELETE FROM students WHERE id LIKE ?').run('stu-pg-%');
  db.prepare('DELETE FROM classes WHERE id LIKE ?').run('cls-pg-%');
  db.prepare('DELETE FROM lessons WHERE id LIKE ?').run('lesson-pg-%');
  for (let i = 1; i <= 3; i++) {
    db.prepare(
      'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(`stu-pg-${i}`, `STU-PG-${i}`, `分页学生${i}`, '', now + i * 1000);
    db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(
      `cls-pg-${i}`,
      `分页班级${i}`,
      now + i * 1000,
    );
    db.prepare('INSERT INTO lessons (id, title, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      `lesson-pg-${i}`,
      `分页课程${i}`,
      teacherId,
      now + i * 1000,
      now + i * 1000,
    );
  }
});

afterAll(async () => {
  db.prepare('DELETE FROM students WHERE id LIKE ?').run('stu-pg-%');
  db.prepare('DELETE FROM classes WHERE id LIKE ?').run('cls-pg-%');
  db.prepare('DELETE FROM lessons WHERE id LIKE ?').run('lesson-pg-%');
  db.prepare('DELETE FROM users WHERE id LIKE ?').run('usr-pg-%');
  db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run('%usr-pg-%');
  const server = (globalThis as any).__pgServer;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('A7: 列表端点分页信封', () => {
  it.each(['/api/lessons', '/api/students', '/api/classes'])('%s 默认返回信封形状', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.data.length).toBeLessThanOrEqual(50);
  });

  it('/api/students page=2&pageSize=1 切片正确（created_at DESC）', async () => {
    const res = await get('/api/students?page=2&pageSize=1');
    const body: any = await res.json();
    // 种子 3 个学生创建时间递增 + 可能存在其他测试残留学生，仅验证切片形状
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(1);
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(body.total).toBeGreaterThanOrEqual(3);
  });

  it('/api/lessons pageSize=all 返回全量且 pageSize===total', async () => {
    const res = await get('/api/lessons?pageSize=all');
    const body: any = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.data.length).toBe(body.total);
    expect(body.pageSize).toBe(body.total);
  });

  it('pageSize 超上限被 clamp 到 500', async () => {
    const res = await get('/api/students?pageSize=99999');
    const body: any = await res.json();
    expect(body.pageSize).toBe(500);
  });

  it('page 非法值回退第 1 页；pageSize 非法回退默认 50', async () => {
    const res = await get('/api/students?page=-3&pageSize=abc');
    const body: any = await res.json();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it('/api/schedules 返回信封；子资源 /api/classes/:classId/schedules 维持裸数组', async () => {
    const all = await get('/api/schedules');
    const allBody: any = await all.json();
    expect(Array.isArray(allBody.data)).toBe(true);
    expect(typeof allBody.total).toBe('number');

    // 子资源端点不在 A7 范围：无班级时返回空数组（裸数组形状）
    const sub = await get('/api/classes/cls-pg-nonexistent/schedules');
    const subBody: any = await sub.json();
    expect(Array.isArray(subBody)).toBe(true);
  });
});
