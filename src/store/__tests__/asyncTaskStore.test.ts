import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { asyncTaskStore } from '../asyncTaskStore';
import { uiStore } from '../uiStore';

describe('asyncTaskStore', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    uiStore.setState({
      lang: 'zh',
      teacherTab: 'courses',
      toasts: [],
      pendingTimetableSubTab: null,
    });
    asyncTaskStore.setState({
      timetableOcrTask: null,
      timetableOcrDraft: null,
      isAnyTaskRunning: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('has correct initial state', () => {
    const state = asyncTaskStore.getState();
    expect(state.timetableOcrTask).toBeNull();
    expect(state.isAnyTaskRunning).toBe(false);
  });

  it('handles startTimetableOcr successfully in Chinese mode', async () => {
    const mockEntries = [
      {
        dayOfWeek: 1,
        timeSlot: '08:00 - 08:45',
        className: '高一(1)班',
        subject: '信息科技',
        location: '机房1',
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        entries: mockEntries,
        providerUsed: {
          id: 'prov_openai',
          name: 'OpenAI GPT-4o',
          model_name: 'gpt-4o',
        },
      }),
    } as any);

    const promise = asyncTaskStore.getState().startTimetableOcr({
      imageBase64: 'data:image/png;base64,fake-data',
      lang: 'zh',
      fileName: 'timetable.png',
    });

    // Check intermediate state while running
    const runningState = asyncTaskStore.getState();
    expect(runningState.isAnyTaskRunning).toBe(true);
    expect(runningState.timetableOcrTask?.status).toBe('running');
    expect(runningState.timetableOcrTask?.title).toBe('课表图片 AI 识别');

    // Check initial toast
    const toasts = uiStore.getState().toasts;
    expect(toasts.some((t) => t.title.includes('课表识别已在后台启动'))).toBe(true);

    await promise;

    // Check completed state
    const completedState = asyncTaskStore.getState();
    expect(completedState.isAnyTaskRunning).toBe(false);
    expect(completedState.timetableOcrTask?.status).toBe('completed');
    expect(completedState.timetableOcrTask?.result?.entries).toEqual(mockEntries);
    expect(completedState.timetableOcrTask?.result?.providerUsed?.model_name).toBe('gpt-4o');

    // Check completion toast and action
    const completionToast = uiStore.getState().toasts.find((t) => t.type === 'success');
    expect(completionToast).toBeDefined();
    expect(completionToast?.title).toContain('AI 课表识别完成');
    expect(completionToast?.action).toBeDefined();
    expect(completionToast?.action?.label).toBe('查看并导入课表');

    // Execute the action: should navigate to teacherTab 'timetable' AND schedule the OCR sub-tab (Issue #89)
    expect(uiStore.getState().teacherTab).toBe('courses');
    completionToast?.action?.onClick();
    expect(uiStore.getState().teacherTab).toBe('timetable');
    expect(uiStore.getState().pendingTimetableSubTab).toBe('ocr_import');
  });

  it('handles startTimetableOcr successfully in English mode', async () => {
    const mockEntries = [
      {
        dayOfWeek: 2,
        timeSlot: '10:00 - 11:30',
        className: 'Class 2A',
        subject: 'Physics',
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        entries: mockEntries,
        providerUsed: {
          id: 'prov_deepseek',
          name: 'DeepSeek',
          model_name: 'deepseek-chat',
        },
      }),
    } as any);

    await asyncTaskStore.getState().startTimetableOcr({
      imageBase64: 'data:image/png;base64,fake-data',
      lang: 'en',
    });

    const state = asyncTaskStore.getState();
    expect(state.timetableOcrTask?.status).toBe('completed');
    expect(state.timetableOcrTask?.title).toBe('Timetable Image AI Recognition');

    const completionToast = uiStore.getState().toasts.find((t) => t.type === 'success');
    expect(completionToast?.title).toContain('Timetable OCR Completed');
    expect(completionToast?.action?.label).toBe('View Timetable');
  });

  it('handles startTimetableOcr failure gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: '未检测到可用的 AI 提供商',
      }),
    } as any);

    await asyncTaskStore.getState().startTimetableOcr({
      imageBase64: 'data:image/png;base64,fake-data',
      lang: 'zh',
    });

    const state = asyncTaskStore.getState();
    expect(state.isAnyTaskRunning).toBe(false);
    expect(state.timetableOcrTask?.status).toBe('failed');
    expect(state.timetableOcrTask?.error).toBe('未检测到可用的 AI 提供商');

    const errorToast = uiStore.getState().toasts.find((t) => t.type === 'error');
    expect(errorToast).toBeDefined();
    expect(errorToast?.title).toBe('AI 课表识别失败');
    expect(errorToast?.message).toBe('未检测到可用的 AI 提供商');
  });

  it('clears timetable task on clearTimetableOcrTask', () => {
    asyncTaskStore.setState({
      timetableOcrTask: {
        id: 'test_task',
        type: 'timetable_ocr',
        title: 'test',
        status: 'completed',
        startedAt: Date.now(),
      },
      isAnyTaskRunning: true,
    });

    asyncTaskStore.getState().clearTimetableOcrTask();

    const state = asyncTaskStore.getState();
    expect(state.timetableOcrTask).toBeNull();
    expect(state.isAnyTaskRunning).toBe(false);
  });
});

describe('asyncTaskStore (Issue #89: 识别草稿持久化)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    asyncTaskStore.setState({ timetableOcrTask: null, timetableOcrDraft: null, isAnyTaskRunning: false });
  });

  it('setTimetableOcrDraft merges partials, persists to sessionStorage and stamps updatedAt', () => {
    asyncTaskStore.getState().setTimetableOcrDraft({ fileName: 'a.png', entries: [{ dayOfWeek: 1 }] });
    asyncTaskStore.getState().setTimetableOcrDraft({ selected: [0], providerId: 'prov_1' });

    const draft = asyncTaskStore.getState().timetableOcrDraft;
    expect(draft?.fileName).toBe('a.png');
    expect(draft?.entries).toEqual([{ dayOfWeek: 1 }]);
    expect(draft?.selected).toEqual([0]);
    expect(draft?.providerId).toBe('prov_1');
    expect(draft?.updatedAt).toBeGreaterThan(0);

    const raw = sessionStorage.getItem('openlearn_timetable_ocr_draft');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).fileName).toBe('a.png');
    expect(JSON.parse(raw!).selected).toEqual([0]);
  });

  it('persists the task lifecycle and clears both task and draft from sessionStorage on clear', () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        entries: [{ dayOfWeek: 1 }],
        providerUsed: { id: 'p', name: 'n', model_name: 'm' },
      }),
    } as any);

    return asyncTaskStore
      .getState()
      .startTimetableOcr({ imageBase64: 'data:x', lang: 'zh' })
      .then(() => {
        expect(JSON.parse(sessionStorage.getItem('openlearn_timetable_ocr_task')!).status).toBe('completed');

        asyncTaskStore.getState().setTimetableOcrDraft({ entries: [{ dayOfWeek: 1 }], selected: [0] });
        expect(sessionStorage.getItem('openlearn_timetable_ocr_draft')).toBeTruthy();

        asyncTaskStore.getState().clearTimetableOcrTask();
        expect(asyncTaskStore.getState().timetableOcrDraft).toBeNull();
        expect(sessionStorage.getItem('openlearn_timetable_ocr_task')).toBeNull();
        expect(sessionStorage.getItem('openlearn_timetable_ocr_draft')).toBeNull();
      });
  });

  it('falls back to stripping image fields when sessionStorage quota is exceeded', () => {
    const originalSetItem = Storage.prototype.setItem;
    let stripped = false;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (!stripped && value.includes('data:image/png;base64,HUGE')) {
        stripped = true;
        throw new DOMException('QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      asyncTaskStore.getState().setTimetableOcrDraft({
        imagePreview: 'data:image/png;base64,HUGE',
        imageBase64: 'data:image/png;base64,HUGE',
        entries: [{ dayOfWeek: 2 }],
        selected: [0],
      });

      // 内存态保留图片（当前会话仍可预览）
      expect(asyncTaskStore.getState().timetableOcrDraft?.imageBase64).toBe('data:image/png;base64,HUGE');
      // 持久化降级：去除图片字段，条目与勾选必须保住
      const raw = sessionStorage.getItem('openlearn_timetable_ocr_draft')!;
      const saved = JSON.parse(raw);
      expect(saved.imageBase64).toBeNull();
      expect(saved.imagePreview).toBeNull();
      expect(saved.entries).toEqual([{ dayOfWeek: 2 }]);
      expect(saved.selected).toEqual([0]);
    } finally {
      (Storage.prototype.setItem as any).mockRestore?.();
      Storage.prototype.setItem = originalSetItem;
    }
  });

  it('hydrates task and draft from sessionStorage on module load', async () => {
    const task = {
      id: 'task_ocr_hydrate',
      type: 'timetable_ocr',
      title: '课表图片 AI 识别',
      status: 'completed',
      startedAt: Date.now(),
      result: { entries: [{ dayOfWeek: 3 }], providerUsed: { id: 'p', name: 'n', model_name: 'm' } },
    };
    const draft = {
      imagePreview: null,
      imageBase64: null,
      fileName: 'x.png',
      providerId: '',
      entries: [{ dayOfWeek: 3 }],
      selected: [0],
      updatedAt: Date.now(),
    };
    sessionStorage.setItem('openlearn_timetable_ocr_task', JSON.stringify(task));
    sessionStorage.setItem('openlearn_timetable_ocr_draft', JSON.stringify(draft));

    vi.resetModules();
    const mod = await import('../asyncTaskStore');
    const state = mod.asyncTaskStore.getState();
    expect(state.timetableOcrTask?.id).toBe('task_ocr_hydrate');
    expect(state.timetableOcrTask?.status).toBe('completed');
    expect(state.timetableOcrDraft?.fileName).toBe('x.png');
    expect(state.isAnyTaskRunning).toBe(false);

    vi.resetModules();
  });
});
