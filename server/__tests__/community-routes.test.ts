import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { COMMUNITY_REGISTRY_ENV, DEFAULT_COMMUNITY_REGISTRY_URL } from '../services/community-registry.js';
import { COMMUNITY_INSTALL_DISABLED_MESSAGE, COMMUNITY_INSTALL_ENV } from '../services/community-attest.js';

vi.mock('../services/community-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/community-registry.js')>();
  return {
    ...actual,
    fetchCommunityRegistry: (opts: Parameters<typeof actual.fetchCommunityRegistry>[0] = {}) =>
      actual.fetchCommunityRegistry({
        ...opts,
        fetchImpl:
          opts.fetchImpl ??
          (async () =>
            new Response(JSON.stringify({ version: 1, plugins: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })),
      }),
  };
});

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
  let savedDbRegistryUrl: string | null = null;

  const adminId = 'usr-community-admin';
  const teacherId = 'usr-community-teacher';
  const adminToken = 'tok-community-admin';
  const teacherToken = 'tok-community-teacher';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    savedRegistryEnv = process.env[COMMUNITY_REGISTRY_ENV];
    delete process.env[COMMUNITY_REGISTRY_ENV];
    try {
      const existing = kernelContainer.db
        .prepare('SELECT community_registry_url FROM site_settings WHERE id = ?')
        .get('global') as { community_registry_url?: string | null } | undefined;
      savedDbRegistryUrl = existing?.community_registry_url ?? null;
      kernelContainer.db.prepare('UPDATE site_settings SET community_registry_url = NULL WHERE id = ?').run('global');
    } catch {
      savedDbRegistryUrl = null;
    }

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
    try {
      kernelContainer.db
        .prepare('UPDATE site_settings SET community_registry_url = ? WHERE id = ?')
        .run(savedDbRegistryUrl, 'global');
      try {
        kernelContainer.db.prepare('UPDATE site_settings SET allow_unsigned_plugins = NULL WHERE id = ?').run('global');
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
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
        source: string | null;
        defaultUrl: string;
        plugins: unknown[];
        envVar: string;
        canConfigure: boolean;
        configSource: string;
      };
      expect(body.success).toBe(true);
      expect(body.envVar).toBe(COMMUNITY_REGISTRY_ENV);
      expect(body.canConfigure).toBe(false);
      expect(body.configSource).toBe('default');
      expect(body.defaultUrl).toBe(DEFAULT_COMMUNITY_REGISTRY_URL);
      expect(body.configured).toBe(true);
      expect(body.source).toBe(DEFAULT_COMMUNITY_REGISTRY_URL);
      expect(body.plugins).toEqual([]);
    });

    it('reports canConfigure=true for an administrator', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(adminToken) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { canConfigure: boolean; configSource: string; defaultUrl: string };
      expect(body.canConfigure).toBe(true);
      expect(body.configSource).toBe('default');
      expect(body.defaultUrl).toBe(DEFAULT_COMMUNITY_REGISTRY_URL);
    });
  });

  describe('PUT /api/plugins/community/config', () => {
    const putConfig = (token: string | null, payload: unknown) =>
      fetch(`${baseUrl}/api/plugins/community/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? cookie(token) : {}) },
        body: JSON.stringify(payload),
      });

    it('rejects an anonymous caller', async () => {
      const res = await putConfig(null, { registryUrl: 'https://registry.example.com/community.json' });
      expect(res.status).toBe(401);
    });

    it('is administrator-only — a teacher cannot modify registry settings', async () => {
      const res = await putConfig(teacherToken, { registryUrl: 'https://registry.example.com/community.json' });
      expect(res.status).toBe(403);
    });

    it('rejects missing or non-string registryUrl', async () => {
      const missing = await putConfig(adminToken, {});
      expect(missing.status).toBe(400);
      const badType = await putConfig(adminToken, { registryUrl: 123 });
      expect(badType.status).toBe(400);
    });

    it.each([
      'http://127.0.0.1/community.json',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.10/community.json',
      'file:///etc/passwd',
    ])('blocks unsafe URL %s with 400', async (badUrl) => {
      const res = await putConfig(adminToken, { registryUrl: badUrl });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/安全拦截: 非法注册表地址/);
    });

    it('persists and clears a valid registry URL in site_settings', async () => {
      const url = 'https://registry.example.com/community-plugins.json';
      const saveRes = await putConfig(adminToken, { registryUrl: url });
      expect(saveRes.status).toBe(200);
      const saveBody = (await saveRes.json()) as {
        success: boolean;
        configSource: string;
        databaseUrl: string | null;
        activeUrl: string | null;
      };
      expect(saveBody).toMatchObject({
        success: true,
        configSource: 'database',
        databaseUrl: url,
        activeUrl: url,
      });

      const clearRes = await putConfig(adminToken, { registryUrl: null });
      expect(clearRes.status).toBe(200);
      const clearBody = (await clearRes.json()) as {
        success: boolean;
        configSource: string;
        databaseUrl: string | null;
        activeUrl: string | null;
      };
      expect(clearBody).toMatchObject({
        success: true,
        configSource: 'default',
        databaseUrl: null,
        activeUrl: DEFAULT_COMMUNITY_REGISTRY_URL,
        defaultUrl: DEFAULT_COMMUNITY_REGISTRY_URL,
      });
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

    it('不需要 acknowledgeRisk 或 signature，直接进入下载流程（测试域名不可达时返回 fallbackToClient）', async () => {
      const res = await post(adminToken, {
        downloadUrl: 'https://plugins.example.com/plugin.zip',
        expectedId: 'ext-homework-hub',
      });
      const body = (await res.json()) as { code?: string; error: string };
      expect(body.code).not.toBe('COMMUNITY_RISK_ACK_REQUIRED');
      expect(body.code).not.toBe('COMMUNITY_ATTESTATION_REQUIRED');
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

    it('streams SSE progress and error events when Accept: text/event-stream is requested', async () => {
      const res = await fetch(`${baseUrl}/api/plugins/install-from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...cookie(adminToken),
        },
        body: JSON.stringify({
          downloadUrl: 'https://plugins.example.com/unreachable.zip',
          expectedId: 'ext-homework-hub',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('event: progress');
      expect(text).toContain('"stage":"downloading"');
      expect(text).toContain('event: error');
      expect(text).toContain('"fallbackToClient":true');
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

    it('B2: OPENLEARN_ALLOW_UNSIGNED=0 时未签名本地包被拦截拒绝 (400 COMMUNITY_ATTESTATION_REQUIRED)', async () => {
      const saved = process.env.OPENLEARN_ALLOW_UNSIGNED;
      process.env.OPENLEARN_ALLOW_UNSIGNED = '0';
      try {
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
      } finally {
        if (saved === undefined) delete process.env.OPENLEARN_ALLOW_UNSIGNED;
        else process.env.OPENLEARN_ALLOW_UNSIGNED = saved;
      }
    });

    it('B2-default: 未设置 OPENLEARN_ALLOW_UNSIGNED 时未签名本地包默认放行（审计记旁路）', async () => {
      auditEvents = [];
      const saved = process.env.OPENLEARN_ALLOW_UNSIGNED;
      delete process.env.OPENLEARN_ALLOW_UNSIGNED;
      try {
        const zipBuf = await makePluginZip({ id: 'ext-unsigned-default-test', version: '1.0.0' }, false);
        const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-unsigned-default-test.zip',
          },
          body: zipBuf,
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { success: boolean };
        expect(body.success).toBe(true);
        const bypassEvent = auditEvents.find(
          (e) => e.event === 'plugin.unverified_local_bypassed' && e.manifestId === 'ext-unsigned-default-test',
        );
        expect(bypassEvent).toBeDefined();
      } finally {
        if (saved !== undefined) process.env.OPENLEARN_ALLOW_UNSIGNED = saved;
      }
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

    it('存储策略收紧后未签名包被拒绝，显式 x-allow-unsigned: true 仍可放行', async () => {
      auditEvents = [];
      const saved = process.env.OPENLEARN_ALLOW_UNSIGNED;
      delete process.env.OPENLEARN_ALLOW_UNSIGNED;
      try {
        kernelContainer.db.prepare('UPDATE site_settings SET allow_unsigned_plugins = 0 WHERE id = ?').run('global');
        const denied = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-stored-unsigned-deny.zip',
          },
          body: await makePluginZip({ id: 'ext-stored-unsigned-deny', version: '1.0.0' }, false),
        });
        expect(denied.status).toBe(400);
        expect(((await denied.json()) as { code?: string }).code).toBe('COMMUNITY_ATTESTATION_REQUIRED');

        const allowed = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-stored-unsigned-ack.zip',
            'x-allow-unsigned': 'true',
          },
          body: await makePluginZip({ id: 'ext-stored-unsigned-ack', version: '1.0.0' }, false),
        });
        expect(allowed.status).toBe(200);
        expect(((await allowed.json()) as { success: boolean }).success).toBe(true);
      } finally {
        kernelContainer.db.prepare('UPDATE site_settings SET allow_unsigned_plugins = NULL WHERE id = ?').run('global');
        if (saved === undefined) delete process.env.OPENLEARN_ALLOW_UNSIGNED;
        else process.env.OPENLEARN_ALLOW_UNSIGNED = saved;
      }
    });

    it('存储策略允许未签名也不能放行签名错误的包', async () => {
      const saved = process.env.OPENLEARN_ALLOW_UNSIGNED;
      delete process.env.OPENLEARN_ALLOW_UNSIGNED;
      try {
        kernelContainer.db.prepare('UPDATE site_settings SET allow_unsigned_plugins = 1 WHERE id = ?').run('global');
        const zip = new JSZip();
        zip.file(
          'manifest.json',
          JSON.stringify({ id: 'ext-bad-sig-stored-allow', name: 'ext-bad-sig-stored-allow', version: '1.0.0' }),
        );
        zip.file('index.js', 'export default {};');
        const unsignedBuf = await zip.generateAsync({ type: 'nodebuffer' });
        const unsignedHash = crypto.createHash('sha256').update(unsignedBuf).digest('hex');
        const payload = `openlearn-plugin-attestation-v2\next-bad-sig-stored-allow\n9.9.9\n${unsignedHash}`;
        const badSig = crypto.sign(null, Buffer.from(payload, 'utf8'), privKey).toString('base64');
        zip.file(
          'signature.json',
          JSON.stringify({ version: 2, algorithm: 'ed25519', signature: badSig, publisher: 'Alice Corp' }),
        );
        const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-bad-sig-stored-allow.zip',
            'x-allow-unsigned': 'true',
          },
          body: await zip.generateAsync({ type: 'nodebuffer' }),
        });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code?: string }).code).toBe('COMMUNITY_SIGNATURE_INVALID');
      } finally {
        kernelContainer.db.prepare('UPDATE site_settings SET allow_unsigned_plugins = NULL WHERE id = ?').run('global');
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

  describe('社区安装开关：持久化、权限与全部门禁', () => {
    const installPayload = {
      downloadUrl: 'https://plugins.example.com/plugin.zip',
      expectedId: 'ext-homework-hub',
      acknowledgeRisk: true,
      integrity: 'abc',
      signature: 'def',
    };

    function clearStoredInstall() {
      kernelContainer.db
        .prepare('UPDATE site_settings SET community_install_enabled = NULL WHERE id = ?')
        .run('global');
    }

    function storedInstall(): number | null {
      const row = kernelContainer.db
        .prepare('SELECT community_install_enabled FROM site_settings WHERE id = ?')
        .get('global') as { community_install_enabled?: number | null } | undefined;
      return row?.community_install_enabled ?? null;
    }

    let savedInstallEnv: string | undefined;
    let savedPubkeyEnv: string | undefined;

    beforeEach(() => {
      savedInstallEnv = process.env[COMMUNITY_INSTALL_ENV];
      savedPubkeyEnv = process.env.OPENLEARN_COMMUNITY_PUBKEY;
      delete process.env[COMMUNITY_INSTALL_ENV];
      clearStoredInstall();
    });

    afterEach(() => {
      clearStoredInstall();
      if (savedInstallEnv === undefined) delete process.env[COMMUNITY_INSTALL_ENV];
      else process.env[COMMUNITY_INSTALL_ENV] = savedInstallEnv;
      if (savedPubkeyEnv === undefined) delete process.env.OPENLEARN_COMMUNITY_PUBKEY;
      else process.env.OPENLEARN_COMMUNITY_PUBKEY = savedPubkeyEnv;
    });

    const putConfig = (token: string, payload: unknown) =>
      fetch(`${baseUrl}/api/plugins/community/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...cookie(token) },
        body: JSON.stringify(payload),
      });

    const postInstall = (token: string, payload: unknown = installPayload) =>
      fetch(`${baseUrl}/api/plugins/install-from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(token) },
        body: JSON.stringify(payload),
      });

    const postUpdate = (token: string) =>
      fetch(`${baseUrl}/api/plugins/ext-homework-hub/one-click-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(token) },
        body: JSON.stringify(installPayload),
      });

    async function communityZipBuf(pluginId: string) {
      const zip = new JSZip();
      zip.file(
        'manifest.json',
        JSON.stringify({
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: 'toggle test',
        }),
      );
      zip.file('index.js', 'export default {};');
      return zip.generateAsync({ type: 'nodebuffer' });
    }

    const postCommunityZip = async (token: string, pluginId: string, extraHeaders: Record<string, string> = {}) =>
      fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
        method: 'POST',
        headers: {
          ...cookie(token),
          'Content-Type': 'application/zip',
          'x-plugin-filename': `${pluginId}.zip`,
          // headerFlag 只把字面量 "true" 视为开启（与前端直传一致）
          'x-community-install': 'true',
          ...extraHeaders,
        },
        body: await communityZipBuf(pluginId),
      });

    it('GET 未配置时默认开启；管理员可见来源，教师看不到敏感配置', async () => {
      const adminRes = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(adminToken) });
      expect(adminRes.status).toBe(200);
      const adminBody = (await adminRes.json()) as Record<string, unknown>;
      expect(adminBody.installEnabled).toBe(true);
      expect(adminBody.installConfigSource).toBe('default');
      expect(adminBody.storedInstallEnabled).toBeNull();
      expect(adminBody.hasInstallEnvFallback).toBe(false);
      expect(typeof adminBody.publicKeysConfigured).toBe('boolean');

      const teacherRes = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(teacherToken) });
      const teacherBody = (await teacherRes.json()) as Record<string, unknown>;
      expect(teacherBody.installEnabled).toBe(true);
      expect(teacherBody.canConfigure).toBe(false);
      expect(teacherBody.installConfigSource).toBeNull();
      expect(teacherBody.storedInstallEnabled).toBeNull();
      expect(teacherBody.hasInstallEnvFallback).toBeNull();
      expect(teacherBody.publicKeysConfigured).toBeNull();
    });

    it('未配置时环境变量 1 可回退开启，显式关闭覆盖后再清除可恢复', async () => {
      process.env[COMMUNITY_INSTALL_ENV] = '1';
      const envRes = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(adminToken) });
      const envBody = (await envRes.json()) as Record<string, unknown>;
      expect(envBody.installEnabled).toBe(true);
      expect(envBody.installConfigSource).toBe('env');
      expect(envBody.hasInstallEnvFallback).toBe(true);

      const offRes = await putConfig(adminToken, { installEnabled: false });
      expect(offRes.status).toBe(200);
      const offBody = (await offRes.json()) as Record<string, unknown>;
      expect(offBody).toMatchObject({
        installEnabled: false,
        storedInstallEnabled: false,
        installConfigSource: 'database',
        hasInstallEnvFallback: true,
      });
      expect(storedInstall()).toBe(0);

      const afterOff = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(adminToken) });
      expect(((await afterOff.json()) as { installEnabled: boolean }).installEnabled).toBe(false);

      const clearRes = await putConfig(adminToken, { installEnabled: null });
      expect(clearRes.status).toBe(200);
      const clearBody = (await clearRes.json()) as Record<string, unknown>;
      expect(clearBody).toMatchObject({
        installEnabled: true,
        storedInstallEnabled: null,
        installConfigSource: 'env',
      });
      expect(storedInstall()).toBeNull();
    });

    it('界面显式开启无需环境变量，保存后再次读取仍开启', async () => {
      const saveRes = await putConfig(adminToken, { installEnabled: true });
      expect(saveRes.status).toBe(200);
      expect((await saveRes.json()) as Record<string, unknown>).toMatchObject({
        success: true,
        installEnabled: true,
        storedInstallEnabled: true,
        installConfigSource: 'database',
      });
      expect(storedInstall()).toBe(1);

      const again = await fetch(`${baseUrl}/api/plugins/community`, { headers: cookie(adminToken) });
      expect((await again.json()) as { installEnabled: boolean; installConfigSource: string }).toMatchObject({
        installEnabled: true,
        installConfigSource: 'database',
      });
    });

    it('只更新安装开关时不会清除已保存的注册表地址', async () => {
      const url = 'https://registry.example.com/community-plugins.json';
      const saveUrl = await putConfig(adminToken, { registryUrl: url });
      expect(saveUrl.status).toBe(200);
      const toggle = await putConfig(adminToken, { installEnabled: true });
      expect(toggle.status).toBe(200);
      const body = (await toggle.json()) as { databaseUrl: string | null; installEnabled: boolean };
      expect(body.databaseUrl).toBe(url);
      expect(body.installEnabled).toBe(true);
      await putConfig(adminToken, { registryUrl: null });
    });

    it('教师不能写入开关，数据库保持未配置', async () => {
      const res = await putConfig(teacherToken, { installEnabled: true });
      expect(res.status).toBe(403);
      expect(storedInstall()).toBeNull();
    });

    it('install-from-url、URL 更新与 x-community-install 直传均使用同一有效值', async () => {
      await putConfig(adminToken, { installEnabled: false });

      const disabledInstall = await postInstall(adminToken);
      expect(disabledInstall.status).toBe(403);
      const disabledBody = (await disabledInstall.json()) as { code?: string; error: string };
      expect(disabledBody.code).toBe('COMMUNITY_INSTALL_DISABLED');
      expect(disabledBody.error).toBe(COMMUNITY_INSTALL_DISABLED_MESSAGE);

      const disabledUpdate = await postUpdate(adminToken);
      expect(disabledUpdate.status).toBe(403);
      expect(((await disabledUpdate.json()) as { code?: string }).code).toBe('COMMUNITY_INSTALL_DISABLED');

      const disabledZip = await postCommunityZip(adminToken, 'ext-community-toggle-disabled');
      expect(disabledZip.status).toBe(403);
      expect(((await disabledZip.json()) as { code?: string }).code).toBe('COMMUNITY_INSTALL_DISABLED');

      await putConfig(adminToken, { installEnabled: true });

      const payload = {
        downloadUrl: 'https://plugins.example.com/plugin.zip',
        expectedId: 'ext-homework-hub',
      };
      const enabledInstall = await postInstall(adminToken, payload);
      const enabledInstallBody = (await enabledInstall.json()) as { code?: string; fallbackToClient?: boolean };
      expect(enabledInstall.status).not.toBe(403);
      expect(enabledInstallBody.code).not.toBe('COMMUNITY_INSTALL_DISABLED');
      expect(enabledInstallBody.code).not.toBe('COMMUNITY_ATTESTATION_REQUIRED');

      const enabledUpdate = await fetch(`${baseUrl}/api/plugins/ext-homework-hub/one-click-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
        body: JSON.stringify(payload),
      });
      const enabledUpdateBody = (await enabledUpdate.json()) as { code?: string };
      expect(enabledUpdate.status).not.toBe(403);
      expect(enabledUpdateBody.code).not.toBe('COMMUNITY_INSTALL_DISABLED');
      expect(enabledUpdateBody.code).not.toBe('COMMUNITY_ATTESTATION_REQUIRED');

      const enabledZip = await postCommunityZip(adminToken, 'ext-community-toggle-enabled');
      const enabledZipBody = (await enabledZip.json()) as { success?: boolean; code?: string };
      expect(enabledZip.status).toBe(200);
      expect(enabledZipBody.success).toBe(true);
    });

    it('未配置公钥时社区直传（x-community-install）直接放行，视为官方安全插件', async () => {
      delete process.env.OPENLEARN_COMMUNITY_PUBKEY;
      delete process.env.OPENLEARN_TRUSTED_PUBKEYS;
      const saveRes = await putConfig(adminToken, { installEnabled: true });
      const saveBody = (await saveRes.json()) as { publicKeysConfigured: boolean };
      expect(saveBody.publicKeysConfigured).toBe(false);

      const zipBuf = await communityZipBuf('ext-community-toggle-nopubkey');
      const shaHex = crypto.createHash('sha256').update(zipBuf).digest('hex');

      // 提供正确 integrity（或完全不提供 integrity/signature）且无公钥时均放行，并标记为官方安全（inline 不被强制降级）
      const savedIsolation = process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION;
      process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = '1';
      try {
        const zipRes = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
          method: 'POST',
          headers: {
            ...cookie(adminToken),
            'Content-Type': 'application/zip',
            'x-plugin-filename': 'ext-community-toggle-nopubkey.zip',
            'x-community-install': 'true',
            'x-integrity': shaHex,
            'x-signature': 'dGVzdC1zaWduYXR1cmU=',
          },
          body: zipBuf,
        });
        expect(zipRes.status).toBe(200);
        const zipBody = (await zipRes.json()) as {
          success?: boolean;
          executionMode?: string;
          executionModeCoerced?: boolean;
        };
        expect(zipBody.success).toBe(true);
        expect(zipBody.executionMode).toBe('inline');
        expect(zipBody.executionModeCoerced).toBe(false);
      } finally {
        if (savedIsolation === undefined) delete process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION;
        else process.env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION = savedIsolation;
      }
    });

    it('拒绝非法 installEnabled 类型', async () => {
      const res = await putConfig(adminToken, { installEnabled: '1' });
      expect(res.status).toBe(400);
    });
  });

  describe('Gitee repository live stars and +⭐ routes', () => {
    const studentId = 'usr-community-student';
    const studentToken = 'tok-community-student';
    const scopedPluginId = '@ext/class-manager';

    beforeAll(() => {
      const now = Date.now();
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(studentId, 'community_student', 'placeholder', 'student', '社区学生', now);
      kernelContainer.db
        .prepare(
          'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(
          studentToken,
          JSON.stringify({ userId: studentId, role: 'student', username: 'community_student' }),
          now,
          now + 60 * 60 * 1000,
        );
    });

    afterAll(() => {
      kernelContainer.db.prepare('DELETE FROM client_sessions WHERE id = ?').run(studentToken);
      kernelContainer.db.prepare('DELETE FROM users WHERE id = ?').run(studentId);
    });

    it('rejects anonymous and student callers for gitee-star mutations and anonymous refreshes', async () => {
      expect((await fetch(`${baseUrl}/api/plugins/community/gitee-star`, { method: 'POST' })).status).toBe(401);
      expect(
        (await fetch(`${baseUrl}/api/plugins/community/gitee-stars?pluginId=${encodeURIComponent(scopedPluginId)}`))
          .status,
      ).toBe(401);
      expect(
        (
          await fetch(`${baseUrl}/api/plugins/community/gitee-star`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cookie(studentToken) },
            body: JSON.stringify({ pluginId: scopedPluginId }),
          })
        ).status,
      ).toBe(403);
    });

    it('returns 401 requiresGiteeAuth with Gitee starUrl when teacher clicks +⭐ without a Gitee token', async () => {
      const registryUrl = 'https://registry.example.com/community-plugins.json';
      const registryJson = JSON.stringify({
        version: 1,
        plugins: [
          {
            id: scopedPluginId,
            name: '班级管理',
            version: '0.3.15',
            downloadUrl: 'https://gitee.com/aymwoo/class_manager/releases/download/v0.3.15/class_manager-0.3.15.zip',
            repository: 'https://gitee.com/aymwoo/class_manager',
            stars: 3,
          },
        ],
      });

      const { __resetCommunityRegistryCache, fetchCommunityRegistry } =
        await import('../services/community-registry.js');
      const { __resetGiteeStarsCache } = await import('../services/gitee-stars.js');

      const installed = new Map<string, string>();
      const rows = kernelContainer.db.prepare('SELECT manifest FROM plugins').all() as Array<{ manifest: string }>;
      for (const row of rows) {
        try {
          const manifest = JSON.parse(row.manifest) as { id?: unknown; version?: unknown };
          if (typeof manifest?.id === 'string' && manifest.id) {
            installed.set(manifest.id, typeof manifest.version === 'string' ? manifest.version : '0.0.0');
          }
        } catch {
          // ignore
        }
      }

      process.env[COMMUNITY_REGISTRY_ENV] = registryUrl;
      __resetCommunityRegistryCache();
      __resetGiteeStarsCache();
      await fetchCommunityRegistry({
        url: registryUrl,
        installed,
        fetchImpl: async () => new Response(registryJson, { status: 200 }),
      });

      try {
        const res = await fetch(`${baseUrl}/api/plugins/community/gitee-star`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
          body: JSON.stringify({ pluginId: scopedPluginId }),
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({
          success: false,
          requiresGiteeAuth: true,
          reason: 'missing_token',
          pluginId: scopedPluginId,
          starUrl: 'https://gitee.com/aymwoo/class_manager',
        });

        const unknownRes = await fetch(`${baseUrl}/api/plugins/community/gitee-star`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
          body: JSON.stringify({ pluginId: 'non-existent-plugin' }),
        });
        expect(unknownRes.status).toBe(404);

        const refreshUnknown = await fetch(
          `${baseUrl}/api/plugins/community/gitee-stars?pluginId=non-existent-plugin`,
          { headers: cookie(teacherToken) },
        );
        expect(refreshUnknown.status).toBe(404);
      } finally {
        delete process.env[COMMUNITY_REGISTRY_ENV];
        __resetCommunityRegistryCache();
        __resetGiteeStarsCache();
      }
    });
  });

  describe('plugin snapshot and rollback routes', () => {
    it('enforces administrator auth and validates snapshotId format', async () => {
      expect((await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots`, { headers: cookie(teacherToken) })).status).toBe(
        403,
      );
      expect(
        (
          await fetch(`${baseUrl}/api/plugins/ext-demo/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...cookie(teacherToken) },
            body: JSON.stringify({}),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots/snap-valid-1`, {
            method: 'DELETE',
            headers: cookie(teacherToken),
          })
        ).status,
      ).toBe(403);

      const badRollback = await fetch(`${baseUrl}/api/plugins/ext-demo/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
        body: JSON.stringify({ snapshotId: '../evil' }),
      });
      expect(badRollback.status).toBe(400);

      const badDelete = await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots/${encodeURIComponent('bad..id')}`, {
        method: 'DELETE',
        headers: cookie(adminToken),
      });
      expect(badDelete.status).toBe(400);
    });

    it('lists snapshots, executes rollback, and deletes a snapshot for admins', async () => {
      const listSpy = vi.spyOn(kernelContainer.pluginHost, 'listPluginSnapshots').mockReturnValue([
        {
          snapshotId: 'snap-1731667200000-abcd1234',
          pluginId: 'uuid-demo',
          manifestId: 'ext-demo',
          pluginName: 'Demo Plugin',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          status: 'ready',
          createdAt: 1731667200000,
          wasActive: true,
          executionMode: 'inline',
          tableCount: 1,
          rowCount: 3,
          storageRows: 2,
          configRows: 1,
          migrationVersion: 1,
          sizeBytes: 2048,
        },
      ]);
      const rollbackSpy = vi.spyOn(kernelContainer.pluginHost, 'rollbackPluginToSnapshot').mockResolvedValue({
        pluginId: 'uuid-demo',
        manifestId: 'ext-demo',
        restoredVersion: '1.0.0',
        fromVersion: '1.1.0',
        snapshotId: 'snap-1731667200000-abcd1234',
        wasActive: true,
      });
      const deleteSpy = vi.spyOn(kernelContainer.pluginHost, 'deletePluginSnapshot').mockReturnValue(true);

      try {
        const listRes = await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots`, { headers: cookie(adminToken) });
        expect(listRes.status).toBe(200);
        const listBody = (await listRes.json()) as { success: boolean; snapshots: Array<{ snapshotId: string }> };
        expect(listBody.success).toBe(true);
        expect(listBody.snapshots).toHaveLength(1);
        expect(listSpy).toHaveBeenCalledWith('ext-demo');

        const rbRes = await fetch(`${baseUrl}/api/plugins/ext-demo/rollback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cookie(adminToken) },
          body: JSON.stringify({ snapshotId: 'snap-1731667200000-abcd1234' }),
        });
        expect(rbRes.status).toBe(200);
        const rbBody = (await rbRes.json()) as { success: boolean; restoredVersion: string };
        expect(rbBody.success).toBe(true);
        expect(rbBody.restoredVersion).toBe('1.0.0');
        expect(rollbackSpy).toHaveBeenCalledWith(
          'ext-demo',
          'snap-1731667200000-abcd1234',
          `user:${adminId}:administrator`,
        );

        const delRes = await fetch(`${baseUrl}/api/plugins/ext-demo/snapshots/snap-1731667200000-abcd1234`, {
          method: 'DELETE',
          headers: cookie(adminToken),
        });
        expect(delRes.status).toBe(200);
        expect(deleteSpy).toHaveBeenCalledWith('ext-demo', 'snap-1731667200000-abcd1234');
      } finally {
        listSpy.mockRestore();
        rollbackSpy.mockRestore();
        deleteSpy.mockRestore();
      }
    });
  });
});
