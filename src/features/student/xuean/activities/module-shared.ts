/**
 * 学生端活动模块的公共契约与提交封装。
 */
import { postActivityProgress } from '../../../../services/lessonActivitiesService.js';
import type { ActivitySubmission } from '../../../../services/lessonActivitiesService.js';

export interface StudentActivityModuleProps {
  activity: {
    id: string;
    lesson_id?: string;
    title: string;
    config_json?: string | null;
  };
  progress?: {
    status: string;
    submission_json?: string | null;
  };
  lang?: 'zh' | 'en';
  onProgressUpdated?: () => void;
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}

export async function submitActivityModule(
  activityId: string,
  submission: ActivitySubmission,
  callbacks: {
    onProgressUpdated?: () => void;
    onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await postActivityProgress(activityId, {
    status: 'submitted',
    progressPercent: 100,
    submission,
  });
  if (!res.ok) {
    const message = (res.error as { error?: string })?.error;
    return { ok: false, error: message || '提交失败，请稍后重试' };
  }
  callbacks.onProgressUpdated?.();
  callbacks.onActivityProgressReported?.({ activityId, status: 'submitted' });
  return { ok: true };
}

export function isActivityDone(progress?: { status: string }): boolean {
  return progress?.status === 'submitted' || progress?.status === 'graded';
}
