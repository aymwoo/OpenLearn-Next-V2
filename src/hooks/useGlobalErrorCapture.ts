import { useEffect } from 'react';
import { errorStore, registerErrorListener } from '../store/errorStore';
import { getOptionalSocket } from '../services/socket-service';
import { appStore } from '../store/appStore';

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

        // Only log network failures that look like internal API calls
        if (endpoint && (endpoint.startsWith('/api') || endpoint.includes('/api/'))) {
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
        const studentId =
          state.session?.userId ||
          urlParams?.get('studentId') ||
          'anonymous_student';
        const studentName =
          state.session?.name ||
          state.session?.username ||
          urlParams?.get('studentName') ||
          studentId;
        const lessonId =
          state.selectedLesson ||
          urlParams?.get('lessonId') ||
          null;
        const classId =
          state.liveClassSelectedClassId ||
          urlParams?.get('classId') ||
          null;

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

