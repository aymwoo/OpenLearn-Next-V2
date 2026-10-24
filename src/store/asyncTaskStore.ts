import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { uiStore } from './uiStore';
import { appStore } from './appStore';

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

/**
 * 课表识别草稿（Issue #89）。
 *
 * 记录「AI 识别导入」子页的现场：结果条目、勾选、图片预览、提供方等。
 * 切换页面（组件卸载）或刷新（sessionStorage 恢复）后均可回到审核界面直接导入，
 * 直到用户导入成功或重新选图/丢弃。
 */
export interface TimetableOcrDraft {
  imagePreview: string | null;
  imageBase64: string | null;
  fileName: string;
  providerId: string;
  entries: any[];
  /** 已勾选条目的索引数组 */
  selected: number[];
  updatedAt: number;
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

  /** 课表识别草稿（Issue #89：切页/刷新不丢失，直到导入成功或重新选图） */
  timetableOcrDraft: TimetableOcrDraft | null;

  /** 是否有任意任务在后台运行中 */
  isAnyTaskRunning: boolean;

  /** 启动课表后台识别任务 */
  startTimetableOcr: (params: {
    imageBase64: string;
    lang: 'zh' | 'en';
    providerId?: string;
    fileName?: string;
  }) => Promise<void>;

  /** 同步「AI 识别导入」子页的草稿现场（结果条目、勾选、图片等） */
  setTimetableOcrDraft: (draft: Partial<Omit<TimetableOcrDraft, 'updatedAt'>>) => void;

  /** 清除或消费课表识别任务结果（如已导入完毕） */
  clearTimetableOcrTask: () => void;
}

// ── sessionStorage 持久化（Issue #89）─────────────────────────────────────
// 刷新或新开窗口后，识别任务状态与草稿仍可恢复。
// 图片 base64 体积可能超过配额：先尝试全量保存，QuotaExceeded 时降级为去除图片再存。

const OCR_TASK_KEY = 'openlearn_timetable_ocr_task';
const OCR_DRAFT_KEY = 'openlearn_timetable_ocr_draft';

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown, stripImageKeys: string[] = []): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 配额不足：去除大字段（图片 base64/预览）后重试一次
    if (stripImageKeys.length > 0 && value && typeof value === 'object') {
      try {
        const slim = { ...(value as Record<string, any>) };
        for (const k of stripImageKeys) slim[k] = null;
        sessionStorage.setItem(key, JSON.stringify(slim));
      } catch {
        /* 彻底不可用时放弃持久化，仅保留内存态 */
      }
    }
  }
}

function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const asyncTaskStore = createStore<AsyncTaskState>((set, get) => ({
  // 刷新后恢复：优先 sessionStorage，配额降级保存时图片字段为 null 不影响结果条目
  timetableOcrTask: readSession<AsyncTask<TimetableOcrResult>>(OCR_TASK_KEY),
  timetableOcrDraft: readSession<TimetableOcrDraft>(OCR_DRAFT_KEY),
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
    writeSession(OCR_TASK_KEY, newTask);

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
      writeSession(OCR_TASK_KEY, completedTask);

      // 任务成功完成，弹出带有一键跳转动作的全局 Toast（直达「AI 识别导入」子页）
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
            // 走 appStore 的 setter —— teacherTab 的权威源是 appStore，
            // 直接写 uiStore 只会改镜像副本，页面不会真的切到课表页。
            appStore.getState().setTeacherTab('timetable');
            uiStore.getState().setPendingTimetableSubTab('ocr_import');
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
      writeSession(OCR_TASK_KEY, failedTask);

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

  setTimetableOcrDraft: (draft) => {
    const next: TimetableOcrDraft = {
      imagePreview: null,
      imageBase64: null,
      fileName: '',
      providerId: '',
      entries: [],
      selected: [],
      ...(get().timetableOcrDraft || {}),
      ...draft,
      updatedAt: Date.now(),
    };
    set({ timetableOcrDraft: next });
    // 图片字段可能超配额：降级时去除图片，其余现场（条目/勾选）必须保住
    writeSession(OCR_DRAFT_KEY, next, ['imagePreview', 'imageBase64']);
  },

  clearTimetableOcrTask: () => {
    set({ timetableOcrTask: null, isAnyTaskRunning: false, timetableOcrDraft: null });
    removeSession(OCR_TASK_KEY);
    removeSession(OCR_DRAFT_KEY);
  },
}));

export const useAsyncTaskStore = <T>(selector: (state: AsyncTaskState) => T): T => useStore(asyncTaskStore, selector);
