# OpenLearn Workspace Shell Specification (工作区 Shell 框架规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P1-01 中，成功构建了 **Classroom Workspace Shell**（位于 `src/features/workspace/`）。

工作区 Shell 采用纯插槽驱动模式（Slot-driven Architecture），提供 8 大标准 `WorkspaceSlotType`，彻底解耦了具体面板（AI Panel, Resource Panel, Activity Panel 等）与工作区框架布局。官方组件与第三方插件均可以通过 `WorkspaceSlotRegistry` 注册为各 Slot 的 Provider。

---

## 2. Workspace Slot Topology (8 大标准插槽图谱)

```
====================================================================
 Slot Name        | Render Location           | Target Content
====================================================================
 TopBar           | Top Full Width (z-30)     | Header / Navigation
 LeftSidebar      | Left Drawer / Bar (z-20)  | Resource / Activity List
 MainCanvas       | Center Main Canvas        | Interactive Whiteboard
 RightSidebar     | Right Inspector (z-20)    | AI Assistant / Inspector
 BottomPanel      | Bottom Action Bar (z-20)  | Media Controls / Timeline
 StatusBar        | Bottom Full Width (z-30)  | System Status / Telemetry
 FloatingArea     | Absolute Overlay (z-40)   | Floating Toolbars / Pills
 DialogArea       | Modal Layer (z-50)        | Modal Dialogs / Overlays
====================================================================
```

---

## 3. Core API & Usage Example (使用示例)

```tsx
import React from 'react';
import {
  WorkspaceProvider,
  WorkspaceLayout,
  WorkspaceSlotRegistry,
} from './src/features/workspace/index.js';

const registry = new WorkspaceSlotRegistry();

// Register official or plugin slot provider
registry.register({
  id: 'provider_topbar_nav',
  slot: 'TopBar',
  priority: 100,
  render: () => <header>Classroom Header</header>,
});

export const AppWorkspace = () => (
  <WorkspaceProvider registry={registry}>
    <WorkspaceLayout />
  </WorkspaceProvider>
);
```
