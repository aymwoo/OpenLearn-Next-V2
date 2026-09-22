import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import fs from 'fs';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

/**
 * 端到端集成测试 —— 模拟「教师在课程中添加互动课件 → 学生上课作答 → 平台监测
 *  → 转作业成绩评定」的完整链路。
 *
 * 链路节点：
 *   1. 教师侧：上传课程资源（课程 + 班级 + 课件）
 *   2. 学生侧：LMS Bridge 在 iframe 内启动 attempt、记录交互事件
 *   3. 学生侧：完成作答，LMS.submit 提交最终成绩
 *   4. 平台侧：教师「保存为作业成绩」按钮触发 /promote → 自动建作业 + 评分
 *   5. 查询侧：教师可在 eval-grades / assignment-submissions 中查到成绩
 *
 * 实际生产中 /promote 由教师在前端主动调用（LiveClassroomView 的"保存成绩"按钮），
 * 这里直接打 HTTP，验证后端契约。
 */
describe('Courseware E2E flow — student score captured & promoted to assignment grade', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  // Fixtures — 用唯一 id 避免污染真实数据
  const teacherId = 'usr-teacher-e2e';
  const teacherToken = 'tok-e2e-teacher-001';
  const studentId = 'stu-e2e-001';
  const studentName = '测试小明';
  const classId = 'cls-e2e-001';
  const className = '高一(1)班-E2E';
  const coursewareUuid = 'cw-e2e-uuid-001';
  const coursewareId = 'cw-e2e-row-001';
  const coursewareName = '互动课件 · E2E';
  let lessonId = '';

  beforeAll(async () => {
    const now = Date.now();

    // ── 1. 教师 / 班级 / 学生 / 课件 ──────────────────────────────
    // Teacher
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(teacherId, 'e2e_teacher', 'placeholder', 'teacher', 'E2E 教师', now);

    // 真实会话行：/api/courseware/attempts 现在需要登录（成绩榜对学生开放，但必须先鉴权）
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        teacherToken,
        JSON.stringify({ userId: teacherId, role: 'teacher', username: 'e2e_teacher' }),
        now,
        now + 60 * 60 * 1000,
      );

    // Class
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(classId, className, 'E2E 测试班级', 'pass-e2e', now);

    // Student
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(studentId, 'stu-e2e-001-num', studentName, 'xm@test', now);
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)')
      .run(classId, studentId, now);

    // Courseware（落 ZIP 磁盘以满足 /runtime/:uuid/ 服务的硬性要求；
    // 真实上传流程走 /api/courseware/upload，这里走捷径）
    const cwDir = path.resolve(process.cwd(), 'storage', 'courseware', coursewareUuid);
    fs.mkdirSync(cwDir, { recursive: true });
    fs.writeFileSync(
      path.resolve(cwDir, 'index.html'),
      `<!DOCTYPE html><html><body><h1>${coursewareName}</h1>
       <script src="/bridge.js"></script>
       <script>
         // 模拟学生答题：5 秒后调用 LMS.submit 提交 88 分
         setTimeout(() => window.LMS.submit(88, 100, {q1: 'B', q2: 'C'}), 500);
       </script></body></html>`,
      'utf8',
    );
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(coursewareId, coursewareUuid, coursewareName, 'html', 'index.html', now);

    // ── 2. 创建 lesson ────────────────────────────────────────────
    // 直接走 SQL INSERT（与 lessons.ts:750 的真实创建路径一致）—— command-bus
    // 在测试环境中未注册 lesson.create handler，需走数据库 + lessons 路由。
    lessonId = `lesson-e2e-${now}`;
    kernelContainer.db
      .prepare(
        'INSERT INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        lessonId,
        'E2E 测试课程',
        JSON.stringify({ description: '自动化端到端测试课程' }),
        null,
        'manual',
        null,
        teacherId,
        now,
        now,
      );

    // ── 3. Boot Express + register routes ─────────────────────────
    app = express();
    app.use(express.json());
    // 注入测试 session：/log、/submit 路由都会校验 session.role === 'student' 且 userId === student_id
    app.use((req, _res, next) => {
      (req as any).session = {
        userId: studentId,
        role: 'student',
        username: 'e2e_student',
      };
      next();
    });
    // 不再手工 grant 能力：CapabilityGuard 会按 actorId 的 `:student` 后缀兜底授予
    // student:write / lesson:read（见 packages/core/capability-system/index.ts）。
    // 历史上这里靠 grant 绕过，掩盖了 /submit 路由 actorId 未归一化的缺陷。
    const ctx: any = {
      app,
      io: { emit: (event: string, payload: any) => emittedEvents.push({ event, payload }) },
    };
    registerCoursewareRoutes(ctx);
    registerLessonsRoutes(ctx);
    registerAssignmentsRoutes(ctx);
    registerGradingRoutes(ctx);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  const emittedEvents: Array<{ event: string; payload: any }> = [];

  afterAll(async () => {
    // ── Cleanup ───────────────────────────────────────────────────
    const lessonCleanup = lessonId;
    kernelContainer.db.prepare('DELETE FROM assignment_submissions WHERE assignment_id LIKE ?').run('ast-cw-%');
    kernelContainer.db.prepare('DELETE FROM assignments WHERE title LIKE ?').run('互动课件:%');
    kernelContainer.db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonCleanup);
    kernelContainer.db.prepare('DELETE FROM submission_result WHERE attempt_id LIKE ?').run('att-e2e-%');
    kernelContainer.db.prepare('DELETE FROM courseware_attempt WHERE id LIKE ?').run('att-e2e-%');
    kernelContainer.db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonCleanup);
    kernelContainer.db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    kernelContainer.db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    kernelContainer.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    kernelContainer.db.prepare('DELETE FROM courseware WHERE id = ?').run(coursewareId);
    kernelContainer.db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    const cwDir = path.resolve(process.cwd(), 'storage', 'courseware', coursewareUuid);
    if (fs.existsSync(cwDir)) fs.rmSync(cwDir, { recursive: true, force: true });
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('runs the full courseware → LMS bridge submit → promote → assignment grade flow', async () => {
    const now = Date.now();

    // ── A. 学生开始 attempt（模拟 LMS Bridge 在 iframe 中初始化）───
    const attemptId = `att-e2e-${now}`;
    kernelContainer.db
      .prepare(
        'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(attemptId, coursewareId, studentId, now, 'in_progress');

    // ── B. 学生答题过程的实时事件流（POST /log，模拟 LMS.score / LMS.progress）──
    const logRes1 = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventType: 'progress', payload: { completion: 0.3, lessonId } }),
    });
    expect(logRes1.status).toBe(200);

    const logRes2 = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType: 'score_event',
        payload: { score: 50, comment: 'q1 done', completion: 0.5, lessonId },
      }),
    });
    expect(logRes2.status).toBe(200);

    // ── C. LMS.submit — 学生最终提交分数 88 ─────────────────────
    const submitRes = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        score: 88,
        completion: 1,
        status: 'completed',
        comment: 'finished all questions',
        extra: { q1: 'B', q2: 'C', totalQuestions: 5 },
        lessonId,
      }),
    });
    if (submitRes.status !== 200) {
      const errBody = await submitRes.text();
      throw new Error(`submit failed: ${submitRes.status} ${errBody}`);
    }
    const submitJson = (await submitRes.json()) as any;
    expect(submitJson.success).toBe(true);

    // 平台「监测」：尝试记录 + 提交结果都入库
    const attemptRow = kernelContainer.db
      .prepare('SELECT status, finished_at FROM courseware_attempt WHERE id = ?')
      .get(attemptId) as { status: string; finished_at: number };
    // builtin.ts:1584 写的是 'completed'，GET 路由使用别名 'finished'；两者语义等价
    expect(['finished', 'completed']).toContain(attemptRow.status);
    expect(attemptRow.finished_at).not.toBeNull();

    const resultRow = kernelContainer.db
      .prepare('SELECT score, comment, completion FROM submission_result WHERE attempt_id = ?')
      .get(attemptId) as { score: number; comment: string; completion: number };
    expect(resultRow.score).toBe(88);
    expect(resultRow.completion).toBe(1);

    // Socket 广播：教师端实时面板能收到
    expect(emittedEvents.some((e) => e.event === 'courseware-attempt-updated')).toBe(true);

    // ── D. 教师侧 GET /api/courseware/attempts?coursewareUuid=X 看到该生成绩 ──
    // （这正是我刚加的 filter —— HtmlAppletFrame 实时面板用这个端点）
    const filterRes = await fetch(
      `${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(coursewareUuid)}`,
      { headers: { Cookie: `edu_os_token=${teacherToken}` } },
    );
    expect(filterRes.status).toBe(200);
    const filterRows = (await filterRes.json()) as Array<{
      attemptId: string;
      studentId: string;
      coursewareUuid: string;
      score: number;
      isPromoted: number;
    }>;
    expect(filterRows.length).toBe(1);
    expect(filterRows[0].attemptId).toBe(attemptId);
    expect(filterRows[0].studentId).toBe(studentId);
    expect(filterRows[0].score).toBe(88);
    expect(filterRows[0].isPromoted).toBe(0); // 尚未 promote

    // ── E. 教师点「保存为作业成绩」→ /promote ───────────────────
    const promoteRes = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `edu_os_token=${teacherToken}` },
      body: JSON.stringify({ lessonId, classId }),
    });
    expect(promoteRes.status).toBe(200);
    const promoteJson = (await promoteRes.json()) as { success: boolean; assignmentId: string; score: number };
    expect(promoteJson.success).toBe(true);
    expect(promoteJson.assignmentId).toMatch(/^ast-cw-/);
    expect(promoteJson.score).toBe(88); // 88 已是 0-100 范围，原样保留

    // ── F. 验证副作用 ──────────────────────────────────────────
    // F.1 — assignment 表里出现「互动课件: <课件名>」作业
    const assignmentTitle = `互动课件: ${coursewareName}`;
    const assignment = kernelContainer.db
      .prepare('SELECT id, class_id, lesson_id, title FROM assignments WHERE id = ?')
      .get(promoteJson.assignmentId) as {
      id: string;
      class_id: string;
      lesson_id: string;
      title: string;
    };
    expect(assignment.title).toBe(assignmentTitle);
    expect(assignment.class_id).toBe(classId);
    expect(assignment.lesson_id).toBe(lessonId);

    // F.2 — assignment_submissions 出现该生分数
    const submission = kernelContainer.db
      .prepare(
        'SELECT score, status, feedback FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?',
      )
      .get(promoteJson.assignmentId, studentId) as { score: number; status: string; feedback: string };
    expect(submission.score).toBe(88);
    expect(submission.status).toBe('graded');
    expect(submission.feedback).toContain('100%'); // 完成度 100%

    // F.3 — student_lesson_progress 标记为 100% 完成
    const progress = kernelContainer.db
      .prepare(
        'SELECT completed, progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?',
      )
      .get(studentId, lessonId) as { completed: number; progress_percent: number };
    expect(progress.completed).toBe(1);
    expect(progress.progress_percent).toBe(100);

    // F.4 — Socket 广播 student-progress-updated
    expect(emittedEvents.some((e) => e.event === 'student-progress-updated')).toBe(true);

    // F.5 — isPromoted 计数现在 >= 1
    const filterRowsAfter = (await (
      await fetch(`${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(coursewareUuid)}`, {
        headers: { Cookie: `edu_os_token=${teacherToken}` },
      })
    ).json()) as Array<{ isPromoted: number }>;
    expect(filterRowsAfter[0].isPromoted).toBeGreaterThanOrEqual(1);

    // F.6 — 幂等：第二次 promote 不会重复建作业，submission 行只增不改
    const promoteAgain = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `edu_os_token=${teacherToken}` },
      body: JSON.stringify({ lessonId, classId }),
    });
    expect(promoteAgain.status).toBe(200);
    const allSubs = kernelContainer.db
      .prepare('SELECT count(*) as n FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(promoteJson.assignmentId, studentId) as { n: number };
    expect(allSubs.n).toBe(1);

    // F.7 — 教师在「学情概览」拉到的成绩来自 grading.ts，应该能看到该生分数
    // （grading.ts 用 assignment_submissions 的 score 算班级指标）
    const classGrades = kernelContainer.db
      .prepare(
        `SELECT student_id, score FROM assignment_submissions
         WHERE assignment_id = ? ORDER BY score DESC`,
      )
      .all(promoteJson.assignmentId) as Array<{ student_id: string; score: number }>;
    expect(classGrades.length).toBe(1);
    expect(classGrades[0].student_id).toBe(studentId);
    expect(classGrades[0].score).toBe(88);
  });

  it('handles 0-1 range score normalization during promote', async () => {
    // 模拟某些课件把分数写为 0-1 比例（extractScoreCommentCompletion 的常见形态）
    const now = Date.now();
    const attemptId = `att-e2e-${now}-norm`;

    kernelContainer.db
      .prepare(
        'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(attemptId, coursewareId, studentId, now, now + 1000, 'finished');
    kernelContainer.db
      .prepare(
        'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(`sr-norm-${now}`, attemptId, 0.85, 'proportion score', 1, null);

    const promoteRes = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `edu_os_token=${teacherToken}` },
      body: JSON.stringify({ lessonId, classId }),
    });
    expect(promoteRes.status).toBe(200);
    const body = (await promoteRes.json()) as { score: number };
    expect(body.score).toBe(85); // 0.85 * 100 → 85

    // Cleanup this single attempt's promoted artifacts
    const allAsts = kernelContainer.db
      .prepare(
        `SELECT id FROM assignments
         WHERE class_id = ? AND lesson_id = ? AND title = ?`,
      )
      .all(classId, lessonId, `互动课件: ${coursewareName}`) as Array<{ id: string }>;
    for (const a of allAsts) {
      kernelContainer.db.prepare('DELETE FROM assignment_submissions WHERE assignment_id = ?').run(a.id);
      kernelContainer.db.prepare('DELETE FROM assignments WHERE id = ?').run(a.id);
    }
    kernelContainer.db.prepare('DELETE FROM submission_result WHERE attempt_id = ?').run(attemptId);
    kernelContainer.db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(attemptId);
  });

  it('returns 404 when promoting a non-existent attempt', async () => {
    const res = await fetch(`${baseUrl}/api/courseware/attempts/does-not-exist/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `edu_os_token=${teacherToken}` },
      body: JSON.stringify({ lessonId, classId }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when promote is called without lessonId/classId', async () => {
    const now = Date.now();
    const attemptId = `att-e2e-${now}-noctx`;
    kernelContainer.db
      .prepare(
        'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
      )
      .run(attemptId, coursewareId, studentId, now, 'in_progress');

    const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: `edu_os_token=${teacherToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    // Cleanup
    kernelContainer.db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(attemptId);
  });
});