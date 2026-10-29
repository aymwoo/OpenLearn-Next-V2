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

  it('锁定时浮层下滑收起，原位只留展开图标（全班专注锁定）', () => {
    render(
      <PluginSandboxIframeView
        pluginId={PLUGIN_ID}
        view="overlay.html"
        label="便签浮层"
        slot="student.classroom.overlay"
        variant="floating"
        locked
      />,
    );

    const iframe = screen.getByTitle('便签浮层') as HTMLIFrameElement;
    const container = iframe.closest('[data-plugin-view-variant]') as HTMLElement;
    expect(container.getAttribute('data-plugin-view-locked')).toBe('true');
    expect(container.getAttribute('data-plugin-view-collapsed')).toBe('true');
    // 整体下滑到视口外（bottom-6 之上再让出一个 1.5rem）
    expect(container.style.transform).toContain('translateY');
    // 双重防线：指针事件剥离 + 键盘焦点剥离（inert），插件 iframe 保持挂载不丢状态
    expect(iframe.className).toContain('pointer-events-none');
    expect(iframe.hasAttribute('inert')).toBe(true);
    // 浮层型不再盖拦截罩，原位换成「已收起」的展开图标
    expect(screen.queryByTestId('plugin-view-lock-cover')).toBeNull();
    const chip = screen.getByTestId('plugin-view-lock-collapsed');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(chip.className).toContain('fixed');
    expect(chip.className).toContain('bottom-6');
  });

  it('锁定时页面级 panel 槽位覆盖拦截罩（不下滑收起）', () => {
    render(
      <PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="学生看板" slot="student.view" locked />,
    );

    const iframe = screen.getByTitle('学生看板') as HTMLIFrameElement;
    const container = iframe.closest('[data-plugin-view-variant]') as HTMLElement;
    expect(container.getAttribute('data-plugin-view-collapsed')).toBeNull();
    expect(container.style.transform).toBe('');
    expect(screen.getByTestId('plugin-view-lock-cover')).toBeTruthy();
    expect(screen.queryByTestId('plugin-view-lock-collapsed')).toBeNull();
  });

  it('默认不渲染锁定罩与收起图标', () => {
    render(
      <PluginSandboxIframeView
        pluginId={PLUGIN_ID}
        view="overlay.html"
        label="便签浮层"
        slot="student.classroom.overlay"
        variant="floating"
      />,
    );

    const iframe = screen.getByTitle('便签浮层') as HTMLIFrameElement;
    expect(iframe.className).not.toContain('pointer-events-none');
    expect(iframe.hasAttribute('inert')).toBe(false);
    expect(screen.queryByTestId('plugin-view-lock-cover')).toBeNull();
    expect(screen.queryByTestId('plugin-view-lock-collapsed')).toBeNull();
  });

  it('responds to "ready" postMessage with "init" payload', async () => {    render(<PluginSandboxIframeView pluginId={PLUGIN_ID} view="dashboard.html" label="测试看板" slot="teacher.tab" />);

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
          studentId: null,
          studentName: null,
          lang: 'zh',
          theme: 'light',
        },
      },
      '*',
    );
  });

  it('下发 studentId 与 studentName 给学生端沙箱视图', async () => {
    render(
      <PluginSandboxIframeView
        pluginId={PLUGIN_ID}
        view="dashboard.html"
        label="学生看板"
        slot="student.view"
        studentId="stu-001"
        studentName="张同学"
      />,
    );

    const iframe = screen.getByTitle('学生看板') as HTMLIFrameElement;
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
      expect.objectContaining({
        channel: PLUGIN_VIEW_CHANNEL,
        type: 'init',
        payload: expect.objectContaining({
          studentId: 'stu-001',
          studentName: '张同学',
        }),
      }),
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
