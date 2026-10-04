import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import fs from 'fs';
import JSZip from 'jszip';
import { registerCoursewareRoutes } from '../routes/courseware.js';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerAssignmentsRoutes } from '../routes/assignments.js';
import { registerGradingRoutes } from '../routes/grading.js';
import { setupRealtimeBridge } from '../realtime-bridge.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { mintCoursewareToken } from '../utils/courseware-access.js';

/**
 * 业务黄金旅程场景 4：交互式课件沙箱与 Bridge SDK 旅程测试
 * (Courseware Sandbox & Bridge SDK Lifecycle Journey)
 *
 * 覆盖环节：
 *   阶段 1：课件包安全上传与 Zip Slip 路径穿越防御
 *   阶段 2：沙箱加载、HMAC Token 校验与 Bridge SDK 自动注入
 *   阶段 3：Bridge 消息流水、实时进度追踪与学生作答提交
 *   阶段 4：教师端一键晋升为作业成绩（/promote）与课程进度自动闭环
 *   阶段 5：越权防御（未授权沙箱拦截、防冒用 Token、学生端越权 promote 拦截）
 */

describe('Golden Journey 4: Courseware Sandbox & Bridge SDK Lifecycle', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  // ── 测试账户与主体夹具 ─────────────────────────────────────────
  const teacherId = 'usr-cw-teacher-j4';
  const teacherToken = 'tok-cw-teacher-j4';
  const studentId = 'usr-cw-student-j4';
  const studentToken = 'tok-cw-student-j4';
  const otherStudentId = 'usr-cw-other-j4';
  const otherStudentToken = 'tok-cw-other-j4';

  const classId = 'cls-cw-j4';
  const className = '高一物理创新实验班';
  const lessonId = `lesson-cw-j4-${Date.now()}`;

  let createdCoursewareUuid = '';
  let createdCoursewareId = '';
  const attemptId = `att-cw-j4-${Date.now()}`;
  const emittedEvents: Array<{ event: string; payload: any }> = [];

  const teacherCookie = { Cookie: `edu_os_token=${teacherToken}` };
  const studentCookie = { Cookie: `edu_os_token=${studentToken}` };
  const otherStudentCookie = { Cookie: `edu_os_token=${otherStudentToken}` };

  beforeAll(async () => {
    // 确保内核和系统插件（包括 BuiltinPlugin 的 courseware.upload 处理器）加载就绪
    await kernelContainer.ready;

    const now = Date.now();
    const db = kernelContainer.db;

    // 1. 初始化教师与学生用户
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'cw_teacher_j4', 'pwd', 'teacher', '物理李老师', now);

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(studentId, 'cw_student_j4', 'pwd', 'student', '张三', now);

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherStudentId, 'cw_other_j4', 'pwd', 'student', '李四', now);

    // 2. 初始化 Session
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'cw_teacher_j4' }),
      now,
      now + 86400000,
    );

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      studentToken,
      JSON.stringify({ userId: studentId, role: 'student', username: 'cw_student_j4' }),
      now,
      now + 86400000,
    );

    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      otherStudentToken,
      JSON.stringify({ userId: otherStudentId, role: 'student', username: 'cw_other_j4' }),
      now,
      now + 86400000,
    );

    // 3. 初始化班级与班级学生绑定
    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(classId, className, '牛顿力学虚拟实验课', 'pass-cw-j4', now);

    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(studentId, 'STU-2026-001', '张三', 'zhangsan@openlearn.test', now);

    db.prepare(
      'INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(otherStudentId, 'STU-2026-002', '李四', 'lisi@openlearn.test', now);

    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );
    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      otherStudentId,
      now,
    );

    // 4. 初始化课程记录
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, progress_conditions, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      lessonId,
      '牛顿运动定律数字仿真实验',
      JSON.stringify({ description: '使用数字化课件进行动力学仿真探究' }),
      null,
      'manual',
      null,
      teacherId,
      now,
      now,
    );

    // 5. 启动 Express 测试服务器与挂载路由
    app = express();
    app.use(express.json({ limit: '10mb' }));

    const mockIo: any = {
      emit: (event: string, payload: any) => {
        emittedEvents.push({ event, payload });
      },
      to: () => ({
        emit: (event: string, payload: any) => {
          emittedEvents.push({ event, payload });
        },
      }),
    };

    const ctx: any = { app, io: mockIo };
    registerCoursewareRoutes(ctx);
    registerBridgeRoutes(ctx);
    registerLessonsRoutes(ctx);
    registerAssignmentsRoutes(ctx);
    registerGradingRoutes(ctx);

    setupRealtimeBridge({
      eventBus: kernelContainer.eventBus,
      io: mockIo,
      db: kernelContainer.db as any,
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    const db = kernelContainer.db;
    // 清理创建的作业与课件记录
    db.prepare('DELETE FROM assignment_submissions WHERE assignment_id LIKE ?').run('ast-cw-%');
    db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM student_lesson_progress WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM submission_result WHERE attempt_id = ?').run(attemptId);
    db.prepare('DELETE FROM courseware_attempt WHERE id = ?').run(attemptId);
    if (createdCoursewareId) {
      db.prepare('DELETE FROM courseware WHERE id = ?').run(createdCoursewareId);
    }
    if (createdCoursewareUuid) {
      db.prepare('DELETE FROM courseware WHERE uuid = ?').run(createdCoursewareUuid);
      const cwDir = path.resolve(process.cwd(), 'storage', 'courseware', createdCoursewareUuid);
      if (fs.existsSync(cwDir)) {
        fs.rmSync(cwDir, { recursive: true, force: true });
      }
    }
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id IN (?, ?)').run(studentId, otherStudentId);
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(teacherId, studentId, otherStudentId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(teacherToken, studentToken, otherStudentToken);

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 阶段 1：课件包安全上传与 Zip Slip 路径穿越防御
  // ─────────────────────────────────────────────────────────────
  describe('阶段 1：课件包安全上传与 Zip Slip 路径穿越防御', () => {
    it('1.1 恶意文件名路径穿越与损坏 ZIP 包被严格阻断且返回错误', async () => {
      // 1. 验证 HTML 单文件上传时的路径穿越文件名 (如 filename: '..') 被严格阻断
      const resTraversal = await fetch(`${baseUrl}/api/courseware/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...teacherCookie,
        },
        body: JSON.stringify({
          name: '路径穿越测试课件',
          filename: '..',
          base64Data: Buffer.from('<html><body>Exploit</body></html>').toString('base64'),
        }),
      });

      expect(resTraversal.status).not.toBe(200);
      const traversalData = await resTraversal.json();
      expect(JSON.stringify(traversalData)).toMatch(/supported for courseware|Invalid courseware filename/i);

      // 2. 验证损坏/伪造的 ZIP 包被解析器阻断
      const resCorrupt = await fetch(`${baseUrl}/api/courseware/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...teacherCookie,
        },
        body: JSON.stringify({
          name: '损坏ZIP课件',
          filename: 'corrupted.zip',
          base64Data: Buffer.from('NOT_A_VALID_ZIP_BUFFER').toString('base64'),
        }),
      });

      expect(resCorrupt.status).not.toBe(200);
      const corruptData = await resCorrupt.json();
      expect(JSON.stringify(corruptData)).toMatch(/Failed to parse ZIP archive/i);
    });

    it('1.2 上传非允许扩展名（如 .exe / .sh）被阻断', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...teacherCookie,
        },
        body: JSON.stringify({
          name: '非法可执行文件',
          filename: 'trojan.exe',
          base64Data: Buffer.from('MZ...').toString('base64'),
        }),
      });

      expect(res.status).not.toBe(200);
      const text = await res.text();
      expect(text).toMatch(/supported for courseware/i);
    });

    it('1.3 教师上传合法 ZIP 课件包成功解压并自动登记入库', async () => {
      const validZip = new JSZip();
      validZip.file(
        'index.html',
        `<!DOCTYPE html>
<html>
<head><title>牛顿第二定律虚拟探究课件</title></head>
<body>
  <h1>Newton's Second Law Simulation</h1>
  <div id="status">Interactive Courseware Ready</div>
  <script src="/bridge.js"></script>
</body>
</html>`,
      );
      validZip.file('assets/style.css', 'body { font-family: sans-serif; }');
      const validZipBuffer = await validZip.generateAsync({ type: 'nodebuffer' });

      const res = await fetch(`${baseUrl}/api/courseware/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...teacherCookie,
        },
        body: JSON.stringify({
          name: '牛顿第二定律虚拟探究课件',
          filename: 'newton_law.zip',
          base64Data: validZipBuffer.toString('base64'),
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.uuid).toBeDefined();
      expect(body.id).toBeDefined();
      expect(body.entry).toBe('index.html');

      createdCoursewareUuid = body.uuid;
      createdCoursewareId = body.id;

      // 验证解压磁盘落地
      const extractedHtml = path.resolve(process.cwd(), 'storage', 'courseware', createdCoursewareUuid, 'index.html');
      expect(fs.existsSync(extractedHtml)).toBe(true);
      const content = fs.readFileSync(extractedHtml, 'utf8');
      expect(content).toContain("Newton's Second Law Simulation");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 阶段 2：沙箱加载、HMAC Token 校验与 Bridge SDK 自动注入
  // ─────────────────────────────────────────────────────────────
  describe('阶段 2：沙箱加载、HMAC Token 校验与 Bridge SDK 自动注入', () => {
    let coursewareToken = '';

    it('2.1 已认证学生调用 /access-token 成功铸造短时 HMAC token', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/${createdCoursewareUuid}/access-token`, {
        headers: studentCookie,
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string };
      expect(typeof data.token).toBe('string');
      expect(data.token.length).toBeGreaterThan(10);
      coursewareToken = data.token;
    });

    it('2.2 学生携带合法 token 访问沙箱 /runtime/:uuid/，获得带 Bridge SDK 注入的 HTML', async () => {
      const runtimeUrl = `${baseUrl}/runtime/${createdCoursewareUuid}/?ct=${encodeURIComponent(coursewareToken)}`;
      const res = await fetch(runtimeUrl);
      expect(res.status).toBe(200);

      const html = await res.text();
      // 验证课件原内容
      expect(html).toContain("Newton's Second Law Simulation");
      // 验证 Bridge SDK 注入
      expect(html).toContain('window.LMS');

      // 验证 CSP 严格沙箱响应头：包含 frame-ancestors 'self'
      const csp = res.headers.get('content-security-policy') || '';
      expect(csp).toContain("frame-ancestors 'self'");
    });

    it('2.3 课件列表查询可查到已上传课件', async () => {
      const res = await fetch(`${baseUrl}/api/courseware`, {
        headers: teacherCookie,
      });
      expect(res.status).toBe(200);
      const list = (await res.json()) as any[];
      const found = list.find((item) => item.uuid === createdCoursewareUuid);
      expect(found).toBeDefined();
      expect(found.name).toBe('牛顿第二定律虚拟探究课件');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 阶段 3：Bridge 消息流水、实时进度追踪与学生作答提交
  // ─────────────────────────────────────────────────────────────
  describe('阶段 3：Bridge 消息流水、实时进度追踪与学生作答提交', () => {
    beforeAll(() => {
      // 在数据库中插入由张三学生初始化的 attempt 记录
      const now = Date.now();
      kernelContainer.db
        .prepare(
          'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(attemptId, createdCoursewareId, studentId, now, 'in_progress');
    });

    it('3.1 学生在沙箱中互动，上报阶段性答题进度事件流（POST /log）', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...studentCookie,
        },
        body: JSON.stringify({
          eventType: 'experiment_step_completed',
          payload: { step: 1, accelerationCalculated: 2.45, completion: 0.5, lessonId },
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('3.2 学生完成仿真实验，LMS.submit 提交最终作答得分（POST /submit）', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...studentCookie,
        },
        body: JSON.stringify({
          score: 92,
          completion: 1,
          status: 'completed',
          comment: '牛顿第二定律斜面小车仿真实验探究完成，误差率在允许范围内',
          extra: { trials: 5, rSquared: 0.992 },
          lessonId,
        }),
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.success).toBe(true);

      // 验证数据库状态已转变为已完成
      const attemptRow = kernelContainer.db
        .prepare('SELECT status, finished_at FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { status: string; finished_at: number };
      expect(['finished', 'completed']).toContain(attemptRow.status);
      expect(attemptRow.finished_at).toBeGreaterThan(0);

      // 验证 submission_result 表记录了成绩 92 分
      const subResult = kernelContainer.db
        .prepare('SELECT score, completion FROM submission_result WHERE attempt_id = ?')
        .get(attemptId) as { score: number; completion: number };
      expect(subResult.score).toBe(92);
      expect(subResult.completion).toBe(1);

      // 验证实时总线广播了 courseware-attempt-updated 事件
      const updateEvt = emittedEvents.find((e) => e.event === 'courseware-attempt-updated');
      expect(updateEvt).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 阶段 4：教师端一键晋升为作业成绩（/promote）与课程进度自动闭环
  // ─────────────────────────────────────────────────────────────
  describe('阶段 4：教师端一键晋升为作业成绩与课程进度自动闭环', () => {
    let createdAssignmentId = '';

    it('4.1 教师拉取课件作答榜单（GET /api/courseware/attempts），能看到张三的未晋升成绩 92 分', async () => {
      const res = await fetch(
        `${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(createdCoursewareUuid)}`,
        { headers: teacherCookie },
      );
      expect(res.status).toBe(200);
      const envelope: any = await res.json();
      expect(envelope.total).toBeGreaterThanOrEqual(1);

      const record = envelope.data.find((item: any) => item.attemptId === attemptId);
      expect(record).toBeDefined();
      expect(record.studentId).toBe(studentId);
      expect(record.score).toBe(92);
      expect(record.isPromoted).toBe(0);
    });

    it('4.2 教师点击一键晋升（POST /promote），将课件得分自动转换为正式作业成绩', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...teacherCookie,
        },
        body: JSON.stringify({ lessonId, classId }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { success: boolean; assignmentId: string; score: number };
      expect(json.success).toBe(true);
      expect(json.assignmentId).toMatch(/^ast-cw-/);
      expect(json.score).toBe(92);
      createdAssignmentId = json.assignmentId;
    });

    it('4.3 验证作业系统已产生「互动课件: ...」作业记录且绑定班级与课程', async () => {
      const assignment = kernelContainer.db
        .prepare('SELECT id, class_id, lesson_id, title FROM assignments WHERE id = ?')
        .get(createdAssignmentId) as { id: string; class_id: string; lesson_id: string; title: string };
      expect(assignment).toBeDefined();
      expect(assignment.class_id).toBe(classId);
      expect(assignment.lesson_id).toBe(lessonId);
      expect(assignment.title).toContain('牛顿第二定律虚拟探究课件');
    });

    it('4.4 验证 assignment_submissions 自动写入张三的 92 分并标记为 graded', async () => {
      const submission = kernelContainer.db
        .prepare('SELECT score, status, feedback FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
        .get(createdAssignmentId, studentId) as { score: number; status: string; feedback: string };
      expect(submission).toBeDefined();
      expect(submission.score).toBe(92);
      expect(submission.status).toBe('graded');
    });

    it('4.5 验证张三在该课程的进度 student_lesson_progress 自动达到 100%', async () => {
      const progress = kernelContainer.db
        .prepare('SELECT completed, progress_percent FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?')
        .get(studentId, lessonId) as { completed: number; progress_percent: number };
      expect(progress).toBeDefined();
      expect(progress.completed).toBe(1);
      expect(progress.progress_percent).toBe(100);
    });

    it('4.6 再次拉取榜单，验证 isPromoted 状态更新为 1', async () => {
      const res = await fetch(
        `${baseUrl}/api/courseware/attempts?coursewareUuid=${encodeURIComponent(createdCoursewareUuid)}`,
        { headers: teacherCookie },
      );
      expect(res.status).toBe(200);
      const envelope: any = await res.json();
      const updatedRecord = envelope.data.find((item: any) => item.attemptId === attemptId);
      expect(updatedRecord).toBeDefined();
      expect(updatedRecord.isPromoted).toBeGreaterThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 阶段 5：越权防御与未授权沙箱访问拦截
  // ─────────────────────────────────────────────────────────────
  describe('阶段 5：越权防御与未授权沙箱访问拦截', () => {
    it('5.1 无 Token 直接访问沙箱 /runtime/:uuid/ 返回 401', async () => {
      const res = await fetch(`${baseUrl}/runtime/${createdCoursewareUuid}/`);
      expect(res.status).toBe(401);
    });

    it('5.2 携带伪造 Token 访问沙箱返回 401', async () => {
      const res = await fetch(`${baseUrl}/runtime/${createdCoursewareUuid}/?ct=fake-tampered-token`);
      expect(res.status).toBe(401);
    });

    it('5.3 携带其他课件 UUID 铸造的 Token 访问沙箱返回 401', async () => {
      const foreignToken = mintCoursewareToken('foreign-other-uuid');
      const res = await fetch(
        `${baseUrl}/runtime/${createdCoursewareUuid}/?ct=${encodeURIComponent(foreignToken)}`,
      );
      expect(res.status).toBe(401);
    });

    it('5.4 匿名未登录用户尝试铸造 Token 返回 401', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/${createdCoursewareUuid}/access-token`);
      expect(res.status).toBe(401);
    });

    it('5.5 学生角色试图调用教师专用的 /promote 接口被 401/403 拒绝', async () => {
      const res = await fetch(`${baseUrl}/api/courseware/attempts/${attemptId}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...studentCookie,
        },
        body: JSON.stringify({ lessonId, classId }),
      });
      // 学生无权 promote 成绩为作业成绩，必须是 teacher 或 administrator
      expect([401, 403]).toContain(res.status);
    });
  });
});
