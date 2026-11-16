import { useEffect, useState } from 'react';
import {
  createDiscussion,
  fetchDiscussion,
  fetchDiscussions,
  replyDiscussion,
  reportDiscussion,
  type DiscussionPost,
  type DiscussionThread,
} from './p1-api';

export function CourseDiscussionBoard({
  courseId,
  lessonId,
  lang,
}: {
  courseId?: string;
  lessonId?: string;
  lang: 'zh' | 'en';
}) {
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [active, setActive] = useState<{ thread: DiscussionThread; posts: DiscussionPost[] } | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchDiscussions({ courseId, lessonId })
      .then((result) => setThreads(result.threads))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    void load();
  }, [courseId, lessonId]);

  return (
    <section
      className="border border-gray-200 rounded-xl p-3 flex flex-col gap-3"
      data-testid="course-discussion-board"
    >
      <h4 className="font-semibold text-sm">{lang === 'zh' ? '讨论区' : 'Discussion'}</h4>
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <div className="flex flex-col gap-2">
        <input
          className="border border-gray-200 rounded px-2 py-1 text-sm"
          placeholder={lang === 'zh' ? '话题标题' : 'Thread title'}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="border border-gray-200 rounded px-2 py-1 text-sm"
          rows={3}
          placeholder={lang === 'zh' ? '正文（外链会被隐藏）' : 'Body (external links will be hidden)'}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          type="button"
          className="self-start px-3 py-1 text-xs bg-indigo-600 text-white rounded"
          onClick={() => {
            if (!title.trim() || !body.trim()) return;
            void createDiscussion({ courseId, lessonId, title, body })
              .then(() => {
                setTitle('');
                setBody('');
                return load();
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          {lang === 'zh' ? '发布讨论' : 'Post thread'}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              className="w-full text-left text-sm px-2 py-1 rounded hover:bg-gray-50"
              onClick={() =>
                void fetchDiscussion(thread.id)
                  .then(setActive)
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
              }
            >
              {thread.pinned ? '📌 ' : ''}
              {thread.title}
              <span className="text-[11px] text-gray-500 ml-2">{thread.postCount ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div className="border-t border-gray-100 pt-2 flex flex-col gap-2">
          <h5 className="font-medium text-sm">{active.thread.title}</h5>
          <p className="text-sm whitespace-pre-wrap">{active.thread.body}</p>
          {active.posts.map((post) => (
            <div key={post.id} className="text-sm bg-gray-50 rounded px-2 py-1">
              <div className="text-[11px] text-gray-500">
                {post.authorName || (lang === 'zh' ? '匿名' : 'Anonymous')}
              </div>
              <div className="whitespace-pre-wrap">{post.body}</div>
              {!post.deletedAt && (
                <button
                  type="button"
                  className="text-[11px] text-rose-700 underline"
                  onClick={() => {
                    const reason = window.prompt(lang === 'zh' ? '举报原因' : 'Reason');
                    if (reason) void reportDiscussion(active.thread.id, reason, post.id);
                  }}
                >
                  {lang === 'zh' ? '举报' : 'Report'}
                </button>
              )}
            </div>
          ))}
          <textarea
            className="border border-gray-200 rounded px-2 py-1 text-sm"
            rows={2}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            disabled={active.thread.locked}
          />
          <button
            type="button"
            disabled={active.thread.locked || !reply.trim()}
            className="self-start px-3 py-1 text-xs bg-indigo-600 text-white rounded disabled:opacity-50"
            onClick={() =>
              void replyDiscussion(active.thread.id, reply)
                .then(() => fetchDiscussion(active.thread.id))
                .then((result) => {
                  setActive(result);
                  setReply('');
                })
            }
          >
            {lang === 'zh' ? '回复' : 'Reply'}
          </button>
        </div>
      )}
    </section>
  );
}
