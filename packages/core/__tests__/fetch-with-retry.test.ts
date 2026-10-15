/**
 * Phase B5: fetchWithRetry 超时与指数退避重试测试。
 * 重定向复检：不把 Bearer 跟到回环 / 链路本地；公网 https 仅在检查器放行时跟随。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry, AIFetchTimeoutError } from '../ai/utils/fetch-with-retry.js';
import { assessAiProviderHop } from '../ai/utils/redirect-guard.js';

const BEARER = 'Bearer secret-token';

const okResponse = () =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => '', headers: { get: () => null } }) as any;

function redirectResponse(location: string) {
  return {
    ok: false,
    status: 302,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' ? location : null),
    },
    text: async () => 'redirect-body-should-not-leak',
  };
}

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
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('非重试状态码（401）立即失败，错误信息只有状态码', async () => {
    const text = vi.fn(async () => 'unauthorized secret-body');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'unauthorized secret-body',
      text,
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await fetchWithRetry('https://ai.example.com/chat', { body: '{}' });
      throw new Error('expected rejection');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('AI Provider Request Failed (401)');
      expect(message).not.toContain('unauthorized');
      expect(message).not.toContain('secret-body');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
  });

  it('4xx 响应体不会进入 Error message', async () => {
    const text = vi.fn(async () => 'upstream-secret-payload');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'upstream-secret-payload',
        text,
      }),
    );
    try {
      await fetchWithRetry('https://ai.example.com/chat', { body: '{}', maxAttempts: 1 });
      throw new Error('expected rejection');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('AI Provider Request Failed (400)');
      expect(message).not.toContain('upstream-secret-payload');
    }
    expect(text).not.toHaveBeenCalled();
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

  it('429 按指数退避重试，耗尽尝试后抛最后错误且不含响应体', async () => {
    vi.useFakeTimers();
    const text = vi.fn(async () => 'rate limited secret-body');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text });
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithRetry('https://ai.example.com/chat', { body: '{}' });
    const assertion = promise.then(
      () => {
        throw new Error('expected rejection');
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toBe('AI Provider Request Failed (429)');
        expect(message).not.toContain('rate limited');
        expect(message).not.toContain('secret-body');
      },
    );
    // 两次退避：500×2⁰ + 500×2¹（含抖动 ≤250ms），推进 3 秒足够覆盖
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(text).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1/secret', 'loopback'],
    ['http://169.254.169.254/latest/meta-data/', 'link-local'],
  ])('302 到 %s 不发送 Bearer', async (location) => {
    const fetchMock = vi.fn(async (input: string, _init?: { headers?: Record<string, string> }) => {
      const target = String(input);
      if (target.includes('127.0.0.1') || target.includes('169.254.169.254')) {
        return okResponse();
      }
      return redirectResponse(location);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWithRetry('https://ai.example.com/chat', {
        body: '{}',
        headers: { Authorization: BEARER },
      }),
    ).rejects.toThrow(/AI provider redirect blocked/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(calledUrl).toBe('https://ai.example.com/chat');
    expect(init?.headers?.Authorization).toBe(BEARER);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain('127.0.0.1');
      expect(String(call[0])).not.toContain('169.254.169.254');
    }
  });

  it('302 到另一个公网 https 主机时，检查器放行才跟随并带上 Bearer', async () => {
    const next = 'https://cdn.example.com/v1/chat/completions';
    const fetchMock = vi.fn(async (input: string, _init?: { headers?: Record<string, string>; redirect?: string }) => {
      if (String(input) === 'https://ai.example.com/chat') return redirectResponse(next);
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const allowed = await fetchWithRetry('https://ai.example.com/chat', {
      body: '{}',
      headers: { Authorization: BEARER },
    });
    expect(allowed.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const followedInit = fetchMock.mock.calls[1]?.[1];
    expect(fetchMock.mock.calls[1]?.[0]).toBe(next);
    expect(followedInit?.headers?.Authorization).toBe(BEARER);
    expect(followedInit?.redirect).toBe('manual');

    fetchMock.mockClear();
    await expect(
      fetchWithRetry('https://ai.example.com/chat', {
        body: '{}',
        headers: { Authorization: BEARER },
        hopCheck: (target) =>
          target.startsWith('https://cdn.example.com')
            ? { allowed: false, reason: 'checker denied' }
            : { allowed: true },
      }),
    ).rejects.toThrow(/checker denied/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://ai.example.com/chat');
  });

  it('首跳链路本地地址在发出请求前被拒绝', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchWithRetry('http://169.254.169.254/latest/meta-data/', {
        headers: { Authorization: BEARER },
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/AI provider request blocked: link-local host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('同主机的回环跳转仍跟随（本机推理服务的尾斜杠）', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (String(input) === 'http://127.0.0.1:11434/v1') {
        return redirectResponse('http://127.0.0.1:11434/v1/');
      }
      return okResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchWithRetry('http://127.0.0.1:11434/v1', {
      headers: { Authorization: BEARER },
      maxAttempts: 1,
    });
    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://127.0.0.1:11434/v1',
      'http://127.0.0.1:11434/v1/',
    ]);
  });
});

describe('assessAiProviderHop', () => {
  const fromPublic = 'https://ai.example.com/chat';

  it('公网 https 重定向放行，回环与链路本地不放行', () => {
    expect(assessAiProviderHop('https://cdn.example.com/v1/chat/completions', fromPublic).allowed).toBe(true);
    expect(assessAiProviderHop('http://127.0.0.1/secret', fromPublic).allowed).toBe(false);
    expect(assessAiProviderHop('http://169.254.169.254/latest/meta-data/', fromPublic).allowed).toBe(false);
    expect(assessAiProviderHop('http://2130706433/', fromPublic).allowed).toBe(false);
    expect(assessAiProviderHop('http://[::ffff:127.0.0.1]/', fromPublic).allowed).toBe(false);
    expect(assessAiProviderHop('http://[::ffff:a9fe:a9fe]/', fromPublic).allowed).toBe(false);
  });

  it('首跳允许回环，拒绝链路本地与元数据主机名', () => {
    expect(assessAiProviderHop('http://127.0.0.1:11434/v1').allowed).toBe(true);
    expect(assessAiProviderHop('http://10.0.0.8:8000/v1').allowed).toBe(true);
    expect(assessAiProviderHop('http://169.254.169.254/').allowed).toBe(false);
    expect(assessAiProviderHop('http://metadata.google.internal/computeMetadata/v1/').allowed).toBe(false);
  });
});
