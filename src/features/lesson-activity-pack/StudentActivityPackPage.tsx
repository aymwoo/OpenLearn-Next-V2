import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileUp,
  Globe,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { LazyCourseware } from '../../components/LazyCourseware';
import {
  ACTIVITY_TYPE_LABELS,
  BLOCK_TYPE_LABELS,
  STATUS_LABELS,
  fetchActivityPack,
  selfReportActivity,
  startActivity,
  type ActivityType,
  type StudentActivityPack,
} from './api';
import { StudentPeerReviewSection } from './StudentPeerReviewSection';

const TYPE_ICONS: Record<ActivityType, typeof BookOpen> = {
  reading: BookOpen,
  courseware: Globe,
  quiz: ClipboardCheck,
  submission: FileUp,
};

export interface StudentActivityPackPageProps {
  lessonId: string;
  lessonTitle?: string;
  lang: 'zh' | 'en';
  onBack: () => void;
  onOpenAssignment?: (assignmentId: string) => void;
  onOpenAssessments?: () => void;
  /** 教师预览：使用传入的学案数据，不调用会写进度的接口。 */
  preview?: boolean;
  previewPack?: StudentActivityPack;
}

export function StudentActivityPackPage({
  lessonId,
  lessonTitle,
  lang,
  onBack,
  onOpenAssignment,
  onOpenAssessments,
  preview = false,
  previewPack,
}: StudentActivityPackPageProps) {
  const [pack, setPack] = useState<StudentActivityPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (preview && previewPack) {
      setPack(previewPack);
      setSelectedId((current) => current ?? previewPack.activities[0]?.id ?? null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchActivityPack(lessonId);
      const studentPack = result.pack as StudentActivityPack;
      setPack(studentPack);
      setSelectedId((current) => current ?? studentPack.activities[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lessonId, preview, previewPack]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => pack?.activities.find((item) => item.id === selectedId) ?? null, [pack, selectedId]);

  const openActivity = async (activityId: string) => {
    setSelectedId(activityId);
    setBusy(true);
    setError(null);
    try {
      if (!preview) {
        await startActivity(lessonId, activityId);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !pack) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-muted gap-2"
        data-testid="student-activity-pack-page"
      >
        <Loader2 size={18} className="animate-spin" />
        <span>{lang === 'zh' ? '正在加载学案…' : 'Loading lesson pack…'}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="student-activity-pack-page">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-medium text-sm cursor-pointer"
        >
          <ChevronRight className="rotate-180" size={16} />
          {lang === 'zh' ? '返回' : 'Back'}
        </button>
        <h2 className="text-xl font-bold text-main">{lessonTitle || (lang === 'zh' ? '学案' : 'Lesson pack')}</h2>
      </div>

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
          {error}
        </div>
      )}

      {pack && (
        <div className="bg-surface border border-theme rounded-xl p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span>
              {lang === 'zh' ? '展示进度' : 'Displayed progress'}: {pack.summary.displayPercent}%
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={14} />
              {lang === 'zh' ? '已验证进度' : 'Verified progress'}: {pack.summary.verifiedPercent}%
            </span>
            <span className="text-muted text-xs">
              {lang === 'zh'
                ? '自报完成不会直接算作课节完成，需教师确认或来自课件/测验/作业的已验证结果。'
                : 'Self-reported completion does not finish the lesson until it is verified.'}
            </span>
          </div>
        </div>
      )}

      {pack && pack.blocks.length > 0 && (
        <section className="bg-surface border border-theme rounded-xl p-4 shadow-sm flex flex-col gap-4">
          <h3 className="font-semibold text-main">{lang === 'zh' ? '学案首页' : 'Lesson homepage'}</h3>
          {pack.blocks.map((block) => (
            <article key={block.id} className="prose prose-sm dark:prose-invert max-w-none">
              <h4>{lang === 'zh' ? BLOCK_TYPE_LABELS[block.blockType].zh : BLOCK_TYPE_LABELS[block.blockType].en}</h4>
              <ReactMarkdown>{typeof block.content.text === 'string' ? block.content.text : ''}</ReactMarkdown>
            </article>
          ))}
        </section>
      )}

      <div className="grid gap-4 @lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav className="bg-surface border border-theme rounded-xl p-3">
          <h3 className="font-semibold text-sm mb-2">{lang === 'zh' ? '活动序列' : 'Activities'}</h3>
          {pack?.activities.length ? (
            <ul className="flex flex-col gap-1">
              {pack.activities.map((activity) => {
                const Icon = TYPE_ICONS[activity.type];
                const active = activity.id === selectedId;
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      onClick={() => void openActivity(activity.id)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm flex flex-col gap-1 ${
                        active ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-surface-secondary'
                      }`}
                    >
                      <span className="font-medium inline-flex items-center gap-2">
                        <Icon size={14} />
                        {activity.title}
                      </span>
                      <span className="text-[11px] text-muted flex items-center gap-2">
                        {lang === 'zh'
                          ? STATUS_LABELS[activity.progress.status].zh
                          : STATUS_LABELS[activity.progress.status].en}
                        {activity.progress.verified && (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 size={11} />
                            verified
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              {lang === 'zh' ? '教师尚未发布学案活动。' : 'No published activities yet.'}
            </p>
          )}
        </nav>

        <section className="bg-surface border border-theme rounded-xl p-4 min-h-[280px]">
          {!selected ? (
            <p className="text-sm text-muted">
              {lang === 'zh' ? '请选择一个活动开始学习。' : 'Select an activity to begin.'}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="text-xs text-muted">
                  {lang === 'zh' ? ACTIVITY_TYPE_LABELS[selected.type].zh : ACTIVITY_TYPE_LABELS[selected.type].en}
                </div>
                <h3 className="text-lg font-bold text-main">{selected.title}</h3>
              </div>
              {selected.type === 'reading' && (
                <>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>
                      {typeof selected.config.body === 'string' ? selected.config.body : ''}
                    </ReactMarkdown>
                  </div>
                  <button
                    type="button"
                    className="self-start px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white disabled:opacity-60"
                    disabled={busy || selected.progress.verified}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        try {
                          if (preview) {
                            setPack((current) =>
                              current
                                ? {
                                    ...current,
                                    activities: current.activities.map((item) =>
                                      item.id === selected.id
                                        ? {
                                            ...item,
                                            progress: { ...item.progress, status: 'submitted', progressPercent: 100 },
                                          }
                                        : item,
                                    ),
                                  }
                                : current,
                            );
                          } else {
                            await selfReportActivity(lessonId, selected.id);
                            await load();
                          }
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    {selected.progress.verified
                      ? lang === 'zh'
                        ? '教师已确认'
                        : 'Verified by teacher'
                      : selected.progress.status === 'submitted'
                        ? lang === 'zh'
                          ? '已自报完成（待确认）'
                          : 'Self-reported (pending verification)'
                        : lang === 'zh'
                          ? '我已阅读'
                          : 'Mark as read'}
                  </button>
                </>
              )}
              {selected.type === 'courseware' && (
                <div className="min-h-[420px] border border-theme rounded-lg overflow-hidden">
                  {typeof selected.config.coursewareId === 'string' ? (
                    <LazyCourseware coursewareId={selected.config.coursewareId} />
                  ) : (
                    <p className="p-4 text-sm text-muted">
                      {lang === 'zh' ? '教师尚未关联课件。' : 'No courseware linked yet.'}
                    </p>
                  )}
                </div>
              )}
              {selected.type === 'quiz' && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">
                    {lang === 'zh'
                      ? '测验在测评中心完成，成绩仍按原测验记分，不会在学案里再记一次。'
                      : 'Complete this quiz in the assessment center. Scores stay in the original gradebook.'}
                  </p>
                  <button
                    type="button"
                    className="self-start px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white"
                    onClick={onOpenAssessments}
                    disabled={!onOpenAssessments}
                  >
                    {lang === 'zh' ? '去完成测验' : 'Open assessments'}
                  </button>
                </div>
              )}
              {selected.type === 'submission' && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">
                    {lang === 'zh'
                      ? '作品请在作业中心提交。教师批阅后，学案会同步为已验证，不会重复计分。'
                      : 'Submit this work in the assignment hub. After grading, the pack marks it verified without double scoring.'}
                  </p>
                  <button
                    type="button"
                    className="self-start px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 text-white"
                    disabled={!onOpenAssignment || typeof selected.config.assignmentId !== 'string'}
                    onClick={() => {
                      if (typeof selected.config.assignmentId === 'string')
                        onOpenAssignment?.(selected.config.assignmentId);
                    }}
                  >
                    {lang === 'zh' ? '去提交作品' : 'Open assignment'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      {!preview && <StudentPeerReviewSection lessonId={lessonId} lang={lang} />}
    </div>
  );
}
