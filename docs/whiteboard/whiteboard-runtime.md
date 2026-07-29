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

| 扩展槽位 | 用途 | 映射文件 |
|----------|------|----------|
| `classroom.tool` | 工具栏按钮 & 备课画板组件卡片 | `WhiteboardToolbar.tsx`, `LessonPalette.tsx` |
| `fullscreenRendererRegistry` | 全屏渲染覆盖 | `FullscreenRendererRegistry.tsx` |
| `propertyEditorRegistry` | 属性面板编辑 | `PropertyEditorRegistry.tsx` |

## 白板组件类型

| 类型 | Canvas 渲染 | 全屏模式 | 属性编辑器 |
|------|-----------|---------|-----------|
| `text` | `Text`+`Html` | 智能默认（text 字段） | 文本/字体/颜色 |
| `quiz` | `Html`（题目标题+选项） | 注册表（quiz renderer） | 问题/选项/正确答案 |
| `timer` | `Html`（数码管计时） | 注册表（timer renderer） | 时长/标签 |
| `assignment` | `Html`（作业卡片） | 注册表（assignment renderer） | 标题/描述 |
| `code-sandbox` | `CodeSandboxWrapper`（IFrame） | 智能默认（code 字段） | 代码编辑 |
| `html-applet` | `<iframe>`（Bridge SDK） | 注册表（html-applet renderer） | UUID/资源/代码/ZIP 上传 |
| `math-graph` | `MathGraphWrapper`（Canvas） | 智能默认（equation 字段） | 公式输入 |
| `presentation` | `RevealPresentationWrapper` | 智能默认（markdown 字段） | Markdown 编辑 |
| `rollcall` | `RollCallWrapper`（点名面板） | 注册表（rollcall renderer） | 点名按钮 |
| `plugin-*` | `PluginCardRenderer` | 可注册/智能默认 | 可注册/通用属性 |
