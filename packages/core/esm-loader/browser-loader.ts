/**
 * BrowserEsmLoader — 浏览器端 ESM 动态加载器实现。
 *
 * D-11: 使用 Blob URL + 原生 import() 实现跨运行时一致接口。
 * 浏览器 sandbox 自然隔离。
 *
 * 关键安全特性：
 * - Blob URL 仅在创建它的 origin 可访问
 * - URL.revokeObjectURL() 在 finally 中立即清理，防止 URL 悬挂（Pitfall 2 防范）
 * - 错误分类私有方法适配浏览器错误消息格式
 *
 * Phase 3 范围: 基本加载器实现和 smoke 测试。
 * 前端实际集成推迟到 Phase 9。
 */

import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmLoaderError, EsmSyntaxError } from './errors.js';

export class BrowserEsmLoader extends EsmLoader {
  /**
   * 通过 Blob URL + import() 加载 ESM 代码字符串。
   *
   * Blob URL 生命周期：
   * 1. URL.createObjectURL(new Blob([code], {type:'text/javascript'})) 创建临时 URL
   * 2. import(url) 动态加载 ESM 模块
   * 3. URL.revokeObjectURL(url) 在 finally 中释放资源，防止内存泄漏
   *
   * @param code - ESM 源代码字符串
   * @returns import() 返回的模块命名空间对象，符合 PluginModule 接口
   */
  async load(code: string): Promise<PluginModule> {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      const mod = await this.doImport(url);
      return mod;
    } catch (err: unknown) {
      throw this.classifyError(err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * 执行实际的 import() 调用。
   * 提取为 protected 方法以便在测试中 mock（jsdom 不支持 Blob URL 的 import()）。
   */
  protected async doImport(url: string): Promise<PluginModule> {
    return await import(url);
  }

  /**
   * 将 import() 抛出的原始 Error 映射为 EsmLoaderError 子类。
   *
   * 浏览器错误消息模式（与 Node.js 不同）：
   * - SyntaxError: 消息包含 "SyntaxError" 或 "Unexpected token"
   * - 其他: 回退到基类 EsmLoaderError
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
