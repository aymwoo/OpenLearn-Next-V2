/**
 * 讨论活动：学生发帖 / 回复，帖子来自 lesson_discussions。
 */
import { useCallback, useEffect, useState } from 'react';
import { parseActivityConfig, readBoolean, readString } from '../../../xuean/activity-config';
import { isActivityDone, submitActivityModule, type StudentActivityModuleProps } from './module-shared';

interface DiscussionPost {
  id: string;
  author_id: string;
  author_name?: string | null;
  content: string;
  parent_id: string | null;
  created_at: number;
}

function formatTime(value: number): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '';
  }
}

export function DiscussionActivityCard({
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: StudentActivityModuleProps) {
  const zh = lang === 'zh';
  const config = parseActivityConfig(activity.config_json);
  const prompt = readString(config, 'prompt').trim();
  const allowReplies = readBoolean(config, 'allowReplies', true);

  const [posts, setPosts] = useState<DiscussionPost[]>([]);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<DiscussionPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const done = isActivityDone(progress);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/lesson-activities/${encodeURIComponent(activity.id)}/discussions`);
      if (res.ok) {
        const body = (await res.json()) as DiscussionPost[];
        setPosts(Array.isArray(body) ? body : []);
      }
    } catch {
      // 列表加载失败时仍允许发帖，下一次刷新会重试
    } finally {
      setLoading(false);
    }
  }, [activity.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(zh ? '请输入内容' : 'Please write something first');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lesson-activities/${encodeURIComponent(activity.id)}/discussions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed, parentId: replyTo?.id ?? null }),
      });
      if (!res.ok) {
        setError(zh ? '发布失败，请稍后重试' : 'Failed to post');
        return;
      }
      setContent('');
      setReplyTo(null);
      await load();
      if (!done) {
        // 首次发帖即视为完成讨论活动；失败不影响发帖结果。
        await submitActivityModule(
          activity.id,
          { type: 'text', content: trimmed },
          { onProgressUpdated, onActivityProgressReported },
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const topLevel = posts.filter((item) => !item.parent_id);
  const repliesOf = (id: string) => posts.filter((item) => item.parent_id === id);

  return (
    <div className="mt-3 space-y-3" data-testid="discussion-activity-module">
      {prompt ? (
        <div className="rounded-lg border border-theme/60 bg-surface-secondary/40 p-3 text-sm text-main whitespace-pre-wrap">
          {prompt}
        </div>
      ) : null}

      <div className="space-y-2">
        {loading ? <p className="text-xs text-muted">{zh ? '加载讨论中…' : 'Loading…'}</p> : null}
        {!loading && topLevel.length === 0 ? (
          <p className="text-xs text-muted">{zh ? '还没有人发言，来写下第一条吧。' : 'No posts yet. Be the first!'}</p>
        ) : null}
        {topLevel.map((postItem) => (
          <div key={postItem.id} className="rounded-lg border border-theme/60 bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-main">{postItem.author_name || (zh ? '同学' : 'Student')}</span>
              <span className="text-[10px] text-muted">{formatTime(postItem.created_at)}</span>
            </div>
            <p className="mt-1 text-sm text-main whitespace-pre-wrap break-words">{postItem.content}</p>
            {allowReplies ? (
              <button
                type="button"
                onClick={() => setReplyTo(postItem)}
                className="mt-1 text-[11px] font-semibold text-primary-theme hover:underline"
              >
                {zh ? '回复' : 'Reply'}
              </button>
            ) : null}
            {repliesOf(postItem.id).map((reply) => (
              <div key={reply.id} className="mt-2 ml-4 rounded-lg border border-theme/50 bg-surface-secondary/40 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-main">
                    {reply.author_name || (zh ? '同学' : 'Student')}
                  </span>
                  <span className="text-[10px] text-muted">{formatTime(reply.created_at)}</span>
                </div>
                <p className="text-xs text-main whitespace-pre-wrap break-words">{reply.content}</p>
              </div>
            ))}
          </div>
        ))}
      </div>

      <form
        className="rounded-lg border border-theme/60 p-3 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void post();
        }}
      >
        {replyTo ? (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>
              {zh ? '回复' : 'Replying to'} {replyTo.author_name || (zh ? '同学' : 'Student')}
            </span>
            <button type="button" onClick={() => setReplyTo(null)} className="underline">
              {zh ? '取消' : 'Cancel'}
            </button>
          </div>
        ) : null}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          aria-label={zh ? '讨论内容' : 'Discussion content'}
          aria-invalid={Boolean(error)}
          aria-describedby="discussion-activity-error"
          required
          placeholder={zh ? '写下你的观点…' : 'Share your thoughts…'}
          className="w-full px-3 py-2 text-sm rounded-lg border border-theme bg-surface text-main focus:outline-none focus:ring-2 focus:ring-primary-theme/40"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (zh ? '发布中…' : 'Posting…') : zh ? (replyTo ? '发布回复' : '发布发言') : 'Post'}
          </button>
          {done ? (
            <span className="text-xs font-semibold text-emerald-600">{zh ? '已参与' : 'Participated'}</span>
          ) : null}
          {error && (
            <span id="discussion-activity-error" role="alert" className="text-xs text-rose-600">
              {error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
