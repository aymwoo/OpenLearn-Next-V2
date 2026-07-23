# OpenLearn Workspace Layout Manager Specification (工作区布局管理器规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P1-05 中，基于已完成的 Workspace Shell 成功构建了 **Workspace Layout Manager**（位于 `src/features/workspace/`）。

布局管理器提供 `WorkspaceRegion` API、基于 localStorage 序列化的 `LayoutStore` 自动状态持久化与恢复，以及针对第三方插件的 Widget 注册与重置扩展接口。同时保证当前 UI 100% 保持不变。

---

## 2. Supported Workspace Regions & State Operations (区域与状态操作)

布局管理器支持 8 大工作区区域（`TopBar`, `LeftSidebar`, `CenterWorkspace`, `RightSidebar`, `BottomPanel`, `StatusBar`, `FloatingArea`, `DialogArea`），每个区域均支持 7 标准控制操作：

- `show(region)` / `hide(region)`: 控制显隐
- `collapse(region)` / `expand(region)`: 控制折叠
- `resize(region, size)`: 尺寸重置（校验合法性）
- `pin(region)` / `unpin(region)`: 控制钉住状态
- `fullscreen(region, enable)`: 全屏放大
- `setActiveTab(region, tabId)`: 切换激活 Tab

---

## 3. Layout Persistence (状态自动持久化)

使用 `LayoutStore` 在 `localStorage` 中自动持久化保存 `openlearn_workspace_layout_v1` 描述符，在页面加载时自动重构与还原上一次布局设置。

---

## 4. Plugin Widget Extension API (插件 Widget 扩展)

```typescript
import { WorkspaceLayoutManager } from './src/features/workspace/index.js';

const layoutManager = new WorkspaceLayoutManager();

// Register new widget
layoutManager.registerWidget({
  id: 'widget_ai_insights',
  name: 'AI Insights Widget',
  region: 'RightSidebar',
});

// Move widget to BottomPanel
layoutManager.moveWidget('widget_ai_insights', 'BottomPanel');

// Replace or hide widget
layoutManager.hideWidget('widget_ai_insights');
```
