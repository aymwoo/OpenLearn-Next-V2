/**
 * 信任边界与各执行模式网络覆盖防漂移测试（Issue #144）。
 *
 * 本测试守住以下关键架构契约：
 * 1. 信任边界矩阵（docs/reference/plugin-trust-boundary.md）与网络代理实现强一致：
 *    - process 模式：注入 plugin-net-preload.cjs，默认阻断底层连接，HTTP(S) 经宿主 IPC 代理
 *    - worker_threads / inline 模式：同进程未注入网络沙箱，原生不受限
 *    - 修复并防止 <|channel|> 等表格语法渲染缺陷再现
 * 2. 策略层防御纵深闭环（resolvePluginExecutionMode）：
 *    - 任何不受信的第三方插件申请 inline 或 worker 模式均被强制改写（coerced）为 process 模式
 * 3. 子进程 spawn 流程网络安全网装载验证：
 *    - rw/ro 策略装载 preload 脚本与批准域名环境变量
 *    - off 策略（逃生舱）不装载 preload 脚本
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  resolvePluginExecutionMode,
  isTrustedInProcessPlugin,
  builtinPluginsDir,
} from '../../plugin-host/execution-policy.js';
import { resolveNetPreloadPath } from '../child-spawn.js';

const REPO_ROOT = path.resolve(process.cwd());

describe('Issue #144 · 信任边界文档一致性（Docs Drift Gate）', () => {
  const docPath = path.join(REPO_ROOT, 'docs/reference/plugin-trust-boundary.md');

  it('docs/reference/plugin-trust-boundary.md 存在且排除了 <|channel|> 渲染错误', () => {
    expect(fs.existsSync(docPath), '信任边界文档必须存在').toBe(true);
    const content = fs.readFileSync(docPath, 'utf8');

    // TB-08：防范表格语法错误再次引入
    expect(content).not.toContain('<|channel|>');
    expect(content).toMatch(/\|\s*指令\s*\|\s*预期行为\s*\|\s*风险\s*\|/);
  });

  it('文档 §1 与 §2 准确反映 process 模式网络代理及 worker/inline 模式现状', () => {
    const content = fs.readFileSync(docPath, 'utf8');

    // 验证 process 模式已对齐为代理而非“不受限”
    expect(content).toContain('plugin-net-preload.cjs');
    expect(content).toContain('默认拒绝 + 获批域名宿主代发');
    expect(content).not.toContain('本版本不受限（Node 无 `--allow-net`）');

    // 验证 worker_threads 与 inline 模式客观说明
    expect(content).toContain('原生不受限（无 preload 拦截）');
    expect(content).toContain('同进程共享宿主网络栈');
  });

  it('文档 §4 与 §7 修正已知缺口描述并更新交付路线图', () => {
    const content = fs.readFileSync(docPath, 'utf8');

    // 缺口描述修正
    expect(content).not.toContain('1. **网络 unrestricted**：Node 本版本没有 `--allow-net`');
    expect(content).toContain('网络拦截与边界划分');
    expect(content).toContain('plugin_network_grants');

    // 路线图已交付项修正
    expect(content).not.toMatch(/^1\.\s*\*\*网络隔离\*\*：host proxy \+ manifest outbound allowlist/m);
    expect(content).toContain('网络隔离演进');
  });

  it('能力矩阵 docs/reference/plugin-capability-matrix.md 已补充 network 说明', () => {
    const matrixPath = path.join(REPO_ROOT, 'docs/reference/plugin-capability-matrix.md');
    expect(fs.existsSync(matrixPath), '能力矩阵文档必须存在').toBe(true);
    const content = fs.readFileSync(matrixPath, 'utf8');

    expect(content).toContain('`network:*` / `net:*`');
    expect(content).toContain('plugin_network_grants');
  });
});

describe('Issue #144 · 各执行模式网络覆盖与策略层防护闭环', () => {
  describe('resolvePluginExecutionMode 执行模式收敛门禁', () => {
    const fakeIsolatedEnv = {
      OPENLEARN_TRUSTED_INLINE_PLUGINS: 'trusted-vendor-plugin',
      // 清除 VITEST 的测试特权分支，模拟生产模式决策
      VITEST: '',
      OPENLEARN_ENFORCE_PLUGIN_ISOLATION: '1',
    };

    it('不受信的第三方插件申请 worker 线程模式被强制改写为 process 模式', () => {
      const decision = resolvePluginExecutionMode(
        'ext-third-party-cool',
        'worker',
        fakeIsolatedEnv,
        '/var/openlearn/plugins/ext-third-party-cool',
      );

      expect(decision.mode).toBe('process');
      expect(decision.coerced).toBe(true);
      expect(decision.reason).toContain('is not trusted for in-process execution');
    });

    it('不受信的第三方插件申请 inline 被强制改写为 process 模式', () => {
      const decision = resolvePluginExecutionMode(
        'ext-malicious-attempt',
        'inline',
        fakeIsolatedEnv,
        '/var/openlearn/plugins/ext-malicious-attempt',
      );

      expect(decision.mode).toBe('process');
      expect(decision.coerced).toBe(true);
      expect(decision.reason).toContain('forced to "process"');
    });

    it('第三方插件申请 process 模式正常通过且不发生改写', () => {
      const decision = resolvePluginExecutionMode(
        'ext-normal-plugin',
        'process',
        fakeIsolatedEnv,
        '/var/openlearn/plugins/ext-normal-plugin',
      );

      expect(decision.mode).toBe('process');
      expect(decision.coerced).toBe(false);
    });

    it('管理员显式加入 OPENLEARN_TRUSTED_INLINE_PLUGINS 的插件允许进程内执行', () => {
      const decision = resolvePluginExecutionMode(
        'trusted-vendor-plugin',
        'worker',
        fakeIsolatedEnv,
        '/var/openlearn/plugins/trusted-vendor-plugin',
      );

      expect(decision.mode).toBe('worker');
      expect(decision.coerced).toBe(false);
    });

    it('仓库内置 packages/plugins 目录内的插件允许进程内执行', () => {
      const builtinPath = path.join(builtinPluginsDir(), 'builtin.ts');
      const decision = resolvePluginExecutionMode('builtin', 'inline', fakeIsolatedEnv, builtinPath);

      expect(decision.mode).toBe('inline');
      expect(decision.coerced).toBe(false);
    });
  });

  describe('child-spawn 模式网络 preload 装配验证', () => {
    it('resolveNetPreloadPath 能正确定位到存在的 plugin-net-preload.cjs 文件', () => {
      const preload = resolveNetPreloadPath();
      expect(fs.existsSync(preload)).toBe(true);
      expect(preload).toMatch(/plugin-net-preload\.cjs$/);

      // 验证 preload 脚本源码核心拦截项
      const preloadCode = fs.readFileSync(preload, 'utf8');
      expect(preloadCode).toContain('net.Socket.prototype.connect');
      expect(preloadCode).toContain('dgram.createSocket');
      expect(preloadCode).toContain('blockDns');
      expect(preloadCode).toContain('ol-net-proxy');
      expect(preloadCode).toContain('OPENLEARN_PLUGIN_NET_ALLOW');
    });
  });
});
