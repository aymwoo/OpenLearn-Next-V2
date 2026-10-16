import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { asyncTaskStore } from '../asyncTaskStore';
import { uiStore } from '../uiStore';

describe('asyncTaskStore', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    uiStore.setState({
      lang: 'zh',
      teacherTab: 'courses',
      toasts: [],
    });
    asyncTaskStore.setState({
      timetableOcrTask: null,
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

    // Execute the action: should navigate to teacherTab 'timetable'
    expect(uiStore.getState().teacherTab).toBe('courses');
    completionToast?.action?.onClick();
    expect(uiStore.getState().teacherTab).toBe('timetable');
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
