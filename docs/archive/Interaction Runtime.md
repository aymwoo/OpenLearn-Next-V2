# OpenLearn Interaction Runtime Specification (统一交互运行时规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P2-09 中，成功构建了 **Unified Interaction Runtime**（位于 `src/features/interaction-runtime/`）。

交互运行时统一收拢与调度系统 9 大交互领域（`Keyboard`, `Mouse`, `Touch`, `Gesture`, `Drag`, `Clipboard`, `Focus`, `ContextMenu`, `Selection`）。通过 `InteractionRegistry` 支持 Handler 优先级排序与拦截，零破坏既有业务逻辑。第三方插件可使用与官方组件相同的贡献 API (`contributeHandler`) 挂载自定义交互拦截逻辑。

---

## 2. Supported Interaction Domains & Contracts (9 大交互领域与契约)

```typescript
export type InteractionDomain =
  | 'Keyboard'
  | 'Mouse'
  | 'Touch'
  | 'Gesture'
  | 'Drag'
  | 'Clipboard'
  | 'Focus'
  | 'ContextMenu'
  | 'Selection';

export interface InteractionEvent<T = Record<string, unknown>> {
  readonly id: string;
  readonly domain: InteractionDomain;
  readonly targetId?: string;
  readonly payload: T;
  readonly timestamp: number;
}

export interface InteractionHandler {
  readonly id: string;
  readonly domain: InteractionDomain;
  readonly priority?: number; // 优先级高的 Handler 优先触发
  readonly handle: (event: InteractionEvent) => boolean | void; // 返回 true 可拦截消费事件
}
```

---

## 3. Usage & Plugin Interaction Contribution Example (使用与插件扩展范例)

```typescript
import { InteractionRuntimeService } from './src/features/interaction-runtime/index.js';

const runtime = new InteractionRuntimeService();

// 1. Contribute Plugin Gesture Handler
runtime.contributeHandler({
  id: 'handler_plugin_pinch_zoom',
  domain: 'Gesture',
  priority: 200,
  handle: (event) => {
    const { type, scale } = event.payload as { type: string; scale: number };
    if (type === 'pinch') {
      console.log('Plugin handling pinch zoom, scale:', scale);
      return true; // Intercept event
    }
  },
});

// 2. Dispatch Gesture Event
runtime.dispatchGesture('pinch', 1.5);

// 3. Track Focus & Selection
runtime.setFocus('element_whiteboard_canvas');
runtime.setSelection(['shape_1', 'shape_2']);
```
