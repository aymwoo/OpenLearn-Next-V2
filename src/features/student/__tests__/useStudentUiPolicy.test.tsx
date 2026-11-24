/**
 * useStudentUiPolicy：学生首屏策略的取数、失败保留与依赖变化重拉。
 *
 * 对应 `docs/architecture/student-ui-policy.md` §5：
 * - 首次进入立即取数；
 * - 请求失败保留上一次成功结果；
 * - lessonId 变化触发重新取数；
 * - 没有学生身份时回退到「全部可见」且不发请求。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useStudentUiPolicy } from '../useStudentUiPolicy';

function jsonResponse(policy: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, policy }),
  } as unknown as Response;
}

const hiddenQuickStats = {
  features: { 'widget.quick-stats': false },
  hideGuidance: true,
  hiddenPlugins: ['p1'],
  hiddenExtensions: [],
  revision: 'r1',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useStudentUiPolicy', () => {
  it('首次进入立即取数并归一化生效策略', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(hiddenQuickStats));

    const { result } = renderHook(() => useStudentUiPolicy('stu-1', null, 1_000_000));

    await waitFor(() => expect(result.current.features['widget.quick-stats']).toBe(false));
    expect(result.current.hideGuidance).toBe(true);
    expect(result.current.hiddenPlugins).toEqual(['p1']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/students/stu-1/ui-policy');
  });

  it('请求失败时保留上一次成功结果', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse(hiddenQuickStats));
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useStudentUiPolicy('stu-1', null, 1_000_000));
    await waitFor(() => expect(result.current.features['widget.quick-stats']).toBe(false));

    // 聚焦触发一次刷新，本次请求失败，但策略不应回退为全可见
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.features['widget.quick-stats']).toBe(false);
    expect(result.current.hideGuidance).toBe(true);
  });

  it('lessonId 变化时重新取数并带上查询参数', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(jsonResponse(hiddenQuickStats));

    const { rerender } = renderHook(
      ({ lessonId }: { lessonId: string | null }) => useStudentUiPolicy('stu-1', lessonId, 1_000_000),
      { initialProps: { lessonId: 'les-1' } },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain('lessonId=les-1');

    rerender({ lessonId: 'les-2' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain('lessonId=les-2');
  });

  it('没有学生身份时回退默认策略且不发请求', () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useStudentUiPolicy(null, 'les-1'));

    expect(result.current.features['widget.quick-stats']).toBe(true);
    expect(result.current.hideGuidance).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
