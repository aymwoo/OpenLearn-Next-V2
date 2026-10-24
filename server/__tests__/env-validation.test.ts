import { describe, it, expect } from 'vitest';
import { validateStartupEnv, formatEnvIssues } from '../security/env-validation.js';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

function errorKeys(env: NodeJS.ProcessEnv): string[] {
  return validateStartupEnv(env).errors.map((issue) => issue.key);
}

describe('插件资源配额与探活调参（TB-03 同类：拼错不能静默回落）', () => {
  it('接受 off / none / 0 与正整数', () => {
    for (const value of ['off', 'none', '0', '512', '32768']) {
      expect(errorKeys({ OPENLEARN_PLUGIN_MAX_RSS_MB: value }), value).toEqual([]);
    }
    expect(errorKeys({ OPENLEARN_PLUGIN_CPU_QUOTA_MS: '20000' })).toEqual([]);
    expect(errorKeys({ OPENLEARN_PLUGIN_CPU_WINDOW_MS: '10000' })).toEqual([]);
  });

  it('拒绝带单位/负数的配额值（否则会静默回落默认值）', () => {
    expect(errorKeys({ OPENLEARN_PLUGIN_MAX_RSS_MB: '512MB' })).toEqual(['OPENLEARN_PLUGIN_MAX_RSS_MB']);
    expect(errorKeys({ OPENLEARN_PLUGIN_CPU_QUOTA_MS: '20s' })).toEqual(['OPENLEARN_PLUGIN_CPU_QUOTA_MS']);
    expect(errorKeys({ OPENLEARN_PLUGIN_CPU_WINDOW_MS: '-1' })).toEqual(['OPENLEARN_PLUGIN_CPU_WINDOW_MS']);
  });

  it('配额总开关拼错时 fail-fast，而不是「看起来关了其实没关」', () => {
    expect(errorKeys({ OPENLEARN_PLUGIN_QUOTA: 'of' })).toEqual(['OPENLEARN_PLUGIN_QUOTA']);
    expect(errorKeys({ OPENLEARN_PLUGIN_QUOTA: 'off' })).toEqual([]);
  });

  it('探活调参必须是正整数', () => {
    expect(errorKeys({ OPENLEARN_WORKER_LIVENESS_INTERVAL_MS: '30s' })).toEqual([
      'OPENLEARN_WORKER_LIVENESS_INTERVAL_MS',
    ]);
    expect(errorKeys({ OPENLEARN_WORKER_LIVENESS_GRACE_MS: '15000' })).toEqual([]);
  });

  it('过小的采样窗口只告警，不阻断', () => {
    const result = validateStartupEnv({ OPENLEARN_PLUGIN_CPU_WINDOW_MS: '200' });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.key)).toContain('OPENLEARN_PLUGIN_CPU_WINDOW_MS');
  });
});

describe('startup env validation', () => {
  it('默认空环境不产生任何 error', () => {
    expect(validateStartupEnv(EMPTY_ENV).errors).toHaveLength(0);
  });

  it('接受合法的 PORT / TRUST_PROXY / 隔离档位组合', () => {
    const result = validateStartupEnv({
      NODE_ENV: 'production',
      PORT: '9000',
      TRUST_PROXY: '1',
      OPENLEARN_WORKER_ISOLATE: 'process',
      OPENLEARN_PLUGIN_PERMISSION: 'ro',
      OPENLEARN_PLUGIN_MAX_HEAP_MB: '256',
      OPENLEARN_WORKER_LIVENESS: 'on',
      BRIDGE_HOOK_TELEMETRY: 'off',
      ENCRYPTION_KEY: 'a'.repeat(64),
      OPENLEARN_ADMIN_PASSWORD: 'S3cure-Admin-Pass',
      OPENLEARN_TEACHER_PASSWORD: 'S3cure-Teacher-Pass',
    });
    expect(result.errors).toHaveLength(0);
  });

  it('拒绝非法的枚举/数值（拼写错误不允许静默回落）', () => {
    const keys = errorKeys({
      NODE_ENV: 'prod',
      PORT: 'abc',
      OPENLEARN_WORKER_ISOLATE: 'worker',
      OPENLEARN_PLUGIN_PERMISSION: 'rw-only',
      OPENLEARN_PLUGIN_MAX_HEAP_MB: '128MB',
      OPENLEARN_WORKER_LIVENESS: 'flase',
      BRIDGE_HOOK_TELEMETRY: 'yes',
    });
    expect(keys).toEqual(
      expect.arrayContaining([
        'NODE_ENV',
        'PORT',
        'OPENLEARN_WORKER_ISOLATE',
        'OPENLEARN_PLUGIN_PERMISSION',
        'OPENLEARN_PLUGIN_MAX_HEAP_MB',
        'OPENLEARN_WORKER_LIVENESS',
        'BRIDGE_HOOK_TELEMETRY',
      ]),
    );
  });

  it('拒绝越界的 PORT', () => {
    expect(errorKeys({ PORT: '70000' })).toContain('PORT');
    expect(errorKeys({ PORT: '0' })).toContain('PORT');
  });

  it('拒绝无法识别的 TRUST_PROXY，允许 loopback / IP / CIDR / 数字', () => {
    expect(errorKeys({ TRUST_PROXY: 'trust-everything' })).toContain('TRUST_PROXY');
    expect(errorKeys({ TRUST_PROXY: 'loopback,192.168.1.1,1' })).not.toContain('TRUST_PROXY');
    expect(errorKeys({ TRUST_PROXY: '10.0.0.0/8,fc00::/7' })).not.toContain('TRUST_PROXY');
    expect(errorKeys({ TRUST_PROXY: '10.0.0.0/33' })).toContain('TRUST_PROXY');
  });

  it('校验 ENCRYPTION_KEY 的 hex 长度', () => {
    expect(errorKeys({ ENCRYPTION_KEY: 'short' })).toContain('ENCRYPTION_KEY');
    expect(errorKeys({ ENCRYPTION_KEY: '"' + 'b'.repeat(64) + '"' })).not.toContain('ENCRYPTION_KEY');
  });

  it('生产环境弱口令直接拒绝，开发环境不阻断', () => {
    expect(errorKeys({ NODE_ENV: 'production', OPENLEARN_ADMIN_PASSWORD: 'admin' })).toContain(
      'OPENLEARN_ADMIN_PASSWORD',
    );
    expect(errorKeys({ NODE_ENV: 'development', OPENLEARN_ADMIN_PASSWORD: 'admin' })).not.toContain(
      'OPENLEARN_ADMIN_PASSWORD',
    );
  });

  it('非法 ALLOWED_ORIGINS 报 error，通配 * 给 warning', () => {
    expect(errorKeys({ ALLOWED_ORIGINS: 'not-a-url' })).toContain('ALLOWED_ORIGINS');
    const result = validateStartupEnv({ ALLOWED_ORIGINS: 'https://example.com,*' });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((issue) => issue.key)).toContain('ALLOWED_ORIGINS');
  });

  it('formatEnvIssues 输出 key 与 severity', () => {
    const text = formatEnvIssues([{ key: 'PORT', severity: 'error', message: 'bad' }]);
    expect(text).toContain('PORT');
    expect(text).toContain('ERROR');
  });
});
