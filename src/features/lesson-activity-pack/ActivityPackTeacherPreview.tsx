import React, { useEffect, useState } from 'react';
import { StudentActivityPackPage } from './StudentActivityPackPage';
import { fetchActivityPackPreview } from './p1-api';
import type { StudentActivityPack } from './api';

export function isActivityPackPreviewMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mode') === 'activity_pack_preview';
}

export function activityPackPreviewLessonId(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('lessonId') || '';
}

export function openActivityPackPreview(lessonId: string) {
  const url = `${window.location.origin}${window.location.pathname}?mode=activity_pack_preview&lessonId=${encodeURIComponent(lessonId)}#/activity_pack_preview`;
  const opened = window.open(url, '_blank');
  if (!opened) {
    throw new Error('新标签页被浏览器拦截，请允许本站打开弹出窗口后重试。');
  }
}

interface ActivityPackTeacherPreviewProps {
  lessonId?: string;
  lang?: 'zh' | 'en';
}

/**
 * 学案教师预览态（模拟学生）。
 * 与现有 student_preview（课节/白板学生视角）以及 StudentWorkspacePreview（C 组迁移预览）分开。
 * 本页只读取预览接口，不会把进度写入真实学生记录。
 */
export function ActivityPackTeacherPreview({ lessonId, lang = 'zh' }: ActivityPackTeacherPreviewProps) {
  const resolvedLessonId = lessonId || activityPackPreviewLessonId();
  const [pack, setPack] = useState<(StudentActivityPack & { unpublishedCount?: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!resolvedLessonId) return;
    void fetchActivityPackPreview(resolvedLessonId)
      .then((result) => {
        if (!cancelled) setPack(result.pack);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '预览加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedLessonId]);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col" data-testid="activity-pack-teacher-preview">
      <div className="bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-3 text-sm font-semibold">
        {lang === 'zh'
          ? '教师预览（模拟学生）· 仅用于查看学案页，不会写入真实进度。这不是 C 组工作区预览，也不是课堂学生视角。'
          : 'Teacher preview (simulated student). This does not write real progress, and is not the C-group workspace preview or classroom student view.'}
        {pack?.unpublishedCount ? (
          <span className="ml-2 font-normal">
            {lang === 'zh'
              ? `另有 ${pack.unpublishedCount} 个未发布活动对学生不可见。`
              : `${pack.unpublishedCount} unpublished activities are hidden.`}
          </span>
        ) : null}
      </div>
      {error && <div className="p-4 text-red-600 text-sm">{error}</div>}
      {!resolvedLessonId && <div className="p-4 text-sm text-slate-600">缺少 lessonId</div>}
      {resolvedLessonId && pack && (
        <div className="flex-1 min-h-0">
          <StudentActivityPackPage
            lessonId={resolvedLessonId}
            lang={lang}
            preview
            previewPack={pack}
            onBack={() => window.close()}
          />
        </div>
      )}
    </div>
  );
}
