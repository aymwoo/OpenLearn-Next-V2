import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import fs from 'fs';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

describe('Issue #132: 下线 POST /api/courseware/debug 接口回归测试', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const studentId = `stu_dbg_${uuidv7().slice(0, 8)}`;
  const studentToken = `tok_dbg_${uuidv7().slice(0, 8)}`;
  const logFilePath = path.join(process.cwd(), 'client_debug.log');

  beforeAll(async () => {
    // 确保测试前没有遗留的 client_debug.log
    if (fs.existsSync(logFilePath)) {
      try {
        fs.unlinkSync(logFilePath);
      } catch {
        /* ignore */
      }
    }

    const now = Date.now();
    const expiresAt = now + 60 * 60 * 1000;
    const db = kernelContainer.db;

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'student_dbg_test', 'hash', 'student', '测试学生', now);

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      studentToken,
      JSON.stringify({ userId: studentId, studentId, role: 'student', username: 'student_dbg_test' }),
      now,
      expiresAt,
    );

    app = express();
    app.use(express.json());
    registerCoursewareRoutes({ app } as any);

    // 模拟服务端 404 兜底门禁
    app.all('/api/*', (req, res) => {
      res.status(404).json({
        success: false,
        error: `API route not found: ${req.method} ${req.path}`,
      });
    });

    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(studentToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(studentId);

    if (fs.existsSync(logFilePath)) {
      try {
        fs.unlinkSync(logFilePath);
      } catch {
        /* ignore */
      }
    }

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('未登录请求 POST /api/courseware/debug 返回 404 Not Found', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/debug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg: 'test debug message' }),
    });
    expect(res.status).toBe(404);
  });

  it('登录用户请求 POST /api/courseware/debug 返回 404，且绝不在磁盘写 client_debug.log', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/debug`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edu_os_token=${studentToken}`,
      },
      body: JSON.stringify({
        msg: 'attempt to write debug log to disk',
        url: 'http://localhost/test',
        student: { id: studentId },
      }),
    });
    expect(res.status).toBe(404);

    // 确认磁盘上没有 client_debug.log 生成
    expect(fs.existsSync(logFilePath)).toBe(false);
  });
});
