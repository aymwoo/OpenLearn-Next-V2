/**
 * 课件类元素的画布渲染回归。
 *
 * 背景：`html-applet` 与 `learning_surface` 的渲染分支曾一起被删除，
 * 元素仍然存在（数据库里有、自动平铺也给它留了位置），画布上却只剩一张
 * 空白卡片 —— 纯逻辑测试看不到，只有真实挂载 InteractiveWhiteboard 才会暴露。
 *
 * 这里锁住两条链路：
 *  - 旧数据 `html-applet` 走 CoursewareHost（HtmlAppletFrame 的继任者）兜底；
 *  - 新数据 `learning_surface` 走 LearningSurfaceHost，未绑定 surfaceId 时给可读占位。
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
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

vi.mock('../widgets/PluginCardRenderer', () => ({
  PluginCardRenderer: () => <div data-testid="mock-plugin-card" />,
}));

vi.mock('../../courseware/CoursewareHost', () => ({
  CoursewareHost: (props: {
    source: Record<string, unknown>;
    lessonId?: string;
    elementId?: string;
    className?: string;
    overlay?: unknown;
  }) => (
    <div
      data-testid="mock-courseware-host"
      data-source={JSON.stringify(props.source)}
      data-lesson-id={props.lessonId ?? ''}
      data-element-id={props.elementId ?? ''}
      data-class-name={props.className ?? ''}
      data-has-overlay={props.overlay ? 'true' : 'false'}
    />
  ),
}));

vi.mock('../../courseware/CoursewareScoresOverlay', () => ({
  CoursewareScoresOverlay: () => <div data-testid="mock-scores-overlay" />,
}));

vi.mock('../../learning-surface/LearningSurfaceHost', () => ({
  LearningSurfaceHost: (props: {
    surfaceId: string;
    lessonId?: string;
    hostId?: string;
    title?: string;
    preview?: boolean;
    lazy?: boolean;
  }) => (
    <div
      data-testid="mock-learning-surface"
      data-surface-id={props.surfaceId}
      data-lesson-id={props.lessonId ?? ''}
      data-host-id={props.hostId ?? ''}
      data-title={props.title ?? ''}
      data-preview={String(Boolean(props.preview))}
      data-lazy={String(Boolean(props.lazy))}
    />
  ),
}));

const { fakeSocket } = vi.hoisted(() => ({
  fakeSocket: { id: 'sock-1', emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('../../../services/socket-service', () => ({
  getSocketInstance: () => fakeSocket,
  getOptionalSocket: () => null,
}));

import { InteractiveWhiteboard } from '../InteractiveWhiteboard';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1024 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 768 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dummyAdd = vi.fn(async () => {});
const dummyUpdate = vi.fn(async () => {});

function renderBoard(
  elements: Array<{ id: string; type: string; data: string }>,
  overrides: Record<string, unknown> = {},
) {
  return render(
    <InteractiveWhiteboard
      lessonId="lesson-courseware"
      elements={elements}
      onElementAdd={dummyAdd}
      onElementUpdate={dummyUpdate}
      userRole="teacher"
      hidePageBar
      {...overrides}
    />,
  );
}

const appletElement = (data: Record<string, unknown>, id = 'el-applet') => ({
  id,
  type: 'html-applet',
  data: JSON.stringify({ x: 20, y: 20, width: 420, height: 300, ...data }),
});

const surfaceElement = (data: Record<string, unknown>, id = 'el-surface') => ({
  id,
  type: 'learning_surface',
  data: JSON.stringify({ x: 20, y: 20, width: 640, height: 400, ...data }),
});

const readSource = (host: HTMLElement): Record<string, unknown> =>
  JSON.parse(host.getAttribute('data-source') || '{}') as Record<string, unknown>;

describe('存量 html-applet 渲染', () => {
  it('coursewareUuid：透传内容源、元素 id，并挂载成绩榜', async () => {
    renderBoard([appletElement({ title: '旧版互动课件', coursewareUuid: 'cw-legacy-1' })]);
    await act(async () => {});

    const host = screen.getByTestId('mock-courseware-host');
    expect(readSource(host)).toMatchObject({ coursewareUuid: 'cw-legacy-1', title: '旧版互动课件' });
    expect(host.getAttribute('data-lesson-id')).toBe('lesson-courseware');
    expect(host.getAttribute('data-element-id')).toBe('el-applet');
    expect(host.getAttribute('data-has-overlay')).toBe('true');

    // 与其它组件一致，套在统一窗口框架里
    expect(document.querySelector('[data-widget-frame="true"]')).toBeTruthy();
    expect(document.querySelector('[data-widget-titlebar="true"]')).toBeTruthy();
  });

  it.each([
    { name: 'resourceId', data: { resourceId: 'res-1' } },
    { name: '手写 code', data: { code: '<div>hello</div>' } },
    { name: '插件自定义内容源', data: { sourceType: 'ext-moodle/courseware', sourceId: 'm-1' } },
  ])('$name 也能映射到 CoursewareHost', async ({ data }) => {
    renderBoard([appletElement(data)]);
    await act(async () => {});

    const host = screen.getByTestId('mock-courseware-host');
    expect(readSource(host)).toMatchObject(data);
    // 只有 coursewareUuid 才有全班成绩榜
    expect(host.getAttribute('data-has-overlay')).toBe('false');
  });

  it('非字符串字段被忽略，不伪造内容源', async () => {
    renderBoard([
      appletElement({
        coursewareUuid: 123,
        resourceId: {},
        code: null,
        sourceType: 5,
        sourceId: { nested: true },
        title: { not: 'a string' },
      }),
    ]);
    await act(async () => {});

    const host = screen.getByTestId('mock-courseware-host');
    expect(readSource(host)).toEqual({});
    expect(host.getAttribute('data-has-overlay')).toBe('false');
    // 标题也回落到默认文案，而不是把对象渲染出来
    expect(screen.getByText('Interactive Courseware')).toBeTruthy();
  });

  it('只读时内容仍然挂载，并盖上只读遮罩', async () => {
    renderBoard([appletElement({ coursewareUuid: 'cw-readonly' })], { readOnly: true });
    await act(async () => {});

    expect(screen.getByTestId('mock-courseware-host')).toBeTruthy();
    expect(screen.getByTestId('whiteboard-readonly-lock-cover')).toBeTruthy();
  });
});

describe('learning_surface 渲染', () => {
  it('透传 surfaceId / hostId / title / lessonId，并以教师预览模式加载', async () => {
    renderBoard([surfaceElement({ title: '学习面', surfaceId: 'surface-1' })]);
    await act(async () => {});

    const host = screen.getByTestId('mock-learning-surface');
    expect(host.getAttribute('data-surface-id')).toBe('surface-1');
    expect(host.getAttribute('data-host-id')).toBe('el-surface');
    expect(host.getAttribute('data-title')).toBe('学习面');
    expect(host.getAttribute('data-lesson-id')).toBe('lesson-courseware');
    expect(host.getAttribute('data-preview')).toBe('true');
    // 白板画布内不做懒挂载，进入页面就应渲染内容
    expect(host.getAttribute('data-lazy')).toBe('false');
  });

  it('学生端不写教师预览标记', async () => {
    renderBoard([surfaceElement({ surfaceId: 'surface-2' })], { userRole: 'student' });
    await act(async () => {});

    expect(screen.getByTestId('mock-learning-surface').getAttribute('data-preview')).toBe('false');
  });

  it('非字符串 title 回落到默认标题，不渲染成 React 子节点', async () => {
    renderBoard([surfaceElement({ title: { not: 'a string' }, surfaceId: 'surface-3' })]);
    await act(async () => {});

    expect(screen.getByText('学习面')).toBeTruthy();
    const host = screen.getByTestId('mock-learning-surface');
    expect(host.getAttribute('data-title')).toBe('');
    expect(host.getAttribute('data-surface-id')).toBe('surface-3');
  });

  it.each([
    { name: '缺失', data: {} },
    { name: '空字符串', data: { surfaceId: '' } },
    { name: '非字符串', data: { surfaceId: 123 } },
  ])('surfaceId $name 时给出可读占位', async ({ data }) => {
    renderBoard([surfaceElement(data, 'el-surface-empty')]);
    await act(async () => {});

    expect(screen.queryByTestId('mock-learning-surface')).toBeNull();
    expect(screen.getByText('学习面未绑定内容')).toBeTruthy();
    expect(screen.getByText('在属性栏选择渲染器与资源后即可显示')).toBeTruthy();
  });
});
