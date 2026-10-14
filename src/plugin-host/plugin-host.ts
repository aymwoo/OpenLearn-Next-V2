/**
 * FrontendPluginHost — browser-side plugin lifecycle manager.
 *
 * D-01: Uses zustand store for all state mutations.
 * D-03: Mirrors backend PluginHost lifecycle (initialize, installPlugin,
 *       activatePlugin, deactivatePlugin, uninstallPlugin) adapted for
 *       the browser environment.
 *
 * Lifecycle (inline mode):
 *   install → INSTALLED → activatePlugin → ACTIVATING → activate() → ACTIVE
 *   ACTIVE → deactivatePlugin → DEACTIVATING → deactivate() → INACTIVE
 *   Any ERROR state → ERROR (auto-set on activation failure)
 *
 * T-09-02: All Blob URL creation uses try/finally with URL.revokeObjectURL()
 *          to prevent memory leaks.
 */

import { FrontendServiceRegistry } from './service-registry';
import { BrowserWorkerManager } from './browser-worker-manager';
import { usePluginHostStore } from './plugin-host-store';
import { useAppStore, appStore } from '../store/appStore';
import { resolvePluginCommandType } from '../../packages/core/plugin-host/plugin-namespace';
import { checkMethodPolicy } from './method-policy';
import { isPluginFrameMessage, PLUGIN_FRAME_CHANNEL, PLUGIN_FRAME_PATH, PLUGIN_SANDBOX_ATTR } from './sandbox-frame';
import {
  PluginState,
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
  SEMESTER_GRADE_SERVICE_TOKEN,
  HOST_ACTION_DISPATCHER_TOKEN,
} from './types';
import type {
  FrontendPluginManifest,
  FrontendPluginContext,
  AnyExtensionSlot,
  ExtensionPointConfig,
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  ISemesterGradeService,
  IHostActionDispatcher,
  FrontendPluginInfo,
} from './types';
import { defaultHostActionDispatcher } from './host-action-dispatcher';
import { resetPluginBreaker } from './extension-breaker';
import { fullscreenRendererRegistry } from '../features/whiteboard/fullscreen/FullscreenRendererRegistry';
import { propertyEditorRegistry } from '../features/whiteboard/properties/PropertyEditorRegistry';
import { coursewareSourceRegistry } from '../features/whiteboard/courseware/courseware-source-registry';
import { paletteItemRegistry } from '../features/teacher/lesson-editor/palette-item-registry';
import type { PaletteColorKey, EditField } from '../features/teacher/lesson-editor/paletteConfig';
import {
  registerCustomSegmentType,
  unregisterCustomSegmentType,
  unregisterPluginSegmentTypes,
  resolveSegmentIcon,
} from '../features/teacher/lesson-editor/timelineConfig';
import type { SegmentTypeMeta } from '../features/teacher/lesson-editor/timelineConfig';
import { assignmentQuestionRendererRegistry } from '../features/teacher/assignment-question-registry';

const PALETTE_COLOR_KEYS = new Set<PaletteColorKey>([
  'slate',
  'blue',
  'violet',
  'amber',
  'rose',
  'emerald',
  'cyan',
  'pink',
  'indigo',
]);

/**
 * Bridge data-shaped `editor.palette_item` contributes into paletteItemRegistry
 * so declarative entries join the LessonPalette grid (search / favorites / groups).
 */
function bridgePaletteItemContribution(entry: Record<string, unknown>, pluginId: string): void {
  const type = String(entry.type ?? entry.id ?? '');
  if (!type) return;
  const labelZh = String(entry.labelZh ?? entry.label ?? entry.title ?? entry.name ?? type);
  const labelEn = String(entry.labelEn ?? labelZh);
  const colorRaw = String(entry.color ?? 'violet');
  const color = (PALETTE_COLOR_KEYS.has(colorRaw as PaletteColorKey) ? colorRaw : 'violet') as PaletteColorKey;
  const group = String(entry.group ?? entry.category ?? 'custom');
  const defaultData =
    entry.defaultData && typeof entry.defaultData === 'object' && !Array.isArray(entry.defaultData)
      ? (entry.defaultData as Record<string, unknown>)
      : {};
  const editFields = Array.isArray(entry.editFields) ? (entry.editFields as EditField[]) : [];
  paletteItemRegistry.register(
    {
      type,
      labelZh,
      labelEn,
      descriptionZh: String(entry.descriptionZh ?? entry.description ?? ''),
      descriptionEn: String(entry.descriptionEn ?? entry.description ?? ''),
      color,
      group,
      defaultData,
      editFields,
      pluginId,
    },
    pluginId,
  );
}

/**
 * Bridge TimelineSegmentConfig-shaped `editor.timeline_segment` contributes
 * (labelZh + labelEn) into the segment-type registry for the type dropdown.
 * Pure UI panel contributions (no bilingual labels) stay ExtensionPoint-only.
 */
function bridgeTimelineSegmentContribution(entry: Record<string, unknown>, pluginId: string): void {
  const labelZh = typeof entry.labelZh === 'string' ? entry.labelZh : '';
  const labelEn = typeof entry.labelEn === 'string' ? entry.labelEn : '';
  if (!labelZh || !labelEn) return;
  const id = String(entry.id ?? '');
  if (!id) return;
  registerCustomSegmentType(
    {
      id,
      labelZh,
      labelEn,
      icon: resolveSegmentIcon(typeof entry.icon === 'string' ? entry.icon : null),
      pluginId,
    },
    pluginId,
  );
}

// ── Module Loader type ───────────────────────────────────────────────────

/**
 * 非视觉贡献（command_palette.item / quick_insert.item / ai.* / classroom.tool
 * 静态桥接等）的占位组件。必须是**直接组件**而非 lazy 工厂：renderer 只对带
 * `__isLazyFactory` 标记的工厂走 React.lazy，未打标的 Promise 工厂会被当作
 * 直接组件渲染并永久悬挂 Suspense（v0.6.0 smart-edu 事故）。
 */
const NullExtensionComponent = () => null;

/**
 * manifest 静态贡献注册 —— classroomTools（legacy）+ contributes 通用桥接。
 *
 * **两条激活路径（activatePlugin / activateRemotePlugin）必须共用本函数**：
 * 此前桥接只存在于 activatePlugin，而生产的远程插件激活走
 * activateRemotePlugin —— 第三方 manifest 的声明式贡献被静默丢弃
 * （v0.6.1 审计 C-1，通用桥接曾整体挂在无生产调用方的路径上）。
 *
 * 两个 id 语义分离：
 * - `pluginId`：store 归属 id（unregisterPluginResources 用同一 id 清理，
 *   远程路径是 DB UUID）；
 * - `manifestId`：commandType 命名空间依据（见
 *   packages/core/plugin-host/plugin-namespace.ts —— 必须用 manifest.id，
 *   而非 DB 生成的 UUID）。
 *
 * F-3：classroom.tool 的 store 注册是**语义桥**，真实消费端
 * LiveClassroomView.tsx 直读 manifest；store 条目服务「可枚举」诉求，
 * 必须带 commandType（否则按 store 渲染的消费端拿到无动作按钮）。
 */
export function registerManifestContributions(
  store: Pick<ReturnType<typeof usePluginHostStore.getState>, 'registerExtensionPoint'>,
  pluginId: string,
  manifestId: string,
  manifest: FrontendPluginManifest,
): void {
  if (manifest.classroomTools) {
    for (const tool of manifest.classroomTools as Array<{
      id: string;
      name: string;
      icon?: string;
      commandType?: string;
    }>) {
      store.registerExtensionPoint('classroom.tool', {
        id: tool.id,
        label: tool.name,
        icon: tool.icon,
        slotProps: tool.commandType ? { commandType: tool.commandType } : undefined,
        component: NullExtensionComponent,
        pluginId,
      });
    }
  }

  const contributes = (manifest as unknown as Record<string, unknown>).contributes as
    | Record<string, unknown>
    | undefined;

  // ── manifest contributes 通用声明式桥接 ──────────────────────────────
  //
  // 数组型 contributes 键一律注册：slotProps 携带完整条目（消费端按各自
  // SlotProps 读取），commandType 按 manifest.id 命名空间前缀化，组件为
  // 占位空组件（贡献本体是数据而非 UI 的槽位，如 command_palette.item）。
  if (contributes) {
    for (const [slotName, entries] of Object.entries(contributes)) {
      if (!Array.isArray(entries)) continue;
      // classroom.tool 与 legacy manifest.classroomTools 二选一，避免双注册
      if (slotName === 'classroom.tool' && manifest.classroomTools) continue;
      for (const rawEntry of entries) {
        if (!rawEntry || typeof rawEntry !== 'object') continue;
        const entry = rawEntry as Record<string, unknown>;
        const entryId = String(entry.id ?? '');
        if (!entryId) continue; // id 是 store 主键，schema 虽强制 min(1) 这里再兜一层
        store.registerExtensionPoint(slotName as AnyExtensionSlot, {
          id: entryId,
          label: String(entry.title ?? entry.label ?? entry.name ?? entryId),
          icon: typeof entry.icon === 'string' ? entry.icon : undefined,
          slotProps: entry.commandType
            ? {
                ...entry,
                // 与 ctx.invokeCommand 同一命名空间规则：manifest 可写裸命令名，
                // 只会命中本插件注册的 handler；跨命名空间引用解析为无效 key。
                commandType: resolvePluginCommandType(String(entry.commandType), manifestId),
              }
            : entry,
          component: NullExtensionComponent,
          pluginId,
        });
        // 数据型备课扩展：声明式 contributes → 运行时 Registry（与命令式 API 对齐）
        if (slotName === 'editor.palette_item') {
          bridgePaletteItemContribution(entry, pluginId);
        } else if (slotName === 'editor.timeline_segment') {
          bridgeTimelineSegmentContribution(entry, pluginId);
        }
      }
    }
  }
}

/**
 * Function type for loading a plugin module from source code.
 *
 * Default implementation uses Blob URL + import() for browser ESM loading.
 * Tests can provide a custom loader to avoid browser-specific APIs.
 */
export type ModuleLoader = (sourceCode: string) => Promise<PluginModule>;

/**
 * Shape of a loaded plugin module (ESM default or named exports).
 */
export interface PluginModule {
  default?: {
    manifest: FrontendPluginManifest;
    activate: (ctx: FrontendPluginContext) => Promise<void>;
    deactivate?: () => Promise<void>;
  };
  manifest?: FrontendPluginManifest;
  activate?: (ctx: FrontendPluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}

/** All frontend service tokens available for Worker plugin RPC. */
const FRONTEND_SERVICE_TOKENS = [
  '@openlearn/frontend:IFrontendAPI',
  '@openlearn/frontend:ISocketService',
  '@openlearn/frontend:IUIService',
  '@openlearn/frontend:IStorageService',
  '@openlearn/frontend:ISemesterGradeService',
];

// ── FrontendPluginHost ───────────────────────────────────────────────────

export class FrontendPluginHost {
  private registry: FrontendServiceRegistry | null = null;
  private initialized = false;
  private sourceCodes = new Map<string, string>();
  private pluginModules = new Map<string, PluginModule>();
  private moduleLoader: ModuleLoader;
  /** BrowserWorkerManager for worker-mode plugin execution. */
  private workerManager: BrowserWorkerManager | null = null;
  private dispatcher: IHostActionDispatcher = defaultHostActionDispatcher;

  /**
   * 每插件的 disposer 登记表（审计 E-5）。
   *
   * 后端有 ResourceTracker 统一回收「注册/dispose」型资源；前端此前只有
   * extensionPoints 一条链 —— 订阅型 API（navigation.subscribeTeacherTab /
   * context.subscribe）把 appStore.subscribe 返回的 unsubscribe **原样**交给
   * 插件：插件不退订就永久泄漏（每次激活再叠一层，zustand subscribe 没有
   * 上限告警，页面会话内只增不减）。
   */
  private disposers = new Map<string, Array<() => void>>();
  /** 远程前端插件的不透明源 iframe。停用时摘掉。 */
  private sandboxFrames = new Map<string, HTMLIFrameElement>();

  /**
   * 登记一个随插件停用/卸载自动执行的清理函数。
   * @returns 供插件**主动**退订的包装 —— 调用即从登记表摘除并执行原 release。
   */
  private trackDisposer(pluginId: string, release: () => void): () => void {
    const list = this.disposers.get(pluginId) ?? [];
    list.push(release);
    this.disposers.set(pluginId, list);
    return () => {
      const current = this.disposers.get(pluginId);
      if (!current) return;
      const idx = current.indexOf(release);
      if (idx >= 0) current.splice(idx, 1);
      release();
    };
  }

  constructor(options?: { moduleLoader?: ModuleLoader }) {
    this.moduleLoader = options?.moduleLoader ?? this.defaultModuleLoader;
  }

  /** Returns the active IHostActionDispatcher. */
  getDispatcher(): IHostActionDispatcher {
    return this.dispatcher;
  }

  /** Sets a custom IHostActionDispatcher instance. */
  setDispatcher(dispatcher: IHostActionDispatcher): void {
    this.dispatcher = dispatcher;
  }

  /**
   * Set the BrowserWorkerManager for worker-mode plugin execution.
   * Mirrors backend PluginHost.setWorkerManager pattern.
   * Must be called before activating any worker-mode plugins.
   */
  setWorkerManager(wm: BrowserWorkerManager): void {
    this.workerManager = wm;
  }

  // ── Initialization ───────────────────────────────────────────────────

  /**
   * Initialize the FrontendPluginHost with the four frontend services and dispatcher.
   *
   * Creates the FrontendServiceRegistry, registers all services
   * with their token constants, and updates the zustand store.
   */
  async initialize(
    frontendApiImpl: IFrontendAPI,
    socketServiceImpl: ISocketService,
    uiServiceImpl: IUIService,
    storageServiceImpl: IStorageService,
    dispatcherImpl?: IHostActionDispatcher,
  ): Promise<void> {
    if (dispatcherImpl) {
      this.dispatcher = dispatcherImpl;
    }
    const registry = new FrontendServiceRegistry();
    await registry.register(FRONTEND_API_TOKEN, frontendApiImpl);
    await registry.register(SOCKET_SERVICE_TOKEN, socketServiceImpl);
    await registry.register(UI_SERVICE_TOKEN, uiServiceImpl);
    await registry.register(STORAGE_SERVICE_TOKEN, storageServiceImpl);
    await registry.register(SEMESTER_GRADE_SERVICE_TOKEN, new SemesterGradeServiceProxy(frontendApiImpl));
    await registry.register(HOST_ACTION_DISPATCHER_TOKEN, this.dispatcher);
    this.registry = registry;
    this.initialized = true;
    usePluginHostStore.getState().initialize(registry);
  }

  /** Returns the FrontendServiceRegistry instance. */
  getRegistry(): FrontendServiceRegistry | null {
    return this.registry;
  }

  /** Returns true if initialize() has been called. */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ── Plugin Lifecycle ─────────────────────────────────────────────────

  /**
   * Install a plugin into local state.
   *
   * Stores the source code internally and adds plugin info to the zustand store
   * with state = INSTALLED. The actual server-side install is done via REST API
   * in the PluginCenter component.
   */
  async installPlugin(manifest: FrontendPluginManifest, sourceCode: string): Promise<void> {
    this.sourceCodes.set(manifest.id, sourceCode);
    usePluginHostStore.getState().addPlugin({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      state: PluginState.INSTALLED,
      executionMode: 'inline',
      icon: manifest.icon,
      // 保留 manifest 声明的 capabilitiesProposed —— 之后若该插件被切到
      // worker 模式激活，Barrier 2 需要它来决定是否放行非 get* 方法。
      capabilitiesProposed: Array.isArray(manifest.capabilitiesProposed) ? [...manifest.capabilitiesProposed] : [],
    });
  }

  /**
   * Activate a previously installed plugin.
   *
   * Flow:
   * 1. Find plugin info in zustand store
   * 2. Validate state transition → ACTIVATING
   * 3. Load plugin module via moduleLoader (Blob URL + import() in production)
   * 4. Validate manifest and activate function
   * 5. Register classroomTools as extension points automatically
   * 6. Build FrontendPluginContext with resolved frontend services
   * 7. Call plugin.activate(ctx) with 5s timeout
   * 8. Success: set state to ACTIVE
   * 9. Error: set state to ERROR, unroll extension points
   */
  /**
   * Activate a remote plugin by fetching and executing its frontend.js script.
   */
  /**
   * manifest 静态贡献注册 —— classroomTools（legacy）+ contributes 通用桥接。
   * 实现已抽为模块级 `registerManifestContributions`（可独立单测），两条
   * 激活路径共用。
   */
  private registerManifestContributions(pluginId: string, manifest: FrontendPluginManifest): void {
    registerManifestContributions(usePluginHostStore.getState(), pluginId, manifest.id, manifest);
  }

  private destroySandboxFrame(pluginId: string): void {
    const frame = this.sandboxFrames.get(pluginId);
    if (!frame) return;
    this.sandboxFrames.delete(pluginId);
    try {
      frame.contentWindow?.postMessage({ channel: PLUGIN_FRAME_CHANNEL, type: 'deactivate', id: pluginId }, '*');
    } catch {
      /* 框架可能已经卸掉 */
    }
    frame.remove();
  }

  private async mountSandboxFrame(
    pluginId: string,
    manifest: FrontendPluginManifest,
    sourceCode: string,
  ): Promise<void> {
    if (typeof document === 'undefined') {
      throw new Error(`Cannot sandbox plugin "${pluginId}" outside a browser document`);
    }
    this.destroySandboxFrame(pluginId);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', PLUGIN_SANDBOX_ATTR);
    frame.setAttribute('src', PLUGIN_FRAME_PATH);
    frame.setAttribute('title', `plugin-sandbox-${pluginId}`);
    frame.style.display = 'none';
    document.body.appendChild(frame);
    this.sandboxFrames.set(pluginId, frame);

    const frontendApi = this.registry ? await this.registry.resolve<IFrontendAPI>(FRONTEND_API_TOKEN) : null;
    const storageService = this.registry ? await this.registry.resolve<IStorageService>(STORAGE_SERVICE_TOKEN) : null;
    const uiService = this.registry ? await this.registry.resolve<IUIService>(UI_SERVICE_TOKEN) : null;
    const caps = Array.isArray(manifest.capabilitiesProposed) ? manifest.capabilitiesProposed : [];

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('Activation timeout (5000ms)'));
      }, 5000);

      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (error) reject(error);
        else resolve();
      };

      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || !isPluginFrameMessage(event.data)) return;
        const data = event.data;
        if (data.type === 'ready') {
          frame.contentWindow?.postMessage(
            { channel: PLUGIN_FRAME_CHANNEL, type: 'load', id: pluginId, pluginId, manifest, source: sourceCode },
            '*',
          );
          return;
        }
        if (data.type === 'activated' && data.id === pluginId) {
          finish();
          return;
        }
        if (data.type === 'activate-error' && data.id === pluginId) {
          finish(new Error(data.error || 'sandbox activation failed'));
          return;
        }
        if (data.type !== 'call' || !data.callId || !data.op) return;
        void this.answerSandboxCall(frame, data.callId, data.op, data.args ?? [], {
          pluginId,
          manifest,
          caps,
          frontendApi,
          storageService,
          uiService,
        }).catch((error: unknown) => {
          frame.contentWindow?.postMessage(
            {
              channel: PLUGIN_FRAME_CHANNEL,
              type: 'reply',
              callId: data.callId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            '*',
          );
        });
      };

      window.addEventListener('message', onMessage);
    });
  }

  private async answerSandboxCall(
    frame: HTMLIFrameElement,
    callId: string,
    op: string,
    args: unknown[],
    ctx: {
      pluginId: string;
      manifest: FrontendPluginManifest;
      caps: string[];
      frontendApi: IFrontendAPI | null;
      storageService: IStorageService | null;
      uiService: IUIService | null;
    },
  ): Promise<void> {
    const reply = (ok: boolean, value?: unknown, error?: string) => {
      frame.contentWindow?.postMessage({ channel: PLUGIN_FRAME_CHANNEL, type: 'reply', callId, ok, value, error }, '*');
    };
    try {
      let value: unknown;
      if (op === 'api.get' || op === 'api.post' || op === 'api.del') {
        const method = op.slice(4);
        const denied = checkMethodPolicy(FRONTEND_API_TOKEN, method, args, ctx.caps);
        if (denied) throw new Error(denied);
        if (!ctx.frontendApi) throw new Error('frontendApi is not available');
        if (method === 'get') value = await ctx.frontendApi.get(String(args[0] ?? ''));
        else if (method === 'post') value = await ctx.frontendApi.post(String(args[0] ?? ''), args[1]);
        else value = await ctx.frontendApi.del(String(args[0] ?? ''));
      } else if (op === 'storage.get' || op === 'storage.set' || op === 'storage.delete') {
        if (!ctx.storageService) throw new Error('storageService is not available');
        const key = `${ctx.manifest.id}:${String(args[0] ?? '')}`;
        if (op === 'storage.get') value = ctx.storageService.get(key);
        else if (op === 'storage.set') {
          const raw = args[1];
          ctx.storageService.set(key, typeof raw === 'string' ? raw : JSON.stringify(raw ?? null));
          value = true;
        } else {
          ctx.storageService.delete(key);
          value = true;
        }
      } else if (op === 'command.invoke') {
        if (!ctx.frontendApi) throw new Error('frontendApi is not available');
        const prefixedType = resolvePluginCommandType(String(args[0] ?? ''), ctx.manifest.id);
        value = await ctx.frontendApi.post('/api/plugins/execute-command', { type: prefixedType, payload: args[1] });
      } else if (op === 'ui.register') {
        const slot = String(args[0] ?? '') as AnyExtensionSlot;
        const config = args[1] && typeof args[1] === 'object' ? (args[1] as ExtensionPointConfig) : ({} as ExtensionPointConfig);
        usePluginHostStore.getState().registerExtensionPoint(slot, { ...config, pluginId: ctx.pluginId });
        value = true;
      } else if (op === 'ui.toast') {
        const message = String(args[0] ?? '');
        ctx.uiService?.showToast(message, message, 'info');
        value = true;
      } else if (op === 'context.get') {
        const state = appStore.getState();
        value = { lessonId: state.selectedLesson, classId: state.liveClassSelectedClassId };
      } else {
        throw new Error(`Unsupported sandbox bridge op "${op}"`);
      }
      reply(true, value);
    } catch (error) {
      reply(false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  async activateRemotePlugin(pluginId: string, manifest: FrontendPluginManifest): Promise<void> {
    const store = usePluginHostStore.getState();

    if (!manifest || typeof manifest.id !== 'string' || !manifest.id) {
      throw new Error(`Invalid remote plugin manifest for "${pluginId}": missing manifest.id`);
    }

    // Idempotency guard: if plugin is already activating or active, skip
    const existingPlugin = store.activePlugins.find((p) => p.id === pluginId);
    if (
      existingPlugin &&
      (existingPlugin.state === PluginState.ACTIVE || existingPlugin.state === PluginState.ACTIVATING)
    ) {
      return;
    }

    store.updatePluginState(pluginId, PluginState.ACTIVATING);

    try {
      const url = `/plugins/${pluginId}/frontend.js`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`Failed to fetch frontend.js for plugin "${pluginId}": HTTP ${res.status}`);
      }
      let sourceCode = await res.text();

      // Transform bare module imports for browser ESM execution
      if ((window as any).HostSharedDeps) {
        sourceCode = transformBareModuleImports(sourceCode);
      }

      // manifest 声明式贡献留在父页面。插件代码只在不透明源 iframe 里执行。
      this.registerManifestContributions(pluginId, manifest);
      await this.mountSandboxFrame(pluginId, manifest, sourceCode);

      this.pluginModules.set(pluginId, {
        manifest,
        activate: async () => undefined,
        deactivate: async () => {
          this.destroySandboxFrame(pluginId);
        },
      });

      // 激活成功即复位熔断 —— v0.6.1 审计 C-2：此前 resetPluginBreaker 是
      // 死代码，blown 标志永驻，重新激活后扩展点被 isPluginBlown 全部跳过
      store.updatePluginState(pluginId, PluginState.ACTIVE);
      resetPluginBreaker(pluginId);
    } catch (err) {
      console.error(`[FrontendPluginHost] Failed to activate remote plugin "${pluginId}":`, err);
      store.updatePluginState(pluginId, PluginState.ERROR);
      this.destroySandboxFrame(pluginId);
      this.unregisterPluginResources(pluginId);
      throw err;
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);
    if (!pluginInfo) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (pluginInfo.executionMode === 'worker') {
      return this.activateWorkerPlugin(pluginId, pluginInfo);
    }

    if (pluginInfo.executionMode !== 'inline') {
      throw new Error(`Unsupported execution mode for activation: ${pluginInfo.executionMode}`);
    }

    store.updatePluginState(pluginId, PluginState.ACTIVATING);

    try {
      const sourceCode = this.sourceCodes.get(pluginId);
      if (!sourceCode) {
        throw new Error(`No source code found for plugin: ${pluginId}`);
      }

      const mod = await this.moduleLoader(sourceCode);
      const plugin = mod.default ?? mod;
      const manifest: FrontendPluginManifest | undefined = plugin.manifest ?? (mod as any).manifest;
      const activate: ((ctx: FrontendPluginContext) => Promise<void>) | undefined =
        plugin.activate ?? (mod as any).activate;
      const deactivate: (() => Promise<void>) | undefined = plugin.deactivate ?? (mod as any).deactivate;

      if (!manifest || typeof activate !== 'function') {
        throw new Error('Invalid plugin: missing manifest or activate function');
      }

      if (manifest.id !== pluginId) {
        throw new Error(`Manifest id mismatch: expected "${pluginId}", got "${manifest.id}"`);
      }

      this.registerManifestContributions(pluginId, manifest);

      const ctx = await this.buildContext(pluginId, manifest);

      // 5s activation timeout
      await Promise.race([
        activate(ctx),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Activation timeout (5000ms)')), 5000)),
      ]);

      this.pluginModules.set(pluginId, {
        manifest,
        activate,
        deactivate: typeof deactivate === 'function' ? deactivate : undefined,
      });

      // 激活成功即复位熔断（同 activateRemotePlugin，v0.6.1 审计 C-2）
      store.updatePluginState(pluginId, PluginState.ACTIVE);
      resetPluginBreaker(pluginId);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      this.unregisterPluginResources(pluginId);
      throw err;
    }
  }

  /**
   * Activate a plugin in worker execution mode via BrowserWorkerManager.
   *
   * Creates a Web Worker, loads the plugin inside it, and sets up
   * the ServiceProxy RPC channel.
   */
  private async activateWorkerPlugin(pluginId: string, pluginInfo: FrontendPluginInfo): Promise<void> {
    if (!this.workerManager) {
      throw new Error(
        `Cannot activate plugin "${pluginId}" in worker mode: BrowserWorkerManager not set. ` +
          'Call setWorkerManager() first.',
      );
    }

    const store = usePluginHostStore.getState();
    const sourceCode = this.sourceCodes.get(pluginId);
    if (!sourceCode) {
      throw new Error(`No source code found for plugin: ${pluginId}`);
    }

    // Build manifest from source or stored data
    // 关键：必须带上插件真实声明的 capabilitiesProposed ——
    // ServiceHost 的 Security Barrier 2 按此判定（为空时只允许 get* 只读方法），
    // BrowserWorkerManager.createWorker 也据此计算 Token 白名单。
    // 缺失时安全回退为空数组（= 最严只读分支）。
    const manifest: FrontendPluginManifest = {
      id: pluginId,
      name: pluginInfo.name,
      version: pluginInfo.version,
      capabilitiesProposed: Array.isArray(pluginInfo.capabilitiesProposed) ? [...pluginInfo.capabilitiesProposed] : [],
    };

    store.updatePluginState(pluginId, PluginState.ACTIVATING);

    try {
      // Resolve ISocketService for event forwarding if available
      let socketService: ISocketService | undefined;
      if (this.registry) {
        try {
          socketService = await this.registry.resolve<ISocketService>('@openlearn/frontend:ISocketService');
        } catch {
          // No socket service registered — event forwarding disabled
        }
      }

      const { serviceHost } = await this.workerManager.createWorker(
        pluginId,
        manifest,
        sourceCode,
        FRONTEND_SERVICE_TOKENS,
        socketService,
      );

      this.pluginModules.set(pluginId, {
        manifest,
        activate: async () => {}, // Already activated via Worker bootstrap
        deactivate: async () => {
          await this.workerManager!.terminateWorker(pluginId);
        },
      });

      store.updatePluginState(pluginId, PluginState.ACTIVE);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      this.unregisterPluginResources(pluginId);
      throw err;
    }
  }

  /**
   * Deactivate an active plugin.
   *
   * Calls plugin.deactivate() if available (5s timeout), then cleans up
   * extension points and zustand state. Always transitions to INACTIVE
   * even on deactivation error.
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);
    if (!pluginInfo || pluginInfo.state !== PluginState.ACTIVE) return;

    store.updatePluginState(pluginId, PluginState.DEACTIVATING);

    try {
      const instance = this.pluginModules.get(pluginId);
      if (instance?.deactivate) {
        await Promise.race([
          instance.deactivate(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Deactivation timeout (5000ms)')), 5000)),
        ]);
      }
    } catch (err) {
      console.error(`[FrontendPluginHost] Deactivation error for "${pluginId}":`, err);
    } finally {
      this.unregisterPluginResources(pluginId);
      this.pluginModules.delete(pluginId);
      store.updatePluginState(pluginId, PluginState.INACTIVE);
    }
  }

  /**
   * Uninstall a plugin (removes it from local state and calls server-side DELETE).
   *
   * Deactivates first if currently active, then removes from zustand store
   * and internal maps.
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);

    if (pluginInfo?.state === PluginState.ACTIVE) {
      await this.deactivatePlugin(pluginId);
    }

    try {
      await fetch(`/api/plugins/${pluginId}`, { method: 'DELETE' });
    } catch (err) {
      console.error(`[FrontendPluginHost] Failed to DELETE plugin "${pluginId}" on server:`, err);
    }

    this.sourceCodes.delete(pluginId);
    this.pluginModules.delete(pluginId);
    this.unregisterPluginResources(pluginId);
    store.removePlugin(pluginId);
  }

  // ── Extension Points ─────────────────────────────────────────────────

  /**
   * Get all registered extension point configs for a given slot.
   */
  getExtensions(slot: AnyExtensionSlot): ExtensionPointConfig[] {
    return usePluginHostStore.getState().getExtensions(slot);
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Clean up all plugin-owned resources on deactivation or activation failure:
   * extension points + whiteboard fullscreen renderers + property editors.
   *
   * v3.5: whiteboard registries are host singletons; plugins reach them only
   * through ctx.ui, so the host must evict their registrations here.
   */
  public unregisterPluginResources(pluginId: string): void {
    // 审计 E-5：先退订该插件登记的全部订阅型资源（appStore subscribe 等）。
    // 放在最前 —— 后续清理可能触发 store 变更，若订阅还在会回调进已半拆的插件。
    const pending = this.disposers.get(pluginId);
    if (pending) {
      const snapshot = pending.splice(0);
      for (const release of snapshot) {
        try {
          release();
        } catch (e) {
          console.error(`[FrontendPluginHost] Error releasing subscription for "${pluginId}":`, e);
        }
      }
      this.disposers.delete(pluginId);
    }
    this.destroySandboxFrame(pluginId);
    usePluginHostStore.getState().unregisterPluginExtensionPoints(pluginId);
    fullscreenRendererRegistry.unregisterPlugin(pluginId);
    propertyEditorRegistry.unregisterPlugin(pluginId);
    coursewareSourceRegistry.unregisterPlugin(pluginId);
    paletteItemRegistry.unregisterPlugin(pluginId);
    unregisterPluginSegmentTypes(pluginId);
    // 注销该插件注册的全部题型渲染器
    assignmentQuestionRendererRegistry.clearOwned(pluginId);
    // v0.6.1 审计 N-6：熔断记录随插件注销清理 —— 模块级 pluginCrashRegistry
    // 此前不随生命周期回收，卸载后残留条目（重新安装后若曾 blown 会被跳过）
    resetPluginBreaker(pluginId);
  }

  /**
   * Default module loader: creates a Blob URL from source code and uses
   * dynamic import() to load the ESM module.
   *
   * T-09-02: try/finally with URL.revokeObjectURL() prevents Blob URL leaks.
   */
  private async defaultModuleLoader(sourceCode: string): Promise<PluginModule> {
    const blob = new Blob([sourceCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ url);
      return mod as PluginModule;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Build a FrontendPluginContext for the given plugin.
   *
   * Resolves all four frontend services from the registry and wraps
   * the extension point registration methods to update the zustand store.
   */
  private async buildContext(pluginId: string, manifest: FrontendPluginManifest): Promise<FrontendPluginContext> {
    if (!this.registry) {
      throw new Error('FrontendPluginHost not initialized');
    }

    const frontendApi = await this.registry.resolve<IFrontendAPI>(FRONTEND_API_TOKEN);
    const socketService = await this.registry.resolve<ISocketService>(SOCKET_SERVICE_TOKEN);
    const uiService = await this.registry.resolve<IUIService>(UI_SERVICE_TOKEN);
    const storageService = await this.registry.resolve<IStorageService>(STORAGE_SERVICE_TOKEN);

    const scopedDispatcher: IHostActionDispatcher = (this.dispatcher as any).createScopedDispatcher
      ? (this.dispatcher as any).createScopedDispatcher(pluginId)
      : {
          dispatch: (action: any, options: any) =>
            this.dispatcher.dispatch(action, { sourcePluginId: pluginId, ...options }),
          registerHandler: (t: any, h: any) => this.dispatcher.registerHandler(t, h),
          subscribe: (t: any, l: any) => this.dispatcher.subscribe(t, l),
          use: (m: any) => this.dispatcher.use(m),
        };

    return {
      services: {
        frontendApi,
        socketService,
        uiService,
        storageService,
      },
      pluginId,
      manifest,
      dispatcher: scopedDispatcher,
      ui: {
        registerExtensionPoint: (slot: AnyExtensionSlot, config: ExtensionPointConfig) => {
          usePluginHostStore.getState().registerExtensionPoint(slot, {
            ...config,
            pluginId,
          });
        },
        // 归属守卫：注入调用方 pluginId，插件只能注销自己的扩展点（v0.6.1 审计 R-2）
        unregisterExtensionPoint: (slot: AnyExtensionSlot, id: string) => {
          usePluginHostStore.getState().unregisterExtensionPoint(slot, id, pluginId);
        },
        registerFullscreenRenderer: (type, renderer) => {
          fullscreenRendererRegistry.register(type, renderer, pluginId);
        },
        unregisterFullscreenRenderer: (type) => {
          fullscreenRendererRegistry.unregister(type, pluginId);
        },
        registerPropertyEditor: (type, editor) => {
          propertyEditorRegistry.register(type, editor, pluginId);
        },
        unregisterPropertyEditor: (type) => {
          propertyEditorRegistry.unregister(type, pluginId);
        },
        registerCoursewareSource: (loader) => {
          coursewareSourceRegistry.register(loader, pluginId);
        },
        unregisterCoursewareSource: (id) => {
          coursewareSourceRegistry.unregister(id, pluginId);
        },
        registerPaletteItem: (item) => {
          paletteItemRegistry.register(item, pluginId);
        },
        unregisterPaletteItem: (type) => {
          paletteItemRegistry.unregister(type, pluginId);
        },
        registerSegmentType: (type: SegmentTypeMeta) => {
          registerCustomSegmentType(type, pluginId);
        },
        unregisterSegmentType: (id: string) => {
          unregisterCustomSegmentType(id, pluginId);
        },
        registerAssignmentQuestionRenderer: (config) => {
          assignmentQuestionRendererRegistry.register(config, pluginId);
        },
        unregisterAssignmentQuestionRenderer: (quizType) => {
          assignmentQuestionRendererRegistry.unregister(quizType, pluginId);
        },
      },
      navigation: {
        getTeacherTab: () => appStore.getState().teacherTab,
        setTeacherTab: (tab: string) => appStore.getState().setTeacherTab(tab),
        setSelectedLesson: (lessonId: string | null) => appStore.getState().setSelectedLesson(lessonId),
        subscribeTeacherTab: (callback: (tab: string) => void) => {
          let prevTab = appStore.getState().teacherTab;
          // E-5：release 登记到宿主，插件停用/卸载时自动退订；
          // 返回给插件的是包装函数（主动退订也会从登记表摘除，不会双重执行）。
          return this.trackDisposer(
            pluginId,
            appStore.subscribe((state) => {
              const nextTab = state.teacherTab;
              if (nextTab !== prevTab) {
                prevTab = nextTab;
                callback(nextTab);
              }
            }),
          );
        },
      },
      context: {
        get: () => {
          const s = appStore.getState();
          return { lessonId: s.selectedLesson, classId: s.liveClassSelectedClassId };
        },
        subscribe: (callback: (ctx: { lessonId: string | null; classId: string | null }) => void) => {
          const init = appStore.getState();
          let snapshot = { lessonId: init.selectedLesson, classId: init.liveClassSelectedClassId };
          // E-5：同上 —— appStore 订阅随插件生命周期自动回收。
          return this.trackDisposer(
            pluginId,
            appStore.subscribe((s) => {
              const next = { lessonId: s.selectedLesson, classId: s.liveClassSelectedClassId };
              if (next.lessonId !== snapshot.lessonId || next.classId !== snapshot.classId) {
                snapshot = next;
                callback(next);
              }
            }),
          );
        },
      },
      invokeCommand: async <T = any>(type: string, payload?: any): Promise<T> => {
        if (!frontendApi)
          throw new Error(
            `Plugin "${pluginId}" cannot invoke command: frontendApi is not available. Has FrontendPluginHost initialized?`,
          );
        // Use the same namespace rule as the worker runtime so the main
        // CommandBus can find the handler that the worker's
        // registerHandler call stored under the prefixed key.
        // See packages/core/plugin-host/plugin-namespace.ts for the contract.
        const prefixedType = resolvePluginCommandType(type, manifest.id);
        const res = await frontendApi.post<T>('/api/plugins/execute-command', {
          type: prefixedType,
          payload,
        });
        if (res.success && res.result !== undefined) return res.result;
        throw new Error(res.error || 'Command execution failed');
      },
      // Backward compatibility shims
      registerPanel: (config: any) => {
        const slot = config.slot || 'teacher.dashboard.widget';
        usePluginHostStore.getState().registerExtensionPoint(slot, {
          ...config,
          pluginId,
        });
      },
      registerMenu: (config: any) => {
        const slot = config.slot || 'teacher.panel';
        usePluginHostStore.getState().registerExtensionPoint(slot, {
          ...config,
          pluginId,
        });
      },
      registerToolbarButton: (config: any) => {
        usePluginHostStore.getState().registerExtensionPoint('classroom.tool', {
          ...config,
          pluginId,
        });
      },
    };
  }
}

class SemesterGradeServiceProxy implements ISemesterGradeService {
  private frontendApi: IFrontendAPI;
  constructor(frontendApi: IFrontendAPI) {
    this.frontendApi = frontendApi;
  }
  async saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void> {
    const res = await this.frontendApi.post('/api/grade-sync', { lessonId, studentId, grade });
    if (!res.success) {
      throw new Error(res.error || 'Failed to sync semester grade');
    }
  }
}

// ── Bare Module Import Transformer ──────────────────────────────────────────

/**
 * Map of bare module specifiers to their global host shared dependencies expression.
 *
 * **与后端 `PLUGIN_SHARED_MODULES` 的有意差异（E-3）**：本 map 严格等于
 * `src/main.tsx` 里 `window.HostSharedDeps` 实际注入的模块（react / react-dom /
 * react-dom-client / jsx-runtime / recharts / lucide-react）。后端白名单里的
 * jspdf / exceljs / uuid / react-markdown 是**服务端**能力，宿主不会把它们
 * 注入浏览器 —— 插件作者在前端代码里 import 这些模块会拿到「未注册共享模块」
 * 错误。请不要为了「两边对齐」把后端模块加进来：那只会把错误从加载期推迟
 * 到调用期。新增前端共享依赖时必须同时注入 HostSharedDeps 并在此登记。
 */
export const SHARED_MODULE_MAP: Record<string, string> = {
  react: 'window.HostSharedDeps.React',
  'react-dom': 'window.HostSharedDeps.ReactDOM',
  'react-dom/client': '(window.HostSharedDeps.ReactDOMClient || window.HostSharedDeps.ReactDOM)',
  'react/jsx-runtime': 'window.HostSharedDeps.jsxRuntime',
  recharts: 'window.HostSharedDeps.Recharts',
  'lucide-react': 'window.HostSharedDeps.LucideReact',
};

/**
 * Transforms named import specifiers (e.g. `useState, useEffect, useMemo as useMemo2`)
 * into destructuring syntax (e.g. `useState, useEffect, useMemo: useMemo2`).
 *
 * @param namedClause The content inside the import `{ ... }` braces.
 * @returns Transformed destructuring properties string.
 */
export function transformNamedImports(namedClause: string): string {
  return namedClause
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, ''))
    .map((s) => s.replace(/\s+as\s+/, ': '))
    .join(', ');
}

/**
 * Transforms an ESM import clause into equivalent `const ... = window.HostSharedDeps...` statements.
 *
 * @param clause The import clause before `from`.
 * @param depExpr The expression evaluating to the dependency namespace.
 * @returns Transformed JS statement(s), or null if clause is not recognized.
 */
export function transformImportClause(clause: string, depExpr: string): string | null {
  clause = clause
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();
  const statements: string[] = [];

  // Form 1: Default + Namespace: `Default, * as All`
  const defAndNs = clause.match(/^([a-zA-Z_$][\w$]*)\s*,\s*\*\s*as\s+([a-zA-Z_$][\w$]*)$/);
  if (defAndNs) {
    statements.push(`const ${defAndNs[1]} = ${depExpr}?.default ?? ${depExpr};`);
    statements.push(`const ${defAndNs[2]} = ${depExpr};`);
    return statements.join(' ');
  }

  // Form 2: Default + Named: `Default, { a, b as c }`
  const defAndNamed = clause.match(/^([a-zA-Z_$][\w$]*)\s*,\s*\{([\s\S]*)\}$/);
  if (defAndNamed) {
    const defaultName = defAndNamed[1];
    const namedBody = transformNamedImports(defAndNamed[2]);
    statements.push(`const ${defaultName} = ${depExpr}?.default ?? ${depExpr};`);
    if (namedBody) {
      statements.push(`const { ${namedBody} } = ${depExpr};`);
    }
    return statements.join(' ');
  }

  // Form 3: Namespace only: `* as All`
  const nsOnly = clause.match(/^\*\s*as\s+([a-zA-Z_$][\w$]*)$/);
  if (nsOnly) {
    return `const ${nsOnly[1]} = ${depExpr};`;
  }

  // Form 4: Named only: `{ a, b as c }`
  const namedOnly = clause.match(/^\{([\s\S]*)\}$/);
  if (namedOnly) {
    const namedBody = transformNamedImports(namedOnly[1]);
    return `const { ${namedBody} } = ${depExpr};`;
  }

  // Form 5: Default only: `Default`
  const defOnly = clause.match(/^([a-zA-Z_$][\w$]*)$/);
  if (defOnly) {
    return `const ${defOnly[1]} = ${depExpr}?.default ?? ${depExpr};`;
  }

  return null;
}

/**
 * Transforms bare module imports in browser ESM source code into references to
 * `window.HostSharedDeps`.
 *
 * Supports:
 * - Default imports (`import React from 'react'`)
 * - Named imports (`import { useState, useEffect } from 'react'`)
 * - Renamed named imports (`import { useState as useState2 } from 'react'`)
 * - Combined default + named (`import React, { useState } from 'react'`)
 * - Namespace imports (`import * as React from 'react'`)
 * - Side-effect imports (`import 'react'`)
 *
 * @param sourceCode The original ESM JavaScript source code.
 * @returns Transformed JavaScript source code.
 */
export function transformBareModuleImports(sourceCode: string): string {
  // 1. Replace side-effect imports: `import "react";`
  let transformed = sourceCode.replace(/import\s+['"]([^'"]+)['"];?/g, (match, specifier) => {
    if (SHARED_MODULE_MAP[specifier]) {
      return `/* [HostSharedDeps] ${match} */`;
    }
    return match;
  });

  // 2. Replace import clauses: `import ... from "specifier";`
  transformed = transformed.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (match, clause, specifier) => {
    const depExpr = SHARED_MODULE_MAP[specifier];
    if (!depExpr) return match;
    const replacement = transformImportClause(clause, depExpr);
    return replacement ? replacement : match;
  });

  return transformed;
}
