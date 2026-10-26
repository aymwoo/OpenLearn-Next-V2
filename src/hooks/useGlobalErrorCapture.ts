import { useEffect } from 'react';
import { errorStore, registerErrorListener } from '../store/errorStore';
import { getOptionalSocket } from '../services/socket-service';
import { appStore } from '../store/appStore';
import { reportClientRuntimeError } from '../services/client-error-report';

/**
 * 判断这次失败是不是「我们自己主动取消的请求」。
 *
 * 主动 abort 的 fetch 会以 AbortError 拒绝 —— 它**不是**网络故障：调用方通常
 * 已经在自己的 catch 里处理过了（例如组件卸载时取消在途请求、切页时取消轮询、
 * 筛选条件变化时取消上一次拉取）。
 *
 * 不区分的后果很具体：学生端会弹出「网络请求失败 (Network Disconnected / Error)」，
 * 这条假警报还会被转发给老师（学生侧错误实时通报），把正常的页面切换报成故障。
 * 实测现场：`live_class` 页卸载时 `/api/classroom/sessions` 的在途请求被 abort，
 * 组件侧已经正确吞掉 AbortError（ClassroomSessionManager 的 catch 分支），
 * 但上报层先记了一笔 —— 组件处理得对不该被上报。
 *
 * 判定依据（任一命中即认为是主动取消）：
 * - 请求的 AbortSignal 处于 aborted 状态（最权威：是我们自己取消的）；
 * - 错误名是 AbortError；
 * - DOMException.ABORT_ERR（code 20）—— 少数实现不设 name 只设 code。
 */
export function isAbortedRequest(err: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string; code?: number };
  return candidate.name === 'AbortError' || candidate.code === 20;
}

/** 从 fetch 调用参数里取出请求信号（Request 对象与 RequestInit 两种形态都要覆盖）。 */
function extractSignal(args: Parameters<typeof window.fetch>): AbortSignal | null {
  const init = args[1];
  if (!init) return null;
  if (init instanceof Request) return init.signal;
  return (init as RequestInit).signal ?? null;
}

/**
 * Global telemetry hook to capture unhandled promise rejections, window runtime errors,
 * and 5xx API network failures into the centralized error store.
 * Also relays student-side errors to server for system audit logging and teacher alerts.
 */
export function useGlobalErrorCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Capture Unhandled Promise Rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;

      // 主动取消的请求产生的 AbortError 不算「未捕获的异步异常」—— 它是本代码主动
      // 取消在途请求的正常结果，报给老师只会变成噪音。
      if (isAbortedRequest(reason)) {
        console.warn('[GlobalErrorCapture] Ignored aborted request rejection:', reason);
        return;
      }

      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : JSON.stringify(reason) || 'Unhandled promise rejection';

      const stack = reason instanceof Error ? reason.stack : undefined;

      errorStore.getState().addError({
        type: 'promise',
        title: '未捕获的异步异常 (Unhandled Promise)',
        message,
        stack,
      });
      reportClientRuntimeError({ source: 'promise', message, stack });

      console.warn('[GlobalErrorCapture] Caught unhandled rejection:', reason);
    };

    // 2. Capture Global Window Runtime Errors
    const handleWindowError = (event: ErrorEvent) => {
      // Ignore cross-origin script error without info
      if (!event.message && !event.error) return;

      const message = event.message || (event.error?.message ?? 'Unknown script error');
      const stack = event.error?.stack;

      errorStore.getState().addError({
        type: 'runtime',
        title: 'JavaScript 运行时错误 (Runtime Error)',
        message,
        stack,
      });
      reportClientRuntimeError({ source: 'runtime', message, stack });

      console.warn('[GlobalErrorCapture] Caught window error:', event.error || event.message);
    };

    // 3. Intercept 5xx Server API Failures
    const originalFetch = window.fetch;
    const monitoredFetch: typeof window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (!response.ok && response.status >= 500) {
          try {
            const clone = response.clone();
            const text = await clone.text();
            let parsedMessage = '';
            try {
              const json = JSON.parse(text);
              parsedMessage = json.error || json.message || json.details || text;
            } catch {
              parsedMessage = text.slice(0, 300);
            }

            const input = args[0];
            const endpoint = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

            errorStore.getState().addError({
              type: 'api',
              title: `服务端接口错误 (HTTP ${response.status})`,
              message: parsedMessage || `Request failed with status ${response.status}`,
              endpoint,
              status: response.status,
            });
          } catch {
            // Ignore response parsing errors
          }
        }
        return response;
      } catch (err: any) {
        // Network failure (TypeError: Failed to fetch, CORS blocked, connection refused)
        const input = args[0];
        const endpoint = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

        // 主动取消的请求（组件卸载 / 切页 / 换筛选条件时 abort）会以 AbortError 拒绝。
        // 它不是网络故障：调用方已经自己处理过，不该在这里记成「网络请求失败」，
        // 更不该作为学生侧错误转发给老师。只放行原始错误给调用方。
        const aborted = isAbortedRequest(err, extractSignal(args));

        // Only log network failures that look like internal API calls
        if (!aborted && endpoint && (endpoint.startsWith('/api') || endpoint.includes('/api/'))) {
          errorStore.getState().addError({
            type: 'api',
            title: '网络请求失败 (Network Disconnected / Error)',
            message: err?.message || 'Failed to fetch API endpoint',
            endpoint,
            stack: err?.stack,
          });
        }
        throw err;
      }
    };

    // 4. Report Student-side Errors to Server / Teacher
    const unregisterListener = registerErrorListener((errorItem) => {
      try {
        const state = appStore.getState();
        const isStudentLiveMode =
          typeof window !== 'undefined' &&
          (new URLSearchParams(window.location.search).get('mode') === 'student_live' ||
            window.location.hash.includes('student_live'));
        const isStudent = state.session?.role === 'student' || isStudentLiveMode;

        // Only student-side errors need to be relayed to teacher & recorded to audit log
        if (!isStudent) return;

        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const studentId = state.session?.userId || urlParams?.get('studentId') || 'anonymous_student';
        const studentName =
          state.session?.name || state.session?.username || urlParams?.get('studentName') || studentId;
        const lessonId = state.selectedLesson || urlParams?.get('lessonId') || null;
        const classId = state.liveClassSelectedClassId || urlParams?.get('classId') || null;

        const payload = {
          studentId,
          studentName,
          lessonId,
          classId,
          error: errorItem,
        };

        const socket = getOptionalSocket();
        if (socket && socket.connected) {
          socket.emit('student-client-error', payload);
        } else {
          // Fallback via HTTP sendBeacon or fetch
          const reportUrl = '/api/diagnostics/report';
          const body = JSON.stringify(payload);
          if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            navigator.sendBeacon(reportUrl, new Blob([body], { type: 'application/json' }));
          } else {
            fetch(reportUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[GlobalErrorCapture] Failed to report student error:', err);
      }
    });

    window.fetch = monitoredFetch;
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleWindowError);

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleWindowError);
      unregisterListener();
    };
  }, []);
}
