/**
 * 阅读活动：展示阅读材料，学生标记已读后回写活动进度。
 */
import { useState } from 'react';
import { parseActivityConfig, readString } from '../../../xuean/activity-config';
import { isActivityDone, submitActivityModule, type StudentActivityModuleProps } from './module-shared';

export function ReadingActivityCard({
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: StudentActivityModuleProps) {
  const zh = lang === 'zh';
  const config = parseActivityConfig(activity.config_json);
  const content = readString(config, 'content').trim();
  const url = readString(config, 'url').trim();
  const done = isActivityDone(progress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDone = async () => {
    setBusy(true);
    setError(null);
    const result = await submitActivityModule(
      activity.id,
      { type: 'text', content: zh ? '已完成阅读' : 'Reading completed' },
      { onProgressUpdated, onActivityProgressReported },
    );
    if (!result.ok) setError(result.error);
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-2" data-testid="reading-activity-module">
      {content ? (
        <div className="rounded-lg border border-theme/60 bg-surface-secondary/40 p-3 text-sm text-main whitespace-pre-wrap max-h-96 overflow-y-auto">
          {content}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-theme bg-surface-secondary/30 p-4">
          <p className="text-sm font-semibold text-main">{zh ? '本环节还没有阅读材料' : 'No reading material yet'}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {zh
              ? '可以先看「本课学习目标」和右侧导读，再点「标记为已读」；老师补充材料后这里会自动刷新。'
              : 'Review the lesson goals and the guide rail first, then mark this activity as read. It refreshes once the teacher adds material.'}
          </p>
        </div>
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block text-xs font-semibold text-primary-theme underline underline-offset-2"
        >
          {zh ? '打开阅读材料链接' : 'Open reading link'}
        </a>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void markDone()}
          disabled={busy || done}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
        >
          {done ? (zh ? '已完成阅读' : 'Completed') : zh ? '标记为已读' : 'Mark as read'}
        </button>
        {error && (
          <span role="alert" className="text-xs text-rose-600">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
