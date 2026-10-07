/**
 * A-1 / A-2 / A-3 回归测试：插件代码静态安全门。
 *
 * 背景（审计 C-1 / C-6 / M-6）：
 * - `openlearn-token-enforcer` 的 `onResolve` 只拦得住 esbuild 能静态解析的**字面量**
 *   specifier。`await import('node:' + 'child_process')` 无法被静态解析，esbuild 只产生
 *   warning 并**原样保留为运行时 import()**，从而完全绕过该插件 —— 而 Worker 与主进程
 *   共享地址空间，拿到 child_process 即等价于宿主 RCE。
 * - `installPlugin(sourceCode)` 曾把源码**裸写盘**，连enforcer 都不经过，
 *   于是 `plugin.install` 路径的静态防线等于不存在（两条安装路径强度不对称）。
 * - 绝对路径 import 曾被放行，可把宿主任意文件内联进插件产物后回传。
 */
import { describe, it, expect } from 'vitest';
import { assertPluginCodeSafe, PluginCodeSecurityError, type PluginCodeViolation } from '../install-utils.js';

function violationOf(code: string): PluginCodeViolation | null {
  try {
    assertPluginCodeSafe(code);
    return null;
  } catch (e) {
    if (e instanceof PluginCodeSecurityError) return e.violation;
    throw e;
  }
}

// ── 必须被拒绝 ────────────────────────────────────────────────────────────

describe('assertPluginCodeSafe — 计算式 import（C-1 核心）', () => {
  it('拒绝字符串拼接的 node: 内置模块导入', () => {
    expect(violationOf(`await import('node:' + 'child_process')`)).toBe('computed-import');
  });

  it('拒绝模板字符串形式的动态导入', () => {
    expect(violationOf('const m = "child_process"; await import(`node:${m}`)')).toBe('computed-import');
  });

  it('拒绝变量形式的动态导入', () => {
    expect(violationOf('const p = "fs"; await import(p)')).toBe('computed-import');
  });

  it('拒绝方法调用形式的动态导入', () => {
    expect(violationOf('await import(getModuleName())')).toBe('computed-import');
  });

  it('拒绝动态 require', () => {
    expect(violationOf('const p = "child_process"; require(p)')).toBe('dynamic-require');
  });

  it('拒绝带空白的裸 require（绕过成员调用误判）', () => {
    expect(violationOf('const p = "fs"; require (p)')).toBe('dynamic-require');
  });

  it('放行 SDK 官方白名单 API ctx.require(变量) —— 其入参按设计就是变量', () => {
    // 金丝雀夹具正是这样用的：for (const m of REQUIRE_OK) ctx.require(m)
    expect(violationOf('for (const m of list) { ctx.require(m); }')).toBeNull();
    expect(violationOf('ctx.require("zod")')).toBeNull();
    expect(violationOf('sandbox.require(m)')).toBeNull();
  });

  it('拒绝 eval', () => {
    expect(violationOf('eval("require(\'fs\')")')).toBe('eval');
  });

  it('拒绝 new Function', () => {
    expect(violationOf('new Function("return require(\'fs\')")')).toBe('eval');
  });

  it("拒绝侧信道写法 import('node:'+'fs') 的等价形式", () => {
    expect(violationOf('const a="node:", b="fs"; import(a+b)')).toBe('computed-import');
  });
});

describe('assertPluginCodeSafe — 绝对路径 import（M-6）', () => {
  it('拒绝 from 绝对路径', () => {
    expect(violationOf(`import fs from '/etc/passwd'`)).toBe('absolute-path-import');
  });

  it('拒绝裸侧 import 绝对路径', () => {
    expect(violationOf(`import '/etc/shadow'`)).toBe('absolute-path-import');
  });

  it('拒绝 export from 绝对路径', () => {
    expect(violationOf(`export { x } from '/home/user/.ssh/id_rsa'`)).toBe('absolute-path-import');
  });

  it('错误信息包含泄露的路径，便于排查', () => {
    try {
      assertPluginCodeSafe(`import fs from '/etc/passwd'`);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('/etc/passwd');
    }
  });
});

// ── 必须放行（防误伤） ─────────────────────────────────────────────────────

describe('assertPluginCodeSafe — 合法代码不被误伤', () => {
  it('放行 @openlearn Token 静态导入', () => {
    expect(violationOf(`import { IDatabaseToken } from '@openlearn/plugin-sdk';`)).toBeNull();
  });

  it('放行相对路径导入', () => {
    expect(violationOf(`import { helper } from './utils/helper.js';`)).toBeNull();
  });

  it('放行字面量动态 import（esbuild 可静态解析，会被 enforcer 正常处理）', () => {
    expect(violationOf(`const m = await import('./chunk.js');`)).toBeNull();
  });

  it('放行注释里的 import —— 不应被当成计算式导入', () => {
    expect(
      violationOf(`
      // 曾经有人写过 await import('node:' + 'child_process')，已删除
      /* 另一个例子：import('node:' + 'fs') */
      export default {};
      `),
    ).toBeNull();
  });

  it('放行字符串字面量里的 import 片段', () => {
    expect(violationOf(`const doc = "use await import('node:' + 'x') carefully"; export default {};`)).toBeNull();
  });

  it('放行普通业务代码', () => {
    expect(
      violationOf(`
      import { PluginContext } from '@openlearn/plugin-sdk';
      export default {
        manifest: { id: 'x', name: 'X', version: '1.0.0', main: 'index.js' },
        async activate(ctx) {
          const db = await ctx.resolve(IDatabaseToken);
          const rows = db.prepare('SELECT 1').all();
          return rows.length;
        },
      };
      `),
    ).toBeNull();
  });
});

// ── 错误类型契约 ───────────────────────────────────────────────────────────

describe('PluginCodeSecurityError 契约', () => {
  it('携带 violation 与 detail，便于上层分类处理', () => {
    try {
      assertPluginCodeSafe(`await import('node:' + 'fs')`);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PluginCodeSecurityError);
      expect((e as PluginCodeSecurityError).name).toBe('PluginCodeSecurityError');
      expect((e as PluginCodeSecurityError).violation).toBe('computed-import');
      expect((e as PluginCodeSecurityError).detail).toBeTruthy();
    }
  });

  it('错误信息说明补救方式（而非仅报错）', () => {
    try {
      assertPluginCodeSafe(`await import('node:' + 'fs')`);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/插件只能 import 字面量路径或 @openlearn/);
    }
  });
});
