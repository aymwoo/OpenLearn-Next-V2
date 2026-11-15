/**
 * @vitest-environment node
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { registerRuntimePolicyRoutes } from '../routes/runtime-policies.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerBridgeRoutes } from '../routes/bridge.js';
import { injectLmsSdk } from '../routes/shared.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { setAuditSinkForTests, type AuditRecord } from '../../packages/core/observability/audit-log.js';
import {
  ALLOW_UNSIGNED_ENV,
  HOOK_TELEMETRY_ENV,
  HTTP_ACCESS_LOG_ENV,
  HTTP_ACCESS_LOG_IGNORE_ENV,
  HTTP_SLOW_MS_ENV,
  LOG_LEVEL_ENV,
  RuntimePolicyError,
  normalizeHttpAccessLogIgnoreInput,
  normalizeHttpSlowMs,
  resolveAllowUnsignedPolicy,
  resolveHookTelemetryPolicy,
  resolveHttpAccessLogPolicy,
  resolveRuntimePolicies,
  setRuntimePolicies,
  type RuntimePolicyDbLike,
  type StoredRuntimePolicyRow,
} from '../services/runtime-policies.js';

function memoryPolicyDb(initial: StoredRuntimePolicyRow = {}): RuntimePolicyDbLike & { store: StoredRuntimePolicyRow } {
  const store: StoredRuntimePolicyRow = { ...initial };
  return {
    store,
    prepare(sql: string) {
      return {
        get() {
          return { ...store };
        },
        run(_id: unknown, value: unknown) {
          const matched = sql.match(/INSERT INTO site_settings \(id, (\w+)\)/);
          if (!matched) throw new Error(`unexpected sql: ${sql}`);
          const column = matched[1] as keyof StoredRuntimePolicyRow;
          (store as Record<string, unknown>)[column] = value as never;
        },
      };
    },
  };
}

const ENV_KEYS = [
  HOOK_TELEMETRY_ENV,
  HTTP_ACCESS_LOG_ENV,
  HTTP_ACCESS_LOG_IGNORE_ENV,
  HTTP_SLOW_MS_ENV,
  ALLOW_UNSIGNED_ENV,
  LOG_LEVEL_ENV,
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

function clearStoredPolicies(): void {
  try {
    kernelContainer.db
      .prepare(
        `UPDATE site_settings
         SET bridge_hook_telemetry = NULL,
             http_access_log_mode = NULL,
             http_access_log_ignore = NULL,
             http_slow_ms = NULL,
             allow_unsigned_plugins = NULL
         WHERE id = ?`,
      )
      .run('global');
  } catch {
    /* 列尚未建立时由 ensureTestSchema 再处理 */
  }
}

describe('runtime policy resolvers', () => {
  afterEach(() => {
    clearEnv();
  });

  it('默认：遥测开启、访问日志 errors、未签名默认放行，来源为 default', () => {
    const snapshot = resolveRuntimePolicies(memoryPolicyDb(), {});
    expect(snapshot.hookTelemetry).toMatchObject({
      enabled: true,
      storedValue: null,
      configSource: 'default',
    });
    expect(snapshot.httpAccessLog).toMatchObject({
      mode: 'errors',
      storedMode: null,
      modeSource: 'default',
      ignorePrefixes: [],
      slowMs: 1000,
      slowSource: 'default',
    });
    expect(snapshot.allowUnsigned).toMatchObject({
      allowByDefault: true,
      storedValue: null,
      configSource: 'default',
    });
  });

  it('未设置存储值时回退环境变量', () => {
    const env = {
      [HOOK_TELEMETRY_ENV]: 'off',
      [HTTP_ACCESS_LOG_ENV]: 'all',
      [HTTP_ACCESS_LOG_IGNORE_ENV]: '/api/vfs,/health',
      [HTTP_SLOW_MS_ENV]: '2500',
      [ALLOW_UNSIGNED_ENV]: '0',
    };
    const snapshot = resolveRuntimePolicies(memoryPolicyDb(), env);
    expect(snapshot.hookTelemetry).toMatchObject({ enabled: false, configSource: 'env', hasEnvFallback: true });
    expect(snapshot.httpAccessLog).toMatchObject({
      mode: 'all',
      modeSource: 'env',
      ignorePrefixes: ['/api/vfs', '/health'],
      ignoreSource: 'env',
      slowMs: 2500,
      slowSource: 'env',
    });
    expect(snapshot.allowUnsigned).toMatchObject({
      allowByDefault: false,
      configSource: 'env',
      hasEnvFallback: true,
    });
  });

  it('LOG_LEVEL=debug 在未设置 HTTP_ACCESS_LOG 时回退为 all', () => {
    const policy = resolveHttpAccessLogPolicy(memoryPolicyDb(), { [LOG_LEVEL_ENV]: 'debug' });
    expect(policy.mode).toBe('all');
    expect(policy.modeSource).toBe('env');
  });

  it('显式存储值（含显式关闭）覆盖环境变量', () => {
    const db = memoryPolicyDb({
      bridge_hook_telemetry: 0,
      http_access_log_mode: 'off',
      http_access_log_ignore: '/metrics',
      http_slow_ms: 200,
      allow_unsigned_plugins: 1,
    });
    const env = {
      [HOOK_TELEMETRY_ENV]: 'on',
      [HTTP_ACCESS_LOG_ENV]: 'all',
      [ALLOW_UNSIGNED_ENV]: '0',
    };
    const snapshot = resolveRuntimePolicies(db, env);
    expect(snapshot.hookTelemetry).toMatchObject({ enabled: false, storedValue: false, configSource: 'database' });
    expect(snapshot.httpAccessLog).toMatchObject({ mode: 'off', modeSource: 'database', slowMs: 200 });
    expect(snapshot.allowUnsigned).toMatchObject({ allowByDefault: true, storedValue: true, configSource: 'database' });
  });

  it('列缺失时当作未配置并回退 ENV', () => {
    const missing: RuntimePolicyDbLike = {
      prepare() {
        throw new Error('no such column: bridge_hook_telemetry');
      },
    };
    const policy = resolveHookTelemetryPolicy(missing, { [HOOK_TELEMETRY_ENV]: 'off' });
    expect(policy).toMatchObject({ enabled: false, storedValue: null, configSource: 'env' });
  });

  it('持久化后再次读取仍是显式值；清除后恢复 ENV', () => {
    const db = memoryPolicyDb();
    const env = { [HOOK_TELEMETRY_ENV]: 'off', [ALLOW_UNSIGNED_ENV]: '0', [HTTP_ACCESS_LOG_ENV]: 'all' };
    setRuntimePolicies(
      db,
      { hookTelemetryEnabled: true, allowUnsignedByDefault: true, httpAccessLogMode: 'errors' },
      env,
    );
    expect(resolveRuntimePolicies(db, env).hookTelemetry).toMatchObject({
      enabled: true,
      configSource: 'database',
    });
    expect(resolveAllowUnsignedPolicy(db, env).allowByDefault).toBe(true);
    expect(resolveHttpAccessLogPolicy(db, env).mode).toBe('errors');

    setRuntimePolicies(db, { hookTelemetryEnabled: null, allowUnsignedByDefault: null, httpAccessLogMode: null }, env);
    const restored = resolveRuntimePolicies(db, env);
    expect(restored.hookTelemetry).toMatchObject({ enabled: false, storedValue: null, configSource: 'env' });
    expect(restored.allowUnsigned).toMatchObject({ allowByDefault: false, storedValue: null, configSource: 'env' });
    expect(restored.httpAccessLog).toMatchObject({ mode: 'all', storedMode: null, modeSource: 'env' });
  });

  it('拒绝非法忽略前缀与慢请求阈值', () => {
    expect(() => normalizeHttpAccessLogIgnoreInput('https://evil.example/')).toThrow(RuntimePolicyError);
    expect(() => normalizeHttpAccessLogIgnoreInput('/ok?q=1')).toThrow(RuntimePolicyError);
    expect(() => normalizeHttpSlowMs(10)).toThrow(RuntimePolicyError);
    expect(() => normalizeHttpSlowMs(120000)).toThrow(RuntimePolicyError);
    expect(normalizeHttpAccessLogIgnoreInput(' /api/vfs , /health ')).toBe('/api/vfs,/health');
    expect(normalizeHttpSlowMs(50)).toBe(50);
  });
});

describe('runtime policy routes and execution gates', () => {
  let server: Server;
  let baseUrl: string;
  let audits: AuditRecord[] = [];
  const adminId = 'usr-runtime-admin';
  const teacherId = 'usr-runtime-teacher';
  const adminToken = 'tok-runtime-admin';
  const teacherToken = 'tok-runtime-teacher';
  const cookie = (token: string) => ({ Cookie: `edu_os_token=${token}` });

  beforeAll(async () => {
    ensureTestSchema();
    clearEnv();
    clearStoredPolicies();
    const now = Date.now();
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(adminId, 'runtime_admin', 'placeholder', 'administrator', '运行时管理员', now);
    kernelContainer.db
      .prepare(
        'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(teacherId, 'runtime_teacher', 'placeholder', 'teacher', '运行时教师', now);
    const expiresAt = now + 60 * 60 * 1000;
    const insertSession = kernelContainer.db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    );
    insertSession.run(
      adminToken,
      JSON.stringify({ userId: adminId, role: 'administrator', username: 'runtime_admin' }),
      now,
      expiresAt,
    );
    insertSession.run(
      teacherToken,
      JSON.stringify({ userId: teacherId, role: 'teacher', username: 'runtime_teacher' }),
      now,
      expiresAt,
    );

    const app = express();
    app.use(express.json());
    registerRuntimePolicyRoutes({ app, io: { emit: () => {} } } as any);
    registerPluginsRoutes({ app, io: { emit: () => {} } } as any);
    registerBridgeRoutes({ app, io: { emit: () => {} } } as any);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    clearEnv();
    clearStoredPolicies();
    audits = [];
    setAuditSinkForTests(null);
  });

  afterAll(async () => {
    clearEnv();
    clearStoredPolicies();
    setAuditSinkForTests(null);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('未登录不能读管理接口或精简遥测接口', async () => {
    const admin = await fetch(`${baseUrl}/api/admin/runtime-policies`);
    expect(admin.status).toBe(401);
    const lite = await fetch(`${baseUrl}/api/bridge/hook-telemetry`);
    expect(lite.status).toBe(401);
  });

  it('教师不能读或写管理策略，且 403 响应不泄露保留环境变量清单', async () => {
    const getRes = await fetch(`${baseUrl}/api/admin/runtime-policies`, { headers: cookie(teacherToken) });
    expect(getRes.status).toBe(403);
    const getText = await getRes.text();
    expect(getText).not.toContain('ENCRYPTION_KEY');
    expect(getText).not.toContain('reservedEnvBoundaries');
    expect(getText).not.toContain('TRUSTED_PUBKEYS');

    const putRes = await fetch(`${baseUrl}/api/admin/runtime-policies`, {
      method: 'PUT',
      headers: { ...cookie(teacherToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hookTelemetryEnabled: false }),
    });
    expect(putRes.status).toBe(403);
  });

  it('教师可读精简遥测开关，且仅返回 enabled', async () => {
    const res = await fetch(`${baseUrl}/api/bridge/hook-telemetry`, { headers: cookie(teacherToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ enabled: true });
  });

  it('管理员可读写策略，清除后恢复 ENV，审计不含密钥', async () => {
    setAuditSinkForTests((row) => audits.push(row));
    process.env[HOOK_TELEMETRY_ENV] = 'off';
    const initial = await fetch(`${baseUrl}/api/admin/runtime-policies`, { headers: cookie(adminToken) });
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as any;
    expect(initialBody.policies.hookTelemetry.enabled).toBe(false);
    expect(initialBody.policies.hookTelemetry.configSource).toBe('env');
    expect(initialBody.reservedEnvBoundaries.some((item: { key: string }) => item.key.includes('ENCRYPTION_KEY'))).toBe(
      true,
    );
    expect(JSON.stringify(initialBody)).not.toMatch(/BEGIN (PRIVATE|RSA) KEY/);

    const putRes = await fetch(`${baseUrl}/api/admin/runtime-policies`, {
      method: 'PUT',
      headers: { ...cookie(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hookTelemetryEnabled: true, httpAccessLogMode: 'off', allowUnsignedByDefault: false }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as any;
    expect(putBody.policies.hookTelemetry).toMatchObject({ enabled: true, configSource: 'database' });
    expect(putBody.policies.httpAccessLog.mode).toBe('off');
    expect(putBody.policies.allowUnsigned.allowByDefault).toBe(false);
    expect(audits.some((row) => row.event === 'runtime_policy.updated')).toBe(true);
    expect(JSON.stringify(audits)).not.toMatch(/BEGIN (PRIVATE|RSA) KEY/);
    expect(JSON.stringify(audits)).not.toContain('OPENLEARN_ADMIN_PASSWORD');

    const lite = await fetch(`${baseUrl}/api/bridge/hook-telemetry`, { headers: cookie(teacherToken) });
    expect(await lite.json()).toEqual({ enabled: true });

    const clearRes = await fetch(`${baseUrl}/api/admin/runtime-policies`, {
      method: 'PUT',
      headers: { ...cookie(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hookTelemetryEnabled: null, httpAccessLogMode: null, allowUnsignedByDefault: null }),
    });
    expect(clearRes.status).toBe(200);
    const cleared = (await clearRes.json()) as any;
    expect(cleared.policies.hookTelemetry).toMatchObject({ enabled: false, storedValue: null, configSource: 'env' });
    expect(cleared.policies.allowUnsigned).toMatchObject({ allowByDefault: true, storedValue: null });
  });

  it('公开站点设置不泄露运行时策略', async () => {
    const res = await fetch(`${baseUrl}/api/site-settings`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('allowUnsigned');
    expect(body).not.toContain('hookTelemetry');
    expect(body).not.toContain('httpAccessLog');
    expect(body).not.toContain('ENCRYPTION_KEY');
    expect(body).not.toContain('reservedEnvBoundaries');
  });

  it('injectLmsSdk 与 /bridge.js 读取同一存储覆盖值', async () => {
    process.env[HOOK_TELEMETRY_ENV] = 'off';
    const req: any = { headers: {}, protocol: 'http', get: () => '127.0.0.1' };
    const cw = { id: 'cw-runtime', name: 'runtime', uuid: 'runtime-uuid' };
    const htmlEnv = injectLmsSdk('<html><head></head><body></body></html>', req, cw);
    expect(htmlEnv).toContain('window.__LMS_HOOK_TELEMETRY__ = false');

    setRuntimePolicies(kernelContainer.db, { hookTelemetryEnabled: true });
    const htmlDb = injectLmsSdk('<html><head></head><body></body></html>', req, cw);
    expect(htmlDb).toContain('window.__LMS_HOOK_TELEMETRY__ = true');

    const res = await fetch(`${baseUrl}/bridge.js`);
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('window.__LMS_HOOK_TELEMETRY__ = true');
    expect(js).toContain('hook-telemetry:changed');
  });

  it('SDK 可接收 hook-telemetry:changed 且全部 HOOK 仍受门控', () => {
    expect(BRIDGE_SDK_CODE).toContain('hook-telemetry:changed');
    expect(BRIDGE_SDK_CODE).toContain('function __hookAllowed()');
  });

  it('非法 PUT 返回 400 且不写入', async () => {
    const res = await fetch(`${baseUrl}/api/admin/runtime-policies`, {
      method: 'PUT',
      headers: { ...cookie(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ httpAccessLogIgnore: 'https://evil.example/' }),
    });
    expect(res.status).toBe(400);
    const snap = resolveHttpAccessLogPolicy(kernelContainer.db, {});
    expect(snap.storedIgnore).toBeNull();
  });
});
