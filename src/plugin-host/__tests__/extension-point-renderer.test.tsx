/**
 * ExtensionPointRenderer — 锚点槽位（anchor:*）placement 过滤渲染测试。
 *
 * v0.2.6: 宿主在锚点按钮前后各渲染一次
 *   <ExtensionPointRenderer slot="anchor:x" placement="before|after" />
 * 本测试验证：
 * - placement="before" 只渲染 placement === 'before' 的扩展
 * - placement="after"  只渲染 placement === 'after' 及未声明（默认）的扩展
 * - 不传 placement 时渲染该槽位全部扩展（向后兼容固定槽位行为）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

/**
 * Build a lazy component factory in the exact shape the renderer expects:
 *   () => Promise<{ default: ComponentType }>
 * with the `__isLazyFactory` marker so `resolveExtensionComponent` wraps it in
 * React.lazy (mirrors src/features/activity-ecosystem/registerTeacherExtension.tsx).
 */
function lazyComponent(el: ReactElement) {
  const factory = () => Promise.resolve({ default: () => el });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — anchor slot placement filtering (v0.2.6)', () => {
  it('placement="before" 只渲染 before 扩展', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" placement="before" />);

    expect(await screen.findByTestId('before')).toBeTruthy();
    expect(screen.queryByTestId('after')).toBeNull();
  });

  it('placement="after" 渲染 after 及未声明 placement（默认）的扩展', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'default-btn',
      label: 'Default',
      pluginId: 'p1',
      component: lazyComponent(<span data-testid="default">Default Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" placement="after" />);

    expect(await screen.findByTestId('after')).toBeTruthy();
    expect(screen.getByTestId('default')).toBeTruthy(); // 未声明 placement 默认视为 'after'
    expect(screen.queryByTestId('before')).toBeNull();
  });

  it('不传 placement 时渲染该槽位全部扩展（向后兼容）', async () => {
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'before-btn',
      label: 'Before',
      pluginId: 'p1',
      placement: 'before',
      component: lazyComponent(<span data-testid="before">Before Btn</span>),
    });
    usePluginHostStore.getState().registerExtensionPoint('anchor:test:btn', {
      id: 'after-btn',
      label: 'After',
      pluginId: 'p1',
      placement: 'after',
      component: lazyComponent(<span data-testid="after">After Btn</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="anchor:test:btn" />);

    expect(await screen.findByTestId('before')).toBeTruthy();
    expect(screen.getByTestId('after')).toBeTruthy();
  });

  it('getExtensions 按 position 升序返回（同槽位跨插件排序，缺省 100）', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    const comp = lazyComponent(<span />);

    // 乱序注册：position 90、10、缺省（默认 100）
    register('anchor:test:btn', {
      id: 'b',
      label: 'B',
      pluginId: 'p1',
      placement: 'before',
      position: 90,
      component: comp,
    });
    register('anchor:test:btn', {
      id: 'a',
      label: 'A',
      pluginId: 'p2',
      placement: 'before',
      position: 10,
      component: comp,
    });
    register('anchor:test:btn', {
      id: 'c',
      label: 'C',
      pluginId: 'p3',
      placement: 'before',
      component: comp,
    });

    const sorted = usePluginHostStore.getState().getExtensions('anchor:test:btn');
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('正确渲染 help.plugin_docs 槽位插件', async () => {
    usePluginHostStore.getState().registerExtensionPoint('help.plugin_docs', {
      id: 'doc-ext',
      label: '插件使用文档',
      pluginId: 'p-docs',
      component: lazyComponent(<div data-testid="plugin-doc-content">Docs Content</div>),
    });

    renderWithHost(<ExtensionPointRenderer slot="help.plugin_docs" />);
    expect(await screen.findByTestId('plugin-doc-content')).toBeTruthy();
  });

  it('正确渲染 student.classroom.overlay 槽位并注入 props', async () => {
    const OverlayComp = (props: any) => (
      <div data-testid="student-overlay" data-student-id={props.studentId} data-lesson-id={props.lessonId}>
        Student Overlay
      </div>
    );
    const factory = () => Promise.resolve({ default: OverlayComp });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('student.classroom.overlay', {
      id: 'hud-ext',
      label: '学生互动 HUD',
      pluginId: 'p-hud',
      component: factory,
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="student.classroom.overlay"
        slotProps={{ studentId: 'stu_123', lessonId: 'les_456' }}
      />,
    );

    const overlay = await screen.findByTestId('student-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.getAttribute('data-student-id')).toBe('stu_123');
    expect(overlay.getAttribute('data-lesson-id')).toBe('les_456');
  });

  it('正确渲染 stage.display.overlay 槽位并注入大屏 HUD props', async () => {
    const OverlayComp = (props: any) => (
      <div
        data-testid="stage-overlay"
        data-lesson-id={props.lessonId}
        data-lesson-title={props.lessonTitle}
        data-stage={props.stage}
        data-fullscreen={String(props.isFullscreen)}
      >
        Stage Overlay Content
      </div>
    );
    const factory = () => Promise.resolve({ default: OverlayComp });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('stage.display.overlay', {
      id: 'danmaku-hud',
      label: '全屏弹幕 HUD',
      pluginId: 'p-stage-danmaku',
      component: factory,
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="stage.display.overlay"
        slotProps={{
          lessonId: 'les-101',
          lessonTitle: '物理公开课',
          stage: 'IN_CLASS_TEACHING',
          isFullscreen: true,
          lang: 'zh',
        }}
      />,
    );

    const overlay = await screen.findByTestId('stage-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.getAttribute('data-lesson-id')).toBe('les-101');
    expect(overlay.getAttribute('data-lesson-title')).toBe('物理公开课');
    expect(overlay.getAttribute('data-stage')).toBe('IN_CLASS_TEACHING');
    expect(overlay.getAttribute('data-fullscreen')).toBe('true');
  });

  it('正确渲染 stage.display.action 槽位并透传操作回调', async () => {
    const onToggle = vi.fn();
    const onReview = vi.fn();

    const ActionComp = (props: any) => (
      <div data-testid="stage-action">
        <button data-testid="btn-toggle" onClick={props.onToggleFullscreen}>
          Toggle
        </button>
        <button data-testid="btn-review" onClick={props.onOpenPeerReview}>
          Review
        </button>
      </div>
    );
    const factory = () => Promise.resolve({ default: ActionComp });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('stage.display.action', {
      id: 'screen-record-btn',
      label: '一键录屏',
      pluginId: 'p-recorder',
      component: factory,
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="stage.display.action"
        slotProps={{
          lessonId: 'les-101',
          isFullscreen: false,
          onToggleFullscreen: onToggle,
          onOpenPeerReview: onReview,
        }}
      />,
    );

    const action = await screen.findByTestId('stage-action');
    expect(action).toBeTruthy();

    screen.getByTestId('btn-toggle').click();
    expect(onToggle).toHaveBeenCalledTimes(1);

    screen.getByTestId('btn-review').click();
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('正确渲染 assignment.submission.preview 槽位并区分自作答与同伴作答', async () => {
    const PreviewComp = (props: any) => (
      <div
        data-testid="submission-preview"
        data-self={String(props.isSelf)}
        data-student={props.studentId}
        data-content={props.submission?.content}
      >
        Submission Preview
      </div>
    );
    const factory = () => Promise.resolve({ default: PreviewComp });
    (factory as any).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('assignment.submission.preview', {
      id: 'code-runner-preview',
      label: '代码沙盒运行预览',
      pluginId: 'p-code-preview',
      component: factory,
    });

    const { rerender } = renderWithHost(
      <ExtensionPointRenderer
        slot="assignment.submission.preview"
        slotProps={{
          submission: { id: 'sub-1', content: 'print("hello")' },
          studentId: 'stu-me',
          lessonId: 'les-101',
          isSelf: true,
          lang: 'zh',
        }}
      />,
    );

    const preview = await screen.findByTestId('submission-preview');
    expect(preview).toBeTruthy();
    expect(preview.getAttribute('data-self')).toBe('true');
    expect(preview.getAttribute('data-student')).toBe('stu-me');
    expect(preview.getAttribute('data-content')).toBe('print("hello")');

    rerender(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <ExtensionPointRenderer
          slot="assignment.submission.preview"
          slotProps={{
            submission: { id: 'sub-2', content: 'console.log("peer")' },
            studentId: 'stu-peer',
            lessonId: 'les-101',
            isSelf: false,
            lang: 'zh',
          }}
        />
      </PluginHostProvider>,
    );

    const peerPreview = await screen.findByTestId('submission-preview');
    expect(peerPreview).toBeTruthy();
    expect(peerPreview.getAttribute('data-self')).toBe('false');
    expect(peerPreview.getAttribute('data-student')).toBe('stu-peer');
    expect(peerPreview.getAttribute('data-content')).toBe('console.log("peer")');
  });
});
