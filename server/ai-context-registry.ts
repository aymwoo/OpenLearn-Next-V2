/**
 * ai-context-registry — 插件注册 AI 上下文切片提供者（P2: ai.context.provider）
 *
 * 场景：插件（如 Python 实验插件）在课堂中维护自己的运行状态，教师与 AI 对话时，
 * Agent 系统指令应能自动注入该插件的实时状态切片（如学生当前的语法错误调用栈），
 * 使 AI 感知插件上下文。
 *
 * 注册入口：`ctx.services.ai.registerAIContextProvider(id, fn)`（Inline 插件传服务端
 * 闭包；Worker 序列化边界无法传函数，此类插件暂不可用此能力）。
 * 消费点：`/api/agent/chat` → `buildAgentSystemInstruction` 逐个调用并以
 * `[Plugin Context · <id>]` 段注入 system instruction。
 */

export type AIContextSliceFn = (lessonId: string | null) => string | null;

interface AIContextRegistryState {
  providers: Map<string, { fn: AIContextSliceFn; registeredBy?: string }>;
}

const registry: AIContextRegistryState = {
  providers: new Map(),
};

/** 注册插件 AI 上下文切片提供者（幂等：同 id 覆盖） */
export function registerAIContextProvider(id: string, fn: AIContextSliceFn, registeredBy?: string): void {
  if (!id?.trim() || typeof fn !== 'function') {
    throw new Error('[AIContextRegistry] id and provider function are required');
  }
  registry.providers.set(id.trim(), { fn, registeredBy });
}

/** 注销（带注册方校验） */
export function unregisterAIContextProvider(id: string, registeredBy?: string): void {
  const entry = registry.providers.get(id.trim());
  if (entry && registeredBy && entry.registeredBy && entry.registeredBy !== registeredBy) return;
  registry.providers.delete(id.trim());
}

/** 收集全部切片（逐个 try/catch，故障返回 null 并告警） */
export function collectAIContextSlices(lessonId: string | null): string[] {
  const slices: string[] = [];
  for (const [id, entry] of registry.providers) {
    try {
      const slice = entry.fn(lessonId);
      if (typeof slice === 'string' && slice.trim()) {
        slices.push(`[Plugin Context · ${id}]\n${slice.trim()}`);
      }
    } catch (err) {
      console.error(`[AIContextRegistry] provider "${id}" failed:`, err);
    }
  }
  return slices;
}

/** 列出全部已注册提供者 id（诊断用） */
export function listAIContextProviders(): string[] {
  return Array.from(registry.providers.keys());
}

/**
 * 服务器启动时接线：把注册表委托给 kernel AIService（插件经
 * ctx.services.ai.registerAIContextProvider 调用的真源落地在此）。
 */
export function bindAIContextRegistry(kernelAIService: {
  bindContextRegistry(delegates: {
    register: (id: string, fn: (lessonId: string | null) => string | null) => void;
    unregister: (id: string) => void;
  }): void;
}): void {
  kernelAIService.bindContextRegistry({
    register: (id, fn) => registerAIContextProvider(id, fn),
    unregister: (id) => unregisterAIContextProvider(id),
  });
}
