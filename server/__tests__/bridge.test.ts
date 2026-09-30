import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import fs from 'fs';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { mintCoursewareToken } from '../utils/courseware-access.js';

describe('Bridge Runtime Routes - Arbitrary HTML & Fallback Discovery', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  const testDir = path.resolve(process.cwd(), 'storage', 'courseware');
  // SEC-AUTH: /runtime 需要 ?ct= token（与 uuid 绑定）或浏览器 Sec-Fetch 元数据；
  // 测试的 fetch 不带 Sec-Fetch 头，统一走 token 通道
  const runtimeUrl = (uuid: string) => `${baseUrl}/runtime/${uuid}/?ct=${encodeURIComponent(mintCoursewareToken(uuid))}`;

  beforeAll(async () => {
    app = express();
    app.use(express.json());

    // Register bridge routes with mock ServerContext
    registerBridgeRoutes({
      app,
      io: { emit: () => {} } as any,
    } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves arbitrary-named HTML courseware (e.g. game_app.html) at /runtime/:uuid/', async () => {
    const testUuid = 'cw-test-arbitrary-1';
    const coursewareDir = path.resolve(testDir, testUuid);
    fs.mkdirSync(coursewareDir, { recursive: true });
    const htmlContent =
      '<!DOCTYPE html><html><head><title>Custom Game</title></head><body><h1>Play Game</h1></body></html>';
    fs.writeFileSync(path.resolve(coursewareDir, 'game_app.html'), htmlContent, 'utf8');

    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testUuid, testUuid, 'Custom Game', 'html', 'game_app.html', Date.now());

    try {
      const res = await fetch(runtimeUrl(testUuid));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Custom Game');
      expect(text).toContain('Play Game');
      // Bridge SDK injection check
      expect(text).toContain('window.LMS');
      // SEC-AUTH: 自有 CSP 必须含 frame-ancestors 'self'，否则外部站点可嵌入
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    } finally {
      if (fs.existsSync(coursewareDir)) {
        fs.rmSync(coursewareDir, { recursive: true, force: true });
      }
      kernelContainer.db.prepare('DELETE FROM courseware WHERE uuid = ?').run(testUuid);
    }
  });

  it('falls back and self-heals when index.html is requested but only custom-named HTML exists', async () => {
    const testUuid = 'cw-test-arbitrary-2';
    const coursewareDir = path.resolve(testDir, testUuid);
    fs.mkdirSync(coursewareDir, { recursive: true });
    const htmlContent =
      '<!DOCTYPE html><html><head><title>Snow Map</title></head><body><h1>Cholera Map</h1></body></html>';
    // Write only snow_map.html on disk, NO index.html
    fs.writeFileSync(path.resolve(coursewareDir, 'snow_map.html'), htmlContent, 'utf8');

    // DB entry intentionally set to index.html to simulate historical bug
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testUuid, testUuid, 'snow_map.html', 'html', 'index.html', Date.now());

    try {
      // Request /index.html explicitly
      const res = await fetch(`${baseUrl}/runtime/${testUuid}/index.html?ct=${encodeURIComponent(mintCoursewareToken(testUuid))}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Snow Map');
      expect(text).toContain('Cholera Map');

      // Verify self-healing: index.html should now exist on disk as a cached copy
      expect(fs.existsSync(path.resolve(coursewareDir, 'index.html'))).toBe(true);
    } finally {
      if (fs.existsSync(coursewareDir)) {
        fs.rmSync(coursewareDir, { recursive: true, force: true });
      }
      kernelContainer.db.prepare('DELETE FROM courseware WHERE uuid = ?').run(testUuid);
    }
  });

  it('restores and serves courseware directly from system_resources if storageDir is missing', async () => {
    const testResId = 'res_test_auto_restore';
    const coursewareDir = path.resolve(testDir, testResId);
    if (fs.existsSync(coursewareDir)) {
      fs.rmSync(coursewareDir, { recursive: true, force: true });
    }

    const htmlContent =
      '<!DOCTYPE html><html><head><title>System Res Applet</title></head><body><h1>From System Resources</h1></body></html>';

    // Seed into system_resources
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(testResId, '趣味小实验.html', 'html', htmlContent, Date.now());

    try {
      const res = await fetch(runtimeUrl(testResId));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('System Res Applet');
      expect(text).toContain('From System Resources');

      // Check that disk cache was restored
      expect(fs.existsSync(path.resolve(coursewareDir, '趣味小实验.html'))).toBe(true);
      expect(fs.existsSync(path.resolve(coursewareDir, 'index.html'))).toBe(true);
    } finally {
      if (fs.existsSync(coursewareDir)) {
        fs.rmSync(coursewareDir, { recursive: true, force: true });
      }
      kernelContainer.db.prepare('DELETE FROM system_resources WHERE id = ?').run(testResId);
      kernelContainer.db.prepare('DELETE FROM courseware WHERE id = ? OR uuid = ?').run(testResId, testResId);
    }
  });

  it('returns 404 if courseware is not found anywhere (with valid token)', async () => {
    const res = await fetch(runtimeUrl('non_existent_uuid_9999'));
    expect(res.status).toBe(404);
  });

  it('returns 401 for direct access without token or Sec-Fetch metadata (SEC-AUTH)', async () => {
    // 模拟地址栏直连 / curl：无 ?ct=、无 Sec-Fetch 头
    const direct = await fetch(`${baseUrl}/runtime/cw-test-arbitrary-1/`);
    expect(direct.status).toBe(401);

    // 伪造 token → 401
    const forged = await fetch(`${baseUrl}/runtime/cw-test-arbitrary-1/?ct=forged.sig`);
    expect(forged.status).toBe(401);

    // 绑定错 uuid 的 token → 401
    const mismatched = await fetch(
      `${baseUrl}/runtime/cw-test-arbitrary-1/?ct=${encodeURIComponent(mintCoursewareToken('other-uuid'))}`,
    );
    expect(mismatched.status).toBe(401);
  });

  it('allows requests carrying browser Sec-Fetch metadata (opaque-iframe subresource)', async () => {
    const testUuid = 'cw-test-secfetch-1';
    const coursewareDir = path.resolve(testDir, testUuid);
    fs.mkdirSync(coursewareDir, { recursive: true });
    fs.writeFileSync(
      path.resolve(coursewareDir, 'index.html'),
      '<!DOCTYPE html><html><body><h1>SecFetch</h1></body></html>',
      'utf8',
    );
    kernelContainer.db
      .prepare('INSERT OR REPLACE INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(testUuid, testUuid, 'SecFetch Test', 'html', 'index.html', Date.now());

    try {
      // 沙箱 iframe 内发起的请求：Site 恒为 cross-site（opaque initiator），但有 Dest 元数据
      const res = await fetch(`${baseUrl}/runtime/${testUuid}/index.html`, {
        headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).toBe(200);

      // 地址栏直连（Dest=document）即使带 cross-site 头也拒绝
      const doc = await fetch(`${baseUrl}/runtime/${testUuid}/index.html`, {
        headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' },
      });
      expect(doc.status).toBe(401);
    } finally {
      fs.rmSync(coursewareDir, { recursive: true, force: true });
      kernelContainer.db.prepare('DELETE FROM courseware WHERE uuid = ?').run(testUuid);
    }
  });
});
