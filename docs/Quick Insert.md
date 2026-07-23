# OpenLearn Quick Insert Specification (Slash Command 快捷插入规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P2-07 中，成功构建了 **Slash Command Quick Insert System**（位于 `src/features/quick-insert/`）。

快捷插入系统提供基于 `/` 的内联弹出菜单，支持从媒体 (`Media`)、图形 (`Shape`)、白板工具 (`Tool`)、AI 助手 (`AI`)、工作区组件 (`Widget`) 与第三方插件 (`Plugin`) 中快捷插入内容。官方 Provider 与第三方 Plugin Provider 统一采用一套接口，插入执行严格重用解耦的能力 API。

---

## 2. Descriptor & API Contracts (插入项描述符与 Provider 契约)

```typescript
export type QuickInsertCategory =
  | 'Media'
  | 'Shape'
  | 'Tool'
  | 'AI'
  | 'Widget'
  | 'Plugin';

export interface QuickInsertItemDescriptor {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: QuickInsertCategory;
  readonly keywords?: ReadonlyArray<string>;
  readonly shortcut?: string;
  readonly execute: (context?: Record<string, unknown>) => void | Promise<void>;
}

export interface QuickInsertProvider {
  readonly id: string;
  readonly getItems: () => ReadonlyArray<QuickInsertItemDescriptor>;
}
```

---

## 3. Slash Command Keyboard Navigation (键盘交互)

- **`/`**: 在输入区域键入 `/` 唤起 Quick Insert 弹出菜单
- **`Up Arrow` / `Down Arrow`**: 列表项上下选择
- **`Enter`**: 触发插入项并执行 Capability API
- **`Escape`**: 退出并关闭弹出菜单

---

## 4. Provider Registration Example (注册范例)

```typescript
import { globalQuickInsertRegistry } from './src/features/quick-insert/index.js';

// Official Item Registration
globalQuickInsertRegistry.registerItem({
  id: 'insert_media_image',
  title: 'Insert Image Asset',
  category: 'Media',
  keywords: ['image', 'photo'],
  execute: async () => {
    console.log('Inserting image...');
  },
});

// Plugin Provider Registration
globalQuickInsertRegistry.registerProvider({
  id: 'provider_plugin_chart',
  getItems: () => [
    {
      id: 'insert_plugin_chart',
      title: 'Insert Dynamic Chart Widget',
      category: 'Plugin',
      keywords: ['chart', 'graph'],
      execute: async () => {
        console.log('Inserting dynamic chart...');
      },
    },
  ],
});
```
