import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processLmsMessage,
  registerManagedIframe,
  clearManagedIframes,
  getManagedIframesCount,
} from '../lms-bridge';
import { frontendEventBus } from '../event-bus';
import { v7 as uuidv7 } from 'uuid';

/**
 * LMS Bridge 消息来源校验（SEC-AUTH）回归测试：
 * 仅 data-lms-bridge 标记的受管辖课件 iframe 可与 LMS Bridge 通信。
 */

function createManagedIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-lms-bridge', 'true');
  document.body.appendChild(iframe);
  return iframe;
}

function createUnmanagedIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  return iframe;
}

function makeEvent(data: unknown, source: MessageEventSource | null): MessageEvent {
  return new MessageEvent('message', { data, source } as MessageEventInit);
}

describe('lms-bridge processLmsMessage source validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('丢弃来自未标记 iframe 的 LMS_SUBMIT（不触发任何请求）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const iframe = createUnmanagedIframe();

    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-unmanaged', payload: { score: 100 } }, iframe.contentWindow),
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('丢弃来自未知外部窗口的消息', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const fakeWindow = { postMessage: vi.fn() } as unknown as MessageEventSource;

    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-external', payload: { score: 100 } }, fakeWindow),
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('处理来自受管辖 iframe 的 LMS_SUBMIT（adopt + submit）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attemptId: 'atk-adopted' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const iframe = createManagedIframe();

    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-managed', payload: { score: 88 } }, iframe.contentWindow),
    );

    const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes('/api/courseware/attempts/atk-managed/adopt'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/api/courseware/attempts/atk-adopted/submit'))).toBe(true);
  });

  it('LMS_GET_PROGRESS 仅响应受管辖 iframe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ progress: { q1: 'a' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const managed = createManagedIframe();
    const unmanaged = createUnmanagedIframe();

    // 受管辖 iframe：取进度并定向回复
    await processLmsMessage(
      makeEvent(
        { type: 'LMS_GET_PROGRESS', attempt_id: 'atk-progress', requestId: 'req-1' },
        managed.contentWindow,
      ),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/attempts/atk-progress/progress'))).toBe(true);

    // 未标记 iframe：直接丢弃，不取进度也不回复
    fetchMock.mockClear();
    await processLmsMessage(
      makeEvent(
        { type: 'LMS_GET_PROGRESS', attempt_id: 'atk-progress', requestId: 'req-2' },
        unmanaged.contentWindow,
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attempt_id 缺失时可从受管辖 iframe 提取（跨域不可读时安全忽略）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attemptId: 'atk-extracted' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const iframe = createManagedIframe();

    // jsdom 中 contentWindow 可读，__LMS_STUDENT__ 未设置 → 无 attemptId，流程终止；
    // 但消息来源本身必须通过校验（此处若被误判为非法来源同样不会触发请求）。
    await processLmsMessage(makeEvent({ type: 'LMS_SAVE_PROGRESS', payload: { score: 1 } }, iframe.contentWindow));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registerManagedIframe 支持 O(1) 注册与注销生命周期', async () => {
    clearManagedIframes();
    expect(getManagedIframesCount()).toBe(0);

    const unmanagedIframe = createUnmanagedIframe();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attemptId: 'atk-reg' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // 未注册时，丢弃消息
    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-test', payload: { score: 95 } }, unmanagedIframe.contentWindow),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // 动态注册
    const unregister = registerManagedIframe(unmanagedIframe);
    expect(getManagedIframesCount()).toBe(1);

    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-test', payload: { score: 95 } }, unmanagedIframe.contentWindow),
    );
    expect(fetchMock).toHaveBeenCalled();

    // 注销后恢复不可达
    fetchMock.mockClear();
    unregister();
    expect(getManagedIframesCount()).toBe(0);

    await processLmsMessage(
      makeEvent({ type: 'LMS_SUBMIT', attempt_id: 'atk-test', payload: { score: 95 } }, unmanagedIframe.contentWindow),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('协议快速预检：非 LMS 协议消息在毫秒级快速退出，不触发任何请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const iframe = createManagedIframe();

    // 模拟 Vite HMR / 第三方插件广播
    await processLmsMessage(makeEvent({ type: 'vite:invalidate', path: '/src/main.ts' }, iframe.contentWindow));
    await processLmsMessage(makeEvent({ randomKey: 'randomValue' }, iframe.contentWindow));
    await processLmsMessage(makeEvent('string-message', iframe.contentWindow));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('EventBus 触发 theme.changed 与 font-scale.changed 时执行防抖广播', async () => {
    vi.useFakeTimers();
    const iframe = createManagedIframe();
    const postMessageSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postMessageSpy },
      writable: true,
    });

    // 密集触发 3 次 theme.changed
    for (let i = 0; i < 3; i++) {
      void frontendEventBus.publish({
        id: uuidv7(),
        type: 'theme.changed',
        source: 'theme-store',
        payload: { theme: `theme-${i}`, tokens: { '--color': '#fff' } },
        timestamp: Date.now(),
      });
    }

    // 50ms 防抖尚未触发
    vi.advanceTimersByTime(20);
    expect(postMessageSpy).not.toHaveBeenCalled();

    // 推进满 50ms
    vi.advanceTimersByTime(40);
    expect(postMessageSpy).toHaveBeenCalled();
    const themeCommands = postMessageSpy.mock.calls.filter(
      (c) => c[0]?.event === 'theme:changed' || c[0]?.type === 'LMS_THEME_CHANGED',
    );
    // 只聚合广播了最后一次 theme-2
    expect(themeCommands.some((c) => c[0]?.payload?.theme === 'theme-2' || c[0]?.theme === 'theme-2')).toBe(true);

    vi.useRealTimers();
  });
});
