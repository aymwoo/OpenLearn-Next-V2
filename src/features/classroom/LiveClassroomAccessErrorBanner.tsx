import React, { type MutableRefObject } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { rememberActiveLesson } from './live-class-resume-memory';
import type { LessonAccessError } from './hooks/useLiveClassroomSessionPolling';

export function LiveClassroomAccessErrorBanner({
  lessonAccessError,
  lang,
  showEntryPortal,
  userReturnedToPortalRef,
  enteredClassroomRef,
  setShowEntryPortal,
  setLessonAccessError,
}: {
  lessonAccessError: LessonAccessError;
  lang: string;
  showEntryPortal: boolean;
  userReturnedToPortalRef: MutableRefObject<boolean>;
  enteredClassroomRef: MutableRefObject<boolean>;
  setShowEntryPortal: (v: boolean) => void;
  setLessonAccessError: (v: LessonAccessError) => void;
}) {
  if (!lessonAccessError) return null;

  return (
    <div
      role="alert"
      data-testid="live-classroom-access-error"
      className="mx-4 mt-3 mb-1 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs text-main shrink-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
        <span className="font-medium">
          {lessonAccessError.status === 401
            ? lang === 'zh'
              ? '当前登录会话已失效（401），已停止自动轮询。请重新登录后继续使用互动课堂。'
              : 'Your sign-in session has expired (401). Automatic polling stopped; please sign in again.'
            : lessonAccessError.status === 403
              ? lang === 'zh'
                ? '当前账号无权访问该课节的课堂会话与统计数据（403），已停止重复轮询。请切换到有权限的课节或账号。'
                : 'You do not have permission to access this lesson or its classroom telemetry (403). Polling stopped; select a different lesson or switch account.'
              : lang === 'zh'
                ? '目标课节或课堂会话不存在（404），已停止重复轮询。'
                : 'Target lesson or classroom session was not found (404). Polling stopped.'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {lessonAccessError.status === 403 && !showEntryPortal && (
          <button
            type="button"
            onClick={() => {
              userReturnedToPortalRef.current = true;
              enteredClassroomRef.current = false;
              rememberActiveLesson(null);
              setShowEntryPortal(true);
            }}
            className="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 cursor-pointer"
          >
            {lang === 'zh' ? '返回选课' : 'Back to portal'}
          </button>
        )}
        <button
          type="button"
          aria-label={lang === 'zh' ? '关闭提示' : 'Dismiss'}
          onClick={() => setLessonAccessError(null)}
          className="p-1 rounded hover:bg-amber-500/20 text-muted hover:text-main cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
