/**
 * 快速插入：内置插入项 + 与画板组件面板的接线
 *
 * 守三件事：
 * 1. 内置插入项**由画板组件清单派生** —— 可插入内容的唯一事实来源是
 *    `paletteConfig.PALETTE_ITEMS`，两份清单必然漂移；
 * 2. 执行插入项 → 调用组件面板同一套 `onActivate` 语义；
 * 3. 只读模式下不激活。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { buildBuiltinQuickInsertItems, registerBuiltinQuickInsertItems } from '../builtin-items';
import { QuickInsertRegistry } from '../quick-insert-registry';
import { PALETTE_ITEMS } from '../../teacher/lesson-editor/paletteConfig';

describe('内置快速插入项', () => {
  it('与画板组件清单一一对应', () => {
    const items = buildBuiltinQuickInsertItems({ lang: 'zh', onActivate: vi.fn() });
    expect(items.map((i) => i.id)).toEqual(PALETTE_ITEMS.map((p) => `builtin.quickInsert.${p.type}`));
  });

  it('执行插入项会激活对应画板组件', () => {
    const onActivate = vi.fn();
    const items = buildBuiltinQuickInsertItems({ lang: 'zh', onActivate });
    const target = items.find((i) => i.id === `builtin.quickInsert.${PALETTE_ITEMS[0].type}`);
    target?.execute();
    expect(onActivate).toHaveBeenCalledWith(PALETTE_ITEMS[0].type);
  });

  it('只读模式不激活任何插入项', () => {
    const onActivate = vi.fn();
    const items = buildBuiltinQuickInsertItems({ lang: 'zh', onActivate, readOnly: true });
    for (const item of items) item.execute();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('语言决定标题与关键词', () => {
    const zh = buildBuiltinQuickInsertItems({ lang: 'zh', onActivate: vi.fn() });
    const en = buildBuiltinQuickInsertItems({ lang: 'en', onActivate: vi.fn() });
    const first = PALETTE_ITEMS[0];
    expect(zh[0].title).toBe(first.labelZh);
    expect(en[0].title).toBe(first.labelEn);
  });

  it('登记是幂等的：重复 register 不会累积重复项', () => {
    const registry = new QuickInsertRegistry();
    const ctx = { lang: 'zh' as const, onActivate: vi.fn() };
    registerBuiltinQuickInsertItems(registry, ctx);
    const first = registry.listAll().length;
    registerBuiltinQuickInsertItems(registry, ctx);
    expect(registry.listAll().length).toBe(first);
  });
});
