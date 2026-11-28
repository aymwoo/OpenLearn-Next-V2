/**
 * 全类型渲染冒烟测试。
 *
 * 目标：把能力表里「宿主会渲染」的每一种内置类型都真实挂到
 * InteractiveWhiteboard 上，断言画布上出现了对应内容。
 *
 * 这层测试专门防「渲染分支被删掉、逻辑测试却全绿」的静默回归 ——
 * 例如 html-applet / learning_surface 的分支曾一起被删除，元素还在、
 * 画布上却只剩一张空白卡片，纯函数测试完全看不到。
 *
 * 不覆盖的取值（有明确原因）：
 *  - `page_meta`：不可见元数据，本就不渲染；
 *  - `timer` / `whiteboard.renderer`：宿主没有内置分支，只能由插件经
 *    `whiteboard.renderer` 扩展点渲染。
 */
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('react-konva', () => {
  const stub = (name: string) =>
    function KonvaStub({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) {
      return (
        <div data-konva={name} {...rest}>
          {children}
        </div>
      );
    };
  return {
    Stage: stub('Stage'),
    Layer: stub('Layer'),
    Group: stub('Group'),
    Rect: stub('Rect'),
    Circle: stub('Circle'),
    Line: stub('Line'),
    Text: stub('Text'),
  };
});

vi.mock('react-konva-utils', () => ({
  Html: ({ children }: React.PropsWithChildren) => <div data-konva="Html">{children}</div>,
}));

vi.mock('pptx-react-viewer', () => ({ PowerPointViewer: () => <div data-testid="mock-pptx-viewer" /> }));
vi.mock('pptx-react-viewer/styles', () => ({}));

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="mock-extension-point" />,
}));

// ── 组件包装器：只保留「有没有渲染」这一个信号 ────────────────────────────
vi.mock('../widgets/PluginCardRenderer', () => ({
  PluginCardRenderer: () => <div data-testid="smoke-plugin" />,
}));
vi.mock('../widgets/RollCallWrapper', () => ({
  RollCallWrapper: () => <div data-testid="smoke-rollcall" />,
}));
vi.mock('../widgets/CodeSandboxWrapper', () => ({
  CodeSandboxWrapper: () => <div data-testid="smoke-code-sandbox" />,
}));
vi.mock('../widgets/MathGraphWrapper', () => ({
  MathGraphWrapper: () => <div data-testid="smoke-math-graph" />,
}));
vi.mock('../widgets/HelloWorldWrapper', () => ({
  HelloWorldWrapper: () => <div data-testid="smoke-hello-world" />,
}));
vi.mock('../widgets/RevealPresentationWrapper', () => ({
  RevealPresentationWrapper: () => <div data-testid="smoke-presentation" />,
}));
vi.mock('../../courseware/CoursewareHost', () => ({
  CoursewareHost: () => <div data-testid="smoke-courseware-host" />,
}));
vi.mock('../../courseware/CoursewareScoresOverlay', () => ({
  CoursewareScoresOverlay: () => <div data-testid="mock-scores-overlay" />,
}));
vi.mock('../../learning-surface/LearningSurfaceHost', () => ({
  LearningSurfaceHost: () => <div data-testid="smoke-learning-surface" />,
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
  getOptionalSocket: () => null,
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';
import { ELEMENT_CAPABILITIES } from '../core/element-capabilities';
import type { PaletteItemConfig } from '../../teacher/lesson-editor/paletteConfig';
import { paletteItemRegistry } from '../../teacher/lesson-editor/palette-item-registry';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 768 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

beforeEach(() => {
  // quiz 计数等挂载请求不需要真实网络
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => null })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const dummyAdd = vi.fn(async () => {});
const dummyUpdate = vi.fn(async () => {});

type Marker = { kind: 'konva'; node: 'Line' | 'Rect' | 'Circle' | 'Text' } | { kind: 'testid'; testId: string };

interface SmokeCase {
  type: string;
  data: Record<string, unknown>;
  marker: Marker;
}

const geometry = { x: 20, y: 20, width: 320, height: 240, page: 0 };

const CASES: SmokeCase[] = [
  // 绘图
  {
    type: 'pen',
    data: { ...geometry, points: [0, 0, 10, 10], color: '#000000' },
    marker: { kind: 'konva', node: 'Line' },
  },
  {
    type: 'highlighter',
    data: { ...geometry, points: [0, 0, 10, 10], color: '#facc15' },
    marker: { kind: 'konva', node: 'Line' },
  },
  { type: 'rectangle', data: geometry, marker: { kind: 'konva', node: 'Rect' } },
  { type: 'circle', data: { ...geometry, radius: 40 }, marker: { kind: 'konva', node: 'Circle' } },
  { type: 'shape', data: { ...geometry, shape: 'rect' }, marker: { kind: 'konva', node: 'Rect' } },
  { type: 'shape', data: { ...geometry, shape: 'circle', radius: 40 }, marker: { kind: 'konva', node: 'Circle' } },
  { type: 'text', data: { ...geometry, text: '冒烟文本' }, marker: { kind: 'konva', node: 'Text' } },
  // 教学组件
  {
    type: 'quiz',
    data: { ...geometry, question: '冒烟题目', options: ['A', 'B'] },
    marker: { kind: 'testid', testId: 'whiteboard-quiz-el-quiz' },
  },
  {
    type: 'assignment',
    data: { ...geometry, title: '冒烟作业', description: '描述' },
    marker: { kind: 'testid', testId: 'assignment-submit-button' },
  },
  { type: 'rollcall', data: { ...geometry, allStudents: [] }, marker: { kind: 'testid', testId: 'smoke-rollcall' } },
  {
    type: 'code-sandbox',
    data: { ...geometry, code: 'console.log(1)' },
    marker: { kind: 'testid', testId: 'smoke-code-sandbox' },
  },
  {
    type: 'math-graph',
    data: { ...geometry, equation: 'Math.sin(x)' },
    marker: { kind: 'testid', testId: 'smoke-math-graph' },
  },
  {
    type: 'presentation',
    data: { ...geometry, markdown: '# Slide' },
    marker: { kind: 'testid', testId: 'smoke-presentation' },
  },
  {
    type: 'learning_surface',
    data: { ...geometry, surfaceId: 'surface-smoke' },
    marker: { kind: 'testid', testId: 'smoke-learning-surface' },
  },
  {
    type: 'html-applet',
    data: { ...geometry, coursewareUuid: 'cw-smoke' },
    marker: { kind: 'testid', testId: 'smoke-courseware-host' },
  },
  { type: 'hello-world', data: geometry, marker: { kind: 'testid', testId: 'smoke-hello-world' } },
  {
    type: 'plugin',
    data: { ...geometry, pluginId: 'ext-smoke', teacherWidgetId: 'w1' },
    marker: { kind: 'testid', testId: 'smoke-plugin' },
  },
];

/**
 * 能力表里「宿主应当渲染」的类型：排除不可见元数据与纯插件通道。
 *
 * 这个集合由能力表推导，而不是手写 —— 新增一个 widget / graphic 类型却
 * 忘了补冒烟用例时，下面的覆盖守卫会直接红。
 */
const HOST_RENDERED_TYPES = ELEMENT_CAPABILITIES.filter(
  (capability) => capability.kind !== 'meta' && capability.kind !== 'extension',
).map((capability) => capability.type);

function renderBoard(
  elements: Array<{ id: string; type: string; data: string }>,
  overrides: Record<string, unknown> = {},
) {
  return render(
    <InteractiveWhiteboard
      lessonId="lesson-smoke"
      elements={elements}
      onElementAdd={dummyAdd}
      onElementUpdate={dummyUpdate}
      userRole="teacher"
      hidePageBar
      {...overrides}
    />,
  );
}

const elementFor = (testCase: Pick<SmokeCase, 'type' | 'data'>, id = `el-${testCase.type}`) => ({
  id,
  type: testCase.type,
  data: JSON.stringify(testCase.data),
});

async function expectMarker(container: HTMLElement, marker: Marker, label: string) {
  if (marker.kind === 'konva') {
    expect(container.querySelector(`[data-konva="${marker.node}"]`), `${label} 未渲染 ${marker.node}`).toBeTruthy();
    return;
  }
  // lazy / Suspense 组件（如 presentation）可能需要等一拍
  expect(await screen.findByTestId(marker.testId), `${label} 未渲染内容`).toBeTruthy();
}

describe('全类型渲染冒烟', () => {
  it('用例表覆盖能力表里全部宿主可渲染类型', () => {
    expect([...new Set(CASES.map((c) => c.type))].sort()).toEqual([...HOST_RENDERED_TYPES].sort());
  });

  it.each(CASES)('$type 渲染出预期节点', async ({ type, data, marker }) => {
    const { container } = renderBoard([elementFor({ type, data })]);
    await act(async () => {});

    await expectMarker(container, marker, type);
  });
});

describe('边界：全班专注锁定（readOnly）', () => {
  it.each(CASES)('$type 仍然渲染内容', async ({ type, data, marker }) => {
    const { container } = renderBoard([elementFor({ type, data })], { readOnly: true });
    await act(async () => {});

    await expectMarker(container, marker, type);
  });
});

describe('边界：同页共存', () => {
  it('全部类型同时挂载时各自都能渲染，互不吞掉', async () => {
    const seen = new Set<string>();
    const elements = CASES.map((testCase, index) => {
      const isFirstOfType = !seen.has(testCase.type);
      seen.add(testCase.type);
      return elementFor(testCase, isFirstOfType ? `el-${testCase.type}` : `el-${testCase.type}-${index}`);
    });

    const { container } = renderBoard(elements);
    await act(async () => {});

    for (const testCase of CASES) {
      await expectMarker(container, testCase.marker, testCase.type);
    }
  });
});

describe('边界：脏数据', () => {
  it('损坏的 JSON 不会让画布崩溃，卡片类型仍按空数据渲染', async () => {
    // parseElementData 对损坏 JSON 会打 warn，这里只验证「不崩」，把噪音静音
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { container } = renderBoard([
        { id: 'el-bad-quiz', type: 'quiz', data: 'NOT JSON' },
        { id: 'el-bad-assignment', type: 'assignment', data: 'NOT JSON' },
        { id: 'el-bad-plugin', type: 'plugin', data: 'NOT JSON' },
        { id: 'el-bad-applet', type: 'html-applet', data: 'NOT JSON' },
        { id: 'el-bad-surface', type: 'learning_surface', data: 'NOT JSON' },
      ]);
      await act(async () => {});

      expect(container.querySelector('[data-testid="whiteboard-stage-host"]')).toBeTruthy();
      expect(screen.getByTestId('whiteboard-quiz-el-bad-quiz')).toBeTruthy();
      expect(screen.getByTestId('assignment-submit-button')).toBeTruthy();
      expect(screen.getByTestId('smoke-plugin')).toBeTruthy();
      expect(screen.getByTestId('smoke-courseware-host')).toBeTruthy();
      expect(screen.getByText('学习面未绑定内容')).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });

  it('对象型 question / title / description 不会崩溃，文本字段回落到兜底', async () => {
    const { container } = renderBoard([
      {
        id: 'el-quiz',
        type: 'quiz',
        data: JSON.stringify({ page: 0, question: { bad: true }, options: ['A'] }),
      },
      {
        id: 'el-assignment',
        type: 'assignment',
        data: JSON.stringify({ page: 0, title: { bad: true }, description: { bad: true } }),
      },
    ]);
    await act(async () => {});

    expect(container.querySelector('[data-testid="whiteboard-stage-host"]')).toBeTruthy();
    // quiz 题目的兜底文案
    expect(screen.getByText('随堂测验题目')).toBeTruthy();
    // assignment 卡片仍然完整挂载
    expect(screen.getByTestId('assignment-submit-button')).toBeTruthy();
  });

  it('调色板兜底卡片遇到对象 title 时只渲染标签，不崩溃', async () => {
    paletteItemRegistry.register(
      {
        type: 'palette-title-smoke',
        labelZh: '调色板组件',
        descriptionZh: '调色板描述',
      } as PaletteItemConfig,
      'smoke',
    );
    try {
      const { container } = renderBoard([
        {
          id: 'el-palette',
          type: 'palette-title-smoke',
          data: JSON.stringify({ ...geometry, title: { bad: true } }),
        },
      ]);
      await act(async () => {});

      expect(container.querySelector('[data-testid="whiteboard-stage-host"]')).toBeTruthy();
      expect(screen.getByText('调色板描述')).toBeTruthy();
      expect(screen.queryByText('[object Object]')).toBeNull();
    } finally {
      paletteItemRegistry.unregister('palette-title-smoke', 'smoke');
    }
  });

  it('未知类型不渲染内容，也不会让画布崩溃', async () => {
    const { container } = renderBoard([{ id: 'el-mystery', type: 'mystery-widget', data: JSON.stringify(geometry) }]);
    await act(async () => {});

    expect(container.querySelector('[data-testid="whiteboard-stage-host"]')).toBeTruthy();
    expect(container.querySelector('[data-widget-frame="true"]')).toBeNull();
    expect(screen.queryByTestId('smoke-plugin')).toBeNull();
  });
});

describe('边界：尺寸与窗口状态', () => {
  it('缺少 width/height 时仍按能力表默认尺寸渲染', async () => {
    const { container } = renderBoard([
      { id: 'el-quiz', type: 'quiz', data: JSON.stringify({ page: 0, question: 'Q', options: ['A'] }) },
      { id: 'el-rect', type: 'rectangle', data: JSON.stringify({ page: 0, x: 10, y: 10 }) },
    ]);
    await act(async () => {});

    expect(screen.getByTestId('whiteboard-quiz-el-quiz')).toBeTruthy();
    expect(container.querySelector('[data-konva="Rect"]')).toBeTruthy();
  });

  it('最小化时保留窗口框架与标题栏，只隐藏内容', async () => {
    const { container } = renderBoard([
      {
        id: 'el-plugin',
        type: 'plugin',
        data: JSON.stringify({ ...geometry, isMinimized: true, pluginId: 'ext-smoke', teacherWidgetId: 'w1' }),
      },
    ]);
    await act(async () => {});

    expect(container.querySelector('[data-widget-frame="true"]')).toBeTruthy();
    expect(container.querySelector('[data-widget-titlebar="true"]')).toBeTruthy();
    expect(screen.queryByTestId('smoke-plugin')).toBeNull();
  });
});
