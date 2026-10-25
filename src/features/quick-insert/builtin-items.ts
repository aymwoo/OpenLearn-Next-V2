/**
 * OpenLearn — 内置「快速插入」项
 *
 * ## 它是什么
 *
 * 左侧组件面板（`LessonPalette`）是**浏览式**的插入入口：分组 + 列表 + 点选。
 * 快速插入是同一批可插入内容的**命令式**入口：在组件面板的搜索框里打 `/`，
 * 浮层接管输入，用模糊搜索直接定位并插入。
 *
 * ## 为什么复用画板组件清单
 *
 * 可插入内容的**唯一事实来源**是 `paletteConfig.PALETTE_ITEMS`（画板白板元素、
 * 课件演示、随堂测验、点名……）。这里由它派生，不另立一份清单 —— 否则两份清单
 * 必然漂移，插入的白板元素类型会对不上。
 *
 * 插件贡献的插入项走 `quick_insert.item` 扩展槽，由 `QuickInsertMenu` 组件自己
 * 合并，这里不重复实现。
 */
import type { QuickInsertItemDescriptor, QuickInsertRegistryFacade } from './quick-insert-types.js';
import { PALETTE_ITEMS } from '../teacher/lesson-editor/paletteConfig.js';

export interface QuickInsertContext {
  lang: 'zh' | 'en';
  /** 激活一个画板组件（与组件面板的 onActivate 同一套语义） */
  onActivate: (type: string) => void;
  /** 只读模式：禁止插入（组件面板同样不允许激活） */
  readOnly?: boolean;
}

/** 画板组件分组 → 快速插入分类。 */
const CATEGORY_BY_GROUP: Record<string, QuickInsertItemDescriptor['category']> = {
  present: 'Media',
  media: 'Media',
  interact: 'Tool',
  tool: 'Tool',
  ai: 'AI',
  widget: 'Widget',
};

export function buildBuiltinQuickInsertItems(ctx: QuickInsertContext): QuickInsertItemDescriptor[] {
  return PALETTE_ITEMS.map((item) => {
    const title = ctx.lang === 'zh' ? item.labelZh : item.labelEn;
    const description = ctx.lang === 'zh' ? item.descriptionZh : item.descriptionEn;
    return {
      id: `builtin.quickInsert.${item.type}`,
      title,
      description,
      category: CATEGORY_BY_GROUP[item.group] ?? 'Widget',
      keywords: [item.type, ...(ctx.lang === 'zh' ? [item.labelZh] : [item.labelEn])],
      execute: () => {
        if (ctx.readOnly) return;
        ctx.onActivate(item.type);
      },
    };
  });
}

/**
 * 把内置插入项登记到注册表。
 *
 * 重复调用是幂等的：`QuickInsertRegistry.registerItem` 按 id 覆盖同名项，
 * 因此语言变化时直接重跑即可刷新文案。
 */
export function registerBuiltinQuickInsertItems(registry: QuickInsertRegistryFacade, ctx: QuickInsertContext): void {
  for (const item of buildBuiltinQuickInsertItems(ctx)) {
    registry.registerItem(item);
  }
}
