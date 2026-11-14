/**
 * @vitest-environment node
 */
import express, { type RequestHandler } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { runStartupMigrations, type MigrationDb } from '../bootstrap-db.js';
import type { ServerContext } from '../context.js';
import { registerFilesRoutes, serveFileAsset } from '../routes/files.js';
import { registerOsRoutes } from '../routes/os.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import {
  LocalFileStorage,
  getFileStorageService,
  resetFileStorageServiceForTesting,
} from '../services/file-storage/index.js';

const db = () => kernelContainer.db;

const adminId = 'usr-froute-admin';
const teacherId = 'usr-froute-teacher';
const studentId = 'stu-froute-1';
const otherStudentId = 'stu-froute-2';

const adminToken = 'tok-froute-admin';
const teacherToken = 'tok-froute-teacher';
const studentToken = 'tok-froute-s1';
const otherToken = 'tok-froute-s2';

const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

let app: express.Express;
let server: Server;
let baseUrl = '';
const createdAssetIds: string[] = [];

describe('文件安全读取网关、旧路径别名与管理配置路由', () => {
  beforeAll(async () => {
    resetFileStorageServiceForTesting();
    await runStartupMigrations(db() as unknown as MigrationDb);

    const now = Date.now();
    for (const u of [
      { id: adminId, username: 'froute_admin', role: 'administrator', name: 'File Admin' },
      { id: teacherId, username: 'froute_teacher', role: 'teacher', name: 'File Teacher' },
      { id: studentId, username: 'FR-001', role: 'student', name: 'File Student 1' },
      { id: otherStudentId, username: 'FR-002', role: 'student', name: 'File Student 2' },
    ]) {
      db()
        .prepare(
          'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(u.id, u.username, 'hash', u.role, u.name, now);
    }

    db()
      .prepare(
        `INSERT OR REPLACE INTO plugin_assignments
           (id, class_id, lesson_id, title, allow_late, allow_text, allow_link, max_files, max_file_size,
            allowed_ext, peer_review_mode, peer_review_count, teacher_weight, peer_weight, status, created_by, created_at, updated_at)
         VALUES (?, NULL, ?, ?, 1, 1, 0, 3, 5242880, '', 'assigned', 1, 0.6, 0.4, 'published', ?, ?, ?)`,
      )
      .run('asg-froute-1', 'lesson-froute-1', 'Test Homework', teacherId, now, now);

    const sessions = [
      { token: adminToken, data: { userId: adminId, role: 'administrator', username: 'froute_admin' } },
      { token: teacherToken, data: { userId: teacherId, role: 'teacher', username: 'froute_teacher' } },
      { token: studentToken, data: { userId: studentId, role: 'student', username: 'FR-001' } },
      { token: otherToken, data: { userId: otherStudentId, role: 'student', username: 'FR-002' } },
    ];
    for (const s of sessions) {
      db()
        .prepare(
          'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(s.token, JSON.stringify(s.data), now, now + 86_400_000);
    }

    app = express();
    app.use(express.json({ limit: '16mb' }));
    const noopMiddleware: RequestHandler = (_req, _res, next) => {
      next();
    };
    const routeCtx = { app, aiLimiter: noopMiddleware } as unknown as ServerContext;
    registerFilesRoutes({ app });
    registerOsRoutes(routeCtx);
    registerPluginsRoutes(routeCtx);

    // 挂载与 server.ts 一致的 /uploads 别名兜底中间件（不含真实磁盘旧文件）
    app.use('/uploads', async (req, res) => {
      const asset = getFileStorageService().getAssetByAlias(`/uploads${req.path || ''}`);
      if (!asset) {
        return res.status(404).json({ error: 'File not found' });
      }
      await serveFileAsset(req, res, asset);
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(async () => {
    // 恢复默认存储策略配置，避免测试用例之间互相污染
    getFileStorageService().updateConfig({
      defaultBackend: 'local',
      deduplicateByHash: true,
      layout: { scheme: 'by-date' },
    });
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const svc = getFileStorageService();
    for (const assetId of createdAssetIds.splice(0)) {
      await svc.purgeAsset(assetId).catch(() => {});
    }
    db().prepare('DELETE FROM plugin_assignment_files WHERE id = ?').run('af-froute-1');
    db().prepare('DELETE FROM plugin_assignments WHERE id = ?').run('asg-froute-1');
    for (const tok of [adminToken, teacherToken, studentToken, otherToken]) {
      db().prepare('DELETE FROM client_sessions WHERE id = ?').run(tok);
    }
    db().prepare('DELETE FROM users WHERE id IN (?, ?, ?, ?)').run(adminId, teacherId, studentId, otherStudentId);
    svc.updateConfig({
      defaultBackend: 'local',
      deduplicateByHash: true,
      layout: { scheme: 'by-date' },
    });
    resetFileStorageServiceForTesting();
  });

  it('GET /api/files/:assetId 实施分级鉴权（public / authenticated / assignment）与安全响应头', async () => {
    const svc = getFileStorageService();

    // 1. public 资产支持免登录读取与 ETag / 304 缓存命中
    const pub = await svc.store({
      buffer: Buffer.from('public-avatar-bytes'),
      originalName: 'avatar.png',
      mime: 'image/png',
      context: { purpose: 'avatar', accessScope: 'public' },
    });
    createdAssetIds.push(pub.assetId);

    const resPub = await fetch(`${baseUrl}${pub.fileUrl}`);
    expect(resPub.status).toBe(200);
    expect(resPub.headers.get('x-content-type-options')).toBe('nosniff');
    const etag = resPub.headers.get('etag');
    expect(etag).toBeTruthy();

    const res304 = await fetch(`${baseUrl}${pub.fileUrl}`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(res304.status).toBe(304);

    // 2. authenticated 资产对未登录返回 401，登录后返回 200 且含 sandbox CSP
    const authAsset = await svc.store({
      buffer: Buffer.from('courseware-attachment-bytes'),
      originalName: 'note.txt',
      mime: 'text/plain',
      context: { purpose: 'courseware-asset', accessScope: 'authenticated', authorId: teacherId },
    });
    createdAssetIds.push(authAsset.assetId);

    const resAnon = await fetch(`${baseUrl}${authAsset.fileUrl}`);
    expect(resAnon.status).toBe(401);

    const resAuth = await fetch(`${baseUrl}${authAsset.fileUrl}`, { headers: cookie(studentToken) });
    expect(resAuth.status).toBe(200);
    expect(resAuth.headers.get('content-security-policy')).toBe('sandbox');

    // 3. assignment 资产：他人 403、提交本人与任课教师 200，且响应头强制 private, no-store
    const workAsset = await svc.store({
      buffer: Buffer.from('%PDF-1.4\nstudent submission'),
      originalName: 'work.pdf',
      mime: 'application/pdf',
      skipDedup: true,
      context: { purpose: 'assignment', accessScope: 'assignment', authorId: studentId },
    });
    createdAssetIds.push(workAsset.assetId);

    db()
      .prepare(
        `INSERT OR REPLACE INTO plugin_assignment_files
           (id, assignment_id, student_id, original_name, mime, size, stored_path, asset_id, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'af-froute-1',
        'asg-froute-1',
        studentId,
        'work.pdf',
        'application/pdf',
        26,
        workAsset.storageKey,
        workAsset.assetId,
        Date.now(),
      );

    const resOther = await fetch(`${baseUrl}${workAsset.fileUrl}`, { headers: cookie(otherToken) });
    expect(resOther.status).toBe(403);

    const resOwner = await fetch(`${baseUrl}${workAsset.fileUrl}`, { headers: cookie(studentToken) });
    expect(resOwner.status).toBe(200);
    expect(resOwner.headers.get('cache-control')).toBe('private, no-store');

    const resTeacher = await fetch(`${baseUrl}${workAsset.fileUrl}`, { headers: cookie(teacherToken) });
    expect(resTeacher.status).toBe(200);
  });

  it('HTML 与 SVG 文件强制服务端安全降级（text/plain / attachment）并在物理丢失时返回干净 404', async () => {
    const svc = getFileStorageService();

    const htmlAsset = await svc.store({
      buffer: Buffer.from('<script>alert(1)</script>'),
      originalName: 'evil.html',
      mime: 'text/html',
      context: { purpose: 'attachment', accessScope: 'public' },
    });
    createdAssetIds.push(htmlAsset.assetId);

    const resHtml = await fetch(`${baseUrl}${htmlAsset.fileUrl}`);
    expect(resHtml.status).toBe(200);
    expect(resHtml.headers.get('content-type')).toContain('text/plain');
    expect(resHtml.headers.get('content-security-policy')).toBe('sandbox');
    expect(resHtml.headers.get('x-content-type-options')).toBe('nosniff');

    const svgAsset = await svc.store({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      originalName: 'diagram.svg',
      mime: 'image/svg+xml',
      context: { purpose: 'attachment', accessScope: 'public' },
    });
    createdAssetIds.push(svgAsset.assetId);

    const resSvg = await fetch(`${baseUrl}${svgAsset.fileUrl}`);
    expect(resSvg.status).toBe(200);
    expect(resSvg.headers.get('content-disposition')).toContain('attachment');

    // 删除底层物理文件，验证返回干净 404
    const localBackend = new LocalFileStorage();
    const absPath = localBackend.resolveLocalPath(htmlAsset.storageKey);
    fs.unlinkSync(absPath);

    const resMissing = await fetch(`${baseUrl}${htmlAsset.fileUrl}`);
    expect(resMissing.status).toBe(404);
  });

  it('/uploads/* 旧路径通过 file_aliases 回退读取并应用相同安全头', async () => {
    const svc = getFileStorageService();
    const legacy = await svc.store({
      buffer: Buffer.from('legacy-aliased-asset'),
      originalName: 'slide.png',
      mime: 'image/png',
      aliases: ['/uploads/legacy-route-test.png'],
      context: { purpose: 'courseware-asset', accessScope: 'authenticated', authorId: teacherId },
    });
    createdAssetIds.push(legacy.assetId);

    const anonRes = await fetch(`${baseUrl}/uploads/legacy-route-test.png`);
    expect(anonRes.status).toBe(401);

    const okRes = await fetch(`${baseUrl}/uploads/legacy-route-test.png`, { headers: cookie(teacherToken) });
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe('legacy-aliased-asset');
    expect(okRes.headers.get('x-content-type-options')).toBe('nosniff');

    const missRes = await fetch(`${baseUrl}/uploads/does-not-exist.png`, { headers: cookie(teacherToken) });
    expect(missRes.status).toBe(404);
  });

  it('Admin 文件存储配置接口严格限制管理员权限、拒绝非法模板且 /api/site-settings 不泄漏配置', async () => {
    const teacherRes = await fetch(`${baseUrl}/api/admin/file-storage/config`, { headers: cookie(teacherToken) });
    expect(teacherRes.status).toBe(403);

    const adminGet = await fetch(`${baseUrl}/api/admin/file-storage/config`, { headers: cookie(adminToken) });
    expect(adminGet.status).toBe(200);
    const cfgBody = await adminGet.json();
    expect(cfgBody.success).toBe(true);
    expect(cfgBody.config.defaultBackend).toBe('local');
    expect(Array.isArray(cfgBody.backends)).toBe(true);

    const badPut = await fetch(`${baseUrl}/api/admin/file-storage/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
      body: JSON.stringify({
        defaultBackend: 'local',
        deduplicateByHash: true,
        layout: { scheme: 'custom', template: '../evil/{safeName}' },
      }),
    });
    expect(badPut.status).toBe(400);

    const previewRes = await fetch(`${baseUrl}/api/admin/file-storage/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
      body: JSON.stringify({
        scheme: 'custom',
        template: 'courses/{courseId}/{safeName}',
        context: { courseId: 'math-101' },
      }),
    });
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.previewKey).toContain('courses/math-101/');

    const statsRes = await fetch(`${baseUrl}/api/admin/file-storage/stats`, { headers: cookie(adminToken) });
    expect(statsRes.status).toBe(200);
    const statsBody = await statsRes.json();
    expect(typeof statsBody.stats.activeAssets).toBe('number');

    const siteSettingsRes = await fetch(`${baseUrl}/api/site-settings`);
    expect(siteSettingsRes.status).toBe(200);
    const siteSettings = await siteSettingsRes.json();
    expect('file_storage_config' in siteSettings).toBe(false);
    expect('fileStorageConfig' in siteSettings).toBe(false);
  });

  it('POST /api/upload 经 FileStorageService 存储并支持透传 courseId/lessonId/purpose 上下文与 PDF 页数提取', async () => {
    const fakePdf = Buffer.from('%PDF-1.4\n/Type /Page\n/Type /Page\n/Type /Page\n');
    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({
        filename: 'algebra-lesson.pdf',
        base64Data: `data:application/pdf;base64,${fakePdf.toString('base64')}`,
        context: {
          courseId: 'course-algebra',
          lessonId: 'lesson-01',
          purpose: 'courseware',
        },
      }),
    });
    expect(uploadRes.status).toBe(200);
    const uploaded = await uploadRes.json();
    expect(uploaded.success).toBe(true);
    expect(uploaded.assetId).toBeTruthy();
    expect(uploaded.fileUrl).toBe(`/api/files/${uploaded.assetId}`);
    expect(uploaded.slideCount).toBe(3);
    createdAssetIds.push(uploaded.assetId);

    const asset = getFileStorageService().getAsset(uploaded.assetId)!;
    expect(asset.courseId).toBe('course-algebra');
    expect(asset.lessonId).toBe('lesson-01');
    expect(asset.purpose).toBe('courseware');

    // 下载回读验证字节完整
    const dlRes = await fetch(`${baseUrl}${uploaded.fileUrl}`, { headers: cookie(studentToken) });
    expect(dlRes.status).toBe(200);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    expect(buf.equals(fakePdf)).toBe(true);
  });
});
