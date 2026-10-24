/**
 * 请求体体积上限的装配（Issue #246）。
 *
 * 病根：课程包导入端点不在大体积白名单里，被全局 2MB body 上限拒掉，
 * 而前端对教师的承诺是「最大不超过 20MB」—— 真实课件必然 413。
 *
 * 这里在裸 express app 上装配真实的中间件（而不是 mock），
 * 断言的是真实行为：多���请求体到底放不放行、超限时返回什么。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { mountLargeBodyParsers } from '../middleware/body-limits.js';
import {
  COURSE_PACKAGE_IMPORT_BODY_LIMIT_BYTES,
  COURSE_PACKAGE_IMPORT_PATH,
  COURSE_PACKAGE_MAX_FILE_BYTES,
} from '../services/course-package.js';

let app: express.Express;
let server: Server;
let baseUrl = '';

/** 构造一个「贴着生产装配」的 app：大体积解析器 → 全局 2MB parser → 路由。 */
function buildApp() {
  const instance = express();
  mountLargeBodyParsers(instance);
  // 全局 parser（与 server.ts 一致）
  instance.use(express.json({ limit: '2mb' }));
  instance.use(express.urlencoded({ limit: '2mb', extended: true }));
  instance.post(COURSE_PACKAGE_IMPORT_PATH, (req, res) => {
    res.json({ ok: true, bytes: Buffer.byteLength(JSON.stringify(req.body ?? {})) });
  });
  instance.post('/api/ordinary-endpoint', (req, res) => {
    res.json({ ok: true });
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

  it('普通业务端点仍然受 2MB 全局上限保护', async () => {
    const res = await fetch(`${baseUrl}/api/ordinary-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBody(5 * 1024 * 1024)),
    });
    expect(res.status).toBe(413);
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
