/**
 * Middleware — 洋葱模型生命周期中间件管道。
 *
 * Phase 7: 提供 compose() 函数将中间件数组组合为洋葱管道，
 * 以及 safeInvoke() 用于手动包装单个中间件的错误隔离。
 *
 * 洋葱模型（Koa 兼容）：
 *   middleware1.pre → middleware2.pre → handler
 *   middleware1.post ← middleware2.post
 *
 * 错误隔离策略：
 *   - 中间件 OWN 代码抛异常（next() 未被调用）→ 日志记录，跳到下一个中间件
 *   - 处理器（handler）或下游中间件抛异常（next() 已被调用）→ 向上传播
 *   - 这确保中间件 bug 不阻塞生命周期，但 handler 错误正确传播
 */

import type { Middleware, MiddlewareContext } from './types.js';

/**
 * 将中间件数组组合成洋葱管道。
 *
 * 调用顺序: m1.pre → m2.pre → handler → m2.post → m1.post
 *
 * 错误隔离：中间件自己的 pre-processing 抛异常时，记录日志并跳到下一个中间件。
 * 如果 next() 已经被调用（即下游抛异常），错误向上传播。
 *
 * @param middlewares - 按注册顺序排列的中间件数组
 * @returns 组合后的函数，接受 (ctx, handler)
 */
export function compose(
  middlewares: Middleware[],
): (ctx: MiddlewareContext, handler: () => Promise<void>) => Promise<void> {
  return async (ctx: MiddlewareContext, handler: () => Promise<void>) => {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('[Middleware] next() called multiple times');
      }
      index = i;

      if (i >= middlewares.length) {
        // 所有中间件执行完毕，调用实际处理器
        return handler();
      }

      const middleware = middlewares[i];
      try {
        await middleware(ctx, () => dispatch(i + 1));
      } catch (err) {
        // index > i 意味着 next() 被调用过（dispatch(i+1) 设置了 index = i+1）
        // 这种情况下，错误来自下游（handler 或其他中间件的 post-processing）
        // → 向上传播（不吞没 handler 错误）
        if (index > i) {
          throw err;
        }
        // index === i 意味着 next() 未被调用
        // → 中间件自己的 pre-processing 抛异常
        // → 记录日志，跳到下一个中间件
        console.error(
          `[PluginHost] Middleware error in phase "${ctx.phase}" for plugin "${ctx.pluginId}":`,
          err,
        );
        return dispatch(i + 1);
      }
    };

    await dispatch(0);
  };
}

/**
 * 单次中间件调用（带错误隔离）。
 *
 * 用于需要手动包装中间件的场景 — 完全吞没错误（包括下游错误）。
 * 通常不应在 compose 管道内使用；仅用于独立中间件调用。
 *
 * @param middleware - 要调用的中间件
 * @param ctx - 中间件上下文
 * @param next - 调用下一个中间件的函数
 */
export async function safeInvoke(
  middleware: Middleware,
  ctx: MiddlewareContext,
  next: () => Promise<void>,
): Promise<void> {
  try {
    await middleware(ctx, next);
  } catch (err) {
    console.error(
      `[PluginHost] Middleware error in phase "${ctx.phase}" for plugin "${ctx.pluginId}":`,
      err,
    );
    // 完全吞没 — 仅用于独立场景
  }
}
