/**
 * R-05：CLI 子命令复用启动期环境校验。
 *
 * 背景（`docs/audit/trust-boundary-hardening-audit-2026-10-14.md` R-05）：
 * `assertStartupEnv()` 只在 `server.ts` 的 `startServer()` 里跑；CLI 子命令
 * （`backup` / `restore` / `migrate` / `reset-admin` / `clean`）不经过那一层，
 * 于是拼错的环境变量在服务入口 fail-fast，在 CLI 里却静默沿用更宽的策略 ——
 * 而这几条命令正要动真实数据（还原数据库、回滚迁移、改管理员口令）。
 *
 * 这里钉住判定矩阵本身（纯函数），而不是靠 spawn 子进程去验：
 * - 写命令 + 非法环境 → 阻断；
 * - 诊断命令 + 非法环境 → 告警但继续（诊断工具自己被挡住就失去意义）；
 * - 构建产物缺失（源码检出）→ 跳过，不阻断。
 */
import { describe, it, expect } from 'vitest';
import { decideEnvPreflight, formatEnvPreflight, loadEnvValidation } from '../../../cli.mjs';

const err = { key: 'PORT', message: 'PORT 必须是数字', severity: 'ERROR' };
const warn = { key: 'TRUST_PROXY', message: '跳数可疑', severity: 'WARN' };

const VALID = { available: true, errors: [], warnings: [] };
const INVALID = { available: true, errors: [err], warnings: [] };
const WARNED = { available: true, errors: [], warnings: [warn] };
const MISSING = { available: false, errors: [], warnings: [] };

describe('decideEnvPreflight', () => {
  it('blocks destructive commands when the environment is invalid', () => {
    for (const command of ['backup', 'restore', 'migrate', 'reset-admin', 'clean']) {
      expect(decideEnvPreflight(command, INVALID), command).toEqual({
        action: 'block',
        reason: 'invalid-env',
      });
    }
  });

  it('lets diagnostic commands run with a warning instead of blocking them', () => {
    for (const command of ['doctor', 'compat-report', 'plugins', 'check-update']) {
      expect(decideEnvPreflight(command, INVALID), command).toEqual({
        action: 'warn',
        reason: 'invalid-env-diagnostic-command',
      });
    }
  });

  it('warns (but does not block) on warnings only', () => {
    expect(decideEnvPreflight('backup', WARNED)).toEqual({ action: 'warn', reason: 'env-warnings' });
    expect(decideEnvPreflight('doctor', WARNED)).toEqual({ action: 'warn', reason: 'env-warnings' });
  });

  it('passes silently when the environment is clean', () => {
    expect(decideEnvPreflight('backup', VALID)).toEqual({ action: 'pass' });
  });

  it('skips when the validation artifact is missing (source checkout)', () => {
    // 源码检出没有 dist/env-validation.cjs —— CLI 的可用性不能被构建产物绑架
    expect(decideEnvPreflight('backup', MISSING)).toEqual({
      action: 'skip',
      reason: 'validation-artifact-missing',
    });
  });

  it('does not block when the service is being started (no subcommand)', () => {
    // 启动服务时由 server.ts 的 assertStartupEnv() 负责，避免同一份规则报两次
    expect(decideEnvPreflight(null, INVALID)).toEqual({
      action: 'warn',
      reason: 'invalid-env-diagnostic-command',
    });
  });
});

describe('formatEnvPreflight', () => {
  it('renders warnings and errors with key + message', () => {
    const text = formatEnvPreflight({ available: true, errors: [err], warnings: [warn] });
    expect(text).toContain('PORT');
    expect(text).toContain('PORT 必须是数字');
    expect(text).toContain('TRUST_PROXY');
  });

  it('returns an empty string when there is nothing to report', () => {
    expect(formatEnvPreflight(VALID)).toBe('');
  });
});

describe('loadEnvValidation', () => {
  it('degrades to { available: false } instead of throwing when the artifact is absent', async () => {
    // 该用例在源码检出里天然走到「加载不到」分支；在生产包里则应返回 available: true。
    const result = await loadEnvValidation({});
    expect(result).toHaveProperty('available');
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
