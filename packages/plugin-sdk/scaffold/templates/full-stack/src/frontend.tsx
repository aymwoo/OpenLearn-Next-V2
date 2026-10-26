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
 * `missing activate function`，插件直接进错误态（可见入口全部带红色告警）。
 *
 * 可见入口来自 manifest 的声明式贡献（`src/index.ts` 的 classroomTools /
 * contributes），由宿主自己渲染；本文件负责运行期桥接：读上下文、读写插件
 * 命名空间存储、调后端命令、注册**数据型**扩展点。
 * 完整能力边界见 docs/plugin/frontend-sandbox-capability-boundary.md。
 */

/**
 * 沙箱 iframe 注入的桥接上下文（SDK 未导出此类型，按实际用到的成员声明最小接口）。
 * 只有这里列出的成员存在，`React` / `document` / `fetch` 都不在 iframe 的可用范围内。
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

  // ② 插件命名空间存储：宿主按 manifest.id 隔离，不同插件不会串键
  const activations = Number((await hostCtx.services.storageService.get('activations')) ?? 0) + 1;
  await hostCtx.services.storageService.set('activations', String(activations));

  // ③ 数据型扩展点：命令面板（Ctrl+K）条目。
  //    宿主渲染这个条目，插件只提供数据 —— 这是第三方插件「无 UI 也能有可见入口」的通道。
  //    commandType 必须写**全限定名**：运行期注册不经过 manifest 命名空间前缀化。
  await hostCtx.ui.registerExtensionPoint('command_palette.item', {
    id: '{{name}}-create',
    label: '{{pluginName}}：新建记录',
    icon: 'Puzzle',
    slotProps: {
      title: '{{pluginName}}：新建记录',
      description: '写入一条记录到 {{pluginName}} 的插件表',
      category: 'Plugin',
      commandType: '{{pluginId}}.process',
      payload: { input: 'created from command palette' },
    },
  });

  console.info('[{{pluginName}}] frontend activated', { lessonId, classId, activations });
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
