import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Clock, HardDrive, Loader2, MessageSquare, Star, Trash2, X } from 'lucide-react';
import AccessibleDialog from '../../AccessibleDialog';
import {
  formatCount,
  formatPackageSize,
  formatReleaseDate,
  type CommunityPlugin,
  type CommunityPluginFeedbackSummary,
  type CommunityPluginReview,
} from './community-format';

const REVIEWS_ENDPOINT = '/api/plugins/community/reviews';

interface PluginReviewDialogProps {
  plugin: CommunityPlugin | null;
  lang: string;
  starPending: boolean;
  onClose: () => void;
  onToggleStar: (plugin: CommunityPlugin) => void;
  onReviewsChanged: (pluginId: string, summary: CommunityPluginFeedbackSummary) => void;
  fetcher: (input: string, init?: RequestInit) => Promise<Response>;
}

const RATING_SCORES = [1, 2, 3, 4, 5] as const;

export function PluginReviewDialog({
  plugin,
  lang,
  starPending,
  onClose,
  onToggleStar,
  onReviewsChanged,
  fetcher,
}: PluginReviewDialogProps) {
  const zh = lang === 'zh';
  const headingId = useId();
  const commentId = useId();
  const commentHintId = useId();
  const errorId = useId();
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<CommunityPluginReview[]>([]);
  const [summary, setSummary] = useState<CommunityPluginFeedbackSummary | null>(null);

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const pluginId = plugin?.id ?? null;

  const loadReviews = useCallback(async () => {
    if (!pluginId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetcher(`${REVIEWS_ENDPOINT}?pluginId=${encodeURIComponent(pluginId)}`);
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        summary?: CommunityPluginFeedbackSummary;
        reviews?: CommunityPluginReview[];
      } | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || (zh ? '加载评价列表失败' : 'Failed to load reviews'));
      }
      const nextReviews = body.reviews ?? [];
      setReviews(nextReviews);
      if (body.summary) {
        setSummary(body.summary);
        onReviewsChanged(pluginId, body.summary);
      }
      const own = nextReviews.find((r) => r.isOwn);
      if (own) {
        setRating(own.rating);
        setComment(own.comment);
      } else {
        setRating(5);
        setComment('');
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [fetcher, onReviewsChanged, pluginId, zh]);

  useEffect(() => {
    if (!pluginId) return;
    setFormError(null);
    setFormNotice(null);
    void loadReviews();
  }, [loadReviews, pluginId]);

  const ownReview = reviews.find((r) => r.isOwn) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plugin) return;
    if (rating < 1 || rating > 5) {
      setFormError(zh ? '请选择 1 到 5 星评分' : 'Please select a rating between 1 and 5 stars');
      return;
    }
    if (comment.trim().length > 1000) {
      setFormError(zh ? '评价内容不能超过 1000 字' : 'Review comment must be 1000 characters or less');
      commentRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const res = await fetcher(REVIEWS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginId: plugin.id,
          rating,
          comment: comment.trim(),
          pluginVersion: plugin.version || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        summary?: CommunityPluginFeedbackSummary;
        review?: CommunityPluginReview;
      } | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || (zh ? '提交评价失败' : 'Failed to submit review'));
      }
      if (body.summary) {
        setSummary(body.summary);
        onReviewsChanged(plugin.id, body.summary);
      }
      setFormNotice(
        ownReview ? (zh ? '已更新你的评价' : 'Review updated') : zh ? '感谢你的评价！' : 'Review submitted!',
      );
      await loadReviews();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!plugin || !ownReview) return;
    setDeleting(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const res = await fetcher(`${REVIEWS_ENDPOINT}?pluginId=${encodeURIComponent(plugin.id)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        summary?: CommunityPluginFeedbackSummary;
      } | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.error || (zh ? '删除评价失败' : 'Failed to delete review'));
      }
      if (body.summary) {
        setSummary(body.summary);
        onReviewsChanged(plugin.id, body.summary);
      }
      setRating(5);
      setComment('');
      setFormNotice(zh ? '已删除你的评价' : 'Your review was removed');
      await loadReviews();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  if (!plugin) return null;

  const releaseDate = formatReleaseDate(plugin.publishedAt, lang);
  const sizeLabel = formatPackageSize(plugin.packageSize);
  const effectiveAvg = summary?.averageRating ?? plugin.averageRating ?? null;
  const effectiveCount = summary?.reviewCount ?? plugin.reviewCount ?? reviews.length;
  const effectiveStars = plugin.stars ?? 0;

  return (
    <AccessibleDialog
      open={Boolean(plugin)}
      onClose={onClose}
      ariaLabelledBy={headingId}
      closedBy="any"
      className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200 p-0 overflow-hidden m-auto"
    >
      <div data-testid="community-review-dialog" className="flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4 bg-slate-50/70">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 id={headingId} className="text-base font-bold text-gray-900 truncate">
                {plugin.name}
              </h3>
              {plugin.version && (
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  v{plugin.version}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-500">
              <span>{plugin.author}</span>
              {releaseDate && (
                <span className="inline-flex items-center gap-1" title={releaseDate.full}>
                  <Clock size={11} />
                  <time dateTime={plugin.publishedAt ?? undefined}>
                    {zh ? `发布于 ${releaseDate.short}` : `Released ${releaseDate.short}`}
                  </time>
                </span>
              )}
              {sizeLabel && (
                <span className="inline-flex items-center gap-1">
                  <HardDrive size={11} />
                  <span>{sizeLabel}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onToggleStar(plugin)}
              disabled={starPending}
              aria-pressed={Boolean(plugin.starred)}
              className={`inline-flex items-center rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                plugin.starred
                  ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              <span className="inline-flex items-center gap-1 px-2.5 py-1.5">
                <Star size={13} className={plugin.starred ? 'fill-amber-400 text-amber-500' : 'text-gray-400'} />
                <span>{plugin.starred ? (zh ? '已标星' : 'Starred') : zh ? '+⭐ 标星' : 'Star'}</span>
              </span>
              <span
                className={`px-2 py-1.5 border-l font-mono ${
                  plugin.starred ? 'border-amber-200 bg-amber-100/60' : 'border-gray-200 bg-gray-50'
                }`}
              >
                {formatCount(effectiveStars, lang) ?? '0'}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label={zh ? '关闭评价弹窗' : 'Close reviews dialog'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-bold text-gray-900 tabular-nums">
                {effectiveAvg !== null ? effectiveAvg.toFixed(1) : '—'}
              </div>
              <div>
                <div className="flex items-center gap-0.5" aria-hidden>
                  {RATING_SCORES.map((score) => (
                    <Star
                      key={score}
                      size={13}
                      className={
                        effectiveAvg !== null && score <= Math.round(effectiveAvg)
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-gray-300'
                      }
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {zh
                    ? `${effectiveCount} 条社区评价`
                    : `${effectiveCount} community review${effectiveCount === 1 ? '' : 's'}`}
                </p>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {ownReview
                ? zh
                  ? `你已给出 ${ownReview.rating} 星评价`
                  : `You rated ${ownReview.rating}/5`
                : zh
                  ? '欢迎分享使用体验，帮助其他老师选型'
                  : 'Share your experience to help other teachers'}
            </div>
          </div>

          {/* Review Form */}
          <form
            onSubmit={(e) => void handleSubmit(e)}
            noValidate
            className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3"
          >
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-gray-800">
                {ownReview ? (zh ? '修改你的评分' : 'Update your rating') : zh ? '为该插件评分' : 'Rate this plugin'}
              </legend>
              <div className="flex items-center gap-1.5 pt-1">
                {RATING_SCORES.map((score) => {
                  const selected = rating >= score;
                  return (
                    <label
                      key={score}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        rating === score
                          ? 'bg-amber-50 border-amber-400 text-amber-800 shadow-xs'
                          : selected
                            ? 'bg-white border-amber-200 text-amber-700 hover:border-amber-300'
                            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="plugin-rating"
                        value={score}
                        checked={rating === score}
                        onChange={() => {
                          setRating(score);
                          if (formError) setFormError(null);
                        }}
                        className="sr-only"
                      />
                      <Star size={13} className={selected ? 'fill-amber-400 text-amber-500' : 'text-gray-300'} />
                      <span>{score}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor={commentId} className="text-xs font-semibold text-gray-800">
                  {zh ? '使用评价（可选）' : 'Review comment (optional)'}
                </label>
                <span id={commentHintId} className="text-xs text-gray-400 tabular-nums">
                  {comment.length} / 1000
                </span>
              </div>
              <textarea
                ref={commentRef}
                id={commentId}
                name="comment"
                rows={3}
                maxLength={1000}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (formError) setFormError(null);
                }}
                aria-describedby={formError ? `${commentHintId} ${errorId}` : commentHintId}
                aria-invalid={Boolean(formError)}
                placeholder={
                  zh ? '说说教学场景下的稳定性、交互体验或改进建议…' : 'Share stability, classroom UX, or suggestions…'
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              />
            </div>

            {formError && (
              <p id={errorId} role="alert" className="text-xs text-rose-600">
                {formError}
              </p>
            )}
            {formNotice && !formError && (
              <p role="status" className="text-xs text-emerald-700">
                {formNotice}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="submit"
                disabled={submitting || deleting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {submitting && <Loader2 size={13} className="animate-spin" />}
                <span>{ownReview ? (zh ? '更新评价' : 'Update Review') : zh ? '提交评价' : 'Submit Review'}</span>
              </button>

              {ownReview && (
                <button
                  type="button"
                  disabled={submitting || deleting}
                  onClick={() => void handleDelete()}
                  className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-rose-200 text-rose-600 bg-white hover:bg-rose-50 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  <span>{zh ? '删除我的评价' : 'Delete my review'}</span>
                </button>
              )}
            </div>
          </form>

          {/* Reviews List */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
              <MessageSquare size={12} />
              <span>{zh ? '全部评价' : 'All Reviews'}</span>
            </h4>

            {loading && (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
                <Loader2 size={14} className="animate-spin" />
                <span>{zh ? '正在加载评价…' : 'Loading reviews…'}</span>
              </div>
            )}

            {!loading && loadError && (
              <div
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-center justify-between gap-2"
              >
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => void loadReviews()}
                  className="font-semibold underline cursor-pointer"
                >
                  {zh ? '重试' : 'Retry'}
                </button>
              </div>
            )}

            {!loading && !loadError && reviews.length === 0 && (
              <p className="text-xs text-gray-400 py-4 text-center">
                {zh ? '暂无评价，来做第一个评价的人吧！' : 'No reviews yet. Be the first to review!'}
              </p>
            )}

            {!loading && !loadError && reviews.length > 0 && (
              <ul className="space-y-2.5">
                {reviews.map((rev) => {
                  const dateLabel = new Date(rev.updatedAt).toLocaleDateString(zh ? 'zh-CN' : 'en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  });
                  return (
                    <li
                      key={rev.id}
                      className={`rounded-xl border p-3.5 text-sm ${
                        rev.isOwn ? 'border-indigo-200 bg-indigo-50/20' : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-gray-900 truncate">{rev.authorName}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {rev.authorRole === 'administrator' ? (zh ? '管理员' : 'Admin') : zh ? '教师' : 'Teacher'}
                          </span>
                          {rev.isOwn && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                              {zh ? '我' : 'You'}
                            </span>
                          )}
                          {rev.pluginVersion && (
                            <span className="text-xs font-mono text-gray-400">v{rev.pluginVersion}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-amber-600">
                            <Star size={12} className="fill-amber-400 text-amber-500" />
                            <span>{rev.rating}.0</span>
                          </span>
                          <span className="text-xs text-gray-400">{dateLabel}</span>
                        </div>
                      </div>
                      {rev.comment && (
                        <p className="mt-2 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{rev.comment}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AccessibleDialog>
  );
}
