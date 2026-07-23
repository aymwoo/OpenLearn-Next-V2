import type { CanvasPage } from '../../canvas-model/types.js';
import type { ShortcutDefinition } from '../types.js';

export class ShortcutEngine {
  private shortcuts: ShortcutDefinition[] = [];

  constructor() {
    this.registerDefaultShortcuts();
  }

  /**
   * Register a keyboard shortcut definition
   */
  public registerShortcut(shortcut: ShortcutDefinition): void {
    this.shortcuts.push(shortcut);
  }

  /**
   * Unregister a shortcut by ID
   */
  public unregisterShortcut(id: string): void {
    this.shortcuts = this.shortcuts.filter((s) => s.id !== id);
  }

  /**
   * Handle incoming KeyboardEvent
   */
  public handleKeyDown(event: KeyboardEvent, page: CanvasPage): CanvasPage | void {
    // Skip if target is inside an input, textarea, or contenteditable element
    const target = event.target as HTMLElement;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    for (const sc of this.shortcuts) {
      const matchKey = sc.key.toLowerCase() === key;
      const matchCtrl = !!sc.ctrlKey === ctrlOrMeta;
      const matchShift = !!sc.shiftKey === event.shiftKey;
      const matchAlt = !!sc.altKey === event.altKey;

      if (matchKey && matchCtrl && matchShift && matchAlt) {
        event.preventDefault();
        const res = sc.action(page);
        if (res) return res;
      }
    }
  }

  /**
   * List all registered shortcut definitions
   */
  public listShortcuts(): ShortcutDefinition[] {
    return [...this.shortcuts];
  }

  private registerDefaultShortcuts(): void {
    this.registerShortcut({
      id: 'delete_selected',
      key: 'Delete',
      description: '删除当前选中的对象',
      action: () => {},
    });

    this.registerShortcut({
      id: 'backspace_selected',
      key: 'Backspace',
      description: '删除当前选中的对象',
      action: () => {},
    });

    this.registerShortcut({
      id: 'copy',
      key: 'c',
      ctrlKey: true,
      description: '复制选中对象',
      action: () => {},
    });

    this.registerShortcut({
      id: 'paste',
      key: 'v',
      ctrlKey: true,
      description: '粘贴剪贴板对象',
      action: () => {},
    });

    this.registerShortcut({
      id: 'cut',
      key: 'x',
      ctrlKey: true,
      description: '剪切选中对象',
      action: () => {},
    });

    this.registerShortcut({
      id: 'duplicate',
      key: 'd',
      ctrlKey: true,
      description: '快速克隆副本',
      action: () => {},
    });

    this.registerShortcut({
      id: 'undo',
      key: 'z',
      ctrlKey: true,
      description: '撤销上一步操作',
      action: () => {},
    });

    this.registerShortcut({
      id: 'redo',
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      description: '重做下一步操作',
      action: () => {},
    });

    this.registerShortcut({
      id: 'select_all',
      key: 'a',
      ctrlKey: true,
      description: '全选白板对象',
      action: () => {},
    });
  }
}

export const shortcutEngine = new ShortcutEngine();
