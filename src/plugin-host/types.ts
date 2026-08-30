/**
 * Frontend PluginHost type definitions.
 *
 * Mirrors backend PluginHost types (PluginState, Disposable) and adds
 * frontend-specific types (ExtensionSlot, FrontendPluginContext, etc.).
 *
 * D-03: PluginState enum — 7 values matching backend lifecycle state machine
 * D-04: ExtensionSlot — 5 slot types for UI extension point registration
 * D-05: ExtensionPointConfig — React.lazy component registration config
 */

import type React from 'react';

// ── Token name constants (frontend namespace) ────────────────────────────

export const FRONTEND_API_TOKEN = '@openlearn/frontend:IFrontendAPI';
export const SOCKET_SERVICE_TOKEN = '@openlearn/frontend:ISocketService';
export const UI_SERVICE_TOKEN = '@openlearn/frontend:IUIService';
export const STORAGE_SERVICE_TOKEN = '@openlearn/frontend:IStorageService';
export const SEMESTER_GRADE_SERVICE_TOKEN = '@openlearn/frontend:ISemesterGradeService';

// ── Core types ───────────────────────────────────────────────────────────

export enum PluginState {
  INSTALLED = 'installed',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  INACTIVE = 'inactive',
  ERROR = 'error',
  UNINSTALLED = 'uninstalled',
}

export interface Disposable {
  dispose(): void;
}

// ── Manifest & Plugin Info ───────────────────────────────────────────────

export interface FrontendPluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  capabilitiesProposed?: string[];
  classroomTools?: Array<{
    id: string;
    name: string;
    icon: string;
    commandType: string;
    payload?: any;
  }>;
}

export interface FrontendPluginInfo {
  id: string;
  name: string;
  version: string;
  state: PluginState;
  executionMode: 'inline' | 'worker' | 'legacy';
}

// ── Extension Points ─────────────────────────────────────────────────────

export type ExtensionSlot =
  | 'teacher.tab'
  | 'student.view'
  | 'classroom.tool'
  | 'teacher.dashboard.widget'
  | 'student.lesson.tool'
  | 'teacher.panel'         // v5.1: 教师独立全宽管理面板
  | 'student.fullscreen'    // v5.1: 学生全屏视图（考试模式）
  | 'global.setting'        // v5.1: 全局设置页扩展
  | 'nav.user_menu';        // v5.2: 顶部 Header 用户菜单扩展

/**
 * Anchor slot — 锚点扩展槽（v0.2.6）。
 *
 * 与固定槽位不同，锚点槽位由「宿主在某个原生按钮/元素前后各渲染一次」实现：
 *   <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:rollcall" placement="before" />
 *   <button ...原生按钮... />
 *   <ExtensionPointRenderer slot="anchor:whiteboard-toolbar:rollcall" placement="after" />
 *
 * 插件通过 `placement: 'before' | 'after'` 声明按钮插在锚点的哪一侧。
 * 命名约定：`anchor:{页面或区域}:{锚点 id}`，锚点 id 由宿主定义并对外公布。
 */
export type AnchorSlot = `anchor:${string}`;

/** 所有可注册的槽位：固定槽位 + 锚点槽位 + 任意字符串（向前兼容）。 */
export type AnyExtensionSlot = ExtensionSlot | AnchorSlot | (string & {});

export interface ExtensionPointConfig {
  id: string;
  label: string;
  icon?: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  position?: number;
  pluginId: string;
  /** v5.2: 导航分组 (teaching | management | analytics | extension) */
  group?: 'teaching' | 'management' | 'analytics' | 'extension' | string;
  /** v5.2: 动态徽标 (数字或小文本) */
  badge?: number | string;
  /** v5.2: 显隐角色防护 */
  rolesAllowed?: ('admin' | 'teacher' | 'student')[];
  /** v5.1: 可选子路由 */
  route?: string;
  /** v5.1: 额外 props */
  slotProps?: Record<string, any>;
  /** v0.2.6: 锚点槽位专用 —— 相对宿主锚点按钮的位置（默认 'after'） */
  placement?: 'before' | 'after';
  /** v3: 可选自定义渲染函数（返回 React 节点，用于非组件式扩展点） */
  render?: (props?: Record<string, any>) => React.ReactNode;
}

// ── Frontend Service Interfaces ──────────────────────────────────────────

export interface IFrontendAPI {
  get<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T = any>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T = any>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

export interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void;
}

export interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning' | 'error'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
  /** v5.1: 触发浏览器文件下载 */
  downloadFile(data: Blob | string, filename: string, mimeType?: string): void;
}

export interface IStorageService {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}

export interface ISemesterGradeService {
  saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
}

// ── Frontend Plugin Context ──────────────────────────────────────────────

export interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI;
    socketService: ISocketService;
    uiService: IUIService;
    storageService: IStorageService;
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: {
    registerExtensionPoint(slot: AnyExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: AnyExtensionSlot, id: string): void;
  };
  /** 调用后端已注册的 Command Handler，自动添加插件命名空间前缀 */
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>;
  /** 页面导航与 Tab 订阅控制 */
  navigation?: {
    getTeacherTab(): string;
    setTeacherTab(tab: string): void;
    subscribeTeacherTab(callback: (tab: string) => void): () => void;
  };
  
  // Backward compatibility shims
  registerPanel?(config: any): void;
  registerMenu?(config: any): void;
  registerToolbarButton?(config: any): void;
}
