/**
 * EsmLoader — 跨运行时 ESM 动态加载器抽象基类。
 *
 * D-02: 抽象基类 + 平台实现
 * D-03: 返回原始模块导出，不构建安全上下文（安全包装在 PluginRuntime 中保留）
 *
 * PluginModule 接口定义 import() 返回的模块命名空间对象形状。
 * D-06: 支持两种插件导出格式：
 *   1. export default { manifest, activate }
 *   2. export function activate(ctx) {}
 */

/**
 * PluginModule — import() 返回的模块命名空间对象。
 *
 * 支持两种插件导出格式（D-06）：
 * 1. export default { manifest, activate }
 * 2. export function activate(ctx) {}
 */
export interface PluginModule {
  default?: {
    manifest?: Record<string, unknown>;
    activate?: (ctx: unknown) => Promise<void>;
  };
  activate?: (ctx: unknown) => Promise<void>;
  manifest?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * EsmLoader — 跨运行时 ESM 动态加载器抽象基类。
 *
 * D-02: 抽象基类 + 平台实现
 * D-03: 返回原始模块导出，不构建安全上下文
 */
export abstract class EsmLoader {
  abstract load(code: string): Promise<PluginModule>;
}
