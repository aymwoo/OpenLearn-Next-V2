import { useMemo } from 'react';
import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, ClipboardList } from 'lucide-react';
import { formatLocalYMD } from '../../utils/date';

export interface StudentLearningFocusProps {
  studentDashboardData: any;
  lang: 'zh' | 'en';
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  setSelectedAssignment: (ast: any) => void;
  setQuizStudentAnswers: (answers: any) => void;
  setSubAssignmentTab: (tab: string) => void;
}

export interface NextLessonPick {
  schedule: any;
  /** 展示用日期（YYYY-MM-DD），跨周时会提到下周对应日 */
  date: string;
  isToday: boolean;
  isNextWeek: boolean;
}

/** 解析 "HH:MM - HH:MM" 时间段；无法解析（如全天）返回 null */
export function parseTimeSlotRange(slot?: string | null): { start: string; end: string } | null {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec((slot || '').trim());
  if (!m) return null;
  return {
    start: `${m[1].padStart(2, '0')}:${m[2]}`,
    end: `${m[3].padStart(2, '0')}:${m[4]}`,
  };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalYMD(d);
}

/**
 * 学习路径中的「最近课节」：优先今天还没结束的课 → 本周后续课 → 下周最早课。
 * 排课是每周重复投影（scheduled_date 已映射到本周），所以跨周时需要 +7 天展示。
 */
export function pickNextLesson(schedules: any[], now: Date = new Date()): NextLessonPick | null {
  const usable = (schedules || []).filter((s) => s?.status !== 'cancelled' && s?.status !== 'holiday');
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) =>
    `${a.scheduled_date || ''} ${a.time_slot || ''}`.localeCompare(`${b.scheduled_date || ''} ${b.time_slot || ''}`),
  );

  const todayStr = formatLocalYMD(now);
  const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const todayUpcoming = sorted.find((s) => {
    if (s.scheduled_date !== todayStr) return false;
    const range = parseTimeSlotRange(s.time_slot);
    return !range || range.end >= nowHM;
  });
  if (todayUpcoming) return { schedule: todayUpcoming, date: todayStr, isToday: true, isNextWeek: false };

  const laterThisWeek = sorted.find((s) => s.scheduled_date > todayStr);
  if (laterThisWeek) {
    return { schedule: laterThisWeek, date: laterThisWeek.scheduled_date, isToday: false, isNextWeek: false };
  }

  const earliest = sorted[0];
  const nextWeekDate = addDays(earliest.scheduled_date, 7);
  return { schedule: earliest, date: nextWeekDate, isToday: false, isNextWeek: true };
}

/** 未提交作业（服务端已按创建时间倒序返回，保持原顺序即可） */
export function pickPendingAssignments(assignments: any[]): any[] {
  return (assignments || []).filter((a) => !a?.submission_status);
}

/** 需要续学的课程：未完成且进度最高的一门 */
export function pickContinueProgress(progress: any[]): any | null {
  const unfinished = (progress || []).filter(
    (p) => p?.lesson_id && p.completed !== 1 && Number(p.progress_percent) < 100,
  );
  if (unfinished.length === 0) return null;
  return [...unfinished].sort((a, b) => Number(b.progress_percent) - Number(a.progress_percent))[0];
}

function formatScheduleDate(pick: NextLessonPick, lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  const todayStr = formatLocalYMD();
  const tomorrowStr = addDays(todayStr, 1);
  if (pick.date === todayStr) return zh ? '今天' : 'Today';
  if (pick.date === tomorrowStr) return zh ? '明天' : 'Tomorrow';

  const weekday = new Date(`${pick.date}T00:00:00`).getDay();
  const zhNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const enNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const name = zh ? zhNames[weekday] : enNames[weekday];
  const prefix = pick.isNextWeek ? (zh ? '下周' : 'Next ') : '';
  return `${prefix}${name}`;
}

const TILE_CLASS = 'flex flex-col gap-2.5 rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-2xs';
const TILE_ACTION_CLASS =
  'mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * Issue IKVKVF：学生首屏「现在该做什么」学习路径焦点区。
 *
 * 固定渲染在可拖拽栅格之上，不随学生自定义布局漂移：
 * 待办作业 → 最近课节 → 需要续学的课程，三者按学习路径排序。
 */
export function StudentLearningFocus(props: StudentLearningFocusProps) {
  const {
    studentDashboardData,
    lang,
    setSelectedLesson,
    setStudentViewStatus,
    setSelectedAssignment,
    setQuizStudentAnswers,
    setSubAssignmentTab,
  } = props;
  const zh = lang === 'zh';

  const pending = useMemo(() => pickPendingAssignments(studentDashboardData?.assignments), [studentDashboardData]);
  const nextLesson = useMemo(() => pickNextLesson(studentDashboardData?.schedules || []), [studentDashboardData]);
  const continueItem = useMemo(() => pickContinueProgress(studentDashboardData?.progress), [studentDashboardData]);

  if (pending.length === 0 && !nextLesson && !continueItem) return null;

  const openAssignment = (ast: any) => {
    setSelectedAssignment(ast);
    setStudentViewStatus('assignment');
    setQuizStudentAnswers({});
    setSubAssignmentTab('quiz');
  };

  const openLesson = (lessonId: string) => {
    setSelectedLesson(lessonId);
    setStudentViewStatus('lesson');
  };

  return (
    <section
      data-testid="student-learning-focus"
      aria-labelledby="student-learning-focus-heading"
      className="rounded-2xl border border-indigo-100/80 bg-gradient-to-br from-indigo-50/70 via-white to-teal-50/60 p-3.5 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="student-learning-focus-heading"
          className="flex items-center gap-2 text-sm font-black tracking-tight text-slate-800"
        >
          <span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden="true" />
          {zh ? '现在该做什么' : 'What to do now'}
        </h2>
        <p className="text-2xs font-medium text-slate-500">
          {zh
            ? '按学习路径排序：先完成待办，再准备最近课节'
            : 'Ordered by learning path: to-dos first, then upcoming class'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {pending.length > 0 && (
          <article data-testid="focus-pending-assignments" className={TILE_CLASS}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <ClipboardList size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-black text-slate-800">{zh ? '待办作业' : 'Assignments to do'}</h3>
                <p className="text-2xs font-semibold text-amber-700">
                  {zh ? `${pending.length} 项待提交` : `${pending.length} pending`}
                </p>
              </div>
            </div>
            <p className="truncate text-xs font-semibold text-slate-700" title={pending[0].title}>
              {pending[0].title}
            </p>
            <p className="truncate text-2xs text-slate-500">{pending[0].class_name}</p>
            <button
              type="button"
              onClick={() => openAssignment(pending[0])}
              className={`${TILE_ACTION_CLASS} bg-amber-500 text-white hover:bg-amber-600 focus-visible:outline-amber-600`}
            >
              {zh ? '开始完成作业' : 'Start assignment'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </article>
        )}

        {nextLesson && (
          <article data-testid="focus-next-lesson" className={TILE_CLASS}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                <CalendarClock size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-black text-slate-800">{zh ? '最近课节' : 'Next class'}</h3>
                <p className="text-2xs font-semibold text-indigo-700">
                  {formatScheduleDate(nextLesson, lang)}
                  {nextLesson.schedule.time_slot ? ` · ${nextLesson.schedule.time_slot}` : ''}
                </p>
              </div>
            </div>
            <p className="truncate text-xs font-semibold text-slate-700" title={nextLesson.schedule.lesson_title}>
              {nextLesson.schedule.lesson_title}
            </p>
            <p className="truncate text-2xs text-slate-500">{nextLesson.schedule.class_name}</p>
            <button
              type="button"
              disabled={!nextLesson.schedule.lesson_id}
              onClick={() => nextLesson.schedule.lesson_id && openLesson(nextLesson.schedule.lesson_id)}
              title={
                nextLesson.schedule.lesson_id
                  ? zh
                    ? '进入该课节学习'
                    : 'Open this lesson'
                  : zh
                    ? '该排课尚未关联课程'
                    : 'No lesson linked to this schedule'
              }
              className={`${TILE_ACTION_CLASS} bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600 disabled:pointer-events-none disabled:bg-slate-200 disabled:text-slate-500`}
            >
              {zh ? '进入课节' : 'Open lesson'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </article>
        )}

        {continueItem && (
          <article data-testid="focus-continue-learning" className={TILE_CLASS}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
                <BookOpen size={16} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-black text-slate-800">{zh ? '继续学习' : 'Continue learning'}</h3>
                <p className="text-2xs font-semibold text-teal-700">
                  {zh ? `已完成 ${continueItem.progress_percent}%` : `${continueItem.progress_percent}% complete`}
                </p>
              </div>
            </div>
            <p className="truncate text-xs font-semibold text-slate-700" title={continueItem.lesson_title}>
              {continueItem.lesson_title}
            </p>
            <div className="flex items-center gap-2" aria-hidden="true">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.min(100, Math.max(0, Number(continueItem.progress_percent) || 0))}%` }}
                />
              </div>
              <CheckCircle2 size={13} className="shrink-0 text-teal-600" />
            </div>
            <button
              type="button"
              onClick={() => openLesson(continueItem.lesson_id)}
              className={`${TILE_ACTION_CLASS} bg-teal-600 text-white hover:bg-teal-700 focus-visible:outline-teal-600`}
            >
              {zh ? '继续学习' : 'Resume course'}
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </article>
        )}
      </div>
    </section>
  );
}

export default StudentLearningFocus;
