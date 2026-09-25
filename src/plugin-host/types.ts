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
import type { FullscreenRenderer } from '../features/whiteboard/fullscreen/FullscreenRendererRegistry';
import type { PropertyEditorComponent } from '../features/whiteboard/properties/PropertyEditorRegistry';
import type { CoursewareSourceLoader } from '../features/whiteboard/courseware/courseware-source-registry';
import type { PaletteItemConfig } from '../features/teacher/lesson-editor/paletteConfig';

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
  | 'teacher.panel' // v5.1: 教师独立全宽管理面板
  | 'student.fullscreen' // v5.1: 学生全屏视图（考试模式）
  | 'global.setting' // v5.1: 全局设置页扩展
  | 'nav.user_menu' // v5.2: 顶部 Header 用户菜单扩展
  | 'classroom.quick_activity' // 极速课堂互动扩展
  | 'stage.display.card' // 大屏展台卡片扩展
  | 'editor.timeline_segment' // 课程编辑器步骤类型扩展
  | 'editor.palette_item' // 课程编辑器白板图元扩展
// ── 本地新增槽位 ──
  | 'classroom.countdown.widget' // 课堂倒计时挂件扩展
  | 'classroom.countdown.action' // 课堂倒计时快捷操作扩展
  | 'student.classroom.countdown' // 学生端倒计时通知扩展
  | 'student.quick_actions.item' // 学生端快捷指令菜单项扩展
  | 'student.quick_actions.action' // 学生端快捷指令操作扩展
  | 'student.quick_actions.fab' // 学生端快捷指令悬浮球扩展
  // 注：student.quick_actions.compact_addon 已移除（无消费者；本地 12 个槽位中其余均有宿主消费方）
  // ── 课堂启动门户（Classroom Entry Portal）扩展槽位 ──────────────
  // 门户是教师进入互动课堂的起始页（选课程 / 班级 / 教学模式）。以下槽位
  // 让第三方插件接入门户各区域，无需改动宿主组件。
  | 'classroom.portal.telemetry' // 顶部遥测岛指标（网络、设备、考勤等）
  | 'classroom.portal.course_badge' // 课程卡片徽章与补充信息
  | 'classroom.portal.teaching_mode' // 自定义教学模式（与 teaching_modes 表合并展示）
  | 'classroom.portal.insight' // 课前学情洞察卡（AI 洞察为内置默认实现）
  | 'classroom.portal.preflight' // 课前检查项
  | 'classroom.portal.launch_action' // 启动区附加操作
  // ── 上课流程扩展：4 个新页面（家校通知/AI 预测/异常告警/小组协作） ──
  | 'classroom.notification.tabs' // 家校通知生成器标签页扩展
  | 'classroom.pacing.dashboard' // AI 学情预测仪表扩展（注入卡片）
  | 'classroom.diagnostic.feed' // 课堂异常告警实时流扩展
  | 'classroom.collab.canvas' // 小组协作白板工具扩展
  // ── 远端新增槽位（Stitch 1219a481 / 21e2dac1 规范） ──
  | 'classroom.topbar.action' // 统一顶栏快捷操作扩展
  | 'classroom.topbar.pill' // 统一顶栏状态胶囊扩展
  | 'classroom.attribution.award' // 课堂归因加分维度扩展
  | 'classroom.attribution.action' // 课堂表现归因动作扩展
  | 'classroom.leaderboard.action' // 班级积分榜操作扩展
  | 'student.profile.dimension' // 学生多维素养雷达维度扩展
  | 'student.profile.card' // 学生成长档案扩展卡片
  | 'student.profile.action' // 学生成长档案操作动作扩展
  | 'student.profile.timeline_item' // 学生答题与互动轨迹项扩展
  | 'classroom.header.action' // 全局顶栏右侧快捷动作扩展
  | 'classroom.barometer.metric' // 课堂节奏晴雨表指标扩展
  | 'classroom.agenda.action' // 教学环节步骤卡片动作扩展
  | 'whiteboard.dock.plugin' // 白板主画板左下角活跃插件悬浮坞扩展
  | 'whiteboard.canvas.widget' // 白板画布动态可拖拽任务卡片扩展
  | 'classroom.audit.event' // 课堂互动分级审计流扩展
  | 'peer_review.rubric.dimension' // 全班大屏互评量规维度扩展
  | 'peer_review.badge' // 全班大屏互评微勋章扩展
  | 'peer_review.action' // 全班大屏互评操作扩展
  | 'peer_review.showcase.widget' // 大屏焦点作品对比分析组件扩展
  // ── 机房座位图扩展槽位 ──────────────────────────────────────────────
  // 座位图读取已有的 computer_labs + student_seats 表，展示班级学生在机房的物理座位分布。
  | 'classroom.seating.toolbar' // 座位图工具栏右侧按钮（如"远程开机"、"锁屏"）
  | 'classroom.seating.legend' // 座位图底部图例区追加（插件自定义状态图例）
  | 'classroom.seating.seat_badge' // 每个座位卡片内叠加徽章/图标
  | 'classroom.seating.seat_actions' // 座位右键/长按菜单项
  | 'classroom.seating.summary' // 座位图底部汇总区追加统计卡片
  // ── 白板自动保存扩展槽位 ──────────────────────────────────────────────
  | 'whiteboard.autosave.status' // 白板自动保存状态指示区扩展（插件可展示同步状态、第三方云备份等）
  | 'whiteboard.autosave.action'; // 白板自动保存附加操作区扩展（如立即同步到外部网盘、版本快照打标）

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

/** v5.1: 宿主注入的只读课堂上下文快照（课程/班级）。 */
export interface FrontendPluginContextSnapshot {
  lessonId: string | null;
  classId: string | null;
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
    /** v3.5: 为第三方白板元素类型注册自定义全屏渲染器（在 activate() 内调用） */
    registerFullscreenRenderer(type: string, renderer: FullscreenRenderer): void;
    unregisterFullscreenRenderer(type: string): void;
    /** v3.5: 为第三方白板元素类型注册自定义属性编辑器（在 activate() 内调用） */
    registerPropertyEditor(type: string, editor: PropertyEditorComponent): void;
    unregisterPropertyEditor(type: string): void;
    /** 为 html-applet 注册自定义内容源 loader（在 activate() 内调用） */
    registerCoursewareSource(loader: CoursewareSourceLoader): void;
    unregisterCoursewareSource(id: string): void;
    /** 为课程设计备课画板注册自定义组件（在 activate() 内调用） */
    registerPaletteItem(item: PaletteItemConfig): void;
    unregisterPaletteItem(type: string): void;
  };
  /** 调用后端已注册的 Command Handler，自动添加插件命名空间前缀 */
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>;
  /** 页面导航与 Tab 订阅控制 */
  navigation?: {
    getTeacherTab(): string;
    setTeacherTab(tab: string): void;
    setSelectedLesson?(lessonId: string | null): void;
    subscribeTeacherTab(callback: (tab: string) => void): () => void;
  };
  /** v5.1: 当前课堂上下文只读快照 + 订阅（非渲染场景读取当前课程/班级） */
  context?: {
    get(): FrontendPluginContextSnapshot;
    subscribe(callback: (ctx: FrontendPluginContextSnapshot) => void): () => void;
  };

  // Backward compatibility shims
  registerPanel?(config: any): void;
  registerMenu?(config: any): void;
  registerToolbarButton?(config: any): void;
}
