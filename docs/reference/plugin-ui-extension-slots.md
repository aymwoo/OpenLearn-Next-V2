# UI 扩展槽位 Context / Props 上下文定义

> **适用范围**：`@openlearn/plugin-sdk@3.5.0`
> 本页说明宿主在渲染各 UI 扩展槽位时**实际注入**给插件 React 组件的 Props，纠正 "宿主会自动注入 `lessonId` / `userId` / `role` / `socket`" 的常见误解。

---

## 1. 完整扩展槽位清单

### 前端 ExtensionSlot 联合类型（`src/plugin-host/types.ts:66-75`）
```typescript
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
```

### 后端 manifest `contributes` 键（`contribution-registry.ts:20-68`，镜像 `plugin-sdk/openlearn.d.ts:213-262`）
- `classroom.tool` → `ClassroomToolConfig`
- `teacher.tab` → `TeacherTabConfig`
- `teacher.dashboard.widget` → `DashboardWidgetConfig`
- `student.view` → `StudentViewConfig`
- `student.lesson.tool` → `StudentLessonToolConfig`
- `help.plugin_docs` → `HelpDocConfig`

### 已实际挂载渲染器（有真实 `ExtensionPointRenderer` 调用点）的槽位
| 槽位 | 渲染调用点 | 宿主注入的 slotProps |
|---|---|---|
| `student.view` | `src/features/student-workspace/widgets/student-default-widgets.tsx`（及 `InteractiveWhiteboard.tsx` 学生分支） | `{ studentId: activeStudentId }` |
| `teacher.tab` | `src/plugin-host/extension-point-renderer.tsx`（按钮形态）/ `src/components/PluginTabPanel.tsx`（面板形态） | 见 §2 |
| `classroom.tool` | `src/features/whiteboard/components/WhiteboardToolbar.tsx`（工具栏按钮）/ 备课画板组件列表卡片 | 无（仅 `route?`） |
| `teacher.dashboard.widget` | `src/features/teacher/Dashboard.tsx` | 无（仅 `route?`） |
| `help.plugin_docs` | `src/features/teacher/help/PluginDocsViewer.tsx` | 无（仅 `route?`） |
| `whiteboard.fullscreen` | `InteractiveWhiteboard.tsx`（`FullscreenOverlay` 通过 `fullscreenRendererRegistry` 查找） | 见 §5 |
| `whiteboard.property-editor` | `InteractiveWhiteboard.tsx`（属性面板通过 `propertyEditorRegistry` 查找） | 见 §6 |

> `student.lesson.tool` / `teacher.panel` / `student.fullscreen` / `global.setting` / `nav.user_menu` 仅出现在 `ExtensionSlot` 联合类型中，**尚无渲染器挂载**，当前不会渲染任何内容。
> `help.plugin_docs` 有渲染器，但**不在** `ExtensionSlot` 联合类型内（以字符串字面量传入，其 prop 类型为 `ExtensionSlot | string`）。

---

## 2. 各槽位组件收到的 Props（实际注入）

渲染机制（`src/plugin-host/extension-point-renderer.tsx:253-256`）：
```typescript
React.createElement(
  resolveExtensionComponent(ext),
  { route: ext.route || route, ...ext.slotProps, ...slotProps },
);
```
组件始终收到（合并顺序）：
1. `route?: string` —— 来自 `ext.route` 或渲染器 `route` prop
2. `...ext.slotProps` —— 插件注册时声明的任意额外 props
3. `...slotProps` —— 宿主在调用点传入的 props

**不存在**自动注入的 `{ lessonId, userId, role, socket }`。组件类型为 `React.ComponentType<any>`（`types.ts:81`）。

### 各槽位实际 props
- **`student.view`**（`src/features/student-workspace/widgets/student-default-widgets.tsx`）：`{ studentId: string, route?: string }`。
- **`teacher.tab`**：
  - `renderType === 'button'`（`src/plugin-host/extension-point-renderer.tsx`）：渲染器**不渲染插件组件**，而是自行合成 `<button>`。插件组件被绕过。
  - `renderType === 'panel'`（`src/components/PluginTabPanel.tsx`）：组件以 `<activeTab.component renderType="panel" />` 渲染 → 收到 `{ renderType: 'panel' }`。
- **`classroom.tool`**（`src/features/whiteboard/components/WhiteboardToolbar.tsx`）：仅 `{ route?: string }`。
- **`teacher.dashboard.widget`**（`src/features/teacher/Dashboard.tsx`）：仅 `{ route?: string }`（可见性由 `dashboardVisibility` store 按插件控制）。
- **`help.plugin_docs`**（`src/features/teacher/help/PluginDocsViewer.tsx`）：仅 `{ route?: string }`。

### 注册配置形态（即插件声明时的类型，`types.ts:77-94`）
```typescript
interface ExtensionPointConfig {
  id: string;
  label: string;
  icon?: string;
  component: () => Promise<{ default: React.ComponentType<any> }>;
  position?: number;
  pluginId: string;
  group?: 'teaching' | 'management' | 'analytics' | 'extension' | string;
  badge?: number | string;
  rolesAllowed?: ('admin' | 'teacher' | 'student')[];
  route?: string;
  slotProps?: Record<string, any>;   // 合并进组件的任意额外 props
  render?: (props?: Record<string, any>) => React.ReactNode;  // v3: 可选自定义渲染函数（非组件式扩展点）
}
```

### manifest `contributes` 配置形态（**仅元数据，不挂载组件**）
```typescript
interface ClassroomToolConfig     { id: string; name: string; icon?: string; description?: string; commandType: string; payload?: Record<string, unknown>; }
interface TeacherTabConfig        { id: string; label: string; icon?: string; position?: number; }
interface DashboardWidgetConfig   { id: string; label: string; icon?: string; position?: number; }
interface StudentViewConfig       { id: string; label: string; icon?: string; route?: string; }
interface StudentLessonToolConfig { id: string; label: string; icon?: string; }
interface HelpDocConfig           { id: string; title: string; description?: string; markdownUrl?: string; }
```
> `manifest.contributes` 仅存入 `ContributionRegistry` 供管理端预览，前端 `ExtensionPointRenderer` 读取的是 zustand `ExtensionPointRegistry`，**不是** contribution registry。

---

## 3. 宿主注入了哪些上下文？（如何获取 user/role/lessonId/socket）

**没有**包裹插件组件的 per-slot Provider 注入 `userId` / `role` / `lessonId` / `socket`。可用途径：

1. **React Props** —— 见 §2。唯一被注入的身份数据是 `student.view` 的 `studentId`，以及 `teacher.tab` 的 `renderType`。
2. **React Context `PluginHostProvider`** —— `src/main.tsx:25` 包裹整个应用。组件内调用 `usePluginHost()`（`src/plugin-host/plugin-host-context.tsx:41-47`）获取 `FrontendPluginHost`。
3. **`FrontendPluginContext`**（即 `activate` 收到的 `ctx`，也是 `usePluginHost()` 暴露的内容，`types.ts:132-152`）：
   ```typescript
   interface FrontendPluginContext {
     services: {
       frontendApi: IFrontendAPI;       // get/post/del 访问后端
       socketService: ISocketService;   // emit/on/off/disconnect（非原生 socket.io Socket）
       uiService: IUIService;           // showToast/showModal/closeModal/downloadFile
       storageService: IStorageService; // get/set/delete/clear（字符串 KV）
     };
     pluginId: string;
     manifest: FrontendPluginManifest;
     ui: { registerExtensionPoint; unregisterExtensionPoint };
     invokeCommand<T>(type: string, payload?: unknown): Promise<T>;
     navigation: { getTeacherTab; setTeacherTab; subscribeTeacherTab };
     registerPanel? / registerMenu? / registerToolbarButton?; // 兼容 shim
   }
   ```
   `ISocketService` 为 `emit/on/off/disconnect` 的薄封装（`types.ts:104-109`），**不是**原生 `Socket`。`FrontendPluginContext` 上没有 `auth` / `user` / `role` / `lessonId` 字段。

**结论**：若插件需要当前用户、角色或课程上下文，必须**自行获取**——通过 `usePluginHost()` → `services`，或 `appStore` hooks（如 `useAppStore(s => s.teacherTab)`），或在自身 `config.slotProps` 中声明，或读取 `studentId` props。宿主不会自动注入。唯一的身份门控是声明式 `rolesAllowed`（`types.ts:89`），在**注册时**评估，而非渲染时。

---

## 4. 插件如何声明目标槽位

存在**两套机制**：

### A. 命令式 React 组件注册（真正挂载 UI）
前端插件模块导出形状（`src/plugin-host/plugin-host.ts:56-65`）：
```typescript
export interface PluginModule {
  default?: { manifest: FrontendPluginManifest; activate: (ctx: FrontendPluginContext) => Promise<void>; deactivate?: () => Promise<void>; };
  manifest?: FrontendPluginManifest;
  activate?: (ctx: FrontendPluginContext) => Promise<void>;
  deactivate?: () => Promise<void>;
}
```
在 `activate(ctx)` 内调用 `ctx.ui.registerExtensionPoint(slot, config)`（`types.ts:141-144`）。兼容 shim：
- `ctx.registerPanel(config)` → 默认槽位 `teacher.dashboard.widget`
- `ctx.registerMenu(config)` → 默认槽位 `teacher.panel`
- `ctx.registerToolbarButton(config)` → 槽位 `classroom.tool`

此外 `manifest.classroomTools` 项在激活时**自动注册**为 `classroom.tool` 扩展点（`plugin-host.ts:295-306`），但组件为 `() => null` 占位——它们是命令触发的工具栏按钮，而非 React 面板。

### B. 声明式 manifest `contributes`（仅元数据层）
`manifest.contributes?: Record<string, Array<{ id: string; [key: string]: unknown }>>`（`openlearn.d.ts:57`），存入 `ContributionRegistry` 供管理端预览，**不挂载 React 组件**。

> 最后更新：2026-07-26

---

## 5. 白板全屏渲染器注册表 (`fullscreenRendererRegistry`)

**注册表位置**：`src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx`

插件可通过 `fullscreenRendererRegistry.register(type, component)` 为白板组件类型注册自定义全屏视图。白板中点击组件的最大化按钮时，`FullscreenOverlay` 优先查询注册表；若无匹配，自动使用智能默认渲染器。

### 使用方式

```typescript
import { fullscreenRendererRegistry } from '@/features/whiteboard/fullscreen';

fullscreenRendererRegistry.register('ext-my-plugin/widget', ({ data, onClose, containerSize, lessonId }) => (
  <div className="flex flex-col items-center justify-center h-full">
    <h2>{data.title}</h2>
    <p>{data.content}</p>
  </div>
));
```

### Props 类型 (`FullscreenRendererProps`)

```typescript
{
  elementType: string;
  data: Record<string, any>;
  onClose: () => void;
  containerSize: { width: number; height: number };
  lessonId: string;
}
```

### 默认兜底渲染

未注册的类型自动使用 `/fullscreen/FullscreenRendererRegistry.tsx` 中的 `DefaultFullscreenRenderer`，按优先级检测 `data` 字段：
`code` → 代码编辑器 / `markdown` → Markdown 预览 / `question` + `options` → 测验视图 / `text` → 文本展示 / `url` → 外链 / `src` → 图片 / `coursewareUuid` → iframe 课件 / `equation` → 公式 / 无可识别字段 → JSON 摘要。

全屏 overlay 通过 `createPortal` 渲染到 `document.body`，使用 `fixed` 定位覆盖整个浏览器视口，支持 ESC 键和右上角关闭按钮退出。

---

## 6. 白板属性编辑器注册表 (`propertyEditorRegistry`)

**注册表位置**：`src/features/whiteboard/properties/PropertyEditorRegistry.tsx`

插件可通过 `propertyEditorRegistry.register(type, component)` 为白板组件类型注册自定义属性编辑器，在白板右侧属性面板中渲染。

### 使用方式

```typescript
import { propertyEditorRegistry } from '@/features/whiteboard/properties';

propertyEditorRegistry.register('ext-my-plugin/widget', ({ data, updateData, elementId, lessonId }) => (
  <div className="space-y-3">
    <label className="block text-[10px] text-slate-400 font-semibold mb-1">标题</label>
    <input
      value={data.title || ''}
      onChange={e => updateData({ title: e.target.value })}
      className="w-full p-2 border border-slate-200 rounded-lg text-xs"
    />
  </div>
));
```

### Props 类型 (`PropertyEditorProps`)

```typescript
{
  elementId: string;
  elementType: string;
  data: Record<string, any>;          // 当前元素属性（可读写副本）
  updateData: (partial: Record<string, any>) => void;  // 更新属性，自动同步到后端
  lessonId: string;
  onClose: () => void;
}
```

调用 `updateData(partial)` 会立即触发本地状态更新 + 持久化到 SQLite。通用属性（x 坐标、y 坐标、宽度、高度）和删除按钮由平台统一渲染，插件无需关心。
