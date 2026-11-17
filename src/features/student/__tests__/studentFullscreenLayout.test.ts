/**
 * 学生端课节双栏全屏显隐规则的单元测试（Issue IKVSIN）。
 *
 * 核心约束（回归防线）：**每个状态必须产出唯一且完整的显隐表达**。
 * 旧实现里「默认态」与「右栏全屏态」共用同一个 class 集合
 * （`w-1/3 md:block hidden`），右栏全屏只是追加一个 `hidden`，而 Tailwind v4 中
 * `.md\:block` 位于 `@media (min-width:48rem)` 内且晚于 `.hidden`，同层同优先级
 * 下胜出 ⇒ 追加的 `hidden` 覆盖不掉它 ⇒ 桌面端左栏依然可见（「点了全屏没反应」）。
 *
 * 因此本文件按**窄屏 / 桌面端两个宽度**分别断言每个状态的显隐结果，
 * 而不只是断言 class 字符串。
 *
 * 注意：这里判定的是「是否被隐藏」，不断言具体的 display 值 —— 交互区的静态类
 * 里还带 `flex flex-col`，其 display 是 `flex` 而非 `block`。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveContentPanelClass,
  resolveInteractionPanelClass,
  type StudentFullscreenPanel,
} from '../studentFullscreenLayout';

const STATES: StudentFullscreenPanel[] = ['none', 'left', 'right'];

function hasClass(cls: string, name: string): boolean {
  return cls.split(/\s+/).includes(name);
}

/**
 * 复刻 Tailwind v4 的实际级联（实测编译产物）：
 * `.hidden { display:none }` 早于 `@media (min-width:48rem) { .md\:block { display:block } }`，
 * 同层同优先级 ⇒ 后者胜出。
 *
 * @param cls 元素 class
 * @param width 断点：`narrow` = <48rem（媒体查询不生效），`desktop` = ≥48rem
 * @returns 该宽度下元素是否被隐藏
 */
function hiddenAt(cls: string, width: 'narrow' | 'desktop'): boolean {
  const hidden = hasClass(cls, 'hidden');
  const mdBlock = hasClass(cls, 'md:block');
  // 窄屏：媒体查询不生效，只有 `.hidden` 起作用
  if (width === 'narrow') return hidden;
  // 桌面端：`.md\:block` 更靠后，胜出
  return mdBlock ? false : hidden;
}

/** 一个状态下两栏的「窄屏 / 桌面端」隐藏情况。 */
function visibility(state: StudentFullscreenPanel, collapsed: boolean) {
  return {
    content: {
      narrow: hiddenAt(resolveContentPanelClass(state, collapsed), 'narrow'),
      desktop: hiddenAt(resolveContentPanelClass(state, collapsed), 'desktop'),
    },
    interaction: {
      narrow: hiddenAt(resolveInteractionPanelClass(state, collapsed), 'narrow'),
      desktop: hiddenAt(resolveInteractionPanelClass(state, collapsed), 'desktop'),
    },
  };
}

describe('studentFullscreenLayout', () => {
  describe('resolveContentPanelClass', () => {
    it('右栏全屏时内容栏在所有宽度都隐藏', () => {
      for (const collapsed of [false, true]) {
        const cls = resolveContentPanelClass('right', collapsed);
        expect(hiddenAt(cls, 'narrow')).toBe(true);
        expect(hiddenAt(cls, 'desktop')).toBe(true);
      }
    });

    it('左栏全屏时内容栏在所有宽度都可见并占满宽度', () => {
      for (const collapsed of [false, true]) {
        const cls = resolveContentPanelClass('left', collapsed);
        expect(hiddenAt(cls, 'narrow')).toBe(false);
        expect(hiddenAt(cls, 'desktop')).toBe(false);
        expect(hasClass(cls, 'w-full')).toBe(true);
      }
    });

    it('左栏全屏优先于折叠态（否则两栏同时不可见 → 空白页）', () => {
      // 左栏全屏的语义是「看课程内容」：即便 collapsed 为真，左栏也必须可见，
      // 否则「退出全屏」按钮随之消失，学生无法自救。
      const cls = resolveContentPanelClass('left', true);
      expect(hiddenAt(cls, 'desktop')).toBe(false);
      expect(hiddenAt(cls, 'narrow')).toBe(false);
    });

    it('折叠态下内容栏在所有宽度都隐藏', () => {
      const cls = resolveContentPanelClass('none', true);
      expect(hiddenAt(cls, 'narrow')).toBe(true);
      expect(hiddenAt(cls, 'desktop')).toBe(true);
    });

    it('默认展开态下内容栏仅桌面端显示、占 1/3（窄屏行为与修复前一致）', () => {
      const cls = resolveContentPanelClass('none', false);
      expect(hiddenAt(cls, 'narrow')).toBe(true);
      expect(hiddenAt(cls, 'desktop')).toBe(false);
      expect(hasClass(cls, 'w-1/3')).toBe(true);
    });

    it('「全宽度隐藏」的状态不得携带 md:block（否则桌面端覆盖不掉）', () => {
      // 这是 IKVSIN 的核心回归点：右栏全屏 / 折叠态必须用单一的 `hidden`。
      for (const collapsed of [false, true]) {
        expect(hasClass(resolveContentPanelClass('right', collapsed), 'md:block')).toBe(false);
      }
      expect(hasClass(resolveContentPanelClass('none', true), 'md:block')).toBe(false);
    });

    it('默认展开态刻意使用「hidden md:block」表达「仅桌面端显示」', () => {
      // 与「全宽度隐藏」是两套不同的 class 集合，因此不会再互相覆盖。
      const cls = resolveContentPanelClass('none', false);
      expect(hasClass(cls, 'hidden')).toBe(true);
      expect(hasClass(cls, 'md:block')).toBe(true);
    });
  });

  describe('resolveInteractionPanelClass', () => {
    it('左栏全屏时交互区在所有宽度都隐藏', () => {
      for (const collapsed of [false, true]) {
        const cls = resolveInteractionPanelClass('left', collapsed);
        expect(hiddenAt(cls, 'narrow')).toBe(true);
        expect(hiddenAt(cls, 'desktop')).toBe(true);
      }
    });

    it('右栏全屏时交互区占满整行', () => {
      for (const collapsed of [false, true]) {
        const cls = resolveInteractionPanelClass('right', collapsed);
        expect(hiddenAt(cls, 'narrow')).toBe(false);
        expect(hiddenAt(cls, 'desktop')).toBe(false);
        expect(hasClass(cls, 'w-full')).toBe(true);
        expect(hasClass(cls, 'flex-grow')).toBe(true);
      }
    });

    it('内容栏折叠时交互区独占整行', () => {
      const cls = resolveInteractionPanelClass('none', true);
      expect(hiddenAt(cls, 'narrow')).toBe(false);
      expect(hiddenAt(cls, 'desktop')).toBe(false);
      expect(hasClass(cls, 'w-full')).toBe(true);
    });

    it('默认展开态下交互区与内容栏按比例分配', () => {
      const cls = resolveInteractionPanelClass('none', false);
      expect(hiddenAt(cls, 'narrow')).toBe(false);
      expect(hiddenAt(cls, 'desktop')).toBe(false);
      expect(hasClass(cls, 'flex-grow')).toBe(true);
      expect(hasClass(cls, 'flex-1')).toBe(true);
      expect(hasClass(cls, 'w-full')).toBe(false);
    });
  });

  it('任何状态下都不会出现「两个栏同时隐藏」的空白页', () => {
    for (const state of STATES) {
      for (const collapsed of [false, true]) {
        const v = visibility(state, collapsed);
        const bothHidden = v.content.narrow && v.content.desktop && v.interaction.narrow && v.interaction.desktop;
        expect(bothHidden, `state=${state} collapsed=${collapsed} 两栏同时隐藏`).toBe(false);
        // 桌面端与窄屏都不允许出现两栏同时不可见
        expect(v.content.desktop && v.interaction.desktop, `state=${state} collapsed=${collapsed} 桌面端空白页`).toBe(
          false,
        );
        expect(v.content.narrow && v.interaction.narrow, `state=${state} collapsed=${collapsed} 窄屏空白页`).toBe(
          false,
        );
      }
    }
  });

  it('全屏位互斥：同一时刻至多一个栏占据全屏', () => {
    // panel='left' ⇒ 内容栏可见、交互区隐藏；panel='right' ⇒ 反之。
    expect(hiddenAt(resolveContentPanelClass('left', false), 'desktop')).toBe(false);
    expect(hiddenAt(resolveInteractionPanelClass('left', false), 'desktop')).toBe(true);
    expect(hiddenAt(resolveContentPanelClass('right', false), 'desktop')).toBe(true);
    expect(hiddenAt(resolveInteractionPanelClass('right', false), 'desktop')).toBe(false);
  });
});
