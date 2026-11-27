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
import { useOptionalPluginHost } from '../../../plugin-host/plugin-host-context';

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
  /** 外层顶栏（学生课堂）已经显示环节名时置 false：头部只留活动导航 + 进度，避免同一句话相邻重复。 */
  showTitle?: boolean;
  /** Mode Pack 工作区可选：进度写库成功后通知（如 ClassroomMessage xuean:task） */
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
  /** 学生身份：透传给 `xuean.activity.student` 插件槽位，避免插件自行从全局 store 推断。 */
  studentId?: string | null;
  classId?: string | null;
}

export function StudentXueanView({
  lessonId,
  lessonTitle,
  lang = 'zh',
  showTitle = true,
  onActivityProgressReported,
  studentId = null,
  classId = null,
}: Props) {
  const [data, setData] = useState<XueanData | null>(null);
  const [loading, setLoading] = useState(true);

  // 没有插件贡献 addon 时不再渲染那层「pt-2 mt-2 border-t」包裹，避免卡片底部多出一条空分隔线。
  const pluginHost = useOptionalPluginHost();
  const hasActivityAddon = Boolean(
    pluginHost && (pluginHost.getExtensions('xuean.activity.student.addon' as never) ?? []).length > 0,
  );

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

  // 活动导航：单行横向滚动，点击直接切换中间内容
  const tabsNode = (
    <div
      ref={tablistRef}
      role="tablist"
      aria-label="学案活动导航"
      className="scrollbar-none -mx-1 flex min-w-0 flex-1 snap-x snap-proximity items-center gap-1 overflow-x-auto scroll-px-1 px-1 pb-1"
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
  );

  const progressNode = (
    <div className="ml-auto flex shrink-0 items-center gap-2.5">
      <div
        className="inline-flex items-center gap-1.5"
        role="progressbar"
        aria-label={lang === 'zh' ? '学案活动完成进度' : 'Activity completion'}
        aria-valuemin={0}
        aria-valuemax={data.activities.length}
        aria-valuenow={completedCount}
      >
        <CompletionRing percent={completedPercent} />
        <span className="text-[11px] tabular-nums text-muted">
          {completedCount} / {data.activities.length}
        </span>
      </div>
      <ExtensionPointRenderer
        slot="xuean.progress.summary"
        slotProps={{
          lessonId: data.lessonId,
          completedCount,
          total: data.activities.length,
          percent: Math.round(completedPercent),
          lang,
        }}
        lang={lang}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 学案头部：默认两行（标题 + 进度 + 活动导航）；外层顶栏已显示环节名时收成一行 */}
      <div className="z-20 shrink-0 border-b border-theme bg-surface/95 backdrop-blur-md">
        {showTitle ? (
          <div className="w-full px-5 pt-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="min-w-0 truncate text-base font-black tracking-tight text-main sm:text-lg">
                {lessonTitle ?? data.lessonId}
              </h2>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-theme" aria-hidden="true" />
                {lang === 'zh' ? '学案式学习' : 'Guided study'}
              </span>
              {progressNode}
            </div>
            <div className="mt-2">{tabsNode}</div>
          </div>
        ) : (
          <div className="flex w-full items-center gap-3 px-5 py-2 sm:px-6">
            {tabsNode}
            {progressNode}
          </div>
        )}
      </div>

      {/* 两栏：左侧当前内容（限宽可读），右侧导读栏（大屏才出现）。
          学案首页本身就在展示这些块，此时不再并排重复一份。 */}
      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          currentItem === 'home' ? '' : 'xl:grid-cols-[minmax(0,1fr)_280px]'
        }`}
      >
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-5 py-5 sm:px-6">
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
                <ExtensionPointRenderer
                  slot="xuean.home.block"
                  slotProps={{ lessonId: data.lessonId, blocks: data.blocks, lang }}
                  lang={lang}
                />
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
                      studentId={studentId ?? null}
                      classId={classId ?? null}
                      // 活动名与本环节同名时不再重复一遍（顶栏与活动导航已经给出）。
                      hideTitle={activity.title.trim() === (lessonTitle ?? '').trim()}
                      hasAddon={hasActivityAddon}
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

        {/* 导读栏：活动页常驻，小屏隐藏（活动导航仍可完成全部切换） */}
        {currentItem === 'home' ? null : (
          <aside
            aria-label={lang === 'zh' ? '学案导读' : 'Study guide'}
            className="hidden min-h-0 overflow-y-auto border-l border-theme bg-surface-secondary/20 px-4 py-5 xl:block"
          >
            <XueanGuideRail
              blocks={data.blocks}
              activities={data.activities}
              progressByActivity={data.progressByActivity}
              lang={lang}
            />
          </aside>
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

/** 完成进度圆环：替代原来那条占满整行、内容却只有一个数字的细进度条。 */
function CompletionRing({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <svg viewBox="0 0 36 36" className="h-4 w-4 -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="5" className="stroke-surface-secondary" />
      <circle
        cx="18"
        cy="18"
        r="15.5"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray={`${value} 100`}
        className="stroke-emerald-500 transition-[stroke-dasharray] duration-300"
      />
    </svg>
  );
}

/** 侧栏只读这几个「导读类」首页块；xuean_home / 课件 / 自由 HTML 仍留在首页正文。 */
const GUIDE_BLOCK_TYPES = new Set(['learning_goals', 'key_points', 'resources', 'operation_tips']);

function toItemText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'title', 'label', 'name']) {
      const v = record[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

/** 首页块内容没有统一 schema（数组 / {goals:[…]} / 纯文本都出现过），这里收敛成条目列表。 */
function blockItems(raw: string): string[] {
  let content: unknown;
  try {
    content = JSON.parse(raw);
  } catch {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (typeof content === 'string') {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(content)) return content.map(toItemText).filter(Boolean);
  if (content && typeof content === 'object') {
    const items: string[] = [];
    for (const value of Object.values(content as Record<string, unknown>)) {
      if (Array.isArray(value)) items.push(...value.map(toItemText).filter(Boolean));
      else if (typeof value === 'string' && value.trim()) items.push(value.trim());
    }
    return items;
  }
  return [];
}

/**
 * 学案导读栏：活动进度 + 学习目标 / 重难点 / 资源。
 * 只读展示（切换活动仍由顶部导航负责），避免与活动导航形成两套互相打脸的导航语义。
 */
function XueanGuideRail({
  blocks,
  activities,
  progressByActivity,
  lang,
}: {
  blocks: Block[];
  activities: Activity[];
  progressByActivity: Record<string, Progress>;
  lang: 'zh' | 'en';
}) {
  const zh = lang === 'zh';
  const guideBlocks = blocks
    .filter((b) => GUIDE_BLOCK_TYPES.has(b.block_type))
    .sort((a, b) => a.order_index - b.order_index)
    .map((b) => ({
      id: b.id,
      label: BLOCK_TYPE_LABELS[b.block_type] ?? b.block_type,
      items: blockItems(b.content_json),
    }))
    .filter((b) => b.items.length > 0);

  return (
    <div className="space-y-5">
      {activities.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
            {zh ? '活动进度' : 'Progress'}
          </h3>
          <ul className="space-y-1.5">
            {activities.map((activity, index) => {
              const progress = progressByActivity[activity.id];
              const status = progress?.status ?? 'not_started';
              const done = status === 'graded' || Boolean(progress?.verified && status === 'submitted');
              const statusLabel = STATUS_LABELS[status];
              return (
                <li key={activity.id} className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold tabular-nums ${
                      done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-theme text-muted'
                    }`}
                  >
                    {done ? '✓' : index + 1}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${done ? 'text-muted' : 'text-main'}`}
                    title={activity.title}
                  >
                    {activity.title}
                  </span>
                  <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] ${statusLabel.cls}`}>
                    {statusLabel.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {guideBlocks.map((block) => (
        <section key={block.id}>
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary-theme">{block.label}</h3>
          <ul className="space-y-1 text-xs leading-relaxed text-main">
            {block.items.map((item, index) => (
              <li key={index} className="flex gap-1.5">
                <span aria-hidden="true" className="shrink-0 text-muted">
                  ·
                </span>
                <span className="min-w-0 break-words">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {guideBlocks.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">
          {zh ? '教师尚未填写学习目标 / 重难点。' : 'No learning goals or key points yet.'}
        </p>
      ) : null}
    </div>
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
                {/* 只有一个数组键时，块类型标题已经说明了它是什么，不再把 schema 键名（GOALS / POINTS…）露给学生 */}
                {keys.length > 1 ? <div className="text-[10px] font-bold uppercase text-muted mb-1">{k}</div> : null}
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
  hideTitle = false,
  hasAddon = false,
  onProgressUpdated,
  onActivityProgressReported,
  studentId = null,
  classId = null,
}: {
  index: number;
  activity: Activity;
  progress?: Progress;
  lang?: 'zh' | 'en';
  /** 活动名与当前环节同名时省略标题，避免同一句话在一屏里出现三次。 */
  hideTitle?: boolean;
  /** 无插件贡献 addon 时省掉底部那条空分隔线。 */
  hasAddon?: boolean;
  onProgressUpdated: () => void;
  onActivityProgressReported?: (info: { activityId: string; status: string }) => void;
  studentId?: string | null;
  classId?: string | null;
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
          slotProps={{
            activity,
            activityType: activity.type,
            lessonId: activity.lesson_id,
            progress: progress ?? null,
            studentId,
            classId,
            lang,
          }}
          fallback={<p className="text-[11px] text-amber-600">插件未加载，暂时无法显示此活动。</p>}
        />
        {hasAddon ? (
          <div className="pt-2 mt-2 border-t border-theme">
            <ExtensionPointRenderer
              slot="xuean.activity.student.addon"
              slotProps={{
                activity,
                activityType: activity.type,
                lessonId: activity.lesson_id,
                progress: progress ?? null,
                lang,
              }}
              lang={lang}
            />
          </div>
        ) : null}
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
            {hideTitle ? null : <p className="mt-1 text-sm font-semibold text-main">{activity.title}</p>}

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

            {/* 进度条：0% 时整条隐藏，否则空轨道会被读成一条多余的分隔线（状态已由顶部徽标给出） */}
            {pct > 0 ? (
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
            ) : null}

            {hasAddon ? (
              <div className="pt-2 mt-2 border-t border-theme">
                <ExtensionPointRenderer
                  slot="xuean.activity.student.addon"
                  slotProps={{
                    activity,
                    activityType: activity.type,
                    lessonId: activity.lesson_id,
                    progress: progress ?? null,
                    lang,
                  }}
                  lang={lang}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
