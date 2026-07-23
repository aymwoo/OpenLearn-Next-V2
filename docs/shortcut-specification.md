# OpenLearn Whiteboard Shortcut Specification

> **Target Module**: `src/features/whiteboard/interaction-engine/shortcut/shortcut-engine.ts`  
> **Status**: Approved & Integrated

---

## 1. Registered Keyboard Shortcuts Matrix

| Key Combination | Action Name | Subsystem Target | Description |
|---|---|---|---|
| `Delete` / `Backspace` | `delete_selected` | CommandManager | 删除当前选中的白板对象 |
| `Ctrl + C` / `Cmd + C` | `copy` | ClipboardService | 复制当前选中对象至剪贴板 |
| `Ctrl + V` / `Cmd + V` | `paste` | ClipboardService | 将剪贴板对象粘贴至画布（带坐标偏移） |
| `Ctrl + X` / `Cmd + X` | `cut` | ClipboardService | 剪切当前选中对象 |
| `Ctrl + D` / `Cmd + D` | `duplicate` | ClipboardService | 快速复制副本（Duplicate） |
| `Ctrl + Z` / `Cmd + Z` | `undo` | CommandManager | 撤销上一步白板操作 |
| `Ctrl + Shift + Z` / `Ctrl + Y` | `redo` | CommandManager | 重做下一步白板操作 |
| `Ctrl + A` / `Cmd + A` | `select_all` | SelectionEngine | 全选当前页面中的所有白板对象 |
| `Space` (Hold) | `pan_mode` | ViewportController | 按住空格键临时切换为平移抓手工具 |
| `Escape` | `reset_tool` | PointerStateMachine | 取消选中状态 / 退出当前工具回归选择指针 |

---

## 2. Extension Guide for Plugins

Plugins can dynamically register custom keyboard shortcuts using `shortcutEngine.registerShortcut()`:

```ts
import { shortcutEngine } from '../features/whiteboard/interaction-engine';

shortcutEngine.registerShortcut({
  id: 'plugin_custom_action',
  key: 'k',
  ctrlKey: true,
  description: 'Trigger Plugin Custom Calculation',
  action: (currentPage) => {
    console.log('Plugin shortcut triggered!');
  },
});
```
