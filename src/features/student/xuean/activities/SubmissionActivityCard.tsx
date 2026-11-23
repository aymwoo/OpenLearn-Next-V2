/**
 * 作品提交（练习）活动：文字作答或提交作品链接。
 */
import { useState } from 'react';
import { parseActivityConfig, readBoolean, readString } from '../../../xuean/activity-config';
import { isActivityDone, submitActivityModule, type StudentActivityModuleProps } from './module-shared';

type SubmissionMode = 'text' | 'link';

function readExisting(progress?: {
  submission_json?: string | null;
}): { mode: SubmissionMode; content: string } | null {
  if (!progress?.submission_json) return null;
  try {
    const parsed = JSON.parse(progress.submission_json) as unknown;
    if (typeof parsed === 'string') return { mode: 'text', content: parsed };
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const content = typeof record.content === 'string' ? record.content : '';
      if (!content) return null;
      return { mode: record.type === 'link' ? 'link' : 'text', content };
    }
  } catch {
    // 旧数据不是 JSON：按普通文本展示
    return { mode: 'text', content: progress.submission_json };
  }
  return null;
}

export function SubmissionActivityCard({
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: StudentActivityModuleProps) {
  const zh = lang === 'zh';
  const config = parseActivityConfig(activity.config_json);
  const instructions = readString(config, 'instructions').trim();
  const acceptText = readBoolean(config, 'acceptText', true);
  const acceptLink = readBoolean(config, 'acceptLink', true);
  const existing = readExisting(progress);

  const [mode, setMode] = useState<SubmissionMode>(() =>
    !acceptText && acceptLink ? 'link' : (existing?.mode ?? 'text'),
  );
  const [content, setContent] = useState(existing?.content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const done = isActivityDone(progress);

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(zh ? '请先填写内容' : 'Please fill in your work first');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitActivityModule(
      activity.id,
      { type: mode, content: trimmed },
      { onProgressUpdated, onActivityProgressReported },
    );
    if (result.ok) {
      setSaved(true);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  return (
    <form
      className="mt-3 space-y-2"
      data-testid="submission-activity-module"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {instructions ? (
        <div className="rounded-lg border border-theme/60 bg-surface-secondary/40 p-3 text-sm text-main whitespace-pre-wrap">
          {instructions}
        </div>
      ) : null}
      {acceptText && acceptLink ? (
        <div className="inline-flex rounded-lg border border-theme overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`px-3 py-1.5 cursor-pointer ${
              mode === 'text' ? 'bg-primary-theme text-white' : 'bg-surface text-muted hover:text-main'
            }`}
          >
            {zh ? '文字作答' : 'Text'}
          </button>
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`px-3 py-1.5 cursor-pointer ${
              mode === 'link' ? 'bg-primary-theme text-white' : 'bg-surface text-muted hover:text-main'
            }`}
          >
            {zh ? '作品链接' : 'Link'}
          </button>
        </div>
      ) : null}
      {mode === 'link' && acceptLink ? (
        <input
          type="url"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          aria-label={zh ? '作品链接' : 'Work link'}
          aria-invalid={Boolean(error)}
          aria-describedby="submission-activity-error"
          required
          placeholder="https://…"
          className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
        />
      ) : (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          aria-label={zh ? '作品内容' : 'Work content'}
          aria-invalid={Boolean(error)}
          aria-describedby="submission-activity-error"
          required
          rows={5}
          placeholder={zh ? '在这里写下你的作答或作品说明…' : 'Write your answer here…'}
          className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
        />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? zh
              ? '提交中…'
              : 'Submitting…'
            : done || saved
              ? zh
                ? '更新提交'
                : 'Update'
              : zh
                ? '提交作品'
                : 'Submit'}
        </button>
        {(done || saved) && !error ? (
          <span className="text-xs font-semibold text-emerald-600">{zh ? '已提交' : 'Submitted'}</span>
        ) : null}
        {error && (
          <span id="submission-activity-error" role="alert" className="text-xs text-rose-600">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
