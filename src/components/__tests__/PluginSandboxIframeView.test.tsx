import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { PluginSandboxIframeView, sanitizeViewPath } from '../PluginSandboxIframeView';
import { PLUGIN_VIEW_CHANNEL } from '../../plugin-host/sandbox-frame';
import { appStore } from '../../store/appStore';
import { useThemeStore } from '../../store/themeStore';

describe('sanitizeViewPath', () => {
  it('allows valid relative file paths', () => {
    expect(sanitizeViewPath('index.html')).toBe('index.html');
    expect(sanitizeViewPath('dist/index.html')).toBe('dist/index.html');
    expect(sanitizeViewPath('/views/sub/page.html')).toBe('views/sub/page.html');
  });

  it('rejects directory traversal and dangerous protocols', () => {
    expect(sanitizeViewPath('../secret.txt')).toBeNull();
    expect(sanitizeViewPath('foo/../../secret.txt')).toBeNull();
    expect(sanitizeViewPath('http://evil.com/page.html')).toBeNull();
    expect(sanitizeViewPath('https://evil.com/page.html')).toBeNull();
    expect(sanitizeViewPath('//evil.com/page.html')).toBeNull();
    expect(sanitizeViewPath('\\evil\\path')).toBeNull();
    expect(sanitizeViewPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeViewPath('data:text/html,bad')).toBeNull();
    expect(sanitizeViewPath('')).toBeNull();
  });
});

describe('PluginSandboxIframeView component', () => {
  const PLUGIN_ID = 'test-plugin';

  beforeEach(() => {
    appStore.setState({
      lang: 'zh',
      selectedLesson: 'lesson-123',
      liveClassSelectedClassId: 'class-456',
      toasts: [],
    });
    useThemeStore.setState({ theme: 'light' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders iframe with sandboxed attributes', () => {
    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="测试看板" slot="teacher.tab" />);

    const iframe = screen.getByTitle('测试看板') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toBe(`/plugins/${PLUGIN_ID}/dashboard.html`);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-downloads');
  });

  it('默认使用 panel 容器（铺满父级，页面级槽位）', () => {
    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="看板" slot="teacher.tab" />);

    const iframe = screen.getByTitle('看板') as HTMLIFrameElement;
    const container = iframe.closest('[data-plugin-view-variant]') as HTMLElement;
    expect(container.getAttribute('data-plugin-view-variant')).toBe('panel');
    expect(container.className).toContain('w-full');
    expect(container.className).toContain('h-full');
    expect(container.className).not.toContain('fixed');
  });

  it('floating 容器不参与父级 flex 布局（避免挤掉主内容 / 白板）', () => {
    render(
      <PluginSandboxIframeView
        pluginId={PLUGIN_ID}
        view="overlay.html"
        label="求助灯"
        slot="student.classroom.overlay"
        variant="floating"
      />,
    );

    const iframe = screen.getByTitle('求助灯') as HTMLIFrameElement;
    const container = iframe.closest('[data-plugin-view-variant]') as HTMLElement;
    expect(container.getAttribute('data-plugin-view-variant')).toBe('floating');
    // 固定定位 → 脱离文档流，不会成为 flex item 占位
    expect(container.className).toContain('fixed');
    // 关键回归点：不能带 w-full / h-full，否则会把 flex-1 的同级主内容挤成 0 宽
    expect(container.className).not.toContain('w-full');
    expect(container.className).not.toContain('h-full');
  });

  it('responds to "ready" postMessage with "init" payload', async () => {
    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="测试看板" slot="teacher.tab" />);

    const iframe = screen.getByTitle('测试看板') as HTMLIFrameElement;
    expect(iframe.contentWindow).toBeTruthy();
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { channel: PLUGIN_VIEW_CHANNEL, type: 'ready' },
          source: iframe.contentWindow,
        }),
      );
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'init',
        payload: {
          pluginId: PLUGIN_ID,
          slot: 'teacher.tab',
          lessonId: 'lesson-123',
          classId: 'class-456',
          lang: 'zh',
          theme: 'light',
        },
      },
      '*',
    );
  });

  it('handles "ui.toast" call by appending toast and sending reply', async () => {
    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="测试看板" />);

    const iframe = screen.getByTitle('测试看板') as HTMLIFrameElement;
    expect(iframe.contentWindow).toBeTruthy();
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: PLUGIN_VIEW_CHANNEL,
            type: 'call',
            callId: 'call-1',
            op: 'ui.toast',
            args: ['操作成功', 'success'],
          },
          source: iframe.contentWindow,
        }),
      );
    });

    const toasts = appStore.getState().toasts;
    expect(toasts.some((t) => t.message === '操作成功' && t.type === 'success')).toBe(true);
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'reply',
        callId: 'call-1',
        ok: true,
        value: true,
        error: undefined,
      },
      '*',
    );
  });

  it('handles storage get/set/delete operations', async () => {
    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="测试看板" />);

    const iframe = screen.getByTitle('测试看板') as HTMLIFrameElement;
    expect(iframe.contentWindow).toBeTruthy();
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, 'postMessage');

    // 1. set
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: PLUGIN_VIEW_CHANNEL,
            type: 'call',
            callId: 'c-set',
            op: 'storage.set',
            args: ['user_pref', { color: 'blue' }],
          },
          source: iframe.contentWindow,
        }),
      );
    });
    expect(localStorage.getItem(`ol_pv_${PLUGIN_ID}_user_pref`)).toBe(JSON.stringify({ color: 'blue' }));

    // 2. get
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: PLUGIN_VIEW_CHANNEL,
            type: 'call',
            callId: 'c-get',
            op: 'storage.get',
            args: ['user_pref'],
          },
          source: iframe.contentWindow,
        }),
      );
    });
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'reply',
        callId: 'c-get',
        ok: true,
        value: { color: 'blue' },
      }),
      '*',
    );

    // 3. delete
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: PLUGIN_VIEW_CHANNEL,
            type: 'call',
            callId: 'c-del',
            op: 'storage.delete',
            args: ['user_pref'],
          },
          source: iframe.contentWindow,
        }),
      );
    });
    expect(localStorage.getItem(`ol_pv_${PLUGIN_ID}_user_pref`)).toBeNull();
  });
});
