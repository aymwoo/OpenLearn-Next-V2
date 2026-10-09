/**
 * L-1 P1 阶段 3：`executionMode` 的第三个取值 `'process'`。
 *
 * ## 这个测试要防的具体故障
 *
 * `'process'` 加进来时，模式收窄散落在 11 处（`plugin-host/index.ts` 5 处、
 * `plugin-distribution-manager.ts` 3 处、`server/routes/plugins.ts` 3 处）。
 * 收窄的写法是：
 *
 * ```ts
 * x === 'worker' || x === 'inline' ? x : undefined
 * ```
 *
 * **漏改任何一处都不产生编译错误**，而后果是：管理员选了「进程隔离」，
 * 该入口把 `'process'` 判为非法 → 返回 `undefined` → 落到默认 `inline`
 * → **插件根本没进隔离路径，界面却显示已生效**。
 *
 * 这是阶段 3 最坏的失效形态：静默、且看起来是成功的。所以本测试的重点
 * 不是「`process` 能跑」，而是「**每一处收窄都认得它**」。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isValidExecutionMode,
  normalizeExecutionMode,
  requiresProcessIsolation,
  type PluginExecutionMode,
} from '../types.js';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.resolve(ROOT, rel), 'utf-8');

/** 剥掉注释，避免注释里提到 'process' 被当成代码 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('阶段 3 · PluginExecutionMode 类型', () => {
  it('包含三个合法取值', () => {
    const modes: PluginExecutionMode[] = ['inline', 'worker', 'process'];
    for (const m of modes) expect(isValidExecutionMode(m)).toBe(true);
  });

  it('拒绝非法值（含大小写变体与空串）', () => {
    for (const bad of ['Worker', 'PROCESS', 'proc', '', ' legacy ', 42, null, undefined, {}]) {
      expect(isValidExecutionMode(bad), `不应接受 ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('requiresProcessIsolation 只对 process 为真', () => {
    expect(requiresProcessIsolation('process')).toBe(true);
    expect(requiresProcessIsolation('worker')).toBe(false);
    expect(requiresProcessIsolation('inline')).toBe(false);
  });

  it('normalizeExecutionMode 把任意来源收敛到合法值（未知 → inline）', () => {
    // DB 的 execution_mode 是 TEXT 列、无 CHECK 约束 ⇒ 脏值一定能进库。
    // 归一化保证脏值只会退化成 inline（最弱但可预测），而不会走错隔离路径。
    expect(normalizeExecutionMode('process')).toBe('process');
    expect(normalizeExecutionMode('worker')).toBe('worker');
    expect(normalizeExecutionMode('inline')).toBe('inline');
    expect(normalizeExecutionMode('legacy')).toBe('inline');
    expect(normalizeExecutionMode('')).toBe('inline');
    expect(normalizeExecutionMode(undefined)).toBe('inline');
    expect(normalizeExecutionMode(null)).toBe('inline');
    expect(normalizeExecutionMode(123)).toBe('inline');
  });
});

describe('阶段 3 · 三处 API 入口都认得 process（防静默降级）', () => {
  /** API 层的收窄若写回内联比较，这里会红 */
  it('server/routes/plugins.ts 的三处收窄都用 isValidExecutionMode', () => {
    const code = stripComments(read('server/routes/plugins.ts'));

    // 旧写法：`x === 'worker' || x === 'inline' ? ... : undefined`
    const legacy = code.match(/===\s*'worker'\s*\|\|\s*\w+\s*===\s*'inline'/g);
    expect(legacy, `发现 ${legacy?.length ?? 0} 处旧的内联收窄 —— 漏改会让 'process' 静默降级为 inline`).toBeNull();

    const guard = code.match(/isValidExecutionMode\(/g) ?? [];
    expect(guard.length, 'API 层应至少 3 处用 isValidExecutionMode 收窄').toBeGreaterThanOrEqual(3);
  });

  it('plugin-host 的 activate 分流覆盖 worker 与 process 两种隔离模式', () => {
    const code = stripComments(read('packages/core/plugin-host/lifecycle.ts'));
    // 判据收敛为 requiresIsolatedExecution（审计 F-1）—— 它同时覆盖
    // worker 与 process；旧的 `mode === 'worker' || mode === 'process'` 字面量
    // 写法散落在四个入口，漏改一处就是一次静默降级。
    expect(
      code,
      'activatePlugin 的分流应使用 requiresIsolatedExecution —— ' +
        '只判 worker 会让 process 模式落进 inline 路径（静默降级）',
    ).toMatch(/requiresIsolatedExecution\(mode\)/);
  });

  it('activateWorker 把 mode 落到具体隔离原语', () => {
    const code = stripComments(read('packages/core/plugin-host/lifecycle.ts'));
    expect(code, 'createWorker 调用处应传 isolateKind，由 mode 决定 thread/process').toMatch(
      /isolateKind:\s*requiresProcessIsolation\(mode\)\s*\?\s*'process'\s*:\s*'thread'/,
    );
  });

  it('createWorker 支持按实例覆盖隔离原语，缺省回落到 Manager 级设置', () => {
    const code = stripComments(read('packages/core/worker-runtime/worker-manager.ts'));
    expect(code).toMatch(/opts\?\.isolateKind\s*\?\?\s*this\.isolateKind/);
  });

  it('全仓生产代码不再有「缺 process 的两值联合」（单一真源）', () => {
    const files = [
      // L-2 阶段 2 后类已拆成继承链，mode 相关的代码分布在 lifecycle/install/core 三层
      'packages/core/plugin-host/lifecycle.ts',
      'packages/core/plugin-host/install.ts',
      'packages/core/plugin-host/core.ts',
      'packages/core/plugin-host/plugin-distribution-manager.ts',
      'packages/core/plugin-host/types.ts',
      'server/routes/plugins.ts',
    ];
    // 只抓**两值**联合：负向断言要求其后不再跟 `| 'process'`，
    // 于是 `types.ts` 里的定义本身（`'inline' | 'worker' | 'process'`，合法真源）
    // 不会被误判 —— 这是本条断言最初失败的原因：它把定义也当成违规了。
    const TWO_VALUE = /'worker'\s*\|\s*'inline'|'inline'\s*\|\s*'worker'/;
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(read(f));
      const re = new RegExp(`(${TWO_VALUE.source})(?!\\s*\\|\\s*'process')`, 'g');
      const hits = code.match(re);
      if (hits) offenders.push(`${f}: ${hits.length} 处 → ${hits[0]}`);
    }
    expect(
      offenders,
      `这些文件仍内联「只认两种模式」的联合类型 —— 'process' 会在该处被判非法并静默降级为 inline：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('SDK 契约层已暴露 process（否则插件作者无从选择该模式）', () => {
    for (const f of ['packages/plugin-sdk/openlearn.d.ts', 'packages/plugin-sdk/dist/index.d.ts']) {
      const dts = read(f);
      expect(dts, `${f} 未把 'process' 暴露给插件作者 —— 内核支持但契约层不认，等于该模式不可用`).toMatch(
        /executionMode\??:[^;]*'process'/,
      );
    }
  });

  it('前端类型也已同步（否则管理台无法选择该模式）', () => {
    const files = [
      'src/plugin-host/types.ts',
      'src/hooks/usePluginManagement.ts',
      'src/components/plugin-center/types.ts',
    ];
    for (const f of files) {
      expect(stripComments(read(f)), `${f} 未同步 'process'`).toMatch(/'process'/);
    }
  });
});

/**
 * 审计 F-1 的回归护栏。
 *
 * 背景：'process' 加入时 activate 一侧改成了双分支，但**停用 / 卸载 /
 * 模式热切换 / 热重载**四处仍写 `=== 'worker'`。四处各自合法、编译器一声不吭，
 * 而后果是静默失效：停用后子进程泄漏、再激活撞 "Worker already exists"、
 * 热重载把进程隔离降级为宿主管内 inline。
 *
 * 本组断言把判据**焊死**在 `requiresIsolatedExecution` 上：新增第四种模式时
 * 只有这一处谓词需要扩展，任何入口退回字面量比较都会立刻红灯。
 */
describe('审计 F-1 · 隔离执行判据收敛到 requiresIsolatedExecution', () => {
  it('activate / deactivate / uninstall / mode-switch / reload 五处分流都用该谓词', () => {
    const cases: Array<{ file: string; expected: number; what: string }> = [
      { file: 'packages/core/plugin-host/lifecycle.ts', expected: 2, what: 'activate + deactivate' },
      { file: 'packages/core/plugin-host/install.ts', expected: 2, what: 'uninstall + mode-switch' },
      { file: 'packages/core/plugin-host/reload.ts', expected: 1, what: 'reload' },
    ];
    for (const { file, expected, what } of cases) {
      const code = stripComments(read(file));
      const hits = code.match(/requiresIsolatedExecution\(/g) ?? [];
      expect(hits.length, `${file}（${what}）应使用 ${expected} 次 requiresIsolatedExecution`).toBe(expected);
    }
  });

  it('五处分流不再有裸字面量 `=== "worker"` 判定', () => {
    const files = [
      'packages/core/plugin-host/lifecycle.ts',
      'packages/core/plugin-host/install.ts',
      'packages/core/plugin-host/reload.ts',
    ];
    for (const file of files) {
      const code = stripComments(read(file));
      // 形如 mode === 'worker' / execMode === 'worker' / oldMode === 'worker'
      const legacy = code.match(/\w*[Mm]ode\s*===\s*'worker'/g);
      expect(
        legacy,
        `${file} 仍有只认 worker 的字面量判定 —— process 模式会在该处落进 inline 路径：\n${legacy?.join('\n')}`,
      ).toBeNull();
    }
  });

  it("manifest.executionMode 的三个取值都被安装路径识别（不再只映射 'worker'）", () => {
    const code = stripComments(read('packages/core/plugin-host/install.ts'));
    expect(
      code,
      "安装路径应 normalizeExecutionMode(manifest.executionMode) —— 写 'process' 不能被静默装成 inline",
    ).toMatch(
      /normalizeExecutionMode\(\s*\(?\s*manifest\s+as\s*\{[^}]*executionMode[^}]*\}\s*\)?\s*\.\s*executionMode\s*\)?/,
    );
  });
});
