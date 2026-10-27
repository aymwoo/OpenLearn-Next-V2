/**
 * {{pluginName}} — 前端入口（沙箱桥接）
 *
 * ⚠️ 这里没有 React 组件，也不要加。
 *
 * 第三方 ZIP 插件的 frontend.js 由宿主 fetch 后经 postMessage 送进
 * `sandbox="allow-scripts"` 的不透明源 iframe（`/plugin-sandbox/frame`）执行，
 * 那个 iframe 是 `display: none` 的隐藏执行体：
 *   - 它不渲染任何用户可见 UI，iframe 内也没有 `window.HostSharedDeps` / React；
 *   - `component` 是函数，postMessage 无法结构化克隆，传进去直接 DataCloneError。
 *
 * 所以本文件的唯一硬契约是：**default export 一个带 activate 函数的对象**。
 * 宿主加载器逐字检查 `typeof plugin.activate !== 'function'`，不满足就抛
 * `missing activate function`，插件直接进错误态。
 *
 * 纯前端模板没有服务端命令处理器，因此它**不声明课堂工具 / 命令**——
 * 声明了也没有 handler 接，点按钮只会报 "No handler registered"。
 * 需要可见入口（课堂工具、命令面板条目）请用 `--template full-stack`。
 * 完整能力边界见 docs/plugin/frontend-sandbox-capability-boundary.md。
 */

/**
 * 沙箱 iframe 注入的桥接上下文（SDK 未导出此类型，按实际用到的成员声明最小接口）。
 */
interface SandboxFrontendContext {
  pluginId: string;
  services: {
    frontendApi: {
      get<T = unknown>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
      post<T = unknown>(path: string, body?: unknown): Promise<{ success: boolean; result?: T; error?: string }>;
      del<T = unknown>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
    };
    storageService: {
      get(key: string): Promise<string | null>;
      set(key: string, value: unknown): Promise<boolean>;
      delete(key: string): Promise<boolean>;
    };
  };
  ui: {
    registerExtensionPoint(slot: string, config: Record<string, unknown>): Promise<boolean>;
    showToast(message: string): Promise<boolean>;
  };
  invokeCommand<T = unknown>(type: string, payload?: unknown): Promise<T>;
  context: { get(): Promise<{ lessonId: string | null; classId: string | null }> };
}

let ctx: SandboxFrontendContext | null = null;

async function activate(hostCtx: SandboxFrontendContext): Promise<void> {
  ctx = hostCtx;

  // ① 课堂上下文：当前课节 / 班级（不在课堂中时为 null）
  const { lessonId, classId } = await hostCtx.context.get();

  // ② 插件命名空间存储：宿主按 manifest.id 隔离；这里做「仅首次激活提示」，
  //    避免每次应用启动都弹 toast。
  const welcomed = await hostCtx.services.storageService.get('welcomed');
  if (!welcomed) {
    await hostCtx.ui.showToast('{{pluginName}} 已启用');
    await hostCtx.services.storageService.set('welcomed', '1');
  }

  console.info('[{{pluginName}}] frontend activated', { lessonId, classId });
}

async function deactivate(): Promise<void> {
  // 宿主停用/卸载时会摘掉本插件运行期注册的扩展点并销毁 iframe，这里无需手工反注册。
  ctx = null;
}

/** 宿主 toast 通道：iframe 内没有 DOM，这是插件唯一能弹提示的方式。 */
export async function notify(message: string): Promise<void> {
  await ctx?.ui.showToast(message);
}

export default { activate, deactivate };
