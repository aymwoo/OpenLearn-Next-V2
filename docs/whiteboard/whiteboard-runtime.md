# Whiteboard Runtime 白板画布引擎

实现位于 `src/features/whiteboard/`，核心入口为 `InteractiveWhiteboard.tsx`。

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
├── canvas-model/                    # 画布对象模型（CanvasObject, CanvasPage, Layer, Selection）
├── interaction-engine/              # 交互引擎（Pointer, Tool, Transform, Snap, Guide, ContextMenu）
├── rendering-engine/                # 渲染引擎（RendererRegistry, LayerRender, Cache, HitTest, Animation）
└── teaching-object/                 # 教学引擎（TeacherContext, StudentContext, Assessment, AI）
```

## 渲染器扩展

### Konva 图元渲染 (`rendererRegistry`)

位于 `src/features/whiteboard/rendering-engine/registry/`。所有可渲染到 Konva `<Stage>` 的图元（文本、形状、图片等）通过 `rendererRegistry.register(type, renderer)` 注册。

### 全屏渲染器 (`fullscreenRendererRegistry`)

**文件**：`src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx`

为白板组件类型注册自定义全屏视图。当用户点击组件标题栏的最大化按钮时，系统优先查表；若无匹配，自动使用智能默认渲染器（按字段优先级检测 `data` 内容）。

**API**：

```typescript
import { fullscreenRendererRegistry } from '@/features/whiteboard/fullscreen';

fullscreenRendererRegistry.register(type, (props) => <JSX />);
// props: { elementType, data, onClose, containerSize, lessonId }
```

全屏 overlay 通过 `createPortal` 渲染到 `document.body`，`fixed` 定位覆盖整个浏览器视口。默认渲染器按优先级自动识别：`code → markdown → question → text → url → src → coursewareUuid → equation → JSON`。

### 属性编辑器 (`propertyEditorRegistry`)

**文件**：`src/features/whiteboard/properties/PropertyEditorRegistry.tsx`

为白板组件类型注册自定义属性编辑器，在右侧属性面板中取代硬编码的 type-specific 编辑区。选中画布组件时触发。

**API**：

```typescript
import { propertyEditorRegistry } from '@/features/whiteboard/properties';

propertyEditorRegistry.register(type, (props) => <JSX />);
// props: { elementId, elementType, data, updateData, lessonId, onClose }
```

`updateData(partial)` 立即触发布局态更新 + 持久化到后端。通用属性（x/y/宽/高）和删除按钮由平台统一管理，插件编辑器接管剩余区域。

## 插件扩展点

| 扩展槽位                     | 用途                          | 映射文件                                     |
| ---------------------------- | ----------------------------- | -------------------------------------------- |
| `classroom.tool`             | 工具栏按钮 & 备课画板组件卡片 | `WhiteboardToolbar.tsx`, `LessonPalette.tsx` |
| `fullscreenRendererRegistry` | 全屏渲染覆盖                  | `FullscreenRendererRegistry.tsx`             |
| `propertyEditorRegistry`     | 属性面板编辑                  | `PropertyEditorRegistry.tsx`                 |

## 白板事件槽 (`WhiteboardEventSlot`)

**文件**：`src/features/whiteboard/events/`

白板内所有组件事件（iframe postMessage、widget 提交、手动录入、quiz/canvas）的统一采集 + 队列 + 分发中心。

### 设计动机

之前白板内的 HTML 课件（`html-applet` 组件）通过 iframe 嵌入，课件内调 `LMS.submit` 走的是 `postMessage` 协议，但**白板容器（`HtmlAppletFrame`）没有监听 message 事件**——成绩事件被静默丢弃。`WhiteboardEventSlot` 解决了三个痛点：

1. **统一事件入口**：iframe postMessage、widget 行为、手动录入都不需要知道谁会订阅它们
2. **可订阅 + 可重放**：教师面板 / AI 助手 / 调试面板能实时拿到事件，也能回放最近 N 条历史
3. **不依赖后端**：纯前端队列（实时），同时兼容 `frontendEventBus` 转发到服务端 EventBus

### 核心 API

```typescript
import { whiteboardEventSlot, useWhiteboardEvents } from '@/features/whiteboard/events';

// 主动发送事件（widget / 手动代码）
whiteboardEventSlot.ingest({
  source: 'widget.quiz',
  type: 'quiz.answered',
  lessonId,
  elementId: shapeId,
  payload: { questionId, answer },
});

// React Hook 订阅（带过滤 + 自动回放）
const events = useWhiteboardEvents(
  { types: ['courseware.submitted'], lessonId },
  { replay: 10, maxItems: 50 },
);
// events: WhiteboardEvent[] 最新在前

// 副作用订阅（不需要 React state）
useWhiteboardEventListener(
  { coursewareUuid },
  (e) => {
    if (e.type === 'courseware.submitted') {
      console.log('学生提交分数:', e.payload.score);
    }
  },
);
```

### 事件类型 (`type`)

| 类型                          | 来源                   | 触发时机                                           |
| ----------------------------- | ---------------------- | -------------------------------------------------- |
| `courseware.submitted`        | `iframe.postMessage` / `applet.score` | 课件内调用 `LMS.submit` / `OpenLearn.submit` |
| `courseware.progress_saved`   | `iframe.postMessage`   | 课件内调用 `LMS.saveProgress`                      |
| `courseware.finished`         | `iframe.postMessage`   | 课件内调用 `LMS.finish`                            |
| `courseware.unknown`          | `iframe.postMessage`   | 其他 `LMS_*` 协议事件（便于调试）                  |
| `courseware.event_logged`     | `iframe.bridge`        | `lms-bridge.ts` 转发到后端前的本地镜像             |
| `courseware.config_reported`  | `iframe.bridge`        | iframe 上报 `LMS_CONFIG`                           |
| `quiz.answered`               | `widget.quiz`          | 原生 quiz widget 提交                              |
| `whiteboard.*`                | `manual`               | 白板自身的 UI 事件                                 |

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
   ├─→ frontendEventBus.publish (兼容 SOCKET_FORWARD_PREFIXES)
   │      └─→ socket 转发 → server EventBus
   └─→ 可选 IndexedDB 持久化 (默认关闭)
```

### 扩展：自定义事件源

任何 widget / 自定义组件都可以直接调用 `whiteboardEventSlot.ingest(...)` 发布事件，订阅端通过 `useWhiteboardEvents({ types, sources, lessonId, ... })` 过滤。

## 白板组件类型

| 类型           | Canvas 渲染                    | 全屏模式                       | 属性编辑器              |
| -------------- | ------------------------------ | ------------------------------ | ----------------------- |
| `text`         | `Text`+`Html`                  | 智能默认（text 字段）          | 文本/字体/颜色          |
| `quiz`         | `Html`（题目标题+选项）        | 注册表（quiz renderer）        | 问题/选项/正确答案      |
| `timer`        | `Html`（数码管计时）           | 注册表（timer renderer）       | 时长/标签               |
| `assignment`   | `Html`（作业卡片）             | 注册表（assignment renderer）  | 标题/描述               |
| `code-sandbox` | `CodeSandboxWrapper`（IFrame） | 智能默认（code 字段）          | 代码编辑                |
| `html-applet`  | `<iframe>`（Bridge SDK）       | 注册表（html-applet renderer） | UUID/资源/代码/ZIP 上传 |

## iframe postMessage 监听（`HtmlAppletFrame`）

**问题**：之前白板内 `html-applet` 组件 iframe 内调 `LMS.submit` / `OpenLearn.submit` 时，**白板容器没有监听 message 事件**，导致成绩上报静默丢失。

**修复**（`src/features/whiteboard/components/HtmlAppletFrame.tsx`）：组件挂载后注册 `window.addEventListener('message')`，仅信任本组件的 iframe（通过 `event.source === iframe.contentWindow` 过滤）。识别以下协议：

| `event.data.type`              | 归一化事件                           |
| ----------------------------- | ------------------------------------ |
| `LMS_SUBMIT`                  | `courseware.submitted` (score/total/completion/comment) |
| `LMS_SAVE_PROGRESS`           | `courseware.progress_saved` (score/completion)          |
| `LMS_FINISH`                  | `courseware.finished`                                     |
| `courseware:score` / `openlearn-cw-sdk:score` | `courseware.submitted` (source: openlearn-cw-sdk) |
| 其他 `LMS_*`                  | `courseware.unknown`（保留 raw）                        |

父组件（`InteractiveWhiteboard.tsx` / `FullscreenOverlay`）必须传入 `elementId` 才能正确关联到白板元素：

```tsx
<HtmlAppletFrame data={data} lessonId={lessonId} elementId={el.id} />
```

同时 `lms-bridge.ts` 的全局监听器（`useLmsBridge(session)`）处理 `LMS_SUBMIT` 时也会同步写入事件槽，source 标记为 `iframe.bridge`（与 `HtmlAppletFrame` 局部监听互补，不冲突）。
| `math-graph`   | `MathGraphWrapper`（Canvas）   | 智能默认（equation 字段）      | 公式输入                |
| `presentation` | `RevealPresentationWrapper`    | 智能默认（markdown 字段）      | Markdown 编辑           |
| `rollcall`     | `RollCallWrapper`（点名面板）  | 注册表（rollcall renderer）    | 点名按钮                |
| `plugin-*`     | `PluginCardRenderer`           | 可注册/智能默认                | 可注册/通用属性         |
