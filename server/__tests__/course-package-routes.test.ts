import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'node:fs';
import path from 'node:path';
import { registerCoursePackageRoutes } from '../routes/course-packages.js';
import { runStartupMigrations } from '../bootstrap-db.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { buildTemplateCoursePackage, COURSE_PACKAGE_FORMAT } from '../services/course-package.js';
import { getUploadsDir } from '../utils/paths.js';

const db = kernelContainer.db;
const teacherId = 'usr-cpkg-teacher';
const teacherToken = 'tok-cpkg-teacher';

let app: express.Express;
let server: Server;
let baseUrl = '';

/** 本次运行导入成功的课程 id（afterAll 里统一清掉）。 */
const importedLessonIds: string[] = [];
/** 本次运行落盘的附件文件名（afterAll 里统一删掉）。 */
const createdAssetFiles: string[] = [];

/**
 * 删除本文件写入的全部痕迹。
 *
 * 必须显式删 whiteboard_elements：lessons 表上没有级联外键，删课程不会带走白板元素。
 * 漏删的 quiz 元素会被同 worker 内后跑的 legacy-assessment-import.test.ts
 * 当成「存量白板 quiz」统计进去（该测试断言 created.assessments === 2）。
 */
/** 记录一次成功导入产生的课程与附件，供 afterAll 清理。 */
function recordImport(body: any) {
  if (body?.result?.lessonId) importedLessonIds.push(body.result.lessonId as string);
  for (const asset of body?.result?.assetFiles ?? []) {
    if (typeof asset.fileUrl === 'string') createdAssetFiles.push(path.basename(asset.fileUrl));
  }
}

function purgeTestRows() {
  for (const id of importedLessonIds) {
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(id);
  }
  db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id NOT IN (SELECT id FROM lessons)').run();
  db.prepare("DELETE FROM lessons WHERE title LIKE '【CPKG-TEST】%'").run();
  importedLessonIds.length = 0;
  for (const name of createdAssetFiles) {
    try {
      const target = path.join(getUploadsDir(), name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (err) {
      console.warn('[course-package test] 清理测试附件失败:', (err as Error).message);
    }
  }
  createdAssetFiles.length = 0;
}

const cookie = (token: string) => ({ Cookie: 'edu_os_token=' + token });

describe('course package routes', () => {
  beforeAll(async () => {
    const now = Date.now();
    await runStartupMigrations(db as unknown as import('../bootstrap-db.js').MigrationDb);
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(teacherId, 'cpkg_teacher', 'hash_placeholder', 'teacher', '课程包教师', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'cpkg_teacher' }),
      now,
      now + 60 * 60 * 1000,
    );

    app = express();
    app.use(express.json({ limit: '64mb' }));
    registerCoursePackageRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = 'http://127.0.0.1:' + addr.port;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    purgeTestRows();
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(teacherToken);
    db.prepare('DELETE FROM users WHERE id = ?').run(teacherId);
  });

  beforeEach(() => {
    purgeTestRows();
  });

  it('requires authentication for the template download', async () => {
    const res = await fetch(baseUrl + '/api/course-packages/template');
    expect(res.status).toBe(401);
  });

  it('serves a downloadable course package template', async () => {
    const res = await fetch(baseUrl + '/api/course-packages/template', { headers: cookie(teacherToken) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('openlearn-course-template.json');
    const body = await res.json();
    expect(body.format).toBe(COURSE_PACKAGE_FORMAT);
    expect(body.lesson.title).toBeTruthy();
    expect(body.elements.length).toBeGreaterThan(0);
    expect(body.assets.length).toBe(2);
  });

  it('imports a package into lesson + timeline + whiteboard elements + assets', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】完整课程';

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    recordImport(body);
    const lessonId = body.result.lessonId as string;
    expect(body.result.segments).toBe(template.lesson.timeline.length);
    expect(body.result.elements).toBe(template.elements.length);
    expect(body.result.assets).toBe(2);

    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
    expect(lesson).toBeTruthy();
    expect(lesson.title).toBe('【CPKG-TEST】完整课程');
    const timeline = JSON.parse(lesson.timeline);
    expect(timeline).toHaveLength(template.lesson.timeline.length);
    expect(timeline[0].id).toBe(template.lesson.timeline[0].id);

    const elements = db
      .prepare('SELECT type, data FROM whiteboard_elements WHERE lesson_id = ?')
      .all(lessonId) as any[];
    expect(elements).toHaveLength(template.elements.length);

    // 附件占位符必须被解析成真实的 /uploads 路径，且文件确实落盘了
    const uploads = db
      .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'presentation'")
      .all(lessonId) as any[];
    const fileUrls = uploads
      .map((row) => JSON.parse(row.data).fileUrl)
      .filter((url: string) => typeof url === 'string' && url.startsWith('/uploads/'));
    expect(fileUrls.length).toBe(2);
    for (const url of fileUrls) {
      const filePath = path.join(getUploadsDir(), path.basename(url));
      expect(fs.existsSync(filePath), 'asset was not written: ' + url).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    }
  });

  it('supports the full download -> re-import round trip', async () => {
    // 完全复刻教师的操作路径：从端点下载模板文件 -> 原样提交回来。
    // 这一条同时验证「下载的内容是可导入的」与「占位符能被解析成真实 /uploads URL」。
    const download = await fetch(baseUrl + '/api/course-packages/template', { headers: cookie(teacherToken) });
    expect(download.status).toBe(200);
    const downloaded = (await download.json()) as any;

    downloaded.lesson.title = '【CPKG-TEST】下载再导入';
    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify(downloaded),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    recordImport(body);
    expect(body.result.assets).toBe(downloaded.assets.length);

    const lessonId = body.result.lessonId as string;
    const rows = db
      .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'presentation'")
      .all(lessonId) as any[];
    const fileUrls = rows.map((r) => JSON.parse(r.data).fileUrl).filter(Boolean);
    expect(fileUrls.length).toBeGreaterThanOrEqual(2);
    for (const url of fileUrls) {
      expect(typeof url).toBe('string');
      expect(url.startsWith('/uploads/')).toBe(true);
      expect(fs.existsSync(path.join(getUploadsDir(), path.basename(url)))).toBe(true);
    }
  });

  // ── G-06：导入幂等（docs/audit/course-import-audit.md）────────────────────

  it('rejects a second import of the same package with 409 and writes nothing', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】幂等';

    const first = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    recordImport(firstBody);
    expect(firstBody.result.duplicate).toBe(false);
    expect(firstBody.result.packageKey).toMatch(/^sha256:[0-9a-f]{64}$/);

    const countBefore = (db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE title = '【CPKG-TEST】幂等'").get() as any)
      .n;
    expect(countBefore).toBe(1);

    const second = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.success).toBe(false);
    expect(secondBody.code).toBe('COURSE_PACKAGE_DUPLICATE');
    expect(secondBody.duplicate.lessonId).toBe(firstBody.result.lessonId);
    expect(secondBody.duplicate.lessonTitle).toBe('【CPKG-TEST】幂等');
    expect(secondBody.duplicate.hasDeclaredId).toBe(false);

    // 关键断言：被拒绝的导入不能留下第二节课程，也不能留下白板元素
    const countAfter = (db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE title = '【CPKG-TEST】幂等'").get() as any)
      .n;
    expect(countAfter).toBe(1);
    const orphans = db
      .prepare('SELECT COUNT(*) AS n FROM whiteboard_elements WHERE lesson_id NOT IN (SELECT id FROM lessons)')
      .get() as any;
    expect(orphans.n).toBe(0);
  });

  it('uses meta.id as the dedup key when the package declares one', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】带 id 的包';
    template.meta = { ...template.meta, id: 'cpkg-test-declared-id' };

    const first = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    recordImport(firstBody);
    expect(firstBody.result.packageKey).toBe('id:cpkg-test-declared-id');
    expect(firstBody.result.packageId).toBe('cpkg-test-declared-id');

    // 改了标题、改了正文 —— 内容哈希变了，但 meta.id 没变，仍视为同一个包。
    // 这正是 meta.id 相对纯内容哈希的价值：作者声明的身份抗内容漂移。
    template.lesson.title = '【CPKG-TEST】带 id 的包（改名后）';
    template.lesson.content = '改了正文内容';

    const second = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.duplicate.packageKey).toBe('id:cpkg-test-declared-id');
    expect(secondBody.duplicate.hasDeclaredId).toBe(true);
  });

  it('imports a copy anyway when allowDuplicate is set', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】强制副本';

    const first = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    recordImport(firstBody);

    const second = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template, allowDuplicate: true }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    recordImport(secondBody);
    expect(secondBody.result.duplicate).toBe(true);
    expect(secondBody.result.lessonId).not.toBe(firstBody.result.lessonId);

    const rows = db.prepare("SELECT id FROM lessons WHERE title = '【CPKG-TEST】强制副本'").all() as any[];
    expect(rows).toHaveLength(2);
  });

  it('does not deduplicate across different creators', async () => {
    // 内置模板要能被每位教师各导一份 —— 全局去重会让第二位教师永远导不进模板。
    const otherTeacherId = 'usr-cpkg-teacher-2';
    const otherToken = 'tok-cpkg-teacher-2';
    const now = Date.now();
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(otherTeacherId, 'cpkg_teacher_2', 'hash_placeholder', 'teacher', '课程包教师2', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      otherToken,
      JSON.stringify({ userId: otherTeacherId, role: 'teacher', username: 'cpkg_teacher_2' }),
      now,
      now + 60 * 60 * 1000,
    );

    try {
      const template = await buildTemplateCoursePackage();
      template.lesson.title = '【CPKG-TEST】跨教师';

      const first = await fetch(baseUrl + '/api/course-packages/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
        body: JSON.stringify({ package: template }),
      });
      expect(first.status).toBe(200);
      recordImport(await first.json());

      const second = await fetch(baseUrl + '/api/course-packages/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(otherToken) },
        body: JSON.stringify({ package: template }),
      });
      expect(second.status).toBe(200);
      recordImport(await second.json());
    } finally {
      db.prepare('DELETE FROM client_sessions WHERE id = ?').run(otherToken);
      db.prepare('DELETE FROM users WHERE id = ?').run(otherTeacherId);
    }
  });

  it('allows re-importing after the lesson is deleted (the key is released)', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】删后重导';

    const first = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    recordImport(firstBody);

    // 模拟教师删课：键随课程行一起消失，不需要额外的清理链路。
    const lessonId = firstBody.result.lessonId as string;
    db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);

    const second = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    recordImport(secondBody);
    expect(secondBody.result.duplicate).toBe(false);
  });

  // ── 任意附件类型 → 白板侧引用机制（审计最后一项）─────────────────────────

  it('carries a non-embeddable asset as a downloadable reference instead of a broken viewer', async () => {
    // 课程包此前只能带 PDF/PPTX。现在能带 docx，但**渲染侧**没有 docx 的
    // 内联渲染器 —— 若原样保留 fileType='docx'，渲染器会拿 zip 字节去喂
    // PowerPointViewer，表现为「一直解析中」。所以导入时必须降级成 fileType='file'。
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】任意附件';
    template.meta = { ...template.meta, id: 'cpkg-any-asset-docx' };
    // 一个最小 docx（ZIP 容器签名 PK\x03\x04），后面补足内容让 magic bytes 通过
    const docxBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake-docx-body')]);
    template.assets = [
      {
        id: 'handout',
        filename: '第3章讲义.docx',
        contentType: 'docx',
        base64: docxBytes.toString('base64'),
      } as any,
    ];
    template.elements = [
      {
        type: 'presentation',
        segmentId: template.lesson.timeline[0].id,
        data: { fileUrl: '${asset:handout}', fileType: 'docx', fileName: '第3章讲义.docx' },
      } as any,
    ];

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    recordImport(body);
    const lessonId = body.result.lessonId as string;
    expect(body.result.assets).toBe(1);

    const row = db
      .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'presentation'")
      .get(lessonId) as any;
    const data = JSON.parse(row.data);
    // 引用是真的：URL 指向落盘后的 /uploads 文件
    expect(typeof data.fileUrl).toBe('string');
    expect(data.fileUrl.startsWith('/uploads/')).toBe(true);
    expect(fs.existsSync(path.join(getUploadsDir(), path.basename(data.fileUrl)))).toBe(true);
    // 且渲染器不会误以为这是 PPTX
    expect(data.fileType).toBe('file');
    expect(data.fileName).toBe('第3章讲义.docx');
    expect(data.slideCount).toBe(0);
  });

  it('rejects an asset whose bytes do not match the declared type', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】类型不符';
    template.meta = { ...template.meta, id: 'cpkg-any-asset-mismatch' };
    // 声明 docx（ZIP 容器），实际给 PDF 字节
    template.assets = [
      {
        id: 'liar',
        filename: '伪装.docx',
        contentType: 'docx',
        base64: Buffer.from('%PDF-1.4 not really a docx').toString('base64'),
      } as any,
    ];
    template.elements = [];

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(500);
    // 关键：整体回滚，不留下半截课程
    expect(db.prepare("SELECT id FROM lessons WHERE title = '【CPKG-TEST】类型不符'").get()).toBeUndefined();
  });

  it('rejects a text asset that is actually binary', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】文本伪装';
    template.meta = { ...template.meta, id: 'cpkg-any-asset-binary-as-text' };
    template.assets = [
      {
        id: 'bin-as-txt',
        filename: '大纲.md',
        contentType: 'md',
        base64: Buffer.from([0x23, 0x00, 0x01, 0x02]).toString('base64'),
      } as any,
    ];
    template.elements = [];

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(500);
    expect(db.prepare("SELECT id FROM lessons WHERE title = '【CPKG-TEST】文本伪装'").get()).toBeUndefined();
  });

  it('still embeds PDF/PPTX inline (no regression on the original two types)', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】PDF 仍内联';
    template.meta = { ...template.meta, id: 'cpkg-any-asset-pdf-inline' };

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    recordImport(body);
    const lessonId = body.result.lessonId as string;
    const rows = db
      .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'presentation'")
      .all(lessonId) as any[];
    const types = rows.map((r) => JSON.parse(r.data).fileType);
    expect(types).toContain('pdf');
    expect(types).toContain('pptx');
    expect(types).not.toContain('file');
  });

  it('rejects a malformed package with 400 and writes nothing', async () => {
    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: { format: 'something-else' } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  // ── Issue #246：附件落盘失败不留孤儿文件；请求体上限与产品承诺对齐 ────────

  it('does not leave orphan files when a later asset fails validation', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】孤儿清理';

    // 第一个附件合法（会真的落盘），第二个附件内容与声明类型不符 → 抛错
    const good = template.assets[0];
    template.assets = [
      { id: 'good-asset', filename: 'ok.pdf', contentType: 'pdf', base64: good.base64 },
      {
        id: 'bad-asset',
        filename: 'broken.pdf',
        contentType: 'pdf',
        base64: Buffer.from('this is definitely not a pdf').toString('base64'),
      },
    ];

    const uploadsDir = getUploadsDir();
    const before = new Set(fs.readdirSync(uploadsDir));

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.ok).toBe(false);

    // 关键断言：第一个附件已经写盘，但它不能在失败后被遗弃在 uploads 目录里
    const leaked = fs.readdirSync(uploadsDir).filter((name) => !before.has(name));
    expect(leaked, `孤儿附件未被清理: ${leaked.join(', ')}`).toEqual([]);

    // 数据库侧同样不留痕迹
    const lesson = db.prepare("SELECT id FROM lessons WHERE title = '【CPKG-TEST】孤儿清理'").get();
    expect(lesson).toBeUndefined();
  });

  it('imports a package whose request body is far beyond the global 2MB limit', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】大体积';

    // 3MB 的「PDF」：magic bytes 只看前 4 字节，后缀填充即可。
    // 保留原资产 id —— 白板元素里的 ${asset:...} 占位符指向它们。
    const bigPdf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(3 * 1024 * 1024, 0x20)]);
    template.assets[0].base64 = bigPdf.toString('base64');

    const payload = JSON.stringify({ package: template });
    expect(Buffer.byteLength(payload)).toBeGreaterThan(2 * 1024 * 1024);

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: payload,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    recordImport(body);
    expect(body.success).toBe(true);
    expect(body.result.assets).toBe(template.assets.length);
  });

  it('rejects a package whose decoded assets exceed the product limit with a clear 413', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】超限';

    // 解码后 21MB > 20MB 上限
    const hugePdf = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(21 * 1024 * 1024, 0x20)]);
    template.assets = [
      { id: 'huge-asset', filename: 'huge.pdf', contentType: 'pdf', base64: hugePdf.toString('base64') },
    ];

    const res = await fetch(baseUrl + '/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
      body: JSON.stringify({ package: template }),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('COURSE_PACKAGE_TOO_LARGE');
    expect(String(body.error)).toContain('20MB');
  });

  it('rolls the whole import back when a whiteboard element write fails', async () => {
    const template = await buildTemplateCoursePackage();
    template.lesson.title = '【CPKG-TEST】回滚';

    // 造一个必然失败的写点：BEFORE INSERT 触发器在插入 quiz 元素时抛错
    db.exec(
      'CREATE TRIGGER IF NOT EXISTS cpkg_test_fail_quiz BEFORE INSERT ON whiteboard_elements ' +
        "WHEN NEW.type = 'quiz' BEGIN SELECT RAISE(ABORT, 'cpkg test failure'); END;",
    );
    const startedAt = Date.now();
    try {
      const res = await fetch(baseUrl + '/api/course-packages/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
        body: JSON.stringify({ package: template }),
      });
      expect(res.ok).toBe(false);

      // 关键断言：课程行必须被回滚，不能留下半截课程
      const lesson = db.prepare("SELECT id FROM lessons WHERE title = '【CPKG-TEST】回滚'").get();
      expect(lesson).toBeUndefined();
      // 白板元素也不允许留下孤儿行（只统计本次导入窗口内写入的）
      const orphans = db
        .prepare(
          'SELECT COUNT(*) AS n FROM whiteboard_elements WHERE created_at >= ? AND lesson_id NOT IN (SELECT id FROM lessons)',
        )
        .get(startedAt) as any;
      expect(orphans.n).toBe(0);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS cpkg_test_fail_quiz;');
    }
  });
});
