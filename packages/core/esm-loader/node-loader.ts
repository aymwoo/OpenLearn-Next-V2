/**
 * NodeEsmLoader — Node.js 端 ESM 动态加载器实现。
 *
 * D-11: 使用 data:text/javascript;base64, URL 方案 + 原生 import() 实现。
 * Base64 编码（Claude's discretion）：binary-safe、更紧凑、处理所有 Unicode 字符。
 *
 * 关键安全特性：
 * - data: URL 模块在 Node.js 中无法访问 require/fs 等 CJS API
 * - import() 只能加载 ESM 模块，不会执行 CJS require
 * - 错误分类私有方法将原始 Error 映射为 EsmLoaderError 子类
 *
 * D-14: 不在 NodeEsmLoader 层添加超时 — 超时由 PluginRuntime 的 Promise.race 处理。
 */

import { EsmLoader, type PluginModule } from './esm-loader.js';
import {
  EsmLoaderError,
  EsmSyntaxError,
  EsmModuleNotFoundError,
} from './errors.js';

export class NodeEsmLoader extends EsmLoader {
  /**
   * 通过 data:text/javascript;base64, URL + import() 加载 ESM 代码字符串。
   *
   * @param code - ESM 源代码字符串（应为 esbuild 预打包的单 bundle）
   * @returns import() 返回的模块命名空间对象，符合 PluginModule 接口
   */
  // 每次 load() 使用唯一时间戳 fragment，避免 Node.js ESM loader 缓存相同 data: URL
  // D-15 要求的缓存隔离：同一代码多次 load() 应返回独立模块实例
  private loadCounter = 0;

  async load(code: string): Promise<PluginModule> {
    const base64 = Buffer.from(code, 'utf-8').toString('base64');
    // 附加唯一 fragment 以绕过 Node.js ESM 缓存（fragment 不影响 data: URL 内容解析）
    const dataUrl = `data:text/javascript;base64,${base64}#${++this.loadCounter}`;

    try {
      return await import(dataUrl);
    } catch (err: unknown) {
      throw this.classifyError(err);
    }
  }

  /**
   * 将 import() 抛出的原始 Error 映射为 EsmLoaderError 子类。
   *
   * Node.js 错误消息模式：
   * - SyntaxError: 消息包含 "Unexpected token" 或 "SyntaxError"
   * - ModuleNotFound: 消息包含 "Failed to resolve module specifier" 或 "Cannot find module"
   * - 其他: 回退到基类 EsmLoaderError
   */
  private classifyError(err: unknown): EsmLoaderError {
    const msg =
      err instanceof Error
        ? err.message
        : err instanceof Object && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);

    if (
      msg.includes('Unexpected token') ||
      msg.includes('Unexpected end of input') ||
      msg.includes('SyntaxError')
    ) {
      return new EsmSyntaxError(msg, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    if (
      msg.includes('Failed to resolve module specifier') ||
      msg.includes('Cannot find module')
    ) {
      return new EsmModuleNotFoundError(msg, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    return new EsmLoaderError(msg, {
      cause: err instanceof Error ? err : undefined,
    });
  }
}
