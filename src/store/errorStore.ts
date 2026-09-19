import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SystemErrorItem } from '../types/error';

export interface ErrorStoreState {
  errors: SystemErrorItem[];
  isErrorCenterOpen: boolean;
  unreadCount: number;

  addError: (
    error: Omit<SystemErrorItem, 'id' | 'timestamp' | 'url' | 'userAgent'> &
      Partial<Pick<SystemErrorItem, 'timestamp' | 'url' | 'userAgent'>>,
  ) => SystemErrorItem;
  removeError: (id: string) => void;
  clearErrors: () => void;
  setIsErrorCenterOpen: (open: boolean) => void;
  markAllRead: () => void;
}

const MAX_STORED_ERRORS = 30;

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

export function formatBatchErrorReport(errors: SystemErrorItem[]): string {
  const now = new Date().toLocaleString();
  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'Unknown';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';

  if (errors.length === 0) {
    return `# 🛠️ OpenLearn 系统诊断报告\n- 生成时间: ${now}\n- 暂无记录的系统异常。`;
  }

  const header = [
    `# 🛠️ OpenLearn 系统异常诊断报告`,
    `- **生成时间**: ${now}`,
    `- **当前页面**: ${currentUrl}`,
    `- **异常总数**: ${errors.length} 项`,
    `- **运行环境**: ${ua}`,
    '',
    `---`,
    '',
  ].join('\n');

  const items = errors
    .map((err, index) => {
      return `#### 错误 #${index + 1} (${err.type.toUpperCase()})\n` + formatSingleErrorReport(err);
    })
    .join('\n\n---\n\n');

  return `${header}${items}`;
}

export const errorStore = createStore<ErrorStoreState>((set, get) => ({
  errors: [],
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

    set((state) => ({
      errors: [newItem, ...state.errors].slice(0, MAX_STORED_ERRORS),
      unreadCount: state.unreadCount + 1,
    }));

    return newItem;
  },

  removeError: (id) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.id !== id),
    })),

  clearErrors: () =>
    set({
      errors: [],
      unreadCount: 0,
    }),

  setIsErrorCenterOpen: (open) =>
    set({
      isErrorCenterOpen: open,
      unreadCount: open ? 0 : get().unreadCount,
    }),

  markAllRead: () => set({ unreadCount: 0 }),
}));

export function useErrorStore<T = ErrorStoreState>(selector?: (state: ErrorStoreState) => T): T {
  return useStore(errorStore, selector || ((s) => s as unknown as T));
}
