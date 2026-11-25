/**
 * ExtensionPointRenderer：学案插件活动按 activityType 分发（editor / student）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

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

describe('ExtensionPointRenderer — xuean.activity.* 按活动类型分发', () => {
  it('学生端只渲染 activityType 匹配的扩展', async () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('xuean.activity.student', {
      id: 'lab-student',
      label: '虚拟实验',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-student">lab</span>),
    });
    register('xuean.activity.student', {
      id: 'reading-student',
      label: '阅读',
      pluginId: 'ext-lab',
      slotProps: { activityType: 'reading' },
      component: lazyComponent(<span data-testid="reading-student">reading</span>),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="xuean.activity.student"
        slotProps={{ activityType: '@acme/lab:experiment', activity: { id: 'a1' } }}
      />,
    );

    expect(await screen.findByTestId('lab-student')).toBeTruthy();
    expect(screen.queryByTestId('reading-student')).toBeNull();
  });

  it('教师端编辑器同样按 activityType 分发', async () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('xuean.activity.editor', {
      id: 'lab-editor',
      label: '虚拟实验配置',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-editor">editor</span>),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="xuean.activity.editor"
        slotProps={{ activityType: '@acme/lab:experiment', lessonId: 'lesson-1' }}
      />,
    );

    expect(await screen.findByTestId('lab-editor')).toBeTruthy();
  });

  it('未显式传 activityType 时回退到 activity.type', async () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('xuean.activity.student', {
      id: 'lab-student',
      label: '虚拟实验',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-student">lab</span>),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="xuean.activity.student"
        slotProps={{ activity: { id: 'a1', type: '@acme/lab:experiment' } }}
      />,
    );

    expect(await screen.findByTestId('lab-student')).toBeTruthy();
  });

  it('没有匹配的活动类型时不渲染任何扩展', () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('xuean.activity.student', {
      id: 'lab-student',
      label: '虚拟实验',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-student">lab</span>),
    });

    renderWithHost(<ExtensionPointRenderer slot="xuean.activity.student" slotProps={{ activityType: 'reading' }} />);

    expect(screen.queryByTestId('lab-student')).toBeNull();
  });

  it('教师端编辑器收到调用点传入的 lessonId / onSaved（C1 回归）', async () => {
    const onSaved = vi.fn();
    const factory = () =>
      Promise.resolve({
        default: (props: { lessonId?: string; onSaved?: () => void }) => (
          <span data-testid="editor-context">
            {String(props.lessonId)}:{typeof props.onSaved}
          </span>
        ),
      });
    (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
    usePluginHostStore.getState().registerExtensionPoint('xuean.activity.editor', {
      id: 'lab-editor',
      label: '虚拟实验配置',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: factory,
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="xuean.activity.editor"
        slotProps={{
          activityType: '@acme/lab:experiment',
          activity: { id: 'a1' },
          lessonId: 'lesson-1',
          onSaved,
        }}
      />,
    );

    expect((await screen.findByTestId('editor-context')).textContent).toBe('lesson-1:function');
  });

  it('activity.editor.footer / activity.student.addon 同样按 activityType 分发', async () => {
    const register = usePluginHostStore.getState().registerExtensionPoint;
    register('xuean.activity.editor.footer', {
      id: 'lab-footer',
      label: '实验底部操作',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-footer">footer</span>),
    });
    register('xuean.activity.student.addon', {
      id: 'lab-addon',
      label: '实验附加区',
      pluginId: 'ext-lab',
      slotProps: { activityType: '@acme/lab:experiment' },
      component: lazyComponent(<span data-testid="lab-addon">addon</span>),
    });

    renderWithHost(
      <>
        <ExtensionPointRenderer
          slot="xuean.activity.editor.footer"
          slotProps={{ activityType: '@acme/lab:experiment', lessonId: 'lesson-1' }}
        />
        <ExtensionPointRenderer
          slot="xuean.activity.student.addon"
          slotProps={{ activityType: '@acme/lab:experiment', activity: { id: 'a1' }, lessonId: 'lesson-1' }}
        />
      </>,
    );

    expect(await screen.findByTestId('lab-footer')).toBeTruthy();
    expect(await screen.findByTestId('lab-addon')).toBeTruthy();
  });
});
