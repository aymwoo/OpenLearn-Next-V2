import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCourseWizard } from '../useCourseWizard';

describe('useCourseWizard —— AI 大纲生成', () => {
  let addToast: ReturnType<typeof vi.fn>;
  let fetchLessons: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  function renderWizard() {
    return renderHook(() =>
      useCourseWizard({
        lang: 'zh',
        addToast: addToast as any,
        fetchLessons: fetchLessons as any,
        setSelectedLesson: vi.fn(),
        setTeacherTab: vi.fn(),
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    addToast = vi.fn();
    fetchLessons = vi.fn();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockOutlineResponse(body: unknown, ok = true, status = 200) {
    (globalThis.fetch as any).mockResolvedValue({
      ok,
      status,
      json: async () => body,
    });
  }

  it('默认时间轴总时长为 40 分钟', () => {
    const { result } = renderWizard();
    const total = result.current.wizardCourseTimeline.reduce(
      (sum, seg) => sum + Number(String(seg.duration).replace(/[^\d]/g, '')),
      0,
    );
    expect(total).toBe(40);
  });

  it('课题为空时应拦截，不发起请求并给出 warning', async () => {
    const { result } = renderWizard();

    await act(async () => {
      await result.current.handleGenerateOutline();
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('请先填写课程课题', expect.any(String), 'warning');
  });

  it('应携带课题/分类/简介/时间轴请求后端，并把返回内容写入课程正文', async () => {
    mockOutlineResponse({ success: true, content: '# 康德的三大批判\n\n## 🎯 教学目标' });

    const { result } = renderWizard();
    act(() => {
      result.current.setWizardCourseTitle('西方哲学：康德的三大批判');
      result.current.setWizardCourseCategory('History');
      result.current.setWizardCourseDescription('面向高中生的哲学入门');
    });

    await act(async () => {
      await result.current.handleGenerateOutline();
    });

    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('/api/lessons/generate-outline');
    expect(init.method).toBe('POST');

    const payload = JSON.parse(init.body);
    expect(payload.title).toBe('西方哲学：康德的三大批判');
    expect(payload.category).toBe('History');
    expect(payload.description).toBe('面向高中生的哲学入门');
    expect(payload.lang).toBe('zh');
    expect(Array.isArray(payload.timeline)).toBe(true);
    expect(
      payload.timeline.reduce((s: number, seg: any) => s + Number(String(seg.duration).replace(/[^\d]/g, '')), 0),
    ).toBe(40);

    await waitFor(() => expect(result.current.wizardCourseContent).toBe('# 康德的三大批判\n\n## 🎯 教学目标'));
    expect(addToast).toHaveBeenCalledWith('✨ AI 大纲生成成功', expect.any(String), 'success');
  });

  it('后端返回失败时应弹出错误 toast 且不覆盖已有正文', async () => {
    mockOutlineResponse({ success: false, error: '未检测到可用的 AI 提供商。' }, false, 400);

    const { result } = renderWizard();
    act(() => {
      result.current.setWizardCourseTitle('Python 编程入门');
      result.current.setWizardCourseContent('教师已手写的教案正文');
    });

    await act(async () => {
      await result.current.handleGenerateOutline();
    });

    expect(result.current.wizardCourseContent).toBe('教师已手写的教案正文');
    expect(addToast).toHaveBeenCalledWith('AI 大纲生成失败', '未检测到可用的 AI 提供商。', 'error');
  });

  it('网络异常时应捕获并提示，不产生未处理 rejection', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('Network down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderWizard();
    act(() => result.current.setWizardCourseTitle('电路并联原理'));

    await act(async () => {
      await result.current.handleGenerateOutline();
    });

    expect(addToast).toHaveBeenCalledWith('AI 大纲生成失败', 'Network down', 'error');
    expect(result.current.wizardIsGeneratingOutline).toBe(false);
  });

  it('生成期间应暴露 loading 态，结束后复位', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (globalThis.fetch as any).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result } = renderWizard();
    act(() => result.current.setWizardCourseTitle('数据结构'));

    let pending: Promise<void>;
    act(() => {
      pending = result.current.handleGenerateOutline();
    });
    await waitFor(() => expect(result.current.wizardIsGeneratingOutline).toBe(true));

    resolveFetch({ ok: true, status: 200, json: async () => ({ success: true, content: '# 数据结构' }) });
    await act(async () => {
      await pending!;
    });

    expect(result.current.wizardIsGeneratingOutline).toBe(false);
    expect(result.current.wizardCourseContent).toBe('# 数据结构');
  });
});
