# OpenLearn Canvas Object Development Guide

> **Target Audience**: Core Developers & Third-Party Plugin Developers  
> **Topic**: How to Register & Build Custom Whiteboard Canvas Objects without modifying Whiteboard Core.

---

## 1. Overview

With the **Canvas Object Model**, adding a new custom whiteboard element (e.g., GeoGebra Calculator, Scratch Sandbox, Interactive Chemistry Model, PPT Viewer) requires **zero changes** to Whiteboard Core code (`InteractiveWhiteboard.tsx`).

Developers register two elements:
1. **Object Descriptor** in `ObjectRegistry` (defines default payload & factory specs).
2. **Object Renderer** in `RendererRegistry` (defines the React / DOM / Canvas rendering UI).

---

## 2. Step-by-Step Developer Guide

### Step 1: Define Payload Interface
Define the payload TypeScript interface for your custom object:

```ts
export interface GeoGebraPayload {
  appType: 'graphing' | 'geometry' | '3d';
  constructionState?: string;
  showToolbar: boolean;
}
```

### Step 2: Register Object Descriptor in `ObjectRegistry`

```ts
import { objectRegistry } from '../features/whiteboard/canvas-model';

objectRegistry.registerObject<GeoGebraPayload>({
  type: 'geogebra-widget',
  displayName: 'GeoGebra 动态数学软件',
  category: 'interactive',
  defaultSize: { width: 550, height: 420 },
  createDefaultPayload: () => ({
    appType: 'graphing',
    showToolbar: true,
  }),
});
```

### Step 3: Register Object Renderer in `RendererRegistry`

```ts
import React from 'react';
import { rendererRegistry, ObjectRendererProps } from '../features/whiteboard/canvas-model';
import type { GeoGebraPayload } from './types';

const GeoGebraRenderer: React.FC<ObjectRendererProps<GeoGebraPayload>> = ({
  object,
  isSelected,
  onUpdate,
}) => {
  const { appType, showToolbar } = object.payload;

  return (
    <div
      style={{
        width: object.size.width,
        height: object.size.height,
        position: 'absolute',
        left: object.position.x,
        top: object.position.y,
      }}
      className={`bg-white rounded-xl border shadow-md ${isSelected ? 'ring-2 ring-indigo-500' : ''}`}
    >
      <div className="bg-indigo-50 px-3 py-1.5 font-bold text-xs text-indigo-700">
        GeoGebra ({appType})
      </div>
      <div className="p-4 text-center text-xs text-slate-500">
        [GeoGebra Interactive Applet Container]
      </div>
    </div>
  );
};

// Register Renderer
rendererRegistry.registerRenderer('geogebra-widget', GeoGebraRenderer);
```

### Step 4: Instantiate & Add via Command System

```ts
import { objectRegistry, commandManager, AddObjectCommand } from '../features/whiteboard/canvas-model';

// Create instance
const newGeoGebraObj = objectRegistry.createObject<GeoGebraPayload>('geogebra-widget', {
  position: { x: 200, y: 150 },
  payload: {
    appType: '3d',
    showToolbar: false,
  },
});

// Dispatch Command (automatically supports Undo/Redo!)
currentPage = commandManager.executeCommand(
  new AddObjectCommand(newGeoGebraObj),
  currentPage
);
```

---

## 3. Best Practices & Rules

1. **Keep Base Fields Intact**: Do not add custom properties directly to `CanvasObject` root; place all custom parameters inside `payload`.
2. **Immutability**: Always return a new object reference when updating state in commands (`onUpdate`).
3. **Clean Up**: Unregister renderers during plugin deactivation via `rendererRegistry.unregisterRenderer(type)`.
