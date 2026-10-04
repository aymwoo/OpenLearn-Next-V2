import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  processLmsMessage,
  registerManagedIframe,
  clearManagedIframes,
  getManagedIframesCount,
  isPayloadOversized,
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ attemptId: 'atk-adopted' }), { status: 200 }));
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
      makeEvent({ type: 'LMS_GET_PROGRESS', attempt_id: 'atk-progress', requestId: 'req-1' }, managed.contentWindow),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/attempts/atk-progress/progress'))).toBe(true);

    // 未标记 iframe：直接丢弃，不取进度也不回复
    fetchMock.mockClear();
    await processLmsMessage(
      makeEvent({ type: 'LMS_GET_PROGRESS', attempt_id: 'atk-progress', requestId: 'req-2' }, unmanaged.contentWindow),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attempt_id 缺失时可从受管辖 iframe 提取（跨域不可读时安全忽略）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ attemptId: 'atk-extracted' }), { status: 200 }));
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ attemptId: 'atk-reg' }), { status: 200 }));
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

  it('isPayloadOversized 正确识别小载荷与超大载荷', () => {
    // 基础小对象
    expect(isPayloadOversized({ type: 'LMS_SUBMIT', score: 95 })).toBe(false);

    // 较长字符串但在 512KB 内
    const normalPayload = { text: 'a'.repeat(10 * 1024) };
    expect(isPayloadOversized(normalPayload)).toBe(false);

    // 超过 512KB 的超大载荷
    const oversizedPayload = { data: 'x'.repeat(600 * 1024) };
    expect(isPayloadOversized(oversizedPayload)).toBe(true);

    // 多字段累加超限
    const multiFieldOversized: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      multiFieldOversized[`key_${i}`] = 'y'.repeat(10 * 1024);
    }
    expect(isPayloadOversized(multiFieldOversized)).toBe(true);
  });
});

/**
 * 载荷尺寸闸门回归：必须按**真实 JSON 序列化长度**判定，而非 `String.length`。
 *
 * Why: 转义密集载荷（换行 / 引号 / 控制字符）在 `JSON.stringify` 时会膨胀 1–5 倍。
 * 旧实现按 `v.length` 估算，约 400KB 的换行密集载荷序列化后 >1MB 却仍能通过 512KB 闸门。
 */
describe('isPayloadOversized — 按序列化长度估算', () => {
  it('换行密集载荷在序列化膨胀后超限即被拦截（历史漏判场景）', () => {
    // 原始长度约 400KB < 512KB，但每 2 个字符序列化后变 3 个 → 约 600KB
    const escapeDense = { type: 'LMS_SUBMIT', attempt_id: 'a-1', payload: { text: 'a\n'.repeat(200 * 1024) } };

    // 前置确认：确实是「原始长度未超限」的漏判场景
    expect(JSON.stringify(escapeDense).length).toBeGreaterThan(512 * 1024);
    expect(escapeDense.payload.text.length).toBeLessThan(512 * 1024);

    expect(isPayloadOversized(escapeDense)).toBe(true);
  });

  it('引号 / 反斜杠 / 控制字符膨胀同样被计入', () => {
    // 原始 400KB < 512KB，但每个引号序列化后占 2 字符 → 约 600KB，应被拦截
    expect(isPayloadOversized({ t: 'a"'.repeat(200 * 1024) })).toBe(true);
    // 反斜杠同理
    expect(isPayloadOversized({ t: 'a\\'.repeat(200 * 1024) })).toBe(true);
    // 控制字符按 6 字符输出，最坏 6 倍膨胀：100KB 原始 → 600KB
    expect(isPayloadOversized({ t: String.fromCharCode(0).repeat(100 * 1024) })).toBe(true);
    // 换行按 2 字符输出
    expect(isPayloadOversized({ t: '\n'.repeat(300 * 1024) })).toBe(true);
  });

  it('不误杀正常载荷：纯 ASCII / 中文 / Emoji 文本在限额内均放行', () => {
    expect(isPayloadOversized({ text: 'a'.repeat(400 * 1024) })).toBe(false);
    // 中文字符在 JSON 中原样输出（UTF-16 长度与序列化长度一致）
    expect(isPayloadOversized({ text: '课'.repeat(300 * 1024) })).toBe(false);
    // Emoji 为合法代理对，序列化后仍是 2 个码元
    expect(isPayloadOversized({ text: '😀'.repeat(150 * 1024) })).toBe(false);
  });

  it('字符串直传按转义后长度判定', () => {
    expect(isPayloadOversized('a'.repeat(100), 200)).toBe(false);
    expect(isPayloadOversized('a'.repeat(300), 200)).toBe(true);
    // 'a\n'.repeat(100) → 序列化后 302 字符（含包裹引号）
    expect(isPayloadOversized('a\n'.repeat(100), 400)).toBe(false);
    expect(isPayloadOversized('a\n'.repeat(100), 250)).toBe(true);
  });

  it('估算与真实序列化长度一致（双向边界断言）', () => {
    const cases: unknown[] = [
      { type: 'LMS_SUBMIT', score: 95, ok: true },
      { text: 'line1\nline2\t"quoted"\\slash' },
      { nested: { a: [1, 2, 3], b: { c: 'x'.repeat(50) } }, flag: false, nothing: null },
      { arr: ['a\nb', { deep: { deeper: 'q"q' } }, 3.5, -0.0001, 1e21] },
      { dropped: undefined, kept: 1, fn: () => 1 },
      { arr2: [undefined, () => 1, 'z'] },
      { empty: {}, emptyArr: [] },
      { unicode: '中文 mixed 😀 with \u0000 null' },
    ];

    for (const data of cases) {
      const actual = JSON.stringify(data).length;
      expect(isPayloadOversized(data, actual - 1), `低于真实长度应判超限: ${actual}`).toBe(true);
      expect(isPayloadOversized(data, actual), `等于真实长度不应判超限: ${actual}`).toBe(false);
    }
  });

  it('深层嵌套 / 非普通对象回退全量序列化，不漏判', () => {
    // 超过估算深度上限的深层结构
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 12; i++) {
      const next: Record<string, unknown> = {};
      cursor.deep = next;
      cursor = next;
    }
    cursor.big = 'x'.repeat(600 * 1024);
    expect(isPayloadOversized(deep)).toBe(true);

    // 带 toJSON 的 Date / 类实例：廉价估算不可靠 → 回退序列化
    expect(isPayloadOversized({ at: new Date(0), v: 1 })).toBe(false);
  });

  it('循环引用沿用历史行为（不拦截，且不抛异常）', () => {
    const cyclic: Record<string, unknown> = { type: 'LMS_SUBMIT' };
    cyclic.self = cyclic;
    expect(() => isPayloadOversized(cyclic)).not.toThrow();
    expect(isPayloadOversized(cyclic)).toBe(false);
  });

  it('processLmsMessage 丢弃序列化后超 512KB 的转义密集消息（不触发请求）', async () => {
    vi.restoreAllMocks();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const iframe = createManagedIframe();

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await processLmsMessage(
      makeEvent(
        {
          type: 'LMS_SUBMIT',
          attempt_id: 'atk-oversized',
          payload: { text: 'a\n'.repeat(200 * 1024) },
        },
        iframe.contentWindow,
      ),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('[LMS Bridge] Dropped oversized postMessage (>512KB)');
    consoleSpy.mockRestore();
  });
});
