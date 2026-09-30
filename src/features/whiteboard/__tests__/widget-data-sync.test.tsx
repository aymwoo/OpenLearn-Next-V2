import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CodeSandboxWrapper } from '../widgets/CodeSandboxWrapper';
import { MathGraphWrapper } from '../widgets/MathGraphWrapper';

/**
 * 服务端图元数据 → 组件本地 state 的反向同步。
 *
 * 教师端改动会持久化并广播刷新，学生端 `data` 随之变化；若组件只把
 * `data` 读进 `useState` 而不回填，学生看到的永远是打开时的那份。
 * 随机点名、数学图表、代码沙箱都曾栽在这里（点名与图表已分别修复）。
 */

// jsdom 不提供 ResizeObserver，而 MathGraphWrapper 用它测量画布尺寸
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CodeSandboxWrapper — 跟随教师端的代码更新', () => {
  it('data.code 变化时回填本地编辑器内容', () => {
    const { rerender } = render(
      <CodeSandboxWrapper
        elementId="cs-1"
        data={{ code: 'const a = 1;' }}
        onPointerDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('const a = 1;')).toBeDefined();

    rerender(
      <CodeSandboxWrapper
        elementId="cs-1"
        data={{ code: 'const b = 2; // 教师现场改的代码' }}
        onPointerDown={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByDisplayValue('const a = 1;')).toBeNull();
    expect(screen.getByDisplayValue('const b = 2; // 教师现场改的代码')).toBeDefined();
  });
});

describe('MathGraphWrapper — 跟随教师端的公式更新', () => {
  it('data.equation 变化时回填本地公式', () => {
    const props = { elementId: 'mg-1', onPointerDown: vi.fn(), onDelete: vi.fn() };
    const { rerender } = render(<MathGraphWrapper {...props} data={{ equation: 'sin(x)' }} />);

    expect(screen.getByDisplayValue('sin(x)')).toBeDefined();

    rerender(<MathGraphWrapper {...props} data={{ equation: 'cos(x) * 2' }} />);

    expect(screen.queryByDisplayValue('sin(x)')).toBeNull();
    expect(screen.getByDisplayValue('cos(x) * 2')).toBeDefined();
  });
});
