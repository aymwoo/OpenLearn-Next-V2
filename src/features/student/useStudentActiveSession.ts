import { useEffect } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Issue #109: 学生端「正在进行的课堂会话」。
 *
 * 学生离开课堂（返回看板 / 刷新 / 切换面板）后，需要明确的入口回到老师当前
 * 正在上的课。此前前端只能靠排课投影猜测（`schedules[0]` / `progress[0]`），
 * 或等老师开启全班锁定被动拉回。这里改为查询服务端真实会话：
 * `GET /api/student/active-session`（学生身份强制使用会话内的 studentId）。
 *
 * 数据由模块级 store 共享：`StudentView` 顶层启动轮询，看板横幅 / 顶部导航 /
 * 悬浮菜单等任意组件直接订阅，避免多处重复请求。
 */

export interface StudentActiveSession {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  classId: string | null;
  className: string;
  stage: string;
  startedAt: number | null;
}

export interface StudentActiveSessionState {
  activeSession: StudentActiveSession | null;
  loading: boolean;
  /** 最近一次成功拉取的时间戳，便于调试与节流 */
  lastFetchAt: number;
  /** 当前查询对应的学生（切换模拟学生时用于丢弃过期响应） */
  studentKey: string | null;
  refresh: (studentId?: string | null) => Promise<void>;
}

let inflightKey: string | null = null;

export const studentActiveSessionStore = createStore<StudentActiveSessionState>((set, get) => ({
  activeSession: null,
  loading: false,
  lastFetchAt: 0,
  studentKey: null,

  refresh: async (studentId) => {
    if (!studentId) {
      set({ activeSession: null, loading: false, studentKey: null });
      return;
    }
    set({ loading: true, studentKey: studentId });
    inflightKey = studentId;
    try {
      const res = await fetch(`/api/student/active-session?studentId=${encodeURIComponent(studentId)}`);
      if (!res.ok) {
        // 无权限/未登录时静默隐藏入口，不制造误导性横幅
        if (get().studentKey === studentId) set({ activeSession: null });
        return;
      }
      const data = await res.json();
      // 学生已切换：丢弃过期响应
      if (inflightKey !== studentId || get().studentKey !== studentId) return;
      set({
        activeSession: data?.activeSession ?? null,
        lastFetchAt: Date.now(),
      });
    } catch {
      // 网络异常时保留上一次结果（横幅不闪断），下次轮询自愈
    } finally {
      if (get().studentKey === studentId) set({ loading: false });
    }
  },
}));

/** 订阅 store（组件用） */
export const useStudentActiveSession = <T>(selector: (state: StudentActiveSessionState) => T): T =>
  useStore(studentActiveSessionStore, selector);

/**
 * 在 StudentView 顶层调用一次：进入页面立即拉取，之后每 20s 轮询；
 * 标签页重新可见/窗口聚焦时立即刷新（回到课堂/下课后入口状态及时更新）。
 */
export function useStudentActiveSessionPolling(studentId: string | null, intervalMs = 20_000): void {
  useEffect(() => {
    if (!studentId) {
      studentActiveSessionStore.setState({ activeSession: null, loading: false, studentKey: null });
      return;
    }
    const refresh = () => void studentActiveSessionStore.getState().refresh(studentId);
    refresh();
    const timer = setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [studentId, intervalMs]);
}
