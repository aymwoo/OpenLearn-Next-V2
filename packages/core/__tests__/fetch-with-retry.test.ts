/**
 * Phase B5: fetchWithRetry 超时与指数退避重试测试。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry, AIFetchTimeoutError } from '../ai/utils/fetch-with-retry.js';

const okResponse = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }) as any;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('B5: fetchWithRetry', () => {
  it('首次成功直接返回，不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('https://ai.example.com/chat', { body: '{}' });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('非重试状态码（401）立即失败，不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('https://ai.example.com/chat', { body: '{}' })).rejects.toThrow(
      'AI Provider Request Failed (401)',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('网络错误重试：前两次失败第三次成功，共 3 次调用', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://ai.example.com/chat', { body: '{}' });
    const assertion = expect(promise).resolves.toBeTruthy();
    // 推进两次退避窗口（500ms + 1000ms + 抖动 ≤250ms）
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('超时：fetch 永挂起时抛 AIFetchTimeoutError（AbortController 触发）', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://ai.example.com/chat', { body: '{}', timeoutMs: 30_000, maxAttempts: 1 });
    const assertion = expect(promise).rejects.toThrow(AIFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('429 按指数退避重试，耗尽尝试后抛最后错误', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://ai.example.com/chat', { body: '{}' });
    const assertion = expect(promise).rejects.toThrow('(429)');
    // 两次退避：500×2⁰ + 500×2¹（含抖动 ≤250ms），推进 3 秒足够覆盖
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
