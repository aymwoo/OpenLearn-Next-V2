/**
 * ext-interactive-lab 前端沙箱桥接入口
 *
 * 遵循 docs/plugin/frontend-sandbox-capability-boundary.md 规范：
 * 跑在 display: none 的沙箱 iframe 中，不挂载任何 React 组件（防 DataCloneError）。
 * 声明式组件由 manifest 的 contributes 由宿主呈现，可视微课件由独立的 HTML 视口呈现。
 */

interface SandboxFrontendContext {
  pluginId: string;
  services: {
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

export async function activate(hostCtx: SandboxFrontendContext): Promise<void> {
  ctx = hostCtx;

  // 1. 获取当前课堂上下文
  const { lessonId, classId } = await hostCtx.context.get();

  // 2. 隔离存储：统计套件启用频次
  const activations = Number((await hostCtx.services.storageService.get('activations')) ?? 0) + 1;
  await hostCtx.services.storageService.set('activations', String(activations));

  // 3. 注册命令面板（Ctrl+K）快捷指令
  await hostCtx.ui.registerExtensionPoint('command_palette.item', {
    id: 'interactive-lab-quick-verify',
    label: '虚拟实验：检查电路门禁通关状态',
    icon: 'Zap',
    slotProps: {
      title: '检查虚拟电路门禁通关状态',
      description: '查询当前学生在科学探究环节的欧姆定律验证记录',
      category: 'Inquiry Lab',
      commandType: 'ext-interactive-lab.circuit.query_status',
      payload: { lessonId },
    },
  });

  console.info('[ext-interactive-lab] 前端沙箱已激活', { lessonId, classId, activations });
}

export async function deactivate(): Promise<void> {
  ctx = null;
}

export async function showNotice(message: string): Promise<void> {
  await ctx?.ui.showToast(message);
}

export default { activate, deactivate };
