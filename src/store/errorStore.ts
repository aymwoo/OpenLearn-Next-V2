import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SystemErrorItem, StudentErrorItem } from '../types/error';

export type ErrorListener = (error: SystemErrorItem) => void;
const errorListeners = new Set<ErrorListener>();

export function registerErrorListener(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export interface ErrorStoreState {
  errors: SystemErrorItem[];
  studentErrors: StudentErrorItem[];
  activeTab: 'local' | 'student';
  isErrorCenterOpen: boolean;
  unreadCount: number;

  addError: (
    error: Omit<SystemErrorItem, 'id' | 'timestamp' | 'url' | 'userAgent'> &
      Partial<Pick<SystemErrorItem, 'timestamp' | 'url' | 'userAgent'>>,
  ) => SystemErrorItem;
  removeError: (id: string) => void;
  clearErrors: () => void;

  addStudentError: (item: StudentErrorItem) => void;
  removeStudentError: (id: string) => void;
  clearStudentErrors: () => void;

  setIsErrorCenterOpen: (open: boolean) => void;
  setActiveTab: (tab: 'local' | 'student') => void;
  markAllRead: () => void;
}

const MAX_STORED_ERRORS = 30;

/**
 * 未读计数不变量：0 <= unreadCount <= errors.length。
 */
const reconcileUnreadCount = (unreadCount: number, errors: SystemErrorItem[]): number =>
  Math.min(unreadCount, errors.length);

export function formatSingleErrorReport(err: SystemErrorItem): string {
  const dateStr = new Date(err.timestamp).toLocaleString();
  const lines: string[] = [
    `### [${err.type.toUpperCase()}] ${err.title}`,
    `- **发生时间**: ${dateStr}`,
    `- **页面路径**: ${err.url || 'N/A'}`,
    `- **错误摘要**: ${err.message}`,
  ];
  if (err.endpoint) {
    lines.push(`- **请求接口**: \`${err.endpoint}\` (HTTP ${err.status || 'Unknown'})`);
  }
  if (err.componentStack) {
    lines.push(`- **组件堆栈**:`, '```', err.componentStack.trim(), '```');
  }
  if (err.stack) {
    lines.push(`- **调用栈 (Stack Trace)**:`, '```', err.stack.trim(), '```');
  }
  return lines.join('\n');
}

export function formatSingleStudentErrorReport(err: StudentErrorItem): string {
  const dateStr = new Date(err.timestamp).toLocaleString();
  const lines: string[] = [
    `### [学生端异常] ${err.studentName || err.studentId} - ${err.title}`,
    `- **学生信息**: ${err.studentName || '未知'} (\`${err.studentId}\`)`,
    `- **关联课节**: ${err.lessonId || '未指定'}`,
    `- **关联班级**: ${err.classId || '未指定'}`,
    `- **发生时间**: ${dateStr}`,
    `- **页面路径**: ${err.url || 'N/A'}`,
    `- **错误摘要**: ${err.message}`,
  ];
  if (err.endpoint) {
    lines.push(`- **请求接口**: \`${err.endpoint}\` (HTTP ${err.status || 'Unknown'})`);
  }
  if (err.componentStack) {
    lines.push(`- **组件堆栈**:`, '```', err.componentStack.trim(), '```');
  }
  if (err.stack) {
    lines.push(`- **调用栈 (Stack Trace)**:`, '```', err.stack.trim(), '```');
  }
  return lines.join('\n');
}

export function formatBatchErrorReport(errors: SystemErrorItem[], studentErrors: StudentErrorItem[] = []): string {
  const now = new Date().toLocaleString();
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'Unknown';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';

  if (errors.length === 0 && studentErrors.length === 0) {
    return `# 🛠️ OpenLearn 系统诊断报告\n- 生成时间: ${now}\n- 暂无记录的系统异常。`;
  }

  const total = errors.length + studentErrors.length;
  const header = [
    `# 🛠️ OpenLearn 系统异常诊断报告`,
    `- **生成时间**: ${now}`,
    `- **当前页面**: ${currentUrl}`,
    `- **异常总数**: ${total} 项`,
    `- **本机异常数**: ${errors.length} 项`,
    `- **学生端异常数**: ${studentErrors.length} 项`,
    `- **运行环境**: ${ua}`,
    '',
    `---`,
    '',
  ].join('\n');

  const localSection =
    errors.length > 0
      ? `## 💻 本机异常记录 (${errors.length})\n\n` +
        errors
          .map((err, index) => `#### 错误 #${index + 1} (${err.type.toUpperCase()})\n` + formatSingleErrorReport(err))
          .join('\n\n---\n\n')
      : '';

  const studentSection =
    studentErrors.length > 0
      ? `## 🎒 学生端异常记录 (${studentErrors.length})\n\n` +
        studentErrors
          .map((err, index) => `#### 学生异常 #${index + 1}\n` + formatSingleStudentErrorReport(err))
          .join('\n\n---\n\n')
      : '';

  return [header, localSection, studentSection].filter(Boolean).join('\n\n---\n\n');
}

export const errorStore = createStore<ErrorStoreState>((set, get) => ({
  errors: [],
  studentErrors: [],
  activeTab: 'local',
  isErrorCenterOpen: false,
  unreadCount: 0,

  addError: (rawErr) => {
    const now = Date.now();
    const url = rawErr.url || (typeof window !== 'undefined' ? window.location.href : '');
    const userAgent = rawErr.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '');

    // Deduplicate: same type + message within 2 seconds
    const existingIndex = get().errors.findIndex(
      (e) => e.type === rawErr.type && e.message === rawErr.message && now - e.timestamp < 2000,
    );
    if (existingIndex >= 0) {
      return get().errors[existingIndex];
    }

    const newItem: SystemErrorItem = {
      id: `err_${now}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: rawErr.timestamp || now,
      url,
      userAgent,
      type: rawErr.type,
      title: rawErr.title,
      message: rawErr.message,
      stack: rawErr.stack,
      componentStack: rawErr.componentStack,
      endpoint: rawErr.endpoint,
      status: rawErr.status,
    };

    set((state) => {
      const errors = [newItem, ...state.errors].slice(0, MAX_STORED_ERRORS);
      return { errors, unreadCount: reconcileUnreadCount(state.unreadCount + 1, errors) };
    });

    // Notify registered error listeners
    errorListeners.forEach((listener) => {
      try {
        listener(newItem);
      } catch (err) {
        console.error('[ErrorStore] Error in errorListener:', err);
      }
    });

    return newItem;
  },

  removeError: (id) =>
    set((state) => {
      const errors = state.errors.filter((e) => e.id !== id);
      return { errors, unreadCount: reconcileUnreadCount(state.unreadCount, errors) };
    }),

  clearErrors: () =>
    set({
      errors: [],
      unreadCount: 0,
    }),

  addStudentError: (raw) => {
    const now = Date.now();
    const itemTime = raw.timestamp || now;
    set((state) => {
      // Deduplicate same error from same student within 2s
      const exists = state.studentErrors.some(
        (e) =>
          e.studentId === raw.studentId &&
          e.type === raw.type &&
          e.message === raw.message &&
          Math.abs(itemTime - e.timestamp) < 2000,
      );
      if (exists) return state;

      const newItem: StudentErrorItem = {
        ...raw,
        id: raw.id || `st_err_${now}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: itemTime,
      };

      const studentErrors = [newItem, ...state.studentErrors].slice(0, MAX_STORED_ERRORS);
      return { studentErrors };
    });
  },

  removeStudentError: (id) =>
    set((state) => ({
      studentErrors: state.studentErrors.filter((e) => e.id !== id),
    })),

  clearStudentErrors: () =>
    set({
      studentErrors: [],
    }),

  setIsErrorCenterOpen: (open) =>
    set({
      isErrorCenterOpen: open,
      unreadCount: open ? 0 : get().unreadCount,
    }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  markAllRead: () => set({ unreadCount: 0 }),
}));

export function useErrorStore<T = ErrorStoreState>(selector?: (state: ErrorStoreState) => T): T {
  return useStore(errorStore, selector || ((s) => s as unknown as T));
}

