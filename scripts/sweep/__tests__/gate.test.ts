/**
 * CI 门禁判定逻辑（回归）。
 *
 * `pnpm sweep` 接入 CI 后，退出码就是门禁。门禁的判定口径必须独立于
 * 「报告可读性」口径：
 *
 * - 报告口径：把「几乎每个视图都出现」的问题归为**全局问题**，并把视图状态重算为
 *   正常 —— 这样报告不会被启动期噪音淹没；
 * - 门禁口径：**只要存在未捕获异常 / 导航失败 / 任何 4xx·5xx 响应，就失败** ——
 *   哪怕它是全局问题（「每个页面都 403」恰恰是最该拦住的回归）。
 *
 * 两条口径**正交**。本文件守住后者，防止「因为被判为全局，所以门禁不响」这种
 * 静默失效。
 */
import { describe, it, expect } from 'vitest';
import { hasBlockingIssue } from '../report.js';
import type { SweepViewResult } from '../types.js';

function makeResult(issues: SweepViewResult['issues'], status: SweepViewResult['status'] = 'ok'): SweepViewResult {
  return {
    role: 'teacher',
    roleLabel: '教师',
    targetId: 't',
    targetLabel: '视图',
    status,
    issues,
    url: 'http://127.0.0.1:9300/',
    durationMs: 1,
  };
}

const http403 = { kind: 'http' as const, severity: 'warning' as const, message: '403 GET /api/x', status: 403 };
const http500 = { kind: 'http' as const, severity: 'error' as const, message: '500 GET /api/x', status: 500 };
const consoleEcho = {
  kind: 'console' as const,
  severity: 'error' as const,
  message: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
};
const pageError = { kind: 'pageerror' as const, severity: 'error' as const, message: 'TypeError: x is not a function' };
const navError = { kind: 'nav' as const, severity: 'error' as const, message: '导航失败：boom' };
const navWarning = { kind: 'nav' as const, severity: 'warning' as const, message: '未找到可点击入口' };
const requestFailed = {
  kind: 'requestfailed' as const,
  severity: 'warning' as const,
  message: 'GET /api/x — net::ERR_CONNECTION_REFUSED',
};

describe('巡检门禁判定', () => {
  it('干净视图不阻断', () => {
    expect(hasBlockingIssue(makeResult([]))).toBe(false);
  });

  it('4xx 响应阻断（即使严重级是 warning）', () => {
    expect(hasBlockingIssue(makeResult([http403]))).toBe(true);
  });

  it('5xx 响应阻断', () => {
    expect(hasBlockingIssue(makeResult([http500]))).toBe(true);
  });

  it('未捕获异常阻断', () => {
    expect(hasBlockingIssue(makeResult([pageError]))).toBe(true);
  });

  it('导航失败阻断', () => {
    expect(hasBlockingIssue(makeResult([navError]))).toBe(true);
  });

  it('仅 console 错误不阻断（它是 4xx 的回声，重复计只会让门禁吵闹）', () => {
    expect(hasBlockingIssue(makeResult([consoleEcho]))).toBe(false);
  });

  it('请求失败（无响应体）不阻断', () => {
    expect(hasBlockingIssue(makeResult([requestFailed]))).toBe(false);
  });

  it('「未找到入口」（warning 级 nav）不阻断', () => {
    expect(hasBlockingIssue(makeResult([navWarning]))).toBe(false);
  });

  it('全局标记不影响阻断判定 —— 全局 403 依然阻断', () => {
    const global403 = { ...http403, global: true };
    expect(hasBlockingIssue(makeResult([global403]))).toBe(true);
  });

  it('全局标记 + 仅 console 回声 → 不阻断', () => {
    const globalEcho = { ...consoleEcho, global: true };
    expect(hasBlockingIssue(makeResult([globalEcho]))).toBe(false);
  });
});
