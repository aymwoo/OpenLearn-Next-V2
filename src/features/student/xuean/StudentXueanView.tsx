/**
 * 学生学案页（IKVO15 · P0）。
 * - 顶部学案首页块（半结构化：learning_goals / key_points / resources / free_html 等）
 * - 活动序列卡片（状态指示 + 自报进度）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getXuean, type ActivitySubmission } from '../../../services/lessonActivitiesService.js';
import { sanitizeRichTextHtml } from '../../../../packages/core/security/html-sanitize';
import { LearningSurfaceHost } from '../../learning-surface/LearningSurfaceHost';
import { AssessmentActivityCard } from './AssessmentActivityCard';
import { ReadingActivityCard } from './activities/ReadingActivityCard';
import { SubmissionActivityCard } from './activities/SubmissionActivityCard';
import { SurveyActivityCard } from './activities/SurveyActivityCard';
import { FormActivityCard } from './activities/FormActivityCard';
import { DiscussionActivityCard } from './activities/DiscussionActivityCard';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

type Block = {
  id: string;
  lesson_id: string;
  block_type: string;
  order_index: number;
  content_json: string;
  surface_id?: string | null;
};

type Activity = {
  id: string;
  lesson_id: string;
  order_index: number;
  type: string;
  title: string;
  required: number;
  visible: number;
  config_json?: string | null;
  surface_id?: string | null;
};

type Progress = {
  activity_id: string;
  student_id: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'graded';
  progress_percent: number;
  verified: number;
  score: number | null;
  submission_json?: string | null;
  nudged_at?: number | null;
  nudge_count?: number;
};

type XueanData = {
  lessonId: string;
  blocks: Block[];
  activities: Activity[];
  progressByActivity: Record<string, Progress>;
};

const BLOCK_TYPE_LABELS: Record<string, string> = {
  xuean_home: '学案首页',
  learning_goals: '学习目标',
  key_points: '重难点',
  resources: '资源准备',
  operation_tips: '操作要点',
  works_showcase: '作品赏析',
  reflection: '反思',
  free_html: '自由内容',
  interactive_courseware: '互动课件',
};

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  reading: '阅读',
  submission: '作品提交',
  quiz: '测验',
  survey: '调查',
  discussion: '讨论',
  courseware: '课件',
  scratch: '编程',
  form: '填表',
  other: '其他',
};

const STATUS_LABELS: Record<Progress['status'], { text: string; cls: string }> = {
  not_started: { text: '未开始', cls: 'bg-muted/10 text-muted border-muted/30' },
  in_progress: { text: '进行中', cls: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  submitted: { text: '已提交', cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  graded: { text: '已批阅', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
};

interface Props {
  lessonId: string;
  lessonTitle?: string;
  lang?: 'zh' | 'en';
  /** Mode Pack 工作区可选：进度写库成功后通知（如 ClassroomMessage xuean:task） */
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}

export function StudentXueanView({ lessonId, lessonTitle, lang = 'zh', onActivityProgressReported }: Props) {
  const [data, setData] = useState<XueanData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!lessonId) return;
    const res = await getXuean(lessonId);
    if (res.ok && res.data) setData(res.data as XueanData);
    setLoading(false);
  }, [lessonId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 当前展示项：'home' 或某个活动 id。默认展示第一个活动，没有活动时展示学案首页。
  const [activeItem, setActiveItem] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    setActiveItem((current) => {
      if (current === 'home' && data.blocks.length > 0) return current;
      if (current && data.activities.some((activity) => activity.id === current)) return current;
      return data.activities[0]?.id ?? (data.blocks.length > 0 ? 'home' : null);
    });
  }, [data]);

  // 活动导航横向滚动：切换时把选中项滚入可视区（只滚动导航自身）。
  const tablistRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const tab = tablistRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeItem, data]);

  if (loading) return <div className="text-center text-muted py-16">加载学案中…</div>;
  if (!data)
    return (
      <div className="text-center text-muted py-16">
        加载失败，请刷新重试
        <button
          type="button"
          onClick={refresh}
          className="ml-3 px-3 py-1 text-xs rounded border border-theme hover:bg-surface-secondary"
        >
          重试
        </button>
      </div>
    );

  // 首帧派生当前项，避免 effect 尚未执行时短暂显示空态。
  const defaultItem = data.activities[0]?.id ?? (data.blocks.length > 0 ? 'home' : null);
  const currentItem =
    activeItem === 'home'
      ? data.blocks.length > 0
        ? 'home'
        : defaultItem
      : activeItem && data.activities.some((activity) => activity.id === activeItem)
        ? activeItem
        : defaultItem;

  const completedCount = data.activities.filter((a) => {
    const p = data.progressByActivity[a.id];
    return p && (p.status === 'graded' || (p.verified && p.status === 'submitted'));
  }).length;

  const completedPercent = data.activities.length > 0 ? (completedCount / data.activities.length) * 100 : 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 学案头部 + 活动导航：共用一层 sticky 容器，避免硬编码吸顶高度 */}
      <div className="sticky top-0 z-20 border-b border-theme bg-surface/95 backdrop-blur-md">
        <div className="w-full px-5 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-black tracking-tight text-main sm:text-lg">{lessonTitle ?? data.lessonId}</h2>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-theme" aria-hidden="true" />
              {lang === 'zh' ? '学案式学习' : 'Guided study'}
            </span>
          </div>

          {/* 完成进度：一条细进度条 + 计数，替代散落的文字 */}
          <div className="mt-2 flex items-center gap-2.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-secondary">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${completedPercent}%` }}
                role="progressbar"
                aria-label={lang === 'zh' ? '学案活动完成进度' : 'Activity completion'}
                aria-valuemin={0}
                aria-valuemax={data.activities.length}
                aria-valuenow={completedCount}
              />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">
              {completedCount} / {data.activities.length}
            </span>
          </div>

          {/* 活动导航：单行横向滚动，点击直接切换中间内容 */}
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="学案活动导航"
            className="scrollbar-none -mx-1 mt-3 flex snap-x snap-proximity items-center gap-1 overflow-x-auto scroll-px-1 px-1 pb-1"
          >
            {data.blocks.length > 0 && (
              <ActivityNavTab
                selected={currentItem === 'home'}
                label={lang === 'zh' ? '学案首页' : 'Overview'}
                onClick={() => setActiveItem('home')}
              />
            )}
            {data.activities.map((activity, index) => {
              const progress = data.progressByActivity[activity.id];
              const done =
                progress && (progress.status === 'graded' || (progress.verified && progress.status === 'submitted'));
              return (
                <ActivityNavTab
                  key={activity.id}
                  selected={currentItem === activity.id}
                  index={index + 1}
                  label={activity.title}
                  done={Boolean(done)}
                  active={progress?.status === 'in_progress'}
                  onClick={() => setActiveItem(activity.id)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="w-full flex-1 px-5 py-6 sm:px-6">
        {currentItem === 'home' && data.blocks.length > 0 ? (
          <section aria-label="学案首页" className="space-y-3">
            {[...data.blocks]
              .sort((a, b) => {
                // 学案首页始终置顶，其余块沿用 order_index。
                if (a.block_type === 'xuean_home') return -1;
                if (b.block_type === 'xuean_home') return 1;
                return a.order_index - b.order_index;
              })
              .map((b) => (
                <BlockCard key={b.id} block={b} />
              ))}
          </section>
        ) : currentItem ? (
          (() => {
            const index = data.activities.findIndex((activity) => activity.id === currentItem);
            if (index < 0) return null;
            const activity = data.activities[index];
            return (
              <section aria-label={`活动 ${index + 1}：${activity.title}`} className="space-y-4">
                <ActivityItem
                  index={index}
                  activity={activity}
                  progress={data.progressByActivity[activity.id]}
                  lang={lang}
                  onProgressUpdated={refresh}
                  onActivityProgressReported={onActivityProgressReported}
                />
                {data.activities.length > 1 && (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveItem(data.activities[index - 1]?.id ?? currentItem)}
                      disabled={index === 0}
                      className="px-3 py-1.5 text-xs rounded-lg border border-theme text-main hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ← {lang === 'zh' ? '上一活动' : 'Previous'}
                    </button>
                    <span className="text-[11px] text-muted">
                      {index + 1} / {data.activities.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveItem(data.activities[index + 1]?.id ?? currentItem)}
                      disabled={index === data.activities.length - 1}
                      className="px-3 py-1.5 text-xs rounded-lg border border-theme text-main hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {lang === 'zh' ? '下一活动' : 'Next'} →
                    </button>
                  </div>
                )}
              </section>
            );
          })()
        ) : (
          <div className="text-center text-muted py-16 border-2 border-dashed border-theme rounded-xl text-sm">
            {lang === 'zh' ? '教师尚未编排活动' : 'No activities yet'}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityNavTab({
  selected,
  label,
  index,
  done = false,
  active = false,
  onClick,
}: {
  selected: boolean;
  label: string;
  /** 活动序号；学案首页不传。 */
  index?: number;
  done?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  const displayLabel = index ? `${index}. ${label}` : label;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      title={displayLabel}
      aria-label={displayLabel}
      className={`relative inline-flex shrink-0 snap-start items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-theme/40 ${
        selected
          ? "bg-primary-theme/10 text-primary-theme after:absolute after:inset-x-2 after:bottom-0.5 after:border-b-[3px] after:border-primary-theme after:content-['']"
          : 'text-muted hover:bg-surface-secondary hover:text-main'
      }`}
    >
      {index ? (
        // 序号徽标仅作视觉提示，可访问名称由按钮的 aria-label 提供（如「1. 活动一」）。
        <span
          aria-hidden="true"
          className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full border px-1 text-[10px] font-bold leading-none tabular-nums ${
            selected ? 'border-primary-theme bg-primary-theme text-white' : 'border-theme bg-surface text-muted'
          }`}
        >
          {index}
        </span>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0">
          <path
            d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="max-w-[12rem] truncate">{label}</span>
      {done ? (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 shrink-0 text-emerald-600">
          <path
            d="m3 8.5 3 3 7-7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : active ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden="true" />
      ) : null}
    </button>
  );
}

function BlockCard({ block }: { block: Block }) {
  let content: unknown;
  try {
    content = JSON.parse(block.content_json);
  } catch {
    content = block.content_json;
  }

  const typeLabel = BLOCK_TYPE_LABELS[block.block_type] ?? block.block_type;

  const renderContent = () => {
    if (block.block_type === 'xuean_home' && content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      const backgroundImage = typeof record.backgroundImage === 'string' ? record.backgroundImage : '';
      const intro = typeof record.intro === 'string' ? record.intro : '';
      return (
        <div
          className="rounded-xl overflow-hidden border border-theme min-h-[180px] bg-surface-secondary bg-cover bg-center relative"
          style={backgroundImage ? { backgroundImage: `url("${backgroundImage}")` } : undefined}
        >
          {backgroundImage && <div className="absolute inset-0 bg-black/35" />}
          <p className={`relative p-5 text-sm whitespace-pre-wrap ${backgroundImage ? 'text-white' : 'text-main'}`}>
            {intro || '本学案暂无简介'}
          </p>
        </div>
      );
    }
    if (block.block_type === 'interactive_courseware' && content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      // 阶段 5：优先走统一 Surface；未迁移的存量块回退旧 CoursewareHost。
      if (block.surface_id) {
        return (
          <div className="h-[420px] w-full overflow-hidden rounded-lg border border-theme">
            <LearningSurfaceHost
              surfaceId={block.surface_id}
              lessonId={block.lesson_id}
              hostId={block.id}
              title={typeof record.title === 'string' ? record.title : undefined}
              lazy={false}
              className="w-full h-full"
            />
          </div>
        );
      }
    }
    if (typeof content === 'string') {
      return block.block_type === 'free_html' ? (
        <div dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(content) }} />
      ) : (
        <p className="text-sm text-main whitespace-pre-wrap">{content}</p>
      );
    }
    if (Array.isArray(content)) {
      return (
        <ul className="space-y-1 text-sm text-main">
          {content.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted shrink-0">•</span>
              <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
            </li>
          ))}
        </ul>
      );
    }
    if (content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length <= 4 && keys.every((k) => Array.isArray(record[k]))) {
        return (
          <div className="grid gap-3">
            {keys.map((k) => (
              <div key={k}>
                <div className="text-[10px] font-bold uppercase text-muted mb-1">{k}</div>
                <ul className="space-y-1 text-sm text-main">
                  {(record[k] as unknown[]).map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted shrink-0">•</span>
                      <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        );
      }
      return (
        <pre className="text-xs text-main/80 bg-surface-secondary rounded p-2 overflow-x-auto">
          {JSON.stringify(content, null, 2)}
        </pre>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-theme bg-surface p-4">
      <div className="text-[10px] font-bold uppercase tracking-wider text-primary-theme mb-2">{typeLabel}</div>
      {renderContent()}
    </div>
  );
}

function ActivityItem({
  index,
  activity,
  progress,
  lang = 'zh',
  onProgressUpdated,
  onActivityProgressReported,
}: {
  index: number;
  activity: Activity;
  progress?: Progress;
  lang?: 'zh' | 'en';
  onProgressUpdated: () => void;
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
}) {
  const status = progress?.status ?? 'not_started';
  const pct = progress?.progress_percent ?? 0;
  const stLabel = STATUS_LABELS[status];
  const activityTypeLabel = ACTIVITY_TYPE_LABELS[activity.type] ?? activity.type;

  // 试题活动：引用试卷，交给内嵌 AssessmentRunner 作答。
  if (activity.type === 'quiz') {
    let hasAssignment = false;
    try {
      hasAssignment = Boolean(JSON.parse(activity.config_json ?? '{}')?.assignmentId);
    } catch {
      hasAssignment = false;
    }
    if (hasAssignment) {
      return (
        <AssessmentActivityCard
          activity={activity}
          onProgressUpdated={onProgressUpdated}
          onActivityProgressReported={onActivityProgressReported}
        />
      );
    }
  }

  // 插件活动：由第三方插件通过 `xuean.activity.student` 提供学生端渲染。
  if (activity.type.includes(':')) {
    return (
      <div className="rounded-xl border border-theme bg-surface p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-xs font-mono text-muted">#{index + 1}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">
            插件活动
          </span>
          <span className="text-sm font-semibold text-main">{activity.title}</span>
        </div>
        <ExtensionPointRenderer
          slot="xuean.activity.student"
          slotProps={{ activity, activityType: activity.type, lessonId: activity.lesson_id }}
          fallback={<p className="text-[11px] text-amber-600">插件未加载，暂时无法显示此活动。</p>}
        />
      </div>
    );
  }

  // 解析已有提交内容
  let existingSubmission: ActivitySubmission | null = null;
  if (progress?.submission_json) {
    try {
      existingSubmission = JSON.parse(progress.submission_json) as ActivitySubmission;
    } catch {
      existingSubmission = progress.submission_json;
    }
  }

  const moduleProps = {
    activity,
    progress,
    lang,
    onProgressUpdated,
    onActivityProgressReported,
  };
  const activityModule =
    activity.type === 'reading' ? (
      <ReadingActivityCard {...moduleProps} />
    ) : activity.type === 'submission' ? (
      <SubmissionActivityCard {...moduleProps} />
    ) : activity.type === 'survey' ? (
      <SurveyActivityCard {...moduleProps} />
    ) : activity.type === 'form' ? (
      <FormActivityCard {...moduleProps} />
    ) : activity.type === 'discussion' ? (
      <DiscussionActivityCard {...moduleProps} />
    ) : null;

  return (
    <>
      <div className="rounded-xl border border-theme bg-surface p-4 hover:border-primary-theme/30 transition">
        <div className="flex items-start gap-3">
          {/* 序号圆徽 */}
          <div className="w-8 h-8 rounded-full bg-primary-theme/10 text-primary-theme font-black text-sm flex items-center justify-center shrink-0 border border-primary-theme/20">
            {index + 1}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{activityTypeLabel}</span>
              {activity.required ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600">必做</span>
              ) : null}
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stLabel.cls}`}>{stLabel.text}</span>
              {progress?.verified && <span className="text-[10px] text-emerald-600">✓ 已验证</span>}
              {progress?.score != null && (
                <span className="text-[10px] text-amber-600 font-bold">得分 {progress.score}</span>
              )}
              {existingSubmission && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  已提交
                </span>
              )}
              {progress?.nudged_at && status !== 'graded' && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/30 animate-pulse"
                  title={`教师于 ${new Date(progress.nudged_at).toLocaleString()} 催办${progress.nudge_count ? `（共 ${progress.nudge_count} 次）` : ''}`}
                >
                  ⚠ 教师催办{progress.nudge_count && progress.nudge_count > 1 ? ` ×${progress.nudge_count}` : ''}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-main">{activity.title}</p>

            {activityModule}

            {/* 学习面：活动绑定了 Surface 时，由统一宿主渲染内容 */}
            {activity.surface_id ? (
              <div className="mt-2 h-80 rounded-lg overflow-hidden border border-theme/60 bg-surface-secondary/30">
                <LearningSurfaceHost
                  surfaceId={activity.surface_id}
                  lessonId={activity.lesson_id}
                  hostId={activity.id}
                  title={activity.title}
                  className="w-full h-full"
                />
              </div>
            ) : null}

            {/* 已提交内容预览（内置活动模块会自行展示，避免重复） */}
            {!activityModule && existingSubmission && (
              <div className="mt-2 p-2 rounded-lg bg-surface-secondary/50 border border-theme/60 max-h-24 overflow-y-auto">
                <p className="text-[10px] text-muted font-bold mb-0.5">我的提交</p>
                <p className="text-xs text-main/80 whitespace-pre-wrap break-all">
                  {typeof existingSubmission === 'string'
                    ? existingSubmission
                    : (existingSubmission.content ?? JSON.stringify(existingSubmission))}
                </p>
              </div>
            )}

            {/* 进度条 */}
            <div className="mt-2 h-1.5 rounded-full bg-surface-secondary overflow-hidden">
              <div
                className="h-full bg-primary-theme transition-all"
                style={{ width: `${pct}%` }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
