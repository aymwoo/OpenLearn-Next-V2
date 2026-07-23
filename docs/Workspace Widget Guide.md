# OpenLearn Workspace Widget Guide (工作空间 Widget 指南)

## 1. Overview (概述)

OpenLearn Workspace 采用 Slot + Widget 机制构建。所有面板（包括 AI Teacher Workspace Widget）均作为一等公民 Widget 注册在 `WorkspaceSlotRegistry` 中。

---

## 2. Standard Slots & Lifecycle (标准 Slot 与 Widget 生命周期)

- **TopBar**: 顶部状态与工具条 Slot
- **LeftSidebar**: 左侧主导航 Slot
- **MainCanvas**: 中央白板与课件 Main Canvas Slot
- **RightSidebar**: 右侧工具面板 Slot (AI Teacher Workspace 默认驻留位)
- **BottomPanel**: 底部信息面板 Slot
- **StatusBar**: 底部状态栏 Slot
- **FloatingArea**: 浮动组件区域 Slot
- **DialogArea**: 模态框与弹窗 Slot

---

## 3. Widget Controls (Widget 控件支持)

Widget 支持下列状态管理与控制动作：
- `show` / `hide`: 显示与隐藏
- `pin` / `unpin`: 固定于 Sidebar 或取消固定
- `float` / `dock`: 浮动窗口与侧栏悬挂模式切换
- `fullscreen` / `restore`: 全屏模式与还原
- `collapse` / `expand`: 折叠与展开
