# Whiteboard Runtime 白板画布引擎

实现位于 `src/features/whiteboard/`，核心入口为 `InteractiveWhiteboard.tsx`。

> 📌 本文为白板**运行时架构**唯一真源。相关文档：[Canvas 对象模型](canvas-object-model.md)、
> [白板子系统机制（渲染器注册、html-applet、防抖自动保存、公平抽问）](../architecture/whiteboard-subsystems.md)。

## 架构概述

```
InteractiveWhiteboard.tsx (主组件)
├── components/
│   ├── WhiteboardToolbar.tsx         # 顶部工具栏（画笔、图形、组件面板）
│   ├── WhiteboardPageBar.tsx        # 底部页面切换 & 缩略图抽屉
│   ├── WhiteboardDialog.tsx         # 通用弹窗
│   └── CoursewareEntrySelectorModal.tsx  # ZIP 课件入口选择弹窗
├── widgets/
│   ├── PluginCardRenderer.tsx       # 插件白板组件渲染器
│   ├── RollCallWrapper.tsx          # 随机点名
│   ├── CodeSandboxWrapper.tsx       # 代码沙箱
│   ├── MathGraphWrapper.tsx         # 数学函数图形
│   ├── HelloWorldWrapper.tsx        # 示例组件
│   └── RevealPresentationWrapper.tsx # Slide 演示文稿
├── fullscreen/
│   ├── FullscreenRendererRegistry.tsx  # 全屏渲染器注册表
│   └── index.ts                        # Barrel export
├── properties/
│   ├── PropertyEditorRegistry.tsx      # 属性编辑器注册表
│   └── index.ts                        # Barrel export
├── utils/
│   └── bridgeUtils.ts               # Bridge SDK 封装（wrapSrcDocWithBridge）
├── theme.ts                         # 主题令牌与 ThemeManager
└── types/payloads.ts                # 图元 payload 类型（宿主对外契约）
```

> **Phase 0 变更（2026-11）**：此前的 `canvas-model/`、`interaction-engine/`、
> `rendering-engine/`、`teaching-object/`、`tool-system/` 五个目录已整体删除
> （61 文件 / 4,042 行）。它们声明了 6 个「引擎」，但 `InteractiveWhiteboard.tsx`
> 只把符号 import 进来、从未调用，构建产物中也不存在对应代码（这些模块的专有
> 字符串在 `dist/` 里 0 命中）。唯一真正被使用的 `theme-manager` 与
> `HtmlAppletPayload` 已就地提升为 `theme.ts` / `types/payloads.ts`。

## 渲染器扩展

### Konva 图元渲染（`renderElement`，**非**注册制）

> **Phase 0 变更（2026-11）**：本节曾记录 `rendering-engine` 与 `canvas-model` 下
> **两套同名 `rendererRegistry`**（前者单参数 `IRenderer<T>`、后者两参数 React 组件），
> 并声称「平台实际使用的是 rendering-engine 那份」。该说法与代码不符：两份实现都
> 只被 import、从未被调用，构建产物中均不存在，现已随目录删除。
>
> 结论：**白板图元渲染没有可用的注册表机制**。新增图元不要恢复上述 registry。

当前实际实现是宿主内的**硬编码分支**：`InteractiveWhiteboard.tsx` 的 `renderElement()`
（约 1,457 行）用 16 个 `el.type === '…'` 分支分派 15 种图元 ——
`pen` / `highlighter` / `rectangle` / `circle` / `text` / `shape` / `quiz` /
`assignment` / `rollcall` / `presentation` / `html-applet` / `code-sandbox` /
`math-graph` / `plugin` / `hello-world`。

新增图元的正确入口是**已存在的插件贡献点** `whiteboard.renderer`
（宿主侧由 `<ExtensionPointRenderer slot="whiteboard.renderer" />` 消费）；
把 9 个 LMS 图元从 `renderElement` 迁到该贡献点是 Phase 1 的计划项。

### 全屏渲染器 (`fullscreenRendererRegistry`)

**文件**：`src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx`

为白板组件类型注册自定义全屏视图。当用户点击组件标题栏的最大化按钮时，系统先查表（`getEffectiveRenderer`）；若无匹配，回落到 `FullscreenOverlay` 的 `renderContent` 宿主注入路径或 `DefaultFullscreenRenderer` 智能默认渲染器（按字段优先级检测 `data` 内容）。

**API**：

```typescript
import { fullscreenRendererRegistry } from '@/features/whiteboard/fullscreen';

fullscreenRendererRegistry.register(type, (props) => <JSX />, pluginId);
// props: { elementType, data, onClose, containerSize, lessonId }
```

> `getEffectiveRenderer` 只接受**带 `pluginId` 的插件注册**或 `registerHostBuiltin` 标记的条目；无 `pluginId` 的 `register` 调用**不生效**（`InteractiveWhiteboard.tsx` 目前只用 `registerHostBuiltin('quiz', QuizFullscreenView)` 标记了一个宿主内置渲染器）。这是为避免「逐类型手写的第二套实现」与画布内真实组件漂移而设。

全屏 overlay 通过 `createPortal` 渲染到 `document.body`，`fixed` 定位覆盖整个浏览器视口。默认渲染器按 `PRIORITY_FIELDS` 优先级自动识别：`text → markdown → code → question（需同时有 options）→ equation → url → src → coursewareUuid`，全部未命中则回落 JSON 预览。

`updateData(partial)` 立即触发布局态更新 + 持久化到后端。通用属性（x/y/宽/高）和删除按钮由平台统一管理，插件编辑器接管剩余区域。

## 插件扩展点

### 注册表型扩展点

| 扩展槽位                     | 用途                          | 映射文件                                     |
| ---------------------------- | ----------------------------- | -------------------------------------------- |
| `classroom.tool`             | 工具栏按钮 & 备课画板组件卡片 | `WhiteboardToolbar.tsx`, `LessonPalette.tsx` |
| `fullscreenRendererRegistry` | 全屏渲染覆盖                  | `FullscreenRendererRegistry.tsx`             |
| `propertyEditorRegistry`     | 属性面板编辑                  | `PropertyEditorRegistry.tsx`                 |

### UI 扩展槽位（`ExtensionSlot`）

| 扩展槽位                        | 挂载位置 / 职责                                                             | 对应文件                                     |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `whiteboard.renderer`           | 画布自定义图元一等公民渲染（支持 React / DOM / 沙箱 `view`）                | `InteractiveWhiteboard.tsx`                  |
| `whiteboard.selection.toolbar`  | 选中图元上方浮动快捷栏（支持 `targetType` 过滤与声明式 `commandType` 按钮） | `InteractiveWhiteboard.tsx`                  |
| `whiteboard.context_menu`       | 画布与组件右键菜单扩展区（支持 `target` 与 `targetType` 过滤）              | `InteractiveWhiteboard.tsx`                  |
| `whiteboard.dock.plugin`        | 画板左下角活跃插件悬浮坞                                                    | `InteractiveWhiteboard.tsx`                  |
| `whiteboard.canvas.widget`      | 画布浮层可拖拽任务卡片                                                      | `InteractiveWhiteboard.tsx`                  |
| `whiteboard.pagebar.action`     | 底部悬浮分页条右侧动作扩展                                                  | `components/WhiteboardPageBar.tsx`           |
| `whiteboard.page_drawer.action` | 页面大纲与缩略图抽屉右上角动作扩展                                          | `components/WhiteboardPageBar.tsx`           |
| `whiteboard.properties.addon`   | 属性编辑侧边栏附加配置区块                                                  | `components/WhiteboardPropertiesSidebar.tsx` |
| `anchor:whiteboard-toolbar:*`   | 顶部工具栏锚点扩展（`cursor` / `pen` / `quiz` / `presentation` 等）         | `components/WhiteboardToolbar.tsx`           |

> **画布现代 Web 能力契约**：插件卡片容器外层统一挂载 `.wb-widget-container`（`container-type: inline-size`），视口容器暴露 `data-wb-readonly`、`data-wb-layout` 与 `--wb-readonly` / `--wb-layout` / `--wb-density` 令牌，并在页码切换与平铺切换时通过作用域过渡（`runScopedTransition`）与全屏态 `inert` 保证交互隔离；工具栏「互动工具」面板优先使用原生 `popover="auto"` + CSS Anchor Positioning 并自动降级至 portal。详细信息见 [plugin-ui-extension-slots.md](../reference/plugin-ui-extension-slots.md)。

## 白板事件槽 (`WhiteboardEventSlot`)

**文件**：`src/features/whiteboard/events/`

白板内所有组件事件（iframe postMessage、widget 提交、手动录入、quiz/canvas）的统一采集 + 队列 + 分发中心。

### 设计动机

之前白板内的 HTML 课件（`html-applet` 组件）通过 iframe 嵌入，课件内调 `LMS.submit` 走的是 `postMessage` 协议，但**白板容器（`HtmlAppletFrame`）没有监听 message 事件**——成绩事件被静默丢弃。`WhiteboardEventSlot` 解决了三个痛点：

1. **统一事件入口**：iframe postMessage、widget 行为、手动录入都不需要知道谁会订阅它们
2. **可订阅 + 可重放**：教师面板 / AI 助手 / 调试面板能实时拿到事件，也能回放最近 N 条历史
3. **不依赖后端**：纯前端队列（实时）；`ingest()` 会同步推一份到进程内 `frontendEventBus`，但**不会跨端**（见下方「数据流」）

### 核心 API

```typescript
import { whiteboardEventSlot, useWhiteboardEvents, useWhiteboardEventListener } from '@/features/whiteboard/events';

// 主动发送事件（widget / 手动代码）
whiteboardEventSlot.ingest({
  source: 'widget.quiz',
  type: 'quiz.answered',
  lessonId,
  elementId: shapeId,
  payload: { questionId, answer },
});

// React Hook 订阅（带过滤 + 自动回放）
const events = useWhiteboardEvents({ types: ['courseware.submitted'], lessonId }, { replay: 10, maxItems: 50 });
// events: WhiteboardEvent[] 最新在前

// 副作用订阅（不需要 React state）
useWhiteboardEventListener({ coursewareUuid }, (e) => {
  if (e.type === 'courseware.submitted') {
    console.log('学生提交分数:', e.payload.score);
  }
});
```

### 事件类型 (`type`)

| 类型                         | 来源                                  | 触发时机                                     |
| ---------------------------- | ------------------------------------- | -------------------------------------------- |
| `courseware.submitted`       | `iframe.postMessage` / `applet.score` | 课件内调用 `LMS.submit` / `OpenLearn.submit` |
| `courseware.progress_saved`  | `iframe.postMessage`                  | 课件内调用 `LMS.saveProgress`                |
| `courseware.finished`        | `iframe.postMessage`                  | 课件内调用 `LMS.finish`                      |
| `courseware.unknown`         | `iframe.postMessage`                  | 其他 `LMS_*` 协议事件（便于调试）            |
| `courseware.event_logged`    | `iframe.bridge`                       | `lms-bridge.ts` 转发到后端前的本地镜像       |
| `courseware.config_reported` | `iframe.bridge`                       | iframe 上报 `LMS_CONFIG`                     |
| `quiz.answered`              | `widget.quiz`                         | 原生 quiz widget 提交                        |
| `whiteboard.*`               | `manual`                              | 白板自身的 UI 事件                           |

### 调试面板

白板右下角可展开 `WhiteboardEventPanel`（开发/调试用）：

```tsx
<WhiteboardEventPanel lessonId={lessonId} />
```

支持：暂停/清空、按类型/来源过滤、点击行展开原始 JSON。

### 数据流

```
iframe 内部 (LMS.submit / OpenLearn.submit)
   ↓ postMessage
HtmlAppletFrame.messageHandler
   ↓ ingest({ source:'iframe.postMessage', type:'courseware.submitted', ... })
WhiteboardEventSlot
   ├─→ 本地订阅者 (TeacherPanel / AI / 调试面板)
   ├─→ frontendEventBus.publish (仅本进程内，不跨端)
   └─→ 可选 IndexedDB 持久化 (persist 默认 false)
```

> ⚠️ **不跨端**：`frontendEventBus`（`src/services/event-bus.ts` 的 `FrontendEventBus`）**只通知同浏览器进程内的订阅者**。该文件头部注释明确记载：曾有一个「把 `whiteboard.` / `courseware.` / `quiz.` / `rollcall.` 前缀转发到服务端」的 `setSocketBridge()` 注入点，但**全仓库零调用**，那段转发是死代码，已删除。因此事件槽产出的事件**不会**经 socket 到达服务端 EventBus。
>
> 需要真正跨端的信号走两条**已接线**的通路：
>
> - 状态变更 → REST/命令总线（`PUT /api/lessons/:id/whiteboard/:elementId` → `whiteboard.update` 命令 → 服务端 `eventBus` → `server/realtime-bridge.ts` 的 `setupRealtimeBridge` 广播）
> - 即时通知 → 直接用 socket（插件可用 `ctx.services.socketService`）

### 扩展：自定义事件源

任何 widget / 自定义组件都可以直接调用 `whiteboardEventSlot.ingest(...)` 发布事件，订阅端通过 `useWhiteboardEvents({ types, sources, lessonId, ... })` 过滤。

## 白板组件类型

| 类型           | Canvas 渲染                    | 全屏模式                  | 属性编辑器              |
| -------------- | ------------------------------ | ------------------------- | ----------------------- |
| `text`         | `Text`+`Html`                  | 智能默认（text 字段）     | 文本/字体/颜色          |
| `quiz`         | `Html`（题目标题+选项）        | 注册表（quiz renderer）   | 问题/选项/正确答案      |
| `assignment`   | `Html`（作业卡片）             | 宿主注入真实组件          | 标题/描述               |
| `code-sandbox` | `CodeSandboxWrapper`（IFrame） | 智能默认（code 字段）     | 代码编辑                |
| `html-applet`  | `<iframe>`（Bridge SDK）       | 宿主注入真实组件          | UUID/资源/代码/ZIP 上传 |
| `math-graph`   | `MathGraphWrapper`（Canvas）   | 智能默认（equation 字段） | 公式输入                |
| `presentation` | `RevealPresentationWrapper`    | 智能默认（markdown 字段） | Markdown 编辑           |
| `rollcall`     | `RollCallWrapper`（点名面板）  | 宿主注入真实组件          | 点名按钮                |
| `plugin-*`     | `PluginCardRenderer`           | 可注册/智能默认           | 可注册/通用属性         |

> `hello-world`（`HelloWorldWrapper`）为示例组件，无对应的全屏与属性编辑器注册。
> 全屏列的「宿主注入真实组件」指 `FullscreenOverlay` 的 `renderContent` 回调 —— 见 `FullscreenRendererRegistry.tsx` 的 `getEffectiveRenderer`：只有**插件注册**（带 `pluginId`）或显式 `registerHostBuiltin`（当前仅 `quiz`）的渲染器才从注册表生效，其余走宿主注入的真实组件路径。

## iframe postMessage 监听（`HtmlAppletFrame`）

**问题**：之前白板内 `html-applet` 组件 iframe 内调 `LMS.submit` / `OpenLearn.submit` 时，**白板容器没有监听 message 事件**，导致成绩上报静默丢失。

**修复**（`src/features/whiteboard/components/HtmlAppletFrame.tsx`）：组件挂载后注册 `window.addEventListener('message')`，仅信任本组件的 iframe（通过 `event.source === iframe.contentWindow` 过滤）。识别以下协议：

| `event.data.type`                             | 归一化事件                                              |
| --------------------------------------------- | ------------------------------------------------------- |
| `LMS_SUBMIT`                                  | `courseware.submitted` (score/total/completion/comment) |
| `LMS_SAVE_PROGRESS`                           | `courseware.progress_saved` (score/completion)          |
| `LMS_FINISH`                                  | `courseware.finished`                                   |
| `courseware:score` / `openlearn-cw-sdk:score` | `courseware.submitted` (source: openlearn-cw-sdk)       |
| 其他 `LMS_*`                                  | `courseware.unknown`（保留 raw）                        |

父组件（`InteractiveWhiteboard.tsx` / `FullscreenOverlay`）必须传入 `elementId` 才能正确关联到白板元素：

```tsx
<HtmlAppletFrame data={data} lessonId={lessonId} elementId={el.id} />
```

同时 `lms-bridge.ts` 的全局监听器（`useLmsBridge(session)`）处理 `LMS_SUBMIT` 时也会同步写入事件槽，source 标记为 `iframe.bridge`（与 `HtmlAppletFrame` 局部监听互补，不冲突）。
