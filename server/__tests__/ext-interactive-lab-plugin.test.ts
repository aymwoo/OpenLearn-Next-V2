import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerClassroomRoutes } from '../routes/classroom.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import { segmentGateService } from '../services/segment-gate-service.js';
import { buildInteractiveLabZip } from '../../packages/interactive-lab/builder.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('第三方增强套件插件: ext-interactive-lab 真实安装与全功能集成测试', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let originalNodeEnv: string | undefined;
  let originalPluginsDir: string;
  let testPluginsDir: string;

  const adminId = 'usr-lab-admin-01';
  const teacherId = 'usr-lab-teacher-01';
  const studentId = 'stu-lab-student-01';
  const classId = 'cls-lab-class-01';
  const lessonId = 'les-lab-lesson-01';

  const adminToken = 'tok-lab-admin-01';
  const teacherToken = 'tok-lab-teacher-01';
  const studentToken = 'tok-lab-student-01';

  const authCookie = (token: string) => ({
    Cookie: `edu_os_token=${token}`,
  });

  let installedPluginId: string | null = null;

  beforeAll(async () => {
    // 切换至 production 口径使得插件能够通过 file:// 解析 @openlearn/* external 导入
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // 插件目录必须位于 vite root（仓库）内以允许 Vitest module runner 正常动态 import
    originalPluginsDir = (kernelContainer.pluginHost as any).pluginsDir;
    testPluginsDir = fs.mkdtempSync(path.resolve(__dirname, '.tmp-plugins-lab-'));
    (kernelContainer.pluginHost as any).pluginsDir = testPluginsDir;

    ensureTestSchema();

    const db = kernelContainer.db;
    const now = Date.now();

    // 1. 初始化测试用户与班级
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminId, 'lab_admin', 'hash_admin', 'administrator', '实验管理员', now);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'lab_teacher', 'hash_teacher', 'teacher', '实验教师', now);
    db.prepare('INSERT OR REPLACE INTO students (id, name, student_number, created_at) VALUES (?, ?, ?, ?)').run(
      studentId,
      '实验学生',
      'LAB-STU-001',
      now,
    );

    db.prepare(
      'INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(classId, '实验探究竞赛班', 'Interactive Lab Class', 'lab-pass-123', teacherId, now);

    db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
      classId,
      studentId,
      now,
    );

    // 2. 初始化 Session
    const sessionData = (userId: string, role: string, extra: Record<string, string> = {}) =>
      JSON.stringify({ userId, role, username: userId, name: userId, ...extra });

    const insertSession = db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(adminToken, sessionData(adminId, 'administrator'), now, now + 86400000);
    insertSession.run(teacherToken, sessionData(teacherId, 'teacher'), now, now + 86400000);
    insertSession.run(studentToken, sessionData(studentId, 'student', { studentId }), now, now + 86400000);

    // 3. 搭建 Express 测试服务器
    app = express();
    app.use(express.json());

    // 挂载 expressApp 到 pluginHost，以支持静态路由注册
    kernelContainer.pluginHost.setExpressApp(app);

    const ioMock = {
      to: () => ({ emit: () => {} }),
      emit: () => {},
    };

    const classroomService = new ClassroomRuntimeService(db, ioMock as any);
    registerPluginsRoutes({ app, io: ioMock } as any);
    registerClassroomRoutes({ app, io: ioMock } as any, classroomService);
    registerLessonsRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    // 清理安装的插件
    if (installedPluginId) {
      try {
        await kernelContainer.pluginHost.deactivatePlugin(installedPluginId);
      } catch (_) {}
      try {
        await kernelContainer.pluginHost.uninstallPlugin(installedPluginId);
      } catch (_) {}
    }

    const db = kernelContainer.db;
    db.prepare('DELETE FROM teaching_modes WHERE id = ?').run('mode-arena-compete');
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
    db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
    db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?, ?)').run(adminToken, teacherToken, studentToken);

    // 恢复与清理 pluginsDir
    if (originalPluginsDir) {
      (kernelContainer.pluginHost as any).pluginsDir = originalPluginsDir;
    }
    if (testPluginsDir && fs.existsSync(testPluginsDir)) {
      try {
        fs.rmSync(testPluginsDir, { recursive: true, force: true });
      } catch (_) {}
    }

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it('1. 插件打包物结构与规范校验', async () => {
    const zipBuf = await buildInteractiveLabZip();
    expect(zipBuf).toBeInstanceOf(Buffer);
    expect(zipBuf.length).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(zipBuf);
    expect(zip.file('manifest.json')).not.toBeNull();
    expect(zip.file('index.js')).not.toBeNull();
    expect(zip.file('frontend.js')).not.toBeNull();
    expect(zip.file('storage/dist/sim-view.html')).not.toBeNull();
    expect(zip.file('storage/dist/sim-app.js')).not.toBeNull();

    const manifestText = await zip.file('manifest.json')!.async('string');
    const rawManifest = JSON.parse(manifestText);
    const parsed = manifestSchema.parse(rawManifest);

    expect(parsed.id).toBe('ext-interactive-lab');
    expect(parsed.name).toContain('虚拟探究实验');
    expect(parsed.capabilitiesProposed).toContain('segment:gate_eval');
    expect(parsed.contributes?.['segment.gate_type']).toBeDefined();
    expect(parsed.contributes?.['classroom.portal.teaching_mode']).toBeDefined();
    expect(parsed.contributes?.['palette.items']).toBeDefined();
    expect(parsed.deploy?.staticRoute).toBe('/ext/interactive-lab');
  });

  it('2. 通过 REST API (POST /api/plugins/upload-zip-raw) 上传并安装插件', async () => {
    const zipBuf = await buildInteractiveLabZip();

    const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
      method: 'POST',
      headers: {
        ...authCookie(adminToken),
        'Content-Type': 'application/zip',
        'x-filename': 'ext-interactive-lab-1.0.0.zip',
      },
      body: zipBuf,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; pluginId: string; manifest: { id: string } };
    expect(body.success).toBe(true);
    expect(body.manifest.id).toBe('ext-interactive-lab');
    expect(body.pluginId).toBeTruthy();

    installedPluginId = body.pluginId;

    // 激活插件
    await kernelContainer.pluginHost.activatePlugin(installedPluginId);
    const state = kernelContainer.pluginHost.getPluginState(installedPluginId);
    expect(state).toBe('active');
  });

  it('3. 验证自定义教学模式注册至 teaching_modes 表与 API 暴露', async () => {
    const db = kernelContainer.db;
    const modeRow = db.prepare('SELECT * FROM teaching_modes WHERE id = ?').get('mode-arena-compete') as any;
    expect(modeRow).toBeDefined();
    expect(modeRow.name).toBe('班级对抗竞赛模式');
    expect(modeRow.icon).toBe('Trophy');
    expect(modeRow.color).toBe('amber');

    // 通过接口读取
    const res = await fetch(`${baseUrl}/api/classroom/teaching-modes`, {
      method: 'GET',
      headers: authCookie(teacherToken),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; modes: Array<{ id: string; name: string }> };
    expect(data.success).toBe(true);
    const customMode = data.modes.find((m) => m.id === 'mode-arena-compete');
    expect(customMode).toBeDefined();
    expect(customMode?.name).toBe('班级对抗竞赛模式');
  });

  it('4. 验证扩展槽与声明式贡献挂载 (palette.items / editor.timeline_segment)', async () => {
    expect(installedPluginId).toBeTruthy();
    const manifest = kernelContainer.pluginHost.getPluginManifest(installedPluginId!);
    expect(manifest).toBeDefined();

    const contributes = (manifest?.contributes || {}) as Record<string, unknown>;
    expect(contributes['editor.palette_item']).toBeDefined();
    expect(contributes['segment.gate_type']).toBeDefined();
    expect(contributes['classroom.portal.teaching_mode']).toBeDefined();

    const gateTypes = contributes['segment.gate_type'] as Array<{ id: string; commandType: string }>;
    expect(gateTypes.some((g) => g.id === 'gate-circuit-verified')).toBe(true);
  });

  it('5. 验证静态沙箱视口资源安全分发与 CSP 头 (/ext/interactive-lab/sim-view.html)', async () => {
    const htmlRes = await fetch(`${baseUrl}/ext/interactive-lab/sim-view.html`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('闭合回路欧姆定律探究实验');
    expect(html).toContain('sim-app.js');
    expect(html).toContain('meterDisplay');

    // 验证安全沙箱 CSP 头
    const csp = htmlRes.headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain('sandbox allow-scripts allow-forms allow-downloads');

    const jsRes = await fetch(`${baseUrl}/ext/interactive-lab/sim-app.js`);
    expect(jsRes.status).toBe(200);
    const js = await jsRes.text();
    expect(js).toContain('lms.submit_score');
    expect(js).toContain('updateDisplay');
  });

  it('6. 教学环节准入门禁端到端判定与闭环放行 (未完成拦截 -> 提交实验 -> 判定放行)', async () => {
    const db = kernelContainer.db;
    const now = Date.now();

    // 创建带门禁的课节时间线：
    // seg-intro: 理论准备
    // seg-lab: 虚拟电路仿真 (门禁: gate-circuit-verified)
    // seg-summary: 实验总结
    const timeline = [
      { id: 'seg-intro', title: '电学理论' },
      {
        id: 'seg-lab',
        title: '虚拟电路探究实验',
        gates: [{ type: 'gate-circuit-verified' }],
      },
      { id: 'seg-summary', title: '全课总结' },
    ];

    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, creator_id, timeline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '欧姆定律探究课', teacherId, JSON.stringify(timeline), now, now);

    // ① 学生初次尝试访问环节 seg-lab：未完成实验，应当被门禁拦截
    const accessBlocked = await segmentGateService.evaluate({
      studentId,
      lessonId,
      targetSegmentId: 'seg-lab',
    });

    expect(accessBlocked.allowed).toBe(false);
    expect(accessBlocked.reason).toContain('请先在白板「虚拟电路探究器」中闭合电路并提交实验报告');
    expect(accessBlocked.progress).toMatchObject({ current: 0, target: 1 });

    // 亦可通过 HTTP API 进行端到端访问验证 (学生身份拦截 403)
    const httpBlockedRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/segment-access`, {
      method: 'POST',
      headers: {
        ...authCookie(studentToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetSegmentId: 'seg-lab' }),
    });
    expect(httpBlockedRes.status).toBe(403);
    const httpBlockedBody = (await httpBlockedRes.json()) as { allowed: boolean; reason?: string };
    expect(httpBlockedBody.allowed).toBe(false);
    expect(httpBlockedBody.reason).toContain('请先在白板「虚拟电路探究器」中闭合电路并提交实验报告');

    // ② 学生在仿真应用中闭合开关，提交实验结果 (模拟微课件 Bridge 提交命令)
    kernelContainer.capabilityGuard.grant('system:sim-bridge', 'lesson:read');
    const submitCmd = kernelContainer.commandBus.createCommand(
      'ext-interactive-lab.circuit.submit_lab',
      {
        studentId,
        lessonId,
        score: 100,
        isPassed: true,
        detail: { voltage: 12, resistance: 10, current: 1.2 },
      },
      'system:sim-bridge',
      { approved: true },
    );
    const submitRes = (await kernelContainer.commandBus.execute(submitCmd)) as { success: boolean; isPassed: boolean };
    expect(submitRes.success).toBe(true);
    expect(submitRes.isPassed).toBe(true);

    // ③ 查询实验完成状态
    const queryCmd = kernelContainer.commandBus.createCommand(
      'ext-interactive-lab.circuit.query_status',
      { studentId, lessonId },
      'system:sim-bridge',
      { approved: true },
    );
    const statusRes = (await kernelContainer.commandBus.execute(queryCmd)) as {
      submitted: boolean;
      isPassed: boolean;
      score: number;
    };
    expect(statusRes.submitted).toBe(true);
    expect(statusRes.isPassed).toBe(true);
    expect(statusRes.score).toBe(100);

    // ④ 学生再次核验环节准入权限：门禁判定放行通过
    const accessPassed = await segmentGateService.evaluate({
      studentId,
      lessonId,
      targetSegmentId: 'seg-lab',
    });

    expect(accessPassed.allowed).toBe(true);
    expect(accessPassed.gates[0].allowed).toBe(true);
    expect(accessPassed.gates[0].reason).toContain('虚拟电路探究实验已成功通关');
    expect(accessPassed.gates[0].progress).toMatchObject({ current: 1, target: 1 });

    // 亦可通过 HTTP API 进行端到端放行验证 (学生身份放行 200)
    const httpPassedRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/segment-access`, {
      method: 'POST',
      headers: {
        ...authCookie(studentToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetSegmentId: 'seg-lab' }),
    });
    expect(httpPassedRes.status).toBe(200);
    const httpPassedBody = (await httpPassedRes.json()) as { allowed: boolean };
    expect(httpPassedBody.allowed).toBe(true);
  });

  it('7. 插件平稳停用与资源回收', async () => {
    if (!installedPluginId) return;

    await kernelContainer.pluginHost.deactivatePlugin(installedPluginId);
    const state = kernelContainer.pluginHost.getPluginState(installedPluginId);
    expect(state).toBe('inactive');
  });
});
