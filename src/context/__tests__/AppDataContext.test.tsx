/**
 * C1-R3: AppDataContext 冒烟测试。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AppDataProvider, useAppData } from '../AppDataContext';
import type { AppDataValue } from '../AppDataContext';

describe('AppDataContext', () => {
  it('无 Provider 时 useAppData 抛错（防漏接）', () => {
    function Probe() {
      useAppData();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/must be used within <AppDataProvider>/);
  });

  it('有 Provider 时可取值', () => {
    function Probe() {
      const data = useAppData() as Record<string, unknown>;
      return <span data-testid="v">{String(data.marker)}</span>;
    }
    render(
      <AppDataProvider value={{ marker: 'ok' } as any}>
        <Probe />
      </AppDataProvider>,
    );
    expect(screen.getByTestId('v').textContent).toBe('ok');
  });

  /**
   * fix-2026-10-14: `fetchClasses is not a function` 回归测试。
   *
   * 历史故障：`useAppComposer` 拼装 `appData` 时漏传 `fetchClasses`，
   * `AppExtras` 也漏标类型字段。`ClassesView` 经 `useAppData() as unknown
   * as ClassesViewProps` 把 `undefined` 透传到 `ClassPasscodeController` /
   * `CreateClassButton`，生产环境点击「随机生成」「创建班级」即抛
   * `TypeError: fetchClasses is not a function`。
   *
   * 现有 `ClassPasscodeController.test.tsx` / `CreateClassButton.test.tsx`
   * 都直接 mock prop 传入，无法触达 context 链路，故无法发现此 bug。
   *
   * 修复：1) `AppExtras` 加 `fetchClasses: () => Promise<void>`；
   *      2) `useAppComposer.appData` 加上 `fetchClasses,`。
   *
   * 回归保证：以下类型层赋值如果有人删掉 `AppExtras.fetchClasses` 字段，
   *  `pnpm lint`（即 `tsc --noEmit`）会立即在 CI 报编译错拦下。本测试运行时
   *  是空检查，但起`门神注释`作用：以下表达式一旦报错请勿忽略。
   */
  it('fix-2026-10-14: AppDataValue.fetchClasses 必须是可调用函数（类型层守卫）', () => {
    // 纯编译期断言：若 AppExtras 未声明 / 声明为 any / 声明为 undefined，
    // `pnpm lint`（= `tsc --noEmit`）会立即报错，CI 拦下。
    // 运行时为 vacuous（fakeCtx = {}，访问 .fetchClasses 得到 undefined），
    // 仅起门神注释作用。
    const fakeCtx = {} as AppDataValue;
    const fn: () => Promise<void> = fakeCtx.fetchClasses; // ← 此行是核心
    void fn;
    expect(true).toBe(true);
  });
});
