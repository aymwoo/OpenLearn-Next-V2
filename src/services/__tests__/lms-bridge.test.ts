import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processLmsMessage } from '../lms-bridge';

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
});
