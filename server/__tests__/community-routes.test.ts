import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { COMMUNITY_REGISTRY_ENV } from '../services/community-registry.js';

/**
 * 社区市场路由的鉴权与入参门禁契约。
 *
 * 这里刻意只覆盖「不需要出站请求」的路径：登录态、角色、URL 安全拦截与参数校验。
 * 下载与安装逻辑由 community-registry.test.ts 以注入 fetch 的方式覆盖。
 */
describe('community plugin registry routes', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let savedRegistryEnv: string | undefined;

  const adminId = 'usr-community-admin';
  const teacherId = 'usr-community-teacher';
  const adminToken = 'tok-community-admin';
  const teacherToken = 'tok-community-teacher';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    savedRegistryEnv = process.env[COMMUNITY_REGISTRY_ENV];
    delete process.env[COMMUNITY_REGISTRY_ENV];

    const now = Date.now();
    const insertUser = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(adminId, 'community_admin', 'placeholder', 'administrator', '社区管理员', now);
    insertUser.run(teacherId, 'community_teacher', 'placeholder', 'teacher', '社区教师', now);

    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    const expiresAt = now + 60 * 60 * 1000;
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'community_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'community_teacher' }),
      now,
      expiresAt,
    );

    app = express();
    app.use(express.json());
    registerPluginsRoutes({ app, io: { emit: () => {} } } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (savedRegistryEnv === undefined) {
      delete process.env[COMMUNITY_REGISTRY_ENV];
    } else {
      process.env[COMMUNITY_REGISTRY_ENV] = savedRegistryEnv;
    }
    kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id IN (?, ?)').run(adminToken, teacherToken);
    kernelContainer.db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(adminId, teacherId);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  describe('GET /api/plugins/community', () => {
    it('rejects an anonymous caller', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/community`);
      expect(res.status).toBe(401);
    });

    it('is reachable by a teacher and is not swallowed by the /:id(*) catch-all', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(teacherToken) });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        success: boolean;
        configured: boolean;
        plugins: unknown[];
        envVar: string;
      };
      expect(body.success).toBe(true);
      expect(body.envVar).toBe(COMMUNITY_REGISTRY_ENV);
      // 未配置注册表地址：明确返回 configured=false 而不是报错
      expect(body.configured).toBe(false);
      expect(body.plugins).toEqual([]);
    });
  });

  describe('POST /api/plugins/install-from-url', () => {
    const post = (token: string | null, payload: unknown) =>
      fetch(`${baseUrl}/api/plugins/install-from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? cookie(token) : {}) },
        body: JSON.stringify(payload),
      });

    it('rejects an anonymous caller', async () => {
      const res = await post(null, { downloadUrl: 'https://plugins.example.com/a.zip' });
      expect(res.status).toBe(401);
    });

    it('is administrator-only — a teacher cannot install remote code', async () => {
      const res = await post(teacherToken, { downloadUrl: 'https://plugins.example.com/a.zip' });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Required: administrator/);
    });

    it('requires a downloadUrl', async () => {
      const res = await post(adminToken, {});
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('缺少 downloadUrl');
    });

    it('rejects an illegal expectedId', async () => {
      const res = await post(adminToken, {
        downloadUrl: 'https://plugins.example.com/a.zip',
        expectedId: 'ext home; rm -rf /',
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/expectedId/);
    });

    it('要求管理员显式确认风险后才下载公网插件包', async () => {
      const res = await post(adminToken, {
        downloadUrl: 'https://plugins.example.com/plugin.zip',
        expectedId: 'ext-homework-hub',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string; error: string };
      expect(body.code).toBe('COMMUNITY_RISK_ACK_REQUIRED');
      expect(body.error).toMatch(/acknowledgeRisk: true/);
    });

    it.each([
      ['a loopback address', 'http://127.0.0.1/plugin.zip'],
      ['a cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
      ['a private network address', 'http://192.168.1.10/plugin.zip'],
      ['a non-HTTP protocol', 'file:///etc/passwd'],
    ])('blocks %s before any download', async (_label, downloadUrl) => {
      const res = await post(adminToken, { downloadUrl });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/安全拦截: 非法下载地址/);
    });
  });

  describe('POST /api/plugins/upload-zip-raw 签名门禁与审计 (Issue #176)', () => {
    let auditEvents: AuditRecord[] = [];
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privKey = keyPair.privateKey;

    let savedPubkeyEnv: string | undefined;

    beforeAll(() => {
      savedPubkeyEnv = process.env.OPENLEARN_COMMUNITY_PUBKEY;
      process.env.OPENLEARN_COMMUNITY_PUBKEY = pubPem;
      process.env.OPENLEARN_COMMUNITY_INSTALL = '1';
      setAuditSinkForTests((record) => {
        auditEvents.push(record);
      });
    });

    afterAll(() => {
      if (savedPubkeyEnv === undefined) {
        delete process.env.OPENLEARN_COMMUNITY_PUBKEY;
      } else {
        process.env.OPENLEARN_COMMUNITY_PUBKEY = savedPubkeyEnv;
      }
      setAuditSinkForTests(null);
    });

    async function makePluginZip(manifest: Record<string, unknown>, embedSig = false) {
      // 显式标注索引类型：展开 Record<string, unknown> 的后推断不会带上 id/version 已知键，
      // 直接访问 fullManifest.id 会触发 TS2339（CI typecheck 实测）。
      const fullManifest: Record<string, unknown> = {
        name: String(manifest.id),
        description: 'Test plugin',
        ...manifest,
      };
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(fullManifest));
      zip.file('index.js', 'export default {};');
      if (embedSig) {
        const unsignedBuf = await zip.generateAsync({ type: 'nodebuffer' });
        const unsignedHash = crypto.createHash('sha256').update(unsignedBuf).digest('hex');
        const payload = `openlearn-plugin-attestation-v2\n${String(fullManifest.id)}\n${String(fullManifest.version ?? '')}\n${unsignedHash}`;
        const signature = crypto.sign(null, Buffer.from(payload, 'utf8'), privKey).toString('base64');
        zip.file(
          'signature.json',
          JSON.stringify({
            version: 2,
            algorithm: 'ed25519',
            signature,
            publisher: 'Alice Corp',
          }),
        );
      }
      return await zip.generateAsync({ type: 'nodebuffer' });
    }

    it('B2: 未签名本地包直接上传默认被拦截拒绝 (400 COMMUNITY_ATTESTATION_REQUIRED)', async () => {
      const zipBuf = await makePluginZip({ id: 'ext-unsigned-test', version: '1.0.0' }, false);
      const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
        method: 'POST',
        headers: {
          ...cookie(adminToken),
          'Content-Type': 'application/zip',
          'x-plugin-filename': 'ext-unsigned-test.zip',
        },
        body: zipBuf,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string; error: string };
      expect(body.code).toBe('COMMUNITY_ATTESTATION_REQUIRED');
      expect(body.error).toContain('allowUnsigned');
    });

    it('B5: 未签名本地包携带 x-allow-unsigned: true 时放行并记录旁路审计', async () => {
      auditEvents = [];
      const zipBuf = await makePluginZip({ id: 'ext-bypassed-test', version: '1.0.0' }, false);
      const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
        method: 'POST',
        headers: {
          ...cookie(adminToken),
          'Content-Type': 'application/zip',
          'x-plugin-filename': 'ext-bypassed-test.zip',
          'x-allow-unsigned': 'true',
        },
        body: zipBuf,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; pluginId: string };
      expect(body.success).toBe(true);

      const installEvent = auditEvents.find(
        (e) => e.event === 'plugin.installed' && e.manifestId === 'ext-bypassed-test',
      );
      expect(installEvent).toBeDefined();
      expect(installEvent?.signatureStatus).toBe('unverified_local_acknowledged');

      const bypassEvent = auditEvents.find(
        (e) => e.event === 'plugin.unverified_local_bypassed' && e.manifestId === 'ext-bypassed-test',
      );
      expect(bypassEvent).toBeDefined();
    });

    it('B5b: OPENLEARN_ALLOW_UNSIGNED=1 时未签名包免逐次头部放行，审计仍记旁路', async () => {
      auditEvents = [];
      const saved = process.env.OPENLEARN_ALLOW_UNSIGNED;
      process.env.OPENLEARN_ALLOW_UNSIGNED = '1';
      try {
        const zipBuf = await makePluginZip({ id: 'ext-env-bypass-test', version: '1.0.0' }, false);
        const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-env-bypass-test.zip',
          },
          body: zipBuf,
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean };
        expect(body.success).toBe(true);

        const bypassEvent = auditEvents.find(
          (e) => e.event === 'plugin.unverified_local_bypassed' && e.manifestId === 'ext-env-bypass-test',
        );
        expect(bypassEvent).toBeDefined();
      } finally {
        if (saved === undefined) delete process.env.OPENLEARN_ALLOW_UNSIGNED;
        else process.env.OPENLEARN_ALLOW_UNSIGNED = saved;
      }
    });

    it('B3: 签名版本与包内 manifest 不匹配时拒绝', async () => {
      const zip = new JSZip();
      const manifest = { id: 'ext-mismatch-test', name: 'ext-mismatch-test', version: '2.0.0' };
      zip.file('manifest.json', JSON.stringify(manifest));
      zip.file('index.js', 'export default {};');
      const unsignedBuf = await zip.generateAsync({ type: 'nodebuffer' });
      const unsignedHash = crypto.createHash('sha256').update(unsignedBuf).digest('hex');

      // 故意签署成旧版本 1.0.0
      const payload = `openlearn-plugin-attestation-v2\next-mismatch-test\n1.0.0\n${unsignedHash}`;
      const badSig = crypto.sign(null, Buffer.from(payload, 'utf8'), privKey).toString('base64');
      zip.file(
        'signature.json',
        JSON.stringify({
          version: 2,
          algorithm: 'ed25519',
          signature: badSig,
          publisher: 'Alice Corp',
        }),
      );
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

      const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
        method: 'POST',
        headers: {
          ...cookie(adminToken),
          'Content-Type': 'application/zip',
          'x-plugin-filename': 'ext-mismatch-test.zip',
        },
        body: zipBuf,
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { code?: string; error: string };
      expect(body.code).toBe('COMMUNITY_SIGNATURE_INVALID');
    });

    it('B1: 携带有效嵌入式签名的 ZIP 包成功通过校验并标记 verified', async () => {
      auditEvents = [];
      const zipBuf = await makePluginZip({ id: 'ext-embed-valid', version: '1.0.0' }, true);
      const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
        method: 'POST',
        headers: {
          ...cookie(adminToken),
          'Content-Type': 'application/zip',
          'x-plugin-filename': 'ext-embed-valid.zip',
        },
        body: zipBuf,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; pluginId: string };
      expect(body.success).toBe(true);

      const installEvent = auditEvents.find(
        (e) => e.event === 'plugin.installed' && e.manifestId === 'ext-embed-valid',
      );
      expect(installEvent).toBeDefined();
      expect(installEvent?.signatureStatus).toBe('verified');
      expect(installEvent?.publisher).toBe('Alice Corp');
    });
  });
});
