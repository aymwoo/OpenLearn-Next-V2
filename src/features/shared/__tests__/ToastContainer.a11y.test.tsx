/**
 * ToastContainer 无障碍回归门禁（WCAG 对比度 + 动效不透明度）
 *
 * ## 为什么要单独守一道
 *
 * 2026-10-25 的审计发现：全局 toast 的**说明文字**在暗色主题下用
 * `text-gray-500 dark:text-gray-400`，且整块 toast 带透明度淡入淡出。
 * axe 会按元素不透明度混合前景/背景，于是：
 *
 * - 淡入动画期间（实测 opacity 经过 0.26 / 0.4 / 0.55）文字实际对比度跌到 4.5:1 以下；
 * - 无障碍门禁 `e2e/a11y-gate.spec.ts` 恰好在这个窗口里采样 → 报出一条并不存在的
 *   对比度违规，让门禁在「单跑绿 / 全量跑红」之间摇摆。
 *
 * 浏览器级采样很难稳定复现（依赖 toast 出现的时机），所以这里做一道**确定性**的
 * 单元门禁：直接断言 DOM 上落下的颜色类名与动效参数。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { uiStore } from '../../../store/uiStore';

// 捕获 motion 组件收到的动画参数（initial / animate / exit）。
const { capturedMotionProps } = vi.hoisted(() => ({ capturedMotionProps: [] as Record<string, unknown>[] }));

vi.mock('motion/react', async () => {
  const ReactMod = await import('react');
  const make = (tag: string) => (props: Record<string, unknown>) => {
    capturedMotionProps.push(props);
    // 动效专有属性不能落到 DOM 上（React 会报未知属性警告）
    const { initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...rest } = props;
    return ReactMod.createElement(tag, rest);
  };
  return {
    motion: { div: make('div') },
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});

/** Tailwind v4 调色板（本用例只用到这几个灰阶/板岩色）。 */
const PALETTE: Record<string, string> = {
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'slate-900': '#0f172a',
  white: '#ffffff',
};

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = srgbToLinear((n >> 16) & 0xff);
  const g = srgbToLinear((n >> 8) & 0xff);
  const b = srgbToLinear(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x 对比度：(L1 + 0.05) / (L2 + 0.05) */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 从类名里取出颜色类（如 `text-gray-600` / `dark:text-gray-300`）对应的色号。
 *
 * @param className 元素的 className
 * @param token 完整的 Tailwind 颜色类名，例如 'text-gray-600' / 'dark:text-gray-300'
 */
function resolveColorToken(className: string, token: string): string | null {
  const escaped = token.replace(/[/:]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  if (!re.test(className)) return null;
  // 'dark:text-gray-300' -> 'gray-300'；'text-gray-600' -> 'gray-600'
  const base = token.replace(/^dark:/, '').replace(/^text-/, '');
  return PALETTE[base] ?? null;
}

describe('ToastContainer 无障碍：说明文字对比度与动效不透明度', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    capturedMotionProps.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderOneToast() {
    uiStore.getState().addToast({
      id: 't-a11y',
      title: '🔒 锁状态更新',
      message: '全班专注锁定成功，学生将无法切回主页。',
      type: 'success',
    });
    render(<ToastContainer />);
    return screen.getByText('全班专注锁定成功，学生将无法切回主页。');
  }

  it('说明文字在浅色主题下对比度 ≥ 7:1（WCAG AAA 文本）', () => {
    const el = renderOneToast();
    const cls = el.className;

    const hex = resolveColorToken(cls, 'text-gray-600');
    expect(hex, `浅色主题应使用 text-gray-600，实际类名：${cls}`).not.toBeNull();

    const ratio = contrastRatio(hex as string, PALETTE.white);
    expect(ratio, `浅色主题说明文字对比度 ${ratio.toFixed(2)}:1 低于 7:1 基线（类名：${cls}）`).toBeGreaterThanOrEqual(
      7,
    );
  });

  it('说明文字在暗色主题下对比度 ≥ 10:1', () => {
    const el = renderOneToast();
    const cls = el.className;

    const hex = resolveColorToken(cls, 'dark:text-gray-300');
    expect(hex, `暗色主题应使用 dark:text-gray-300，实际类名：${cls}`).not.toBeNull();

    const ratio = contrastRatio(hex as string, PALETTE['slate-900']);
    expect(ratio, `暗色主题说明文字对比度 ${ratio.toFixed(2)}:1 低于 10:1 基线（类名：${cls}）`).toBeGreaterThanOrEqual(
      10,
    );
  });

  it('toast 不做透明度淡入淡出 —— 文字全程以完整不透明度渲染', () => {
    renderOneToast();

    const props = capturedMotionProps.at(-1) as
      { initial?: { opacity?: number }; animate?: { opacity?: number }; exit?: { opacity?: number } } | undefined;
    expect(props, '未捕获到 motion 组件的动画参数').toBeDefined();

    for (const phase of ['initial', 'animate', 'exit'] as const) {
      const opacity = props?.[phase]?.opacity;
      expect(
        opacity,
        `${phase} 阶段的 opacity 应为 undefined 或 1 —— 淡入淡出会让文字在动画期间掉出 WCAG 对比度阈值`,
      ).toBeUndefined();
    }
  });
});
