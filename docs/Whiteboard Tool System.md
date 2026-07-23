# OpenLearn Whiteboard Tool System Specification (白板工具系统架构规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P2-01 中，成功完成了 **Whiteboard Tool System**（位于 `src/features/whiteboard/tool-system/`）的注册表架构化重构。

通过引入 `WhiteboardToolRegistry` 与 `IWhiteboardTool` 接口，将原有的硬编码绘图工具解耦并转换为标准 Tool Extension，内置注册 11 款基础工具（`Selection`, `Pen`, `Rectangle`, `Ellipse`, `Arrow`, `Connector`, `Text`, `Image`, `Sticky Note`, `Hand`, `Eraser`），同时向第三方插件开放扩充新工具（如 `MindMap`, `Mermaid`, `GeoGebra`, `Blockly`, `Scratch`, `Code Runner`, `Flowchart`, `UML`）。现有 Konva 画布渲染与绘图行为 100% 保持不变。

---

## 2. Core Tool Interfaces & Lifecycle (工具接口与生命周期)

```typescript
export type WhiteboardToolCategory =
  | 'Selection'
  | 'Drawing'
  | 'Shape'
  | 'Annotation'
  | 'Media'
  | 'Extension';

export interface WhiteboardToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly category: WhiteboardToolCategory;
  readonly cursor?: string;
  readonly shortcut?: string;
  readonly priority?: number;
  readonly permissions?: ReadonlyArray<string>;
}

export interface IWhiteboardTool {
  readonly meta: WhiteboardToolMetadata;
  activate?: (context?: Record<string, unknown>) => void;
  deactivate?: () => void;
  dispose?: () => void;
}
```

---

## 3. Built-in Tools & Plugin Extension API (内置工具与插件扩展范例)

```typescript
import {
  WhiteboardToolRegistry,
  registerDefaultWhiteboardTools,
  IWhiteboardTool,
} from './src/features/whiteboard/tool-system/index.js';

const registry = new WhiteboardToolRegistry();

// 1. Register 11 default tools
registerDefaultWhiteboardTools(registry);

// 2. Register plugin extension tool
const mindMapPluginTool: IWhiteboardTool = {
  meta: {
    id: 'tool_plugin_mindmap',
    name: 'MindMap Tool',
    category: 'Extension',
    icon: 'git-merge',
    priority: 200,
  },
  activate: () => console.log('MindMap tool activated'),
  deactivate: () => console.log('MindMap tool deactivated'),
};

registry.register(mindMapPluginTool);

// 3. Activate tool
registry.activateTool('tool_plugin_mindmap');
```
