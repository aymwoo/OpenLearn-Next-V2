# OpenLearn Teaching Resource Workflow Specification (教学资源运行时工作流规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P3-01 中，成功构建了 **Teaching Resource Runtime Workflow**（位于 `src/features/resource-runtime/`）。

将原有的资源中心升级为围绕课堂教学活动展开的资源运行时（Teaching Resource Runtime）。原生支持 13 种教学资源类型 (`PDF`, `PPT`, `Image`, `Video`, `Markdown`, `Notebook`, `Mermaid`, `MindMap`, `GeoGebra`, `Blockly`, `Scratch`, `HTML`, `Plugin`)，提供标准的 7 大资源操作 (`preview`, `open`, `pin`, `favorite`, `annotate`, `share`, `fullscreen`)，并通过 `asWorkspaceWidget` 转换适配器完美融入 Workspace 布局。后端持久化与 SQLite 数据表 100% 保持未动。

---

## 2. Teaching Resource Workflow Pipeline (教学资源工作流拓扑)

```
====================================================================
 Teacher selects resource (PDF/PPT/Image/GeoGebra/etc.)
   ↓
 Preview (PreviewProvider / Modal preview)
   ↓
 Drag to Workspace (asWorkspaceWidget -> WorkspaceLayout)
   ↓
 Whiteboard displays resource (Canvas element / Konva 2D Layer)
   ↓
 AI can explain resource (AI Assistant Capability)
   ↓
 Plugins may enhance resource (Third-party ResourceProvider)
   ↓
 Students interact (Interactive teaching session)
====================================================================
```

---

## 3. Resource Provider & Widget Adapter Example (资源 Provider 与 Widget 转换范例)

```typescript
import {
  ResourceRegistry,
  asWorkspaceWidget,
} from './src/features/resource-runtime/index.js';

const registry = new ResourceRegistry();

// 1. Register Plugin Resource Provider
registry.registerProvider({
  id: 'provider_plugin_geogebra',
  type: 'GeoGebra',
  preview: (res) => ({ previewUrl: res.url, isInteractive: true }),
  open: (res) => ({ renderMode: '3D', resId: res.id }),
});

// 2. Register GeoGebra Resource
registry.registerResource({
  id: 'res_geo_mesh_1',
  title: 'Pythagorean Geometry Mesh',
  type: 'GeoGebra',
  url: 'https://storage.openlearn.org/mesh.ggb',
});

// 3. Execute Standard Actions
registry.executeAction('res_geo_mesh_1', 'pin');
registry.executeAction('res_geo_mesh_1', 'favorite');

// 4. Convert Resource to Workspace Widget
const widget = asWorkspaceWidget(
  registry.getResource('res_geo_mesh_1')!,
  'CenterWorkspace'
);
```
