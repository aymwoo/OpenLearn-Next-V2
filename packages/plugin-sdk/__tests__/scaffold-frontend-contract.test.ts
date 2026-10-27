/**
 * 脚手架 `frontend.tsx` 的导出契约必须与沙箱加载器一致。
 *
 * ## 为什么这条测试存在
 *
 * 宿主把第三方插件的 `frontend.js` 送进隐藏的不透明源 iframe，iframe 里的加载器是
 * `server/utils/plugin-sandbox-frame.ts`：
 *
 *     const plugin = mod.default || mod;
 *     if (typeof plugin.activate !== 'function') throw new Error('missing activate function');
 *
 * 而模板曾经生成 `export default function Component()` —— 装得上、构建得过，**激活必失败**，
 * 插件直接进错误态（可见入口全部带红色告警）。这是「文档/模板与运行时契约不一致」的
 * 典型形态：静态看都对，跑起来才炸，而炸点在校验链的最末端。
 *
 * ## 断言方式
 *
 * 不用正则 grep 模板文本（排版一改就失效），而是**真的把模板编译成 CJS 并求值**：
 * 用 esbuild transform（loader=tsx）→ `new Function` 求值 → 按沙箱加载器的同一句判据检查。
 * 模板占位符 `{{...}}` 出现在字符串字面量里，不影响求值。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../scaffold/templates');

/** 模板里含 frontend.tsx 的两档（server-only 不带前端） */
const WITH_FRONTEND = ['full-stack', 'frontend-only'];

function evaluateFrontendModule(template: string): Record<string, unknown> {
  const file = path.join(TEMPLATE_DIR, template, 'src/frontend.tsx');
  const source = fs.readFileSync(file, 'utf-8');
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', target: 'es2020' });
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  // 模板已转成 CJS，不含动态 import / require，求值是安全的
  new Function('module', 'exports', 'console', code)(mod, mod.exports, { info() {}, warn() {}, error() {} });
  return mod.exports;
}

describe('scaffold frontend.tsx 与插件沙箱的导出契约', () => {
  it.each(WITH_FRONTEND)('%s 的 default export 带 activate 函数', (template) => {
    const exportsObj = evaluateFrontendModule(template);
    const plugin = (exportsObj.default ?? exportsObj) as Record<string, unknown>;
    // 与 server/utils/plugin-sandbox-frame.ts 的判据逐字对齐
    expect(
      typeof plugin.activate,
      `${template} 的 frontend.tsx 缺少 activate —— 沙箱 iframe 会抛 "missing activate function"`,
    ).toBe('function');
  });

  it.each(WITH_FRONTEND)('%s 的 activate 可被调用且不依赖 React / DOM', async (template) => {
    const exportsObj = evaluateFrontendModule(template);
    const plugin = (exportsObj.default ?? exportsObj) as { activate: (ctx: unknown) => Promise<void> };

    // 模拟沙箱 iframe 注入的桥接上下文（server/utils/plugin-sandbox-frame.ts 的 makeCtx）
    const store = new Map<string, string>();
    const ctx = {
      pluginId: '@test/scaffold',
      manifest: { id: '@test/scaffold', name: 'Scaffold' },
      services: {
        frontendApi: {
          get: async () => ({ success: true }),
          post: async () => ({ success: true }),
          del: async () => ({ success: true }),
        },
        storageService: {
          get: async (k: string) => store.get(k) ?? null,
          set: async (k: string, v: unknown) => {
            store.set(k, String(v));
            return true;
          },
          delete: async (k: string) => store.delete(k),
        },
      },
      ui: {
        registerExtensionPoint: async () => true,
        showToast: async () => true,
      },
      invokeCommand: async () => ({}),
      context: { get: async () => ({ lessonId: null, classId: null }) },
    };

    await expect(plugin.activate(ctx)).resolves.toBeUndefined();
  });

  it.each(WITH_FRONTEND)('%s 的扩展点注册配置可结构化克隆（postMessage 前置条件）', async (template) => {
    const exportsObj = evaluateFrontendModule(template);
    const plugin = (exportsObj.default ?? exportsObj) as { activate: (ctx: unknown) => Promise<void> };

    const registered: unknown[] = [];
    const ctx = {
      pluginId: '@test/scaffold',
      manifest: { id: '@test/scaffold', name: 'Scaffold' },
      services: {
        frontendApi: { get: async () => ({}), post: async () => ({}), del: async () => ({}) },
        storageService: { get: async () => null, set: async () => true, delete: async () => true },
      },
      ui: {
        registerExtensionPoint: async (_slot: string, config: Record<string, unknown>) => {
          registered.push(config);
          return true;
        },
        showToast: async () => true,
      },
      invokeCommand: async () => ({}),
      context: { get: async () => ({ lessonId: null, classId: null }) },
    };
    await plugin.activate(ctx);

    for (const config of registered) {
      expect(
        () => structuredClone(config),
        `${template} 注册的扩展点配置含函数（component / render）—— 跨 iframe postMessage 会抛 DataCloneError`,
      ).not.toThrow();
    }
  });

  it('server-only 模板不带 frontend.tsx（因此没有任何前端产物）', () => {
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'server-only', 'src', 'frontend.tsx'))).toBe(false);
  });
});
