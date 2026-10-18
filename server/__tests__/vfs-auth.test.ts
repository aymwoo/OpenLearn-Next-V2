/**
 * SEC-AUTH #128：VFS 与文件下载只允许教师/管理员。
 *
 * 此前 `/api/vfs` 与 `/files/*` 只要求登录，学生可列出全校课节正文、
 * 作业列表与任意 VFS 文件。现在学生请求一律 403，教师/管理员行为不变。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerWorkspaceRoutes } from '../routes/workspace.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

describe('VFS 与文件下载角色鉴权（#128）', () => {
  let server: Server;
  let baseUrl: string;
  const db = kernelContainer.db;

  const teacherId = 'usr-vfsauth-teacher';
  const adminId = 'usr-vfsauth-admin';
  const studentId = 'stu-vfsauth-student';
  const lessonId = 'les-vfsauth-1';
  const fileName = 'VFS-AUTH-TEST.txt';
  const fileContent = 'only staff may read this file';

  const tokTeacher = 'tok-vfsauth-teacher';
  const tokAdmin = 'tok-vfsauth-admin';
  const tokStudent = 'tok-vfsauth-student';

  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });
  const get = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, token ? { headers: cookie(token) } : undefined);

  beforeAll(async () => {
    const now = Date.now();
    const exp = now + 3600_000;

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      tokTeacher,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'vfsauth_t' }),
      now,
      exp,
    );
    insertSession.run(
      tokAdmin,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'vfsauth_a' }),
      now,
      exp,
    );
    insertSession.run(
      tokStudent,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'vfsauth_s' }),
      now,
      exp,
    );

    db.prepare('DELETE FROM vfs_nodes WHERE name = ?').run(fileName);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      lessonId,
      'VFS 鉴权测试课节',
      '课节正文仅教师可见',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('vfsauth-file-1', null, 'file', fileName, fileContent, now, now);

    const app = express();
    app.use(express.json());
    registerWorkspaceRoutes({ app } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      db.prepare('DELETE FROM vfs_nodes WHERE name = ?').run(fileName);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
      db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(tokTeacher, tokAdmin, tokStudent);
    } catch {
      // 清理失败不掩盖测试结论
    }
  });

  describe('学生一律 403', () => {
    it('根目录列表', async () => {
      expect((await get('/api/vfs', tokStudent)).status).toBe(403);
    });

    it('课节正文虚拟目录', async () => {
      expect((await get('/api/vfs?parentId=virtual-lessons', tokStudent)).status).toBe(403);
    });

    it('作业列表虚拟目录', async () => {
      expect((await get('/api/vfs?parentId=virtual-assignments', tokStudent)).status).toBe(403);
    });

    it('学生作品虚拟目录（此前仅返回本人，现整段关闭）', async () => {
      expect((await get('/api/vfs?parentId=virtual-submissions', tokStudent)).status).toBe(403);
    });

    it('按路径下载 VFS 文件', async () => {
      expect((await get(`/files/${fileName}`, tokStudent)).status).toBe(403);
    });
  });

  describe('教师与管理员不受影响', () => {
    it('教师可列出根目录并看到虚拟目录与文件', async () => {
      const res = await get('/api/vfs', tokTeacher);
      expect(res.status).toBe(200);
      const body: any[] = await res.json();
      expect(body.some((n) => n.id === 'virtual-lessons')).toBe(true);
      expect(body.some((n) => n.id === 'virtual-submissions')).toBe(true);
      expect(body.some((n) => n.name === fileName)).toBe(true);
    });

    it('教师可读取课节正文虚拟目录', async () => {
      const res = await get('/api/vfs?parentId=virtual-lessons', tokTeacher);
      expect(res.status).toBe(200);
      const body: any[] = await res.json();
      const lesson = body.find((n) => n.id === `lesson-${lessonId}`);
      expect(lesson).toBeTruthy();
      expect(lesson.content).toContain('课节正文仅教师可见');
    });

    it('教师可下载 VFS 文件', async () => {
      const res = await get(`/files/${fileName}`, tokTeacher);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(fileContent);
    });

    it('管理员可列出根目录', async () => {
      expect((await get('/api/vfs', tokAdmin)).status).toBe(200);
    });
  });

  describe('未登录 401', () => {
    it('/api/vfs', async () => {
      expect((await get('/api/vfs')).status).toBe(401);
    });

    it('/files/*', async () => {
      expect((await get(`/files/${fileName}`)).status).toBe(401);
    });
  });
});
