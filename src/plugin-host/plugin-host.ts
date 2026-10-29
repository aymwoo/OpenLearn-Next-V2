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
import { registerPluginLocales, unregisterPluginLocales, t, getGlobalLanguage } from '../i18n';
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
import { assessmentQuestionTypeUiRegistry } from '../features/assessment/question-type-ui-registry';

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
export const NullExtensionComponent = () => null;

/**
 * 把激活异常归一成一句可展示给用户的短描述（v0.7.0）。
 *
 * 错误态要出现在插件面板里，因此必须是**面向用户**的短句，不能把整段堆栈
 * 糊到 UI 上；但也不能只剩一句「加载失败」—— 用户需要知道是拉不到前端包
 * 还是包跑不起来。
 */
export function describeActivationError(err: unknown): string {
  if (err instanceof Error && err.message) {
    // 常见失败形态归一化，避免把 HTTP 状态码/超时等内部措辞直接抛给用户
    const msg = err.message;
    if (/Failed to fetch frontend\.js/i.test(msg)) return '前端资源加载失败（HTTP 错误）';
    if (/Activation timeout/i.test(msg)) return '插件激活超时（5 秒）';
    if (/Cannot read properties of undefined/i.test(msg)) {
      return '插件依赖缺失：宿主未提供共享运行时（React 等）';
    }
    if (/Invalid plugin|missing manifest|activate function/i.test(msg)) return '插件入口格式不合法';
    return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
  }
  return '未知错误';
}

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
        origin: 'manifest',
      });
    }
  }

  const contributes = (manifest as unknown as Record<string, unknown>).contributes as
    Record<string, unknown> | undefined;

  // 注册插件多语言词条包 (Issue #148)
  if (contributes && (contributes as any).locales && typeof (contributes as any).locales === 'object') {
    registerPluginLocales(pluginId, (contributes as any).locales);
  }

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
        const entryId = String(entry.id ?? entry.type ?? '');
        if (!entryId) continue; // id 是 store 主键，schema 虽强制 min(1) 这里再兜一层
        store.registerExtensionPoint(slotName as AnyExtensionSlot, {
          id: entryId,
          label: String(entry.title ?? entry.label ?? entry.name ?? entryId),
          icon: typeof entry.icon === 'string' ? entry.icon : undefined,
          view: typeof entry.view === 'string' ? entry.view : undefined,
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
          origin: 'manifest',
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
  /**
   * pluginId → manifest 缓存（v0.7.0）。
   *
   * 激活失败后用户点「重试」需要重新拿到 manifest 才能再次激活（远程路径
   * `activateRemotePlugin` 以 manifest 为入参）。manifest 本身来自服务端，
   * 前端不重复拉取 —— 这里留存最后一次成功读到（或读到但激活失败）的副本。
   */
  private manifests = new Map<string, FrontendPluginManifest>();
  /** 远程前端插件的不透明源 iframe。停用时摘掉。 */
  private sandboxFrames = new Map<string, HTMLIFrameElement>();
  /** 远程前端沙箱常驻消息监听器与生命周期清理回调。 */
  private sandboxCleanups = new Map<string, () => void>();

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
    const cleanup = this.sandboxCleanups.get(pluginId);
    if (cleanup) {
      this.sandboxCleanups.delete(pluginId);
      cleanup();
    }
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

    // I3: 异常导航/重定向监控。首次 load 为正规载入，二次 load 视为试图重定向外逃，即刻销毁
    let loadCount = 0;
    const onLoad = () => {
      loadCount++;
      if (loadCount > 1) {
        console.error(`[PluginSandbox] Plugin "${pluginId}" attempted unauthorized navigation. Destroying sandbox.`);
        this.destroySandboxFrame(pluginId);
        this.unregisterPluginResources(pluginId);
        this.pluginModules.delete(pluginId);
        usePluginHostStore.getState().updatePluginState(pluginId, PluginState.ERROR);
      }
    };
    frame.addEventListener('load', onLoad);

    document.body.appendChild(frame);
    this.sandboxFrames.set(pluginId, frame);

    const frontendApi = this.registry ? await this.registry.resolve<IFrontendAPI>(FRONTEND_API_TOKEN) : null;
    const storageService = this.registry ? await this.registry.resolve<IStorageService>(STORAGE_SERVICE_TOKEN) : null;
    const uiService = this.registry ? await this.registry.resolve<IUIService>(UI_SERVICE_TOKEN) : null;
    const caps = Array.isArray(manifest.capabilitiesProposed) ? manifest.capabilitiesProposed : [];

    // I1: 注册长驻消息处理器（与激活 Promise 解耦）
    const onPersistentMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !isPluginFrameMessage(event.data)) return;
      const data = event.data;
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
    window.addEventListener('message', onPersistentMessage);

    this.sandboxCleanups.set(pluginId, () => {
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onPersistentMessage);
    });

    // 激活期单次等待：仅负责 ready/load 与 activated/activate-error
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const timer = window.setTimeout(() => {
        if (resolved) return;
        window.removeEventListener('message', onActivationMessage);
        reject(new Error('Activation timeout (5000ms)'));
      }, 5000);

      const finish = (error?: Error) => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timer);
        window.removeEventListener('message', onActivationMessage);
        if (error) reject(error);
        else resolve();
      };

      const onActivationMessage = (event: MessageEvent) => {
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
      };

      window.addEventListener('message', onActivationMessage);
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
        const commandType = String(args[0] ?? '');
        value = await ctx.frontendApi.post(`/api/plugins/${encodeURIComponent(ctx.pluginId)}/sandbox-command`, {
          type: commandType,
          payload: args[1],
        });
      } else if (op === 'ui.register') {
        const slot = String(args[0] ?? '') as AnyExtensionSlot;
        const config =
          args[1] && typeof args[1] === 'object' ? (args[1] as ExtensionPointConfig) : ({} as ExtensionPointConfig);
        usePluginHostStore.getState().registerExtensionPoint(slot, {
          ...config,
          pluginId: ctx.pluginId,
          origin: 'runtime',
        });
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

  async activateRemotePlugin(
    pluginId: string,
    manifest: FrontendPluginManifest,
    options?: { hasFrontend?: boolean },
  ): Promise<void> {
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

    // 缓存 manifest —— 激活失败后用户点「重试」需要它再走一次远程激活
    // （必须在 try 之前缓存：失败的 manifest 同样要留给重试路径用）
    this.manifests.set(pluginId, manifest);

    // manifest 声明式贡献留在父页面（提前注册：同 (slot, id) 幂等覆盖，且不依赖前端 bundle 结果）。
    // 即使前端 bundle 404 或无前端产物，声明式贡献也能正常展示，并在 catch 块中被 preserveManifestContributions 正确保留。
    this.registerManifestContributions(pluginId, manifest);

    // 若无前端产物（如纯 view 沙箱插件或纯声明式插件），无需请求 frontend.js
    const hasFrontend = options?.hasFrontend ?? existingPlugin?.hasFrontend ?? true;
    if (!hasFrontend) {
      this.pluginModules.set(pluginId, {
        manifest,
        activate: async () => undefined,
        deactivate: async () => undefined,
      });
      store.updatePluginState(pluginId, PluginState.ACTIVE);
      resetPluginBreaker(pluginId);
      store.clearPluginError(pluginId);
      return;
    }

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

      // 实际执行模式只看**服务端求值后的** store 值（来源：GET /api/plugins 的
      // execution_mode 列，由 resolvePluginExecutionMode 计算）。
      //
      // 不要把 `manifest.executionMode` 加回这个判断：manifest JSON 是插件
      // 作者原文落库（install.ts），服务端只把改写结果写进 execution_mode 列 ——
      // 拿 manifest 自述做判断，等于让任意第三方包靠写一行
      // `"executionMode": "inline"` 就把自己的 frontend.js 放进宿主页面
      // 同源执行，完整绕过 iframe 沙箱与 CSP 边界。
      const isInline = existingPlugin?.executionMode === 'inline';
      if (isInline) {
        const blob = new Blob([sourceCode], { type: 'text/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const mod = await import(/* @vite-ignore */ blobUrl);
          const plugin = mod.default ?? mod;
          const activate = plugin.activate ?? mod.activate;
          const deactivate = plugin.deactivate ?? mod.deactivate;
          if (typeof activate === 'function') {
            const ctx = await this.buildContext(pluginId, manifest);
            await Promise.race([
              activate(ctx),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Activation timeout (5000ms)')), 5000),
              ),
            ]);
            this.pluginModules.set(pluginId, {
              manifest,
              activate,
              deactivate: typeof deactivate === 'function' ? deactivate : undefined,
            });
          }
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        await this.mountSandboxFrame(pluginId, manifest, sourceCode);

        this.pluginModules.set(pluginId, {
          manifest,
          activate: async () => undefined,
          deactivate: async () => {
            this.destroySandboxFrame(pluginId);
          },
        });
      }

      // 激活成功即复位熔断 —— v0.6.1 审计 C-2：此前 resetPluginBreaker 是
      // 死代码，blown 标志永驻，重新激活后扩展点被 isPluginBlown 全部跳过
      store.updatePluginState(pluginId, PluginState.ACTIVE);
      resetPluginBreaker(pluginId);
      store.clearPluginError(pluginId);
    } catch (err) {
      console.error(`[FrontendPluginHost] Failed to activate remote plugin "${pluginId}":`, err);
      store.updatePluginState(pluginId, PluginState.ERROR);
      this.destroySandboxFrame(pluginId);
      // v0.7.0 熔断越权修复：**保留** manifest 声明式贡献 —— 它们由服务端
      // 插件宿主执行，与前端 bundle 无关。此前整包摘除导致 Tab「闪现后消失」。
      // 改为记录显式错误 → 渲染层显示「加载失败 + 重试」。
      this.unregisterPluginResources(pluginId, { preserveManifestContributions: true });
      store.setPluginError(pluginId, describeActivationError(err));
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
      store.clearPluginError(pluginId);
      this.manifests.set(pluginId, manifest);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      // v0.7.0 熔断越权修复：保留 manifest 声明式贡献（服务端执行，与前端无关）
      this.unregisterPluginResources(pluginId, { preserveManifestContributions: true });
      store.setPluginError(pluginId, describeActivationError(err));
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
      store.clearPluginError(pluginId);
    } catch (err) {
      store.updatePluginState(pluginId, PluginState.ERROR);
      // v0.7.0 熔断越权修复：保留 manifest 声明式贡献（服务端执行，与前端无关）
      this.unregisterPluginResources(pluginId, { preserveManifestContributions: true });
      store.setPluginError(pluginId, describeActivationError(err));
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
   * 熔断降级 —— 停掉插件的**运行时代码**，但保留 manifest 声明式贡献。
   *
   * 与 `deactivatePlugin` 的区别是**语义**上的：deactivate 是「用户主动停用
   * 插件」，插件确实不再参与平台，声明式贡献也该一并消失；suspend 是「插件
   * 前端反复崩溃，平台把它降级」，插件的服务端部分与声明式贡献仍然有效，
   * 只是前端不再渲染。因此：
   * - 只摘除**运行时**注册的扩展点，manifest 声明式贡献保留（Tab 仍可见）；
   * - 保留熔断记录，让「已熔断」状态持续存在（否则下次崩溃从 0 重新计数，
   *   熔断阈值形同虚设）；
   * - 记录显式错误 → 渲染层显示「加载失败 + 重试」，而不是静默留白。
   */
  async suspendPlugin(pluginId: string): Promise<void> {
    const store = usePluginHostStore.getState();

    try {
      const instance = this.pluginModules.get(pluginId);
      if (instance?.deactivate) {
        await Promise.race([
          instance.deactivate(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Deactivation timeout (5000ms)')), 5000)),
        ]);
      }
    } catch (err) {
      console.error(`[FrontendPluginHost] Suspend error for "${pluginId}":`, err);
    } finally {
      this.unregisterPluginResources(pluginId, {
        preserveManifestContributions: true,
        keepBreakerState: true,
      });
      this.pluginModules.delete(pluginId);
      store.updatePluginState(pluginId, PluginState.ERROR);
      // 取最新快照（而不是函数入口的 store）—— deactivate 期间可能已有新的错误记录
      if (!usePluginHostStore.getState().pluginErrors.get(pluginId)) {
        store.setPluginError(pluginId, '插件前端连续崩溃，已自动降级');
      }
    }
  }

  /**
   * 重试激活失败的插件（错误态面板上的「重试」按钮）。
   *
   * 走与首次激活同源的路径：远程插件用缓存的 manifest 重走 iframe 沙箱，
   * 内联/worker 插件走各自的既有激活路径。成功后清除错误态，失败则覆盖为
   * 新的错误描述（用户能看出「重试也失败了」）。
   */
  async retryPlugin(pluginId: string): Promise<boolean> {
    const store = usePluginHostStore.getState();
    const pluginInfo = store.activePlugins.find((p) => p.id === pluginId);
    if (!pluginInfo) return false;

    // 先摘掉旧的运行时扩展点，避免重试过程中新旧实现并存
    store.unregisterPluginRuntimeExtensionPoints(pluginId);
    store.clearPluginError(pluginId);

    try {
      const manifest = this.manifests.get(pluginId);
      // 顺序有讲究：远程插件（inline 与子进程沙箱都一样）没有本地 sourceCode ——
      // 只有本地 installPlugin() 才会填 this.sourceCodes。所以必须先看 manifest
      // 缓存，inline 远程插件才不会掉进 activatePlugin() 抛的
      // "No source code found for plugin"（此前 retry 对 inline 远程插件 100% 失败）。
      // worker 仍优先走 activatePlugin()，保持原有 Worker 激活语义不变。
      if (pluginInfo.executionMode === 'worker') {
        await this.activatePlugin(pluginId);
      } else if (manifest) {
        await this.activateRemotePlugin(pluginId, manifest, { hasFrontend: pluginInfo.hasFrontend });
      } else if (pluginInfo.executionMode === 'inline') {
        await this.activatePlugin(pluginId);
      } else {
        throw new Error(`无法重试插件 "${pluginId}"：缺少 manifest 缓存`);
      }
      return true;
    } catch (err) {
      console.error(`[FrontendPluginHost] Retry failed for plugin "${pluginId}":`, err);
      store.setPluginError(pluginId, describeActivationError(err));
      return false;
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
    this.manifests.delete(pluginId);
    this.unregisterPluginResources(pluginId);
    store.removePlugin(pluginId);
    store.clearPluginError(pluginId);
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
   *
   * v0.7.0 熔断越权修复：`opts.preserveManifestContributions` 为真时**保留**
   * manifest 声明式贡献（只摘除运行时注册的扩展点）。插件前端起不来不代表
   * 声明式贡献不可用 —— 那些贡献的执行后端在服务端插件宿主，与前端 bundle
   * 无关。整包摘除会让用户看到 Tab「闪现后消失」（v0.6.1 审计 C-2 的遗留越权）。
   *
   * `opts.keepBreakerState` 为真时不清除熔断记录 —— 熔断降级路径要让「已熔断」
   * 状态持续存在，否则下一次崩溃会从 0 重新计数，熔断阈值形同虚设。
   */
  public unregisterPluginResources(
    pluginId: string,
    opts?: { preserveManifestContributions?: boolean; keepBreakerState?: boolean },
  ): void {
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
    if (opts?.preserveManifestContributions) {
      usePluginHostStore.getState().unregisterPluginRuntimeExtensionPoints(pluginId);
    } else {
      usePluginHostStore.getState().unregisterPluginExtensionPoints(pluginId);
    }
    fullscreenRendererRegistry.unregisterPlugin(pluginId);
    propertyEditorRegistry.unregisterPlugin(pluginId);
    coursewareSourceRegistry.unregisterPlugin(pluginId);
    paletteItemRegistry.unregisterPlugin(pluginId);
    unregisterPluginSegmentTypes(pluginId);
    // 注销该插件注册的全部题型渲染器
    assignmentQuestionRendererRegistry.clearOwned(pluginId);
    assessmentQuestionTypeUiRegistry.clearOwned(pluginId);
    unregisterPluginLocales(pluginId);
    // v0.6.1 审计 N-6：熔断记录随插件注销清理 —— 模块级 pluginCrashRegistry
    // 此前不随生命周期回收，卸载后残留条目（重新安装后若曾 blown 会被跳过）
    if (!opts?.keepBreakerState) {
      resetPluginBreaker(pluginId);
    }
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
            origin: 'runtime',
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
        /** 测评题型出题编辑器注册（Issue #121）：与后端 IAssessmentGraderRegistry 共用 type */
        registerAssessmentQuestionType: (config) => {
          assessmentQuestionTypeUiRegistry.register(config, pluginId);
        },
        unregisterAssessmentQuestionType: (type) => {
          assessmentQuestionTypeUiRegistry.unregister(type, pluginId);
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
      i18n: {
        t: (key: string, defaultValueOrParams?: string | Record<string, any>, maybeParams?: Record<string, any>) => {
          const namespacedKey = key.includes(':') ? key : `${pluginId}:${key}`;
          return t(namespacedKey, defaultValueOrParams, maybeParams);
        },
        getLanguage: () => getGlobalLanguage(),
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
          origin: 'runtime',
        });
      },
      registerMenu: (config: any) => {
        const slot = config.slot || 'teacher.panel';
        usePluginHostStore.getState().registerExtensionPoint(slot, {
          ...config,
          pluginId,
          origin: 'runtime',
        });
      },
      registerToolbarButton: (config: any) => {
        usePluginHostStore.getState().registerExtensionPoint('classroom.tool', {
          ...config,
          pluginId,
          origin: 'runtime',
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
