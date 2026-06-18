/**
 * BrowserEsmLoader — 浏览器端 ESM 动态加载器实现。
 *
 * D-11: 使用 Blob URL + import() 实现浏览器端 ESM 动态加载。
 * 每次 load() 创建临时 Blob URL，finally 块中 revoke 防止内存泄漏。
 *
 * 关键安全特性：
 * - Blob URL 作用域在页面级，模块加载后不能访问 Node.js builtins
 * - URL.revokeObjectURL() 确保资源在加载完成后释放
 * - 错误分类私有方法适配浏览器错误消息格式
 */

import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmLoaderError, EsmSyntaxError } from './errors.js';

export class BrowserEsmLoader extends EsmLoader {
  /**
   * 通过 Blob URL + import() 加载 ESM 代码字符串。
   *
   * @param code - ESM 源代码字符串（应为 esbuild 预打包的单 bundle）
   * @returns import() 返回的模块命名空间对象，符合 PluginModule 接口
   */
  async load(code: string): Promise<PluginModule> {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      const mod = await import(/* @vite-ignore */ url);
      return mod as unknown as PluginModule;
    } catch (err: unknown) {
      throw this.classifyError(err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * 将 import() 抛出的原始 Error 映射为 EsmLoaderError 子类。
   *
   * 浏览器错误消息模式：
   * - 包含 "SyntaxError" 或 "Unexpected token" 的为语法错误
   * - 其他：回退到基类 EsmLoaderError
   */
  private classifyError(err: unknown): EsmLoaderError {
    const msg =
      err instanceof Error
        ? err.message
        : err instanceof Object && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);

    if (msg.includes('SyntaxError') || msg.includes('Unexpected token')) {
      return new EsmSyntaxError(msg, {
        cause: err instanceof Error ? err : undefined,
      });
    }
    return new EsmLoaderError(msg, {
      cause: err instanceof Error ? err : undefined,
    });
  }
}
