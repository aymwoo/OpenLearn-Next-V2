import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { uiStore } from './uiStore';

export type AsyncTaskType = 'timetable_ocr' | 'outline_generation' | 'batch_grading';
export type AsyncTaskStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface TimetableOcrResult {
  entries: any[];
  providerUsed: {
    id: string;
    name: string;
    model_name: string;
  };
}

export interface AsyncTask<T = any> {
  id: string;
  type: AsyncTaskType;
  title: string;
  status: AsyncTaskStatus;
  startedAt: number;
  completedAt?: number;
  result?: T;
  error?: string;
  meta?: Record<string, any>;
}

export interface AsyncTaskState {
  /** 当前正在执行或刚完成的课表识别任务 */
  timetableOcrTask: AsyncTask<TimetableOcrResult> | null;

  /** 是否有任意任务在后台运行中 */
  isAnyTaskRunning: boolean;

  /** 启动课表后台识别任务 */
  startTimetableOcr: (params: {
    imageBase64: string;
    lang: 'zh' | 'en';
    providerId?: string;
    fileName?: string;
  }) => Promise<void>;

  /** 清除或消费课表识别任务结果（如已导入完毕） */
  clearTimetableOcrTask: () => void;
}

export const asyncTaskStore = createStore<AsyncTaskState>((set, get) => ({
  timetableOcrTask: null,
  isAnyTaskRunning: false,

  startTimetableOcr: async ({ imageBase64, lang, providerId, fileName }) => {
    const taskId = `task_ocr_${Date.now()}`;
    const newTask: AsyncTask<TimetableOcrResult> = {
      id: taskId,
      type: 'timetable_ocr',
      title: lang === 'zh' ? '课表图片 AI 识别' : 'Timetable Image AI Recognition',
      status: 'running',
      startedAt: Date.now(),
      meta: { fileName },
    };

    set({
      timetableOcrTask: newTask,
      isAnyTaskRunning: true,
    });

    // 立即给出全局轻量提示，告知已进入后台运行，用户可自由跳转页面
    uiStore.getState().addToast({
      id: `toast_start_${taskId}`,
      title: lang === 'zh' ? '⏳ 课表识别已在后台启动' : '⏳ Timetable OCR Running in Background',
      message:
        lang === 'zh'
          ? '大模型正在后台分析提取课表内容，您可以继续进行其他操作，识别完成后将通过通知提醒您。'
          : 'AI is analyzing your timetable image in the background. You can navigate freely; you will be notified upon completion.',
      type: 'info',
    });

    try {
      const response = await fetch('/api/timetable/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          lang,
          providerId: providerId || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || (lang === 'zh' ? '识别请求失败' : 'OCR recognition failed'));
      }

      const entries = Array.isArray(data.entries) ? data.entries : [];
      const completedTask: AsyncTask<TimetableOcrResult> = {
        ...newTask,
        status: 'completed',
        completedAt: Date.now(),
        result: {
          entries,
          providerUsed: data.providerUsed,
        },
      };

      set({
        timetableOcrTask: completedTask,
        isAnyTaskRunning: false,
      });

      // 任务成功完成，弹出带有一键跳转动作的全局 Toast
      uiStore.getState().addToast({
        id: `toast_done_${taskId}`,
        title: lang === 'zh' ? '🎉 AI 课表识别完成' : '🎉 Timetable OCR Completed',
        message:
          lang === 'zh'
            ? `已成功从图片中解析出 ${entries.length} 节课程，点击前往核对并导入。`
            : `Successfully parsed ${entries.length} timetable entries. Click to review and import.`,
        type: 'success',
        action: {
          label: lang === 'zh' ? '查看并导入课表' : 'View Timetable',
          onClick: () => {
            uiStore.getState().setTeacherTab('timetable');
          },
        },
      });
    } catch (err: any) {
      console.error('[AsyncTask] Timetable OCR failed:', err);
      const failedTask: AsyncTask<TimetableOcrResult> = {
        ...newTask,
        status: 'failed',
        completedAt: Date.now(),
        error: err?.message || (lang === 'zh' ? '未知识别错误' : 'Unknown OCR error'),
      };

      set({
        timetableOcrTask: failedTask,
        isAnyTaskRunning: false,
      });

      uiStore.getState().addToast({
        id: `toast_fail_${taskId}`,
        title: lang === 'zh' ? 'AI 课表识别失败' : 'Timetable OCR Failed',
        message:
          err?.message ||
          (lang === 'zh'
            ? '请检查图片是否清晰可见，或前往「系统管理 -> AI 提供商管理」检查模型连通性。'
            : 'Please check the image quality or AI provider settings.'),
        type: 'error',
      });
    }
  },

  clearTimetableOcrTask: () => {
    set({ timetableOcrTask: null, isAnyTaskRunning: false });
  },
}));

export const useAsyncTaskStore = <T>(selector: (state: AsyncTaskState) => T): T =>
  useStore(asyncTaskStore, selector);
