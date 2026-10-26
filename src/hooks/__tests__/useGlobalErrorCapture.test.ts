/**
 * 全局错误捕获：主动取消的请求**不算**网络故障。
 *
 * 现场（2026-10-26）：live_class 页卸载时 `/api/classroom/sessions` 的在途请求
 * 被 abort，组件侧已经正确吞掉 AbortError，但上报层把它记成了
 * 「网络请求失败 (Network Disconnected / Error)」，学生端弹窗、并把这条假警报
 * 转发给老师。
 *
 * 这里盯住三件事：
 * 1. 被 abort 的 fetch 不进错误中心；
 * 2. 真正的网络故障（TypeError: Failed to fetch）照旧进错误中心；
 * 3. 未捕获的 AbortError 拒绝不进错误中心、不上报；其它未捕获拒绝照旧上报。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

const { reportMock } = vi.hoisted(() => ({ reportMock: vi.fn() }));
vi.mock('../../services/client-error-report', () => ({
  reportClientRuntimeError: reportMock,
}));

import { errorStore } from '../../store/errorStore';
import { useGlobalErrorCapture } from '../useGlobalErrorCapture';

const realFetch = window.fetch;

/** 构造一个「被 abort 时以 AbortError 拒绝」的 fetch 桩。 */
function stubAbortableFetch() {
  window.fetch = vi.fn().mockImplementation((_input: unknown, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('signal is aborted without reason', 'AbortError'));
      });
    });
  }) as unknown as typeof window.fetch;
}

describe('useGlobalErrorCapture · 主动取消 vs 真故障', () => {
  beforeEach(() => {
    errorStore.getState().clearErrors();
    reportMock.mockClear();
  });

  afterEach(() => {
    // 本仓库的 vitest 未开 globals，@testing-library/react 不会自动卸载已渲染的 hook。
    // 不卸载的话，上一个用例挂着的全局监听器仍在监听 unhandledrejection，
    // 下一个用例会被重复上报（断言次数翻倍就是这么来的）。
    cleanup();
    window.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('被 abort 的 API 请求不进错误中心（组件自己已处理，不该再报一次）', async () => {
    stubAbortableFetch();
    renderHook(() => useGlobalErrorCapture());

    const controller = new AbortController();
    const pending = window.fetch('/api/classroom/sessions?page=1&pageSize=10', {
      signal: controller.signal,
    });
    controller.abort();

    // 调用方仍然会收到 AbortError（包装层只做上报，不吞错误）
    await expect(pending).rejects.toThrow(/aborted/i);
    expect(errorStore.getState().errors).toHaveLength(0);
  });

  it('真正的网络故障照旧进错误中心并带上接口地址', async () => {
    window.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof window.fetch;
    renderHook(() => useGlobalErrorCapture());

    await expect(window.fetch('/api/classroom/sessions?page=1')).rejects.toThrow('Failed to fetch');

    const errors = errorStore.getState().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('api');
    expect(errors[0].endpoint).toContain('/api/classroom/sessions');
  });

  it('未捕获的 AbortError 拒绝不进错误中心、不上报给服务端', () => {
    renderHook(() => useGlobalErrorCapture());

    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new DOMException('signal is aborted without reason', 'AbortError');
    window.dispatchEvent(event);

    expect(errorStore.getState().errors).toHaveLength(0);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('其它未捕获拒绝照旧进错误中心并上报', () => {
    renderHook(() => useGlobalErrorCapture());

    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('真正的未捕获异常');
    window.dispatchEvent(event);

    const errors = errorStore.getState().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('promise');
    expect(reportMock).toHaveBeenCalledTimes(1);
  });
});
