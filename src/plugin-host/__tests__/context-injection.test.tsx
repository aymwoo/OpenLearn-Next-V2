/**
 * 课堂上下文注入测试（v5.1 PR2）。
 *
 * 验证：
 * - ExtensionPointRenderer 统一注入 { lessonId, classId } 到扩展点组件 props
 * - 调用点 slotProps 可覆盖注入值（合并优先级最低层）
 * - ctx.context.get() / subscribe() 只读快照与订阅
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';
import { appStore } from '../../store/appStore';
import type {
  FrontendPluginContext,
  IFrontendAPI,
  ISocketService,
  IUIService,
  IStorageService,
  FrontendPluginManifest,
} from '../types';

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

function createMockServices() {
  return {
    frontendApi: {
      get: async () => ({ success: true }),
      post: async () => ({ success: true }),
      del: async () => ({ success: true }),
    } as unknown as IFrontendAPI,
    socketService: { emit: () => {}, on: () => {}, off: () => {}, disconnect: () => {} } as unknown as ISocketService,
    uiService: { showToast: () => {}, showModal: () => {}, closeModal: () => {} } as unknown as IUIService,
    storageService: { get: () => null, set: () => {}, delete: () => {}, clear: () => {} } as unknown as IStorageService,
  };
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
  appStore.setState({ selectedLesson: null, liveClassSelectedClassId: null });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer 统一注入课堂上下文（v5.1）', () => {
  it('注入 lessonId/classId 到扩展点组件 props', async () => {
    appStore.setState({ selectedLesson: 'lesson-1', liveClassSelectedClassId: 'class-1' });

    let receivedProps: any;
    const factory = () =>
      Promise.resolve({
        default: (props: any) => {
          receivedProps = props;
          return <span data-testid="ctx">ok</span>;
        },
      });
    (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('student.view', {
      id: 'ctx-probe',
      label: 'Ctx',
      pluginId: 'p1',
      component: factory,
    });

    renderWithHost(<ExtensionPointRenderer slot="student.view" />);
    expect(await screen.findByTestId('ctx')).toBeTruthy();

    expect(receivedProps.lessonId).toBe('lesson-1');
    expect(receivedProps.classId).toBe('class-1');
  });

  it('调用点 slotProps 可覆盖注入的 lessonId/classId（最低合并优先级）', async () => {
    appStore.setState({ selectedLesson: 'lesson-1', liveClassSelectedClassId: 'class-1' });

    let receivedProps: any;
    const factory = () =>
      Promise.resolve({
        default: (props: any) => {
          receivedProps = props;
          return <span data-testid="ctx-override">ok</span>;
        },
      });
    (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;

    usePluginHostStore.getState().registerExtensionPoint('student.view', {
      id: 'ctx-probe',
      label: 'Ctx',
      pluginId: 'p1',
      component: factory,
    });

    renderWithHost(<ExtensionPointRenderer slot="student.view" slotProps={{ lessonId: 'override-lesson' }} />);
    expect(await screen.findByTestId('ctx-override')).toBeTruthy();

    expect(receivedProps.lessonId).toBe('override-lesson');
    expect(receivedProps.classId).toBe('class-1');
  });
});

describe('ctx.context 只读快照 + 订阅（v5.1）', () => {
  it('get() 返回当前课程/班级，subscribe 在变化时触发', async () => {
    appStore.setState({ selectedLesson: 'L1', liveClassSelectedClassId: 'C1' });

    let receivedCtx: FrontendPluginContext | undefined;
    const manifest: FrontendPluginManifest = {
      id: 'ctx-test-plugin',
      name: 'Ctx Test',
      version: '1.0.0',
    };
    const plugin = {
      manifest,
      activate: async (ctx: FrontendPluginContext) => {
        receivedCtx = ctx;
      },
      deactivate: async () => {},
    };
    const moduleLoader = async () => ({
      default: { manifest: plugin.manifest, activate: plugin.activate, deactivate: plugin.deactivate },
    });

    const host = new FrontendPluginHost({ moduleLoader });
    const mocks = createMockServices();
    await host.initialize(mocks.frontendApi, mocks.socketService, mocks.uiService, mocks.storageService);
    await host.installPlugin(manifest, 'export default {}');
    await host.activatePlugin(manifest.id);

    expect(receivedCtx?.context?.get()).toEqual({ lessonId: 'L1', classId: 'C1' });

    let observed: { lessonId: string | null; classId: string | null } | undefined;
    receivedCtx?.context?.subscribe((c) => {
      observed = c;
    });
    appStore.setState({ selectedLesson: 'L2' });
    expect(observed).toEqual({ lessonId: 'L2', classId: 'C1' });
  });
});
