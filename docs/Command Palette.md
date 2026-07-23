# OpenLearn Global Command Palette Specification (全局命令面板规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P2-05 中，成功构建了 **Global Command Palette**（位于 `src/features/command-palette/`）。

命令面板提供键盘优先 (Keyboard-first) 的全局快捷命令交互入口，支持关键词模糊搜索、7 大分级分类 (`Lesson`, `Whiteboard`, `Plugin`, `AI`, `Workspace`, `Analytics`, `Resource`)、最近命令 (Recents) 与收藏 (Favorites) 管理。命令的执行严格委托给已有解耦的能力 API (Capability API)，拒绝任何业务逻辑重复。官方命令与第三方插件命令统一采用一套接口定义。

---

## 2. Command Descriptor & API Contracts (命令描述符与契约)

```typescript
export type CommandCategory =
  | 'Lesson'
  | 'Whiteboard'
  | 'Plugin'
  | 'AI'
  | 'Workspace'
  | 'Analytics'
  | 'Resource';

export interface CommandDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: CommandCategory;
  readonly keywords?: ReadonlyArray<string>;
  readonly permissions?: ReadonlyArray<string>;
  readonly shortcut?: string;
  readonly execute: (context?: Record<string, unknown>) => void | Promise<void>;
}
```

---

## 3. Keyboard Navigation & Shortcuts (键盘操作与快捷键)

- **`Cmd + K` / `Ctrl + K`**: 唤起 / 关闭命令面板 Modal 浮层
- **`Up Arrow` / `Down Arrow`**: 选中命令列表中上下移动焦点
- **`Enter`**: 触发并执行当前选中的命令，自动关闭面板
- **`Escape`**: 退出并关闭面板

---

## 4. Registering Official & Plugin Extension Commands (注册范例)

```typescript
import { globalCommandRegistry } from './src/features/command-palette/index.js';

// Register Official AI Command
globalCommandRegistry.register({
  id: 'cmd_ai_summarize',
  title: 'Summarize Lesson Key Points',
  category: 'AI',
  keywords: ['summary', 'ai', 'lesson'],
  shortcut: 'Cmd+Shift+S',
  execute: async () => {
    // Delegate execution to Capability API
    const aiCap = capabilityRuntime.resolveCapability('capability_ai');
    await aiCap.summarize();
  },
});

// Register Third-party Plugin Command
globalCommandRegistry.register({
  id: 'cmd_plugin_export_pdf',
  title: 'Export Whiteboard to PDF',
  category: 'Plugin',
  keywords: ['export', 'pdf', 'whiteboard'],
  execute: () => {
    console.log('Exporting PDF via Plugin API...');
  },
});
```
