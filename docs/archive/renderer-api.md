# OpenLearn Plugin Renderer API Specification

> **Target Module**: `src/features/whiteboard/rendering-engine/registry/renderer-registry.ts`  
> **Status**: Approved & Integrated

---

## 1. Plugin Renderer Interface

Third-party plugins or custom built-in modules register custom renderers via `IRenderer<T>`:

```ts
import type { CanvasObject } from '../canvas-model/types';
import type { RenderContext, IRenderer } from '../rendering-engine/types';

export interface MyPluginPayload {
  data: string;
}

export class MyPluginRenderer implements IRenderer<MyPluginPayload> {
  readonly type = 'my-plugin-widget';

  render(object: CanvasObject<MyPluginPayload>, ctx: RenderContext): void {
    // Custom Canvas 2D or DOM rendering
  }

  getHitArea(object: CanvasObject<MyPluginPayload>) {
    return {
      x: object.position.x,
      y: object.position.y,
      width: object.size.width,
      height: object.size.height,
    };
  }
}
```

---

## 2. Registering & Overriding Renderers

```ts
import { rendererRegistry } from '../features/whiteboard/rendering-engine';

// 1. Register a new custom object renderer
rendererRegistry.registerRenderer(new MyPluginRenderer());

// 2. Override an existing renderer
rendererRegistry.overrideRenderer('text', new CustomTextRenderer());

// 3. Unregister renderer during plugin cleanup
rendererRegistry.unregisterRenderer('my-plugin-widget');
```
