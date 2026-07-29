# Whiteboard Runtime 白板引擎与 Canvas 对象模型

Whiteboard 引擎位于 `src/features/whiteboard/` 与 `packages/core/` 微前端适配模块中，提供高性能矢量画布渲染、Canvas 对象模型与跨终端实时协同绘制功能。

---

## Canvas 对象模型 (Canvas Object Model)

画布中的每一个渲染元素均继承自统一的 `CanvasObject` 基础结构：

```typescript
export interface CanvasObject<T = any> {
  id: string;
  type: string; // 'path' | 'text' | 'shape' | 'geogebra-widget' | 'html-applet' | 'image' | 'custom'
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  zIndex: number;
  locked: boolean;
  payload: T;
}
```

---

## 渲染器注册体系 (Renderer Registry)

白板渲染采用插件化注册模式，任何新增的图形或富媒体组件均通过 `rendererRegistry` 动态扩充：

```typescript
import { rendererRegistry } from '../features/whiteboard/canvas-model';

// 注册渲染器
rendererRegistry.registerRenderer('geogebra-widget', GeoGebraRenderer);
```

---

## 协同渲染与增量同步

1. **增量事件**: 绘制路径或移动对象时，通过 Socket.IO 发送 `whiteboard.draw` / `whiteboard.object_transformed` 增量包。
2. **OT / CRDT 冲突解决**: 基于时间戳（uuidv7）与版本号控制，确保多端同屏协同不出现卡顿或乱序覆盖。

---

## 交互式 Web 课件 (html-applet)

在 V0.2.1 中，白板系统引入了对富交互 Web 课件（`html-applet`）的支持。

### 画布对象与渲染管线
当 `type === 'html-applet'` 时，白板将其渲染为一个嵌入的 Web 课件窗口：
- **沙箱隔离**: 课件在 `<iframe>` 内渲染，并强制添加 `sandbox="allow-scripts allow-forms allow-downloads"`（无 `allow-same-origin`）以防止 XSS 与提权风险。
- **Bridge 注入**: 针对 URL 托管课件（通过 `/runtime/:uuid/` 下发），服务端会在 HTML 响应头自动注入 Bridge SDK。

### SrcDoc 模式与 wrapSrcDocWithBridge
对于纯文本/无后端的单体离线课件资源，使用 iframe 的 `srcdoc` 属性直接挂载 HTML 字符串。
为解决 `srcdoc` 同域沙箱代理问题，引擎提供了 `wrapSrcDocWithBridge(htmlString)` 函数，该模式下：
1. 会自动将 Bridge SDK 运行时逻辑打包为 IIFE 或 内联 `<script>` 注入到 `htmlString` 头部。
2. Bridge 内部同样采用 `Object.defineProperty` 与 `Proxy` 拦截 `window.parent` 和 `window.top`，并将跨域 `postMessage` 通信时 `targetOrigin === 'null'` 的消息规范化为 `'*'`。

### 工具栏入口
用户可以在主 **WhiteboardToolbar** 工具栏点击新增的 **Globe（地球仪）** 按钮。该操作将弹出资源选择器，允许讲师选择/上传 HTML 课件包或直接粘贴网页 URL，从而创建并同步挂载一个 `html-applet` 实例。
