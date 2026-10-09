import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { HostActionDispatcher, type ActiveModalState } from '../host-action-dispatcher';
import { HostModalContainer } from '../host-modal-container';
import { FrontendPluginHost } from '../plugin-host';
import { PluginHostProvider } from '../plugin-host-context';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { usePluginHostStore } from '../plugin-host-store';
import { appStore } from '../../store/appStore';
import type { FrontendPluginManifest, IFrontendAPI, ISocketService, IUIService, IStorageService } from '../types';

describe('HostActionDispatcher Core Unit Tests', () => {
  let dispatcher: HostActionDispatcher;

  beforeEach(() => {
    dispatcher = new HostActionDispatcher();
    dispatcher.closeAllModals();
  });

  afterEach(() => {
    dispatcher.closeAllModals();
  });

  it('executes built-in host:refresh and triggers appStore loaders', async () => {
    const loadClassesSpy = vi.fn().mockResolvedValue(undefined);
    const loadLessonsSpy = vi.fn().mockResolvedValue(undefined);
    const loadStudentsSpy = vi.fn().mockResolvedValue(undefined);

    appStore.setState({
      loadClasses: loadClassesSpy,
      loadLessons: loadLessonsSpy,
      loadStudents: loadStudentsSpy,
    });

    const res = await dispatcher.dispatch({
      type: 'host:refresh',
      payload: { target: 'all' },
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.refreshed).toContain('classes');
    expect(res.refreshed).toContain('lessons');
    expect(res.refreshed).toContain('students');
    expect(loadClassesSpy).toHaveBeenCalledTimes(1);
    expect(loadLessonsSpy).toHaveBeenCalledTimes(1);
    expect(loadStudentsSpy).toHaveBeenCalledTimes(1);
  });

  it('allows registering custom handlers and unregistering via dispose()', async () => {
    const customHandler = vi.fn().mockResolvedValue({ handledByCustom: true });

    const disposable = dispatcher.registerHandler('ext:custom_test', customHandler);

    const result = await dispatcher.dispatch({
      type: 'ext:custom_test',
      payload: { value: 42 },
    });

    expect(result).toEqual({ handledByCustom: true });
    expect(customHandler).toHaveBeenCalledTimes(1);
    expect(customHandler.mock.calls[0][0].action.payload).toEqual({ value: 42 });

    // After dispose, no handler remains
    disposable.dispose();
    const resultAfterDispose = await dispatcher.dispatch({
      type: 'ext:custom_test',
      payload: { value: 99 },
    });
    expect(resultAfterDispose).toBeUndefined();
  });

  it('supports middleware pipeline for auditing, modification, and interception', async () => {
    const auditLog: string[] = [];

    dispatcher.use(async (envelope, next) => {
      auditLog.push(`before:${envelope.action.type}`);
      const res = await next();
      auditLog.push(`after:${envelope.action.type}`);
      return res;
    });

    dispatcher.use(async (envelope, next) => {
      auditLog.push(`inner:${envelope.action.type}`);
      return next();
    });

    dispatcher.registerHandler('test:ping', () => 'pong');

    const res = await dispatcher.dispatch({ type: 'test:ping', payload: {} });
    expect(res).toBe('pong');
    expect(auditLog).toEqual(['before:test:ping', 'inner:test:ping', 'after:test:ping']);
  });

  it('supports passive subscriptions via subscribe() for specific actions and wildcard (*)', async () => {
    const specificObserver = vi.fn();
    const wildcardObserver = vi.fn();

    const sub1 = dispatcher.subscribe('host:toast', specificObserver);
    const sub2 = dispatcher.subscribe('*', wildcardObserver);

    await dispatcher.dispatch({
      type: 'host:toast',
      payload: { title: 'Test Toast', message: 'Hello world', type: 'info' },
    });

    expect(specificObserver).toHaveBeenCalledTimes(1);
    expect(wildcardObserver).toHaveBeenCalledTimes(1);

    sub1.dispose();
    await dispatcher.dispatch({
      type: 'host:toast',
      payload: { title: 'Second Toast', message: 'Hello again' },
    });

    expect(specificObserver).toHaveBeenCalledTimes(1);
    expect(wildcardObserver).toHaveBeenCalledTimes(2);
    sub2.dispose();
  });

  it('respects timeoutMs and rejects if action handler takes too long', async () => {
    dispatcher.registerHandler('test:slow', () => new Promise((resolve) => setTimeout(resolve, 500)));

    await expect(
      dispatcher.dispatch(
        { type: 'test:slow', payload: {} },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow('timed out after 50ms');
  });

  it('creates scoped dispatcher that automatically injects sourcePluginId', async () => {
    const scoped = dispatcher.createScopedDispatcher('ext-test-plugin');
    const handlerSpy = vi.fn().mockReturnValue('ok');

    dispatcher.registerHandler('test:scoped', handlerSpy);

    await scoped.dispatch({ type: 'test:scoped', payload: { foo: 'bar' } });

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const envelope = handlerSpy.mock.calls[0][0];
    expect(envelope.sourcePluginId).toBe('ext-test-plugin');
  });
});

describe('Controlled Modal & Confirmation Protocol', () => {
  let dispatcher: HostActionDispatcher;

  beforeEach(() => {
    dispatcher = new HostActionDispatcher();
    dispatcher.closeAllModals();
  });

  afterEach(() => {
    dispatcher.closeAllModals();
  });

  it('dispatches host:modal:confirm and resolves true when confirmed', async () => {
    const promise = dispatcher.dispatch({
      type: 'host:modal:confirm',
      payload: {
        title: '确认清空课表',
        message: '此操作不可撤销，是否继续？',
        variant: 'danger',
      },
    });

    const activeModals = dispatcher.getActiveModals();
    expect(activeModals).toHaveLength(1);
    expect(activeModals[0].title).toBe('确认清空课表');
    expect(activeModals[0].variant).toBe('danger');

    // Simulate user confirming
    dispatcher.resolveModal(activeModals[0].id, { confirmed: true });

    const result = await promise;
    expect(result).toEqual({ confirmed: true });
    expect(dispatcher.getActiveModals()).toHaveLength(0);
  });

  it('dispatches host:modal:confirm and resolves false when cancelled', async () => {
    const promise = dispatcher.dispatch({
      type: 'host:modal:confirm',
      payload: {
        title: '确认更新',
        message: '是否应用排课规则？',
      },
    });

    const activeModals = dispatcher.getActiveModals();
    expect(activeModals).toHaveLength(1);

    // Simulate user cancelling
    dispatcher.resolveModal(activeModals[0].id, { confirmed: false });

    const result = await promise;
    expect(result).toEqual({ confirmed: false });
    expect(dispatcher.getActiveModals()).toHaveLength(0);
  });

  it('dispatches host:modal:open with custom action buttons and resolves actionId', async () => {
    const promise = dispatcher.dispatch({
      type: 'host:modal:open',
      payload: {
        title: '排课规则配置',
        actions: [
          { actionId: 'save_draft', label: '存为草稿', variant: 'secondary' },
          { actionId: 'publish_now', label: '立即发布', variant: 'primary', isClose: true },
        ],
      },
    });

    const activeModals = dispatcher.getActiveModals();
    expect(activeModals).toHaveLength(1);
    expect(activeModals[0].title).toBe('排课规则配置');

    dispatcher.resolveModal(activeModals[0].id, { actionId: 'publish_now', closed: true });

    const result = await promise;
    expect(result).toEqual({ actionId: 'publish_now', closed: true });
  });

  it('HostModalContainer renders modal and resolves dispatch promise via UI click', async () => {
    render(<HostModalContainer dispatcher={dispatcher} />);

    let confirmResult: any = null;
    act(() => {
      dispatcher
        .dispatch({
          type: 'host:modal:confirm',
          payload: {
            title: '删除日程',
            message: '您确定要删除此节课程吗？',
            confirmText: '确认删除',
            cancelText: '点错了',
            variant: 'danger',
          },
        })
        .then((res) => {
          confirmResult = res;
        });
    });

    // Check modal rendered in DOM
    expect(screen.getByText('删除日程')).toBeTruthy();
    expect(screen.getByText('您确定要删除此节课程吗？')).toBeTruthy();
    const confirmBtn = screen.getByText('确认删除');
    expect(confirmBtn).toBeTruthy();

    // Click confirm button
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(confirmResult).toEqual({ confirmed: true });
    expect(screen.queryByText('删除日程')).toBeNull();
  });
});

describe('HostActionDispatcher Integration with PluginHost & Slots', () => {
  let host: FrontendPluginHost;
  const mockApi: IFrontendAPI = {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  };
  const mockSocket: ISocketService = {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
  const mockUi: IUIService = {
    showToast: vi.fn(),
    showModal: vi.fn(),
    closeModal: vi.fn(),
    downloadFile: vi.fn(),
  };
  const mockStorage: IStorageService = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  };

  beforeEach(async () => {
    usePluginHostStore.setState({ extensionPoints: new Map(), activePlugins: [] });
    host = new FrontendPluginHost();
    await host.initialize(mockApi, mockSocket, mockUi, mockStorage);
  });

  afterEach(() => {
    cleanup();
  });

  it('injects scoped dispatcher into plugin context during activate()', async () => {
    let capturedContext: any = null;

    const manifest: FrontendPluginManifest = {
      id: 'ext-auto-scheduler',
      name: 'AI 智能排课器',
      version: '1.0.0',
    };

    await host.installPlugin(
      manifest,
      'export default { activate(ctx) {} };',
    );

    // Mock moduleLoader
    (host as any).moduleLoader = vi.fn().mockResolvedValue({
      default: {
        manifest,
        activate: async (ctx: any) => {
          capturedContext = ctx;
        },
      },
    });

    await host.activatePlugin('ext-auto-scheduler');

    expect(capturedContext).toBeDefined();
    expect(capturedContext.dispatcher).toBeDefined();
    expect(typeof capturedContext.dispatcher.dispatch).toBe('function');

    // Dispatching from plugin context carries sourcePluginId
    const handlerSpy = vi.fn().mockResolvedValue({ ok: true });
    host.getDispatcher().registerHandler('plugin:hello', handlerSpy);

    await capturedContext.dispatcher.dispatch({
      type: 'plugin:hello',
      payload: { msg: 'world' },
    });

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(handlerSpy.mock.calls[0][0].sourcePluginId).toBe('ext-auto-scheduler');
  });

  it('ExtensionPointRenderer injects props.dispatcher into rendered extension components', () => {
    let capturedProps: any = null;

    const TestComponent: React.FC<any> = (props) => {
      capturedProps = props;
      return <div data-testid="timetable-plugin-panel">Timetable Plugin Panel</div>;
    };

    usePluginHostStore.getState().registerExtensionPoint('timetable.tab', {
      id: 'ai-view',
      label: '智能排课面板',
      component: TestComponent as any,
      pluginId: 'ext-timetable-pro',
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="timetable.tab"
          slotProps={{
            renderType: 'panel',
            timetableActiveTab: 'plugin:ext-timetable-pro/ai-view',
          }}
        />
      </PluginHostProvider>,
    );

    expect(screen.getByTestId('timetable-plugin-panel')).toBeTruthy();
    expect(capturedProps).toBeDefined();
    expect(capturedProps.dispatcher).toBeDefined();
    expect(typeof capturedProps.dispatcher.dispatch).toBe('function');
  });
});
