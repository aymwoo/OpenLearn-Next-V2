/**
 * 请求体体积上限的装配（Issue #246）。
 *
 * 病根：课程包导入端点不在大体积白名单里，被全局 2MB body 上限拒掉，
 * 而前端对教师的承诺是「最大不超过 20MB」—— 真实课件必然 413。
 *
 * 这里在裸 express app 上装配真实的中间件（而不是 mock），
 * 断言的是真实行为：多大的请求体到底放不放行、超限时返回什么。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import Database from 'better-sqlite3';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import {
  mountLargeBodyParsers,
  mountConfigurableBodyParsers,
  normalizeApiBodyLimitMb,
  resolveApiBodyLimitMb,
  DEFAULT_API_BODY_LIMIT_MB,
  MAX_API_BODY_LIMIT_MB,
  MIN_API_BODY_LIMIT_MB,
  MEDIUM_UPLOAD_ENDPOINTS,
  LARGE_UPLOAD_ENDPOINTS,
} from '../middleware/body-limits.js';
import { sendSafeError } from '../utils/error-handler.js';
import {
  COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES,
  COURSE_PACKAGE_IMPORT_PATH,
  COURSE_PACKAGE_MAX_FILE_BYTES,
} from '../services/course-package.js';

let app: express.Express;
let server: Server;
let baseUrl = '';

/** 模拟「管理员在后台配置的全局请求体上限」：改这个变量即等价于保存设置。 */
let configuredLimitMb = DEFAULT_API_BODY_LIMIT_MB;

/** 构造一个「贴着生产装配」的 app：大体积解析器 → 可配置全局 parser → 路由 → 错误中间件。 */
function buildApp() {
  const instance = express();
  mountLargeBodyParsers(instance);
  // 全局 parser（与 server.ts 一致：每次请求按当前配置解析）
  mountConfigurableBodyParsers(instance, () => configuredLimitMb);
  instance.post(COURSE_PACKAGE_IMPORT_PATH, (req, res) => {
    res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body ?? {})) });
  });
  instance.post('/api/auth/avatar', (req, res) => {
    res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body ?? {})) });
  });
  instance.post('/api/timetable/ocr', (req, res) => {
    res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body ?? {})) });
  });
  instance.post('/api/resources', (req, res) => {
    res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body ?? {})) });
  });
  instance.post('/api/ordinary-endpoint', (req, res) => {
    res.json({ ok: true });
  });
  instance.post('/api/form-endpoint', (req, res) => {
    res.json({ ok: true, body: req.body ?? null });
  });

  // 全局错误处理兜底（与 server.ts 一致，走 sendSafeError）
  instance.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    sendSafeError(res, err, 500);
  });
  return instance;
}

beforeAll(async () => {
  app = buildApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  configuredLimitMb = DEFAULT_API_BODY_LIMIT_MB;
});

/** 造一个指定体积的 JSON 请求体。 */
function makeBody(totalBytes: number) {
  const filler = 'x'.repeat(Math.max(0, totalBytes - 64));
  return { filler };
}

describe('请求体体积上限装配（Issue #246）', () => {
  it('课程包导入端点能吃下超过全局 2MB 的请求体', async () => {
    const res = await fetch(`${baseUrl}${COURSE_PACKAGE_IMPORT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(5 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
  });

  it('普通业务端点仍然受 2MB 全局上限保护，且通过 sendSafeError 给出 PAYLOAD_TOO_LARGE 机器码', async () => {
    const res = await fetch(`${baseUrl}/api/ordinary-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(5 * 1024 * 1024)),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('个人头像上传端点放行合规文件 base64 膨胀后的请求体（> 2MB）', async () => {
    // 1.6MB 图片经 base64 膨胀后约 2.2MB，此前在全局 2MB parser 处直接 413
    const res = await fetch(`${baseUrl}/api/auth/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(2.5 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
  });

  it('课表多模态 OCR 端点放行拍摄/高清大图请求体（5MB）', async () => {
    const res = await fetch(`${baseUrl}/api/timetable/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(5 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
  });

  it('交互资源库端点放行包含整包/目录文件的大请求体（5MB）', async () => {
    const res = await fetch(`${baseUrl}/api/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(5 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
  });

  it('白名单端点定义完整性校验', () => {
    expect(MEDIUM_UPLOAD_ENDPOINTS).toContain('/api/auth/avatar');
    expect(MEDIUM_UPLOAD_ENDPOINTS).toContain('/api/timetable/ocr');
    expect(MEDIUM_UPLOAD_ENDPOINTS).toContain('/api/site-settings');
    expect(MEDIUM_UPLOAD_ENDPOINTS).toContain('/api/agent/chat');
    expect(LARGE_UPLOAD_ENDPOINTS).toContain('/api/resources');
  });

  it('课程包导入超限时给出能指到真实原因的错误（不是裸 entity.too.large）', async () => {
    // 超过 32MB 请求体上限
    const res = await fetch(`${baseUrl}${COURSE_PACKAGE_IMPORT_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES + 1024 * 1024)),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('COURSE_PACKAGE_TOO_LARGE');
    expect(String(body.error)).toContain('20MB');
    expect(String(body.error)).not.toContain('entity too large');
  });

  it('请求体上限必须高于产品承诺的文件上限（否则文件合规请求仍被拒）', () => {
    expect(COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES).toBeGreaterThan(COURSE_PACKAGE_MAX_FILE_BYTES);
    // base64 会把二进制膨胀约 1.37 倍，请求体上限要能容纳它
    expect(COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES).toBeGreaterThan(COURSE_PACKAGE_MAX_FILE_BYTES * 1.37);
  });
});

describe('全局请求体上限可配置（管理后台 → 站点信息设置）', () => {
  it('默认 2MB：超过 2MB 的普通业务请求仍被拒', async () => {
    const res = await fetch(`${baseUrl}/api/ordinary-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(3 * 1024 * 1024)),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('调高到 5MB 后，3MB 请求立即放行（无需重启）', async () => {
    configuredLimitMb = 5;
    const res = await fetch(`${baseUrl}/api/ordinary-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(3 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('调低到 1MB 后，2MB 请求被拒（配置双向生效）', async () => {
    configuredLimitMb = 1;
    const res = await fetch(`${baseUrl}/api/ordinary-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(2 * 1024 * 1024)),
    });
    expect(res.status).toBe(413);
  });

  it('表单（urlencoded）请求仍由同一条链正确解析，且同样受配置上限约束', async () => {
    // JSON parser 跳过 → urlencoded parser 接管
    const okRes = await fetch(`${baseUrl}/api/form-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=2',
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true, body: { a: '1', b: '2' } });

    const rejected = await fetch(`${baseUrl}/api/form-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `filler=${'x'.repeat(3 * 1024 * 1024)}`,
    });
    expect(rejected.status).toBe(413);
  });

  it('uploadMaxFileMb 等专用上传端点不受全局配置影响', async () => {
    configuredLimitMb = 1;
    const res = await fetch(`${baseUrl}/api/auth/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(2.5 * 1024 * 1024)),
    });
    expect(res.status).toBe(200);
  });

  it('normalizeApiBodyLimitMb 对非法值回落默认、超上限收敛到 MAX', () => {
    expect(normalizeApiBodyLimitMb(null)).toBe(DEFAULT_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb(undefined)).toBe(DEFAULT_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb('')).toBe(DEFAULT_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb('abc')).toBe(DEFAULT_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb(0)).toBe(DEFAULT_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb(MIN_API_BODY_LIMIT_MB)).toBe(MIN_API_BODY_LIMIT_MB);
    expect(normalizeApiBodyLimitMb(8)).toBe(8);
    expect(normalizeApiBodyLimitMb(MAX_API_BODY_LIMIT_MB + 10)).toBe(MAX_API_BODY_LIMIT_MB);
  });

  it('resolveApiBodyLimitMb 读取 site_settings.api_body_limit_mb，NULL 时回落默认', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE site_settings (id TEXT PRIMARY KEY, api_body_limit_mb INTEGER)');
      expect(resolveApiBodyLimitMb(db)).toBe(DEFAULT_API_BODY_LIMIT_MB);

      db.prepare('INSERT INTO site_settings (id, api_body_limit_mb) VALUES (?, ?)').run('global', 7);
      expect(resolveApiBodyLimitMb(db)).toBe(7);

      db.prepare('UPDATE site_settings SET api_body_limit_mb = NULL WHERE id = ?').run('global');
      expect(resolveApiBodyLimitMb(db)).toBe(DEFAULT_API_BODY_LIMIT_MB);
    } finally {
      db.close();
    }
  });

  it('列缺失的旧库回落到默认值而不是阻断请求', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE site_settings (id TEXT PRIMARY KEY)');
      expect(resolveApiBodyLimitMb(db)).toBe(DEFAULT_API_BODY_LIMIT_MB);
    } finally {
      db.close();
    }
  });
});
