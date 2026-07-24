# Whiteboard Runtime 白板引擎与 Canvas 对象模型

Whiteboard 引擎位于 `src/features/whiteboard/` 与 `packages/core/` 微前端适配模块中，提供高性能矢量画布渲染、Canvas 对象模型与跨终端实时协同绘制功能。

---

## Canvas 对象模型 (Canvas Object Model)

画布中的每一个渲染元素均继承自统一的 `CanvasObject` 基础结构：

```typescript
export interface CanvasObject<T = any> {
  id: string;
  type: string; // 'path' | 'text' | 'shape' | 'geogebra-widget' | 'image' | 'custom'
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
