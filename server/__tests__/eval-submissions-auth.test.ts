import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 回归测试 —— 作业互评只读接口的鉴权与「提交内容物」回填。
 *
 * 背景（两个缺陷）：
 *   1. `GET /api/lessons/:lessonId/eval-submissions` 与
 *      `GET /api/lessons/:lessonId/students/:studentId/eval-status` 原本完全没有鉴权：
 *      任何人不带 Cookie、仅凭 lessonId 就能读到全班的提交（含文字作答、附件文件名、
 *      互评与成绩）。与 /eval 系列同批修掉。
 *   2. 作业中心（P0/P1）支持纯文字 / 链接 / 多附件提交，这类提交
 *      `plugin_submissions.file_path` 恒为 NULL，旧接口只回 file_path，前端
 *      `file_path.split('/')` 直接白屏。接口现在回填最新版本的
 *      `files` / `textContent` / `linkUrl`。
 */

describe('eval-submissions / eval-status 鉴权与内容回填', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const lessonId = 'lesson-evalauth-1';
  const studentId = 'stu-evalauth-1';
  const studentToken = 'tok-evalauth-student';
  const teacherToken = 'tok-evalauth-teacher';
  const submissionId = 'sub-evalauth-1';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    const now = Date.now();

    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(studentId, 'evalauth_student', 'placeholder', 'student', '互评学生', now);
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('usr-evalauth-teacher', 'evalauth_teacher', 'placeholder', 'teacher', '互评教师', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(studentId, 'evalauth-1', '互评学生', 'evalauth@test', now);

    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'evalauth_student' }),
      now,
      now + 60 * 60 * 1000,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: 'usr-evalauth-teacher', role: 'teacher', username: 'evalauth_teacher' }),
      now,
      now + 60 * 60 * 1000,
    );

    // 纯附件提交：file_path 为 NULL（正是线上白屏的触发条件）
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO plugin_submissions
           (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(submissionId, 'asg-evalauth-1', lessonId, studentId, null, 1, now, now);
    kernelContainer.db
      .prepare(
        `INSERT OR REPLACE INTO plugin_submission_versions
           (id, submission_id, assignment_id, student_id, version, files_json, text_content, link_url, is_late, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'sv-evalauth-1',
        submissionId,
        'asg-evalauth-1',
        studentId,
        1,
        JSON.stringify([{ fileId: 'af-evalauth-1', name: '闹钟.html', size: 1024, mime: 'text/html' }]),
        null,
        null,
        0,
        now,
      );

    app = express();
    app.use(express.json());
    registerLessonsRoutes({ app, io: { emit: () => {} } } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    kernelContainer.db.prepare('DELETE FROM plugin_submission_versions WHERE id = ?').run('sv-evalauth-1');
    kernelContainer.db.prepare('DELETE FROM plugin_submissions WHERE id = ?').run(submissionId);
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(studentToken, teacherToken);
    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(studentId, 'usr-evalauth-teacher');
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('未登录不得读取互评提交与个人互评状态', async () => {
    const subs = await fetch(`${baseUrl}/api/lessons/${lessonId}/eval-submissions`);
    expect(subs.status).toBe(401);
    const status = await fetch(`${baseUrl}/api/lessons/${lessonId}/students/${studentId}/eval-status`);
    expect(status.status).toBe(401);
  });

  it('登录后可读，且空 file_path 的提交回填 files/textContent/linkUrl', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/eval-submissions`, {
      headers: cookie(studentToken),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].file_path).toBeNull();
    expect(rows[0].student_name).toBe('互评学生');
    expect(rows[0].files).toEqual([
      { fileId: 'af-evalauth-1', name: '闹钟.html', size: 1024, mime: 'text/html' },
    ]);
    expect(rows[0].textContent).toBeNull();
    expect(rows[0].linkUrl).toBeNull();
    // 内部字段不再泄露给前端
    expect(rows[0].latest_files_json).toBeUndefined();
  });

  it('eval-status 同样回填提交内容物（file_path 为 null 也不报错）', async () => {
    const res = await fetch(`${baseUrl}/api/lessons/${lessonId}/students/${studentId}/eval-status`, {
      headers: cookie(teacherToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.submission.file_path).toBeNull();
    expect(body.submission.files[0].name).toBe('闹钟.html');
    expect(body.submission.textContent).toBeNull();
  });
});
