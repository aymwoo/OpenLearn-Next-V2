import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Cpu,
  FlaskConical,
  FolderKanban,
  GraduationCap,
  Layers,
  LayoutGrid,
  Loader2,
  Monitor,
  Presentation,
  Radio,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { useNetworkLatency } from '../../hooks/useNetworkLatency';
import { fetchTeachingModes, teachingModeColor, type TeachingMode } from './teaching-modes-client';

/**
 * ClassroomEntryPortal —— 互动课堂的起始门户（对应 Stitch「课程入口与班级选择门户」设计）。
 *
 * 教师进入互动课堂后先看到本页：确认课程 → 挑选班级（含席位矩阵）→ 选择教学模式
 * → 启动进入授课。设计三栏：顶部遥测岛（全宽）+ 左主栏（STEP1/STEP2/启动区）
 * + 右辅栏（教案蓝图 / 课前洞察 / 自检）。
 *
 * 实现约定：
 *  - 全部使用项目语义 token（bg-surface / text-main / border-theme / bg-primary-theme…），
 *    因此 light / dark / eyecare / chalkboard 四套主题自动一致，不硬编码 indigo/slate；
 *  - 图标统一 lucide-react（与项目其余 126 个文件一致，不引入第二套图标库）；
 *  - 字号遵循项目「全站不小于 12px」的强制规范，不使用 text-[10px] 这类会被改写的值；
 *  - 六个区域均通过扩展槽位渲染，插件可接入而不必改动本组件：
 *      classroom.portal.telemetry / course_badge / teaching_mode / insight /
 *      preflight / launch_action
 */

export interface ClassroomEntryPortalProps {
  lessons: any[];
  classes: any[];
  students: any[];
  selectedLesson: string | null;
  setSelectedLesson: (id: string | null) => void;
  liveClassSelectedClassId: string | null;
  setLiveClassSelectedClassId: (id: string | null) => void;
  timelineSegments: any[];
  onlineStudentIds: string[];
  lang: string;
  addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  /** 点击「进入课堂」时回调，由父组件切换到授课阶段 */
  onEnterClassroom: (payload: {
    lessonId: string;
    classId: string;
    teachingModeId: string | null;
  }) => void | Promise<void>;
  /** 测试注入点；默认使用全局 fetch */
  fetcher?: typeof fetch;
}

/** 教学模式 icon 名（服务端常量的语义名）→ lucide 组件 */
const MODE_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Presentation,
  FlaskConical,
  Users,
  Sparkles,
  Target,
  BookOpen,
  FolderKanban,
  Layers,
  Cpu,
  GraduationCap,
};

function greetingOf(hour: number, zh: boolean): string {
  if (hour < 6) return zh ? '凌晨好' : 'Good early morning';
  if (hour < 12) return zh ? '上午好' : 'Good morning';
  if (hour < 18) return zh ? '下午好' : 'Good afternoon';
  return zh ? '晚上好' : 'Good evening';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// ── 顶部遥测岛 ─────────────────────────────────────────────────────────────

function TelemetryIsland({
  lang,
  seatCount,
  onlineCount,
  readinessRate,
}: {
  lang: string;
  seatCount: number;
  onlineCount: number;
  readinessRate: string;
}) {
  const zh = lang === 'zh';
  const { latencyMs, quality, isOnline } = useNetworkLatency();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const qualityLabel =
    quality === 'offline'
      ? zh
        ? '离线'
        : 'Offline'
      : quality === 'smooth'
        ? zh
          ? '流畅'
          : 'Smooth'
        : quality === 'fair'
          ? zh
            ? '一般'
            : 'Fair'
          : zh
            ? '较差'
            : 'Poor';

  const qualityTone =
    quality === 'smooth'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/40 dark:border-emerald-800/80 dark:text-emerald-300'
      : quality === 'fair'
        ? 'text-amber-700 bg-amber-50 border-amber-200/80 dark:bg-amber-950/40 dark:border-amber-800/80 dark:text-amber-300'
        : 'text-rose-700 bg-rose-50 border-rose-200/80 dark:bg-rose-950/40 dark:border-rose-800/80 dark:text-rose-300';

  const tiles = [
    {
      icon: Monitor,
      label: zh ? '主控大屏' : 'Main Display',
      value: zh ? '投屏通道通畅' : 'Projector ready',
      hint: zh ? '4K UHD' : '4K UHD',
    },
    {
      icon: Server,
      label: zh ? '沙箱就绪率' : 'Sandbox Ready',
      value: `${onlineCount} / ${seatCount}`,
      hint: readinessRate,
    },
    {
      icon: isOnline ? Wifi : WifiOff,
      label: zh ? '网络时延' : 'Network RTT',
      value: latencyMs === null ? '—' : `${latencyMs} ms`,
      hint: qualityLabel,
      tone: qualityTone,
    },
    {
      icon: Clock,
      label: zh ? '授课系统时钟' : 'System Clock',
      value: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      hint: zh ? '本地时间' : 'Local time',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className="bg-surface border border-theme rounded-xl px-3 py-2.5 flex items-center gap-2.5 shadow-3xs"
          >
            <div className="w-8 h-8 rounded-lg bg-surface-secondary border border-theme-subtle flex items-center justify-center shrink-0">
              <Icon size={15} className="text-primary-theme" />
            </div>
            <div className="min-w-0">
              <div className="text-2xs text-muted truncate">{tile.label}</div>
              <div className={`font-mono font-bold text-xs truncate ${tile.tone ? '' : 'text-main'}`}>
                {tile.tone ? <span className={`px-1.5 py-0.5 rounded border ${tile.tone}`}>{tile.value}</span> : tile.value}
              </div>
              <div className="text-2xs text-subtle truncate">{tile.hint}</div>
            </div>
          </div>
        );
      })}
      {/* 插件可注册额外遥测指标 */}
      <ExtensionPointRenderer slot="classroom.portal.telemetry" lang={lang} />
    </div>
  );
}

// ── 区块外壳 ───────────────────────────────────────────────────────────────

function Deck({
  step,
  title,
  subtitle,
  aside,
  children,
  className,
}: {
  step?: string;
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-surface border border-theme rounded-2xl shadow-3xs p-4 ${className ?? ''}`}>
      <header className="flex items-start justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {step && (
            <span className="w-6 h-6 rounded-lg bg-primary-theme-light text-primary-theme border border-primary-theme font-bold text-2xs flex items-center justify-center shrink-0">
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-main truncate">{title}</h3>
            {subtitle && <p className="text-2xs text-muted truncate">{subtitle}</p>}
          </div>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

// ── STEP1 课程选择 ─────────────────────────────────────────────────────────

function CourseDeck({
  lessons,
  selectedLesson,
  onSelect,
  lang,
}: {
  lessons: any[];
  selectedLesson: string | null;
  onSelect: (id: string) => void;
  lang: string;
}) {
  const zh = lang === 'zh';
  return (
    <Deck
      step="01"
      title={zh ? '选择授课课程' : 'Select Course'}
      subtitle={zh ? `共 ${lessons.length} 门关联课` : `${lessons.length} courses available`}
    >
      {lessons.length === 0 ? (
        <p className="text-xs text-muted italic py-6 text-center">
          {zh ? '暂无可用课程，请先在「课程管理」中创建课节' : 'No courses yet — create a lesson first'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {lessons.slice(0, 6).map((lesson) => {
            const active = lesson.id === selectedLesson;
            return (
              <button
                key={lesson.id}
                type="button"
                onClick={() => onSelect(lesson.id)}
                aria-pressed={active}
                className={`text-left rounded-xl border p-3.5 transition-all cursor-pointer flex flex-col gap-2 h-full ${
                  active
                    ? 'border-primary-theme bg-primary-theme-light shadow-3xs'
                    : 'border-theme bg-surface hover:border-primary-theme hover:bg-surface-secondary'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-2xs font-mono font-bold text-muted">
                    <Layers size={11} />
                    {zh ? '课节' : 'Lesson'}
                  </span>
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-2xs font-bold text-primary-theme">
                      <CheckCircle2 size={12} />
                      {zh ? '已选' : 'Selected'}
                    </span>
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-theme" />
                  )}
                </div>
                <div className="font-bold text-xs text-main line-clamp-2 leading-relaxed">{lesson.title}</div>
                <div className="mt-auto flex items-center gap-2 text-2xs text-muted">
                  <BookOpen size={11} />
                  <span className="truncate">
                    {Array.isArray(lesson.timeline)
                      ? zh
                        ? `${lesson.timeline.length} 个环节`
                        : `${lesson.timeline.length} segments`
                      : zh
                        ? '按默认时长授课'
                        : 'Default pacing'}
                  </span>
                </div>
                {/* 插件可在课程卡片上追加徽章/标签 */}
                <ExtensionPointRenderer
                  slot="classroom.portal.course_badge"
                  lang={lang}
                  slotProps={{ lessonId: lesson.id, lesson, isSelected: active }}
                />
              </button>
            );
          })}
        </div>
      )}
    </Deck>
  );
}

// ── 座位矩阵 ───────────────────────────────────────────────────────────────

function SeatMatrix({
  students,
  onlineStudentIds,
  lang,
}: {
  students: any[];
  onlineStudentIds: string[];
  lang: string;
}) {
  const zh = lang === 'zh';
  const seats = useMemo(() => {
    const sorted = [...students].sort((a, b) =>
      String(a.student_number ?? a.name ?? '').localeCompare(String(b.student_number ?? b.name ?? ''), 'zh-Hans-CN', {
        numeric: true,
      }),
    );
    return sorted;
  }, [students]);

  const groups = useMemo(() => {
    if (seats.length === 0) return [] as { title: string; members: any[] }[];
    const per = Math.ceil(seats.length / 4);
    const out: { title: string; members: any[] }[] = [];
    for (let i = 0; i < seats.length; i += per) {
      out.push({
        title: zh ? `第 ${out.length + 1} 组` : `Group ${out.length + 1}`,
        members: seats.slice(i, i + per),
      });
    }
    return out;
  }, [seats, zh]);

  if (seats.length === 0) {
    return (
      <p className="text-xs text-muted italic py-6 text-center">
        {zh ? '该班级暂无学生，请先在「班级管理」中导入名单' : 'No students in this class yet'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <div className="text-2xs font-bold text-subtle flex items-center gap-1.5">
            <Users size={11} />
            {group.title}
            <span className="font-mono font-normal">
              · {group.members.length} {zh ? '席' : 'seats'}
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {group.members.map((student, idx) => {
              const online = onlineStudentIds.includes(student.id);
              const seatNo = String(student.student_number ?? idx + 1).slice(-2);
              return (
                <div
                  key={student.id}
                  title={`${student.name ?? ''}${online ? (zh ? '（在线）' : ' (online)') : zh ? '（未连接）' : ' (offline)'}`}
                  className={`rounded-lg border px-1.5 py-1.5 flex flex-col items-center gap-0.5 transition-colors ${
                    online
                      ? 'bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/40 dark:border-emerald-800/70'
                      : 'bg-surface-secondary border-theme-subtle'
                  }`}
                >
                  <span className="font-mono text-2xs font-bold text-muted leading-none">{seatNo}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  />
                  <span className="text-2xs text-main truncate w-full text-center leading-tight">
                    {(student.name ?? '').slice(0, 2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 教学模式选择器 ─────────────────────────────────────────────────────────

function TeachingModeSelector({
  modes,
  selectedId,
  onSelect,
  loading,
  lang,
}: {
  modes: TeachingMode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  lang: string;
}) {
  const zh = lang === 'zh';
  const ordered = modes.slice(0, 3);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-2xs font-semibold text-muted flex items-center gap-1.5">
          <Target size={13} className="text-primary-theme" />
          {zh ? '开课默认授课模式：' : 'Default teaching mode:'}
        </span>

        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted">
            <Loader2 size={12} className="animate-spin" />
            {zh ? '加载中…' : 'Loading…'}
          </span>
        ) : ordered.length === 0 ? (
          <span className="text-2xs text-subtle italic">{zh ? '暂无可用模式' : 'No modes available'}</span>
        ) : (
          <div
            role="radiogroup"
            aria-label={zh ? '教学模式' : 'Teaching mode'}
            className="grid grid-cols-3 p-1 rounded-xl bg-surface-secondary border border-theme gap-1 min-w-[260px]"
          >
            {ordered.map((mode) => {
              const active = mode.id === selectedId;
              const Icon = MODE_ICONS[mode.icon] ?? BookOpen;
              const tone = teachingModeColor(mode.color);
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onSelect(mode.id)}
                  title={zh ? mode.description : (mode.descriptionEn ?? mode.description)}
                  className={`px-2.5 py-1.5 rounded-lg text-2xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 truncate ${
                    active
                      ? `bg-surface border shadow-3xs ${tone.chipActive}`
                      : 'text-muted hover:text-main hover:bg-surface/60 border border-transparent'
                  }`}
                >
                  <Icon size={12} className={active ? tone.iconActive : ''} />
                  <span className="truncate">{zh ? mode.name : (mode.nameEn ?? mode.name)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 插件可注册自定义教学模式 */}
      <ExtensionPointRenderer
        slot="classroom.portal.teaching_mode"
        lang={lang}
        slotProps={{
          modes,
          selectedModeId: selectedId,
          onSelect,
          registerHint: zh
            ? '插件可通过 classroom.portal.teaching_mode 槽位注册自定义教学模式'
            : 'Plugins can add modes via the classroom.portal.teaching_mode slot',
        }}
      />
    </div>
  );
}

// ── STEP2 班级与分配 ───────────────────────────────────────────────────────

function ClassroomDeck({
  classes,
  students,
  selectedClassId,
  onSelectClass,
  onlineStudentIds,
  modes,
  selectedModeId,
  onSelectMode,
  modesLoading,
  lang,
}: {
  classes: any[];
  students: any[];
  selectedClassId: string | null;
  onSelectClass: (id: string) => void;
  onlineStudentIds: string[];
  modes: TeachingMode[];
  selectedModeId: string | null;
  onSelectMode: (id: string) => void;
  modesLoading: boolean;
  lang: string;
}) {
  const zh = lang === 'zh';
  const onlineCount = students.filter((s) => onlineStudentIds.includes(s.id)).length;
  const readiness = students.length ? Math.round((onlineCount / students.length) * 100) : 0;
  const { latencyMs } = useNetworkLatency();

  return (
    <Deck
      step="02"
      title={zh ? '挑选班级与分配沙箱算力' : 'Pick Class & Allocate Sandbox'}
      subtitle={zh ? '选择本节课面向的班级' : 'Choose the class for this session'}
      aside={
        <span className="text-2xs font-semibold text-muted inline-flex items-center gap-1.5">
          <Activity size={11} className="text-emerald-500" />
          {zh ? `${onlineCount} 节点在线` : `${onlineCount} nodes online`}
        </span>
      }
    >
      <div className="flex flex-col gap-3.5">
        {classes.length === 0 ? (
          <p className="text-xs text-muted italic py-4 text-center">
            {zh ? '暂无班级，请先在「班级管理」中创建' : 'No classes yet'}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {classes.slice(0, 6).map((klass) => {
              const active = klass.id === selectedClassId;
              return (
                <button
                  key={klass.id}
                  type="button"
                  onClick={() => onSelectClass(klass.id)}
                  aria-pressed={active}
                  className={`text-left rounded-xl border p-3 transition-all cursor-pointer flex flex-col gap-1.5 ${
                    active
                      ? 'border-primary-theme bg-primary-theme-light shadow-3xs'
                      : 'border-theme bg-surface hover:border-primary-theme hover:bg-surface-secondary'
                  }`}
                >
                  <span className="font-bold text-xs text-main truncate">{klass.name}</span>
                  <span className="text-2xs text-muted">
                    {active
                      ? zh
                        ? '当前授课班级'
                        : 'Current class'
                      : zh
                        ? '点击选择'
                        : 'Click to select'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedClassId && (
          <div className="bg-surface-secondary border border-theme rounded-xl p-3.5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-main flex items-center gap-1.5">
                <LayoutGrid size={13} className="text-primary-theme" />
                {zh ? '席位与硬件透视' : 'Seats & hardware'}
              </span>
              <div className="flex flex-wrap items-center gap-3 text-2xs text-muted">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Wifi size={11} />
                  {latencyMs === null ? '—' : `${latencyMs}ms`}
                </span>
                <span className="inline-flex items-center gap-1 font-mono">
                  <Cpu size={11} />
                  {readiness}%
                </span>
                <span className="inline-flex items-center gap-1 font-mono">
                  <Users size={11} />
                  {students.length} {zh ? '席' : 'seats'}
                </span>
              </div>
            </div>
            <SeatMatrix students={students} onlineStudentIds={onlineStudentIds} lang={lang} />
          </div>
        )}

        <TeachingModeSelector
          modes={modes}
          selectedId={selectedModeId}
          onSelect={onSelectMode}
          loading={modesLoading}
          lang={lang}
        />
      </div>
    </Deck>
  );
}

// ── 底部启动区 ─────────────────────────────────────────────────────────────

function LaunchDeck({
  lessonTitle,
  className,
  seatCount,
  canLaunch,
  launching,
  onLaunch,
  lang,
}: {
  lessonTitle: string;
  className: string;
  seatCount: number;
  canLaunch: boolean;
  launching: boolean;
  onLaunch: () => void;
  lang: string;
}) {
  const zh = lang === 'zh';
  return (
    <div className="sticky bottom-4 z-20 bg-surface border border-theme rounded-2xl shadow-3xs px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-primary-theme text-white flex items-center justify-center shrink-0">
          <Rocket size={18} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-main truncate">
              {zh ? '已锁定开课流水线' : 'Launch pipeline locked'}
            </span>
            <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/70">
              Ready
            </span>
          </div>
          <p className="text-2xs text-muted truncate">
            {lessonTitle || (zh ? '未选择课程' : 'No course selected')}
            {className ? ` · ${className}` : ''}
            {seatCount ? ` (${seatCount}${zh ? '席' : ' seats'})` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* 插件可在启动区附加操作（如“预览教案与沙箱”） */}
        <ExtensionPointRenderer slot="classroom.portal.launch_action" lang={lang} slotProps={{ canLaunch }} />
        <button
          type="button"
          onClick={onLaunch}
          disabled={!canLaunch || launching}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary-theme text-white hover:bg-primary-theme-hover transition-colors shadow-3xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {launching ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
          <span>{zh ? '进入数字赋能课堂' : 'Enter Classroom'}</span>
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

// ── 右栏：教案蓝图 + 节奏管道 ──────────────────────────────────────────────

function LessonBlueprint({
  lessonTitle,
  timelineSegments,
  lang,
}: {
  lessonTitle: string;
  timelineSegments: any[];
  lang: string;
}) {
  const zh = lang === 'zh';
  const segments = timelineSegments ?? [];
  const totalSeconds = segments.reduce((acc, seg) => acc + (seg.duration || 300), 0);
  const totalMinutes = Math.round(totalSeconds / 60);

  return (
    <Deck
      title={zh ? '本节课教学蓝图' : 'Lesson Blueprint'}
      subtitle={lessonTitle || (zh ? '未选择课程' : 'No course selected')}
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-2xs font-bold text-subtle mb-1.5 flex items-center gap-1.5">
            <BookOpen size={11} />
            {zh ? `课堂节拍节奏设计（${totalMinutes} 分钟）` : `Pacing (${totalMinutes} min)`}
          </div>
          {segments.length === 0 ? (
            <p className="text-2xs text-muted italic">
              {zh ? '暂未配置环节大纲，将在课中按默认时长授课' : 'No segments configured yet'}
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {segments.slice(0, 6).map((seg, idx) => {
                const mins = Math.round((seg.duration || 300) / 60);
                const width = totalSeconds > 0 ? Math.max(8, Math.round(((seg.duration || 300) / totalSeconds) * 100)) : 0;
                return (
                  <li key={seg.id || idx} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-2xs">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-4 h-4 rounded bg-primary-theme-light text-primary-theme font-bold flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-main truncate">{seg.title}</span>
                      </span>
                      <span className="font-mono text-muted shrink-0">{mins}m</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                      <div className="h-full rounded-full bg-primary-theme" style={{ width: `${width}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </Deck>
  );
}

// ── 右栏：课前洞察（扩展点 + 内置兜底） ────────────────────────────────────

function InsightDeck({ students, onlineStudentIds, lang }: { students: any[]; onlineStudentIds: string[]; lang: string }) {
  const zh = lang === 'zh';
  // 内置简化实现：把尚未连接的席位列为「需关注」，作为插件不可用时的兜底。
  // 真正的 AI 学情诊断可由插件通过 classroom.portal.insight 槽位替换。
  const offline = students.filter((s) => !onlineStudentIds.includes(s.id)).slice(0, 2);

  return (
    <Deck
      title={zh ? 'AI 助教学情透镜' : 'AI Teaching Lens'}
      subtitle={zh ? '课前重点关注提示' : 'Pre-class attention hints'}
      aside={<Sparkles size={13} className="text-primary-theme" />}
    >
      <div className="flex flex-col gap-2">
        {offline.length === 0 ? (
          <p className="text-2xs text-muted py-3 text-center inline-flex items-center justify-center gap-1.5">
            <ShieldCheck size={12} className="text-emerald-500" />
            {zh ? '全员席位已连接，暂无需要关注的学生' : 'All seats connected — nothing needs attention'}
          </p>
        ) : (
          offline.map((student) => (
            <div
              key={student.id}
              className="rounded-xl border border-amber-200/80 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-800/70 p-2.5 flex gap-2.5"
            >
              <div className="w-7 h-7 rounded-lg bg-surface border border-amber-200/80 dark:border-amber-800/70 flex items-center justify-center font-bold text-2xs text-amber-700 dark:text-amber-300 shrink-0">
                {(student.name ?? '?').slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="text-2xs font-bold text-main truncate">
                  {student.name}
                  {student.student_number ? (
                    <span className="font-mono font-normal text-muted"> · {student.student_number}</span>
                  ) : null}
                </div>
                <p className="text-2xs text-muted leading-relaxed">
                  {zh ? '学生端尚未连接，建议课前确认设备或网络状态。' : 'Student端 not connected yet — check device or network.'}
                </p>
              </div>
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
            </div>
          ))
        )}
        {/* 插件可注册自定义课前洞察卡（如基于历史成绩的 AI 诊断） */}
        <ExtensionPointRenderer
          slot="classroom.portal.insight"
          lang={lang}
          slotProps={{ students, onlineStudentIds }}
        />
      </div>
    </Deck>
  );
}

// ── 右栏：课前自检 ─────────────────────────────────────────────────────────

function PreflightDeck({
  seatCount,
  onlineCount,
  lang,
}: {
  seatCount: number;
  onlineCount: number;
  lang: string;
}) {
  const zh = lang === 'zh';
  const { isOnline, quality } = useNetworkLatency();
  const items = [
    {
      icon: CheckCircle2,
      label: zh ? '随堂课件与代码示例同步' : 'Courseware sync',
      value: zh ? '已就绪' : 'Ready',
      ok: true,
    },
    {
      icon: Server,
      label: zh ? '学生端沙箱节点' : 'Student sandboxes',
      value: seatCount ? `${onlineCount}/${seatCount} ${zh ? '存活' : 'alive'}` : zh ? '无席位' : 'No seats',
      ok: seatCount === 0 || onlineCount > 0,
    },
    {
      icon: Radio,
      label: zh ? '互动投票与抢答器信道' : 'Interaction channel',
      value: isOnline ? (quality === 'poor' ? (zh ? '时延偏高' : 'High latency') : zh ? '双工正常' : 'Duplex OK') : zh ? '离线' : 'Offline',
      ok: isOnline,
    },
  ];

  return (
    <Deck
      title={zh ? '课前三项自检体检卡' : 'Pre-flight Checks'}
      subtitle={zh ? '开课前环境自检' : 'Environment self-check'}
      aside={
        <span
          className={`text-2xs font-bold px-1.5 py-0.5 rounded border ${
            items.every((i) => i.ok)
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/70'
              : 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/70'
          }`}
        >
          {items.every((i) => i.ok) ? 'ALL PASS' : zh ? '需注意' : 'ATTENTION'}
        </span>
      }
    >
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex items-center justify-between gap-2.5 text-2xs">
              <span className="flex items-center gap-2 min-w-0">
                <Icon size={12} className={item.ok ? 'text-emerald-500' : 'text-amber-500'} />
                <span className="text-main truncate">{item.label}</span>
              </span>
              <span className={`font-mono shrink-0 ${item.ok ? 'text-muted' : 'text-amber-600 dark:text-amber-400'}`}>
                {item.value}
              </span>
            </li>
          );
        })}
        {/* 插件可注册额外课前检查项 */}
        <ExtensionPointRenderer slot="classroom.portal.preflight" lang={lang} />
      </ul>
    </Deck>
  );
}

// ── 主组件 ─────────────────────────────────────────────────────────────────

export function ClassroomEntryPortal({
  lessons,
  classes,
  students,
  selectedLesson,
  setSelectedLesson,
  liveClassSelectedClassId,
  setLiveClassSelectedClassId,
  timelineSegments,
  onlineStudentIds,
  lang,
  addToast,
  onEnterClassroom,
  fetcher,
}: ClassroomEntryPortalProps) {
  const zh = lang === 'zh';
  const [modes, setModes] = useState<TeachingMode[]>([]);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [modesLoading, setModesLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 加载教学模式（服务端已合并内置与自定义；失败时静默降级，不阻塞开课）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchTeachingModes(fetcher);
        if (cancelled || !mountedRef.current) return;
        setModes(list);
        setSelectedModeId((prev) => prev ?? list[0]?.id ?? null);
      } catch {
        if (!cancelled && mountedRef.current) setModes([]);
      } finally {
        if (!cancelled && mountedRef.current) setModesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  const currentLesson = useMemo(
    () => lessons.find((l) => l.id === selectedLesson) ?? null,
    [lessons, selectedLesson],
  );
  const currentClass = useMemo(
    () => classes.find((c) => c.id === liveClassSelectedClassId) ?? null,
    [classes, liveClassSelectedClassId],
  );

  const onlineCount = students.filter((s) => onlineStudentIds.includes(s.id)).length;
  const readinessRate = students.length ? `${Math.round((onlineCount / students.length) * 100)}%` : '—';
  const canLaunch = Boolean(selectedLesson) && Boolean(liveClassSelectedClassId);

  const startClock = new Date();
  const zhGreeting = greetingOf(startClock.getHours(), true);
  const enGreeting = greetingOf(startClock.getHours(), false);

  const handleLaunch = useCallback(async () => {
    if (!selectedLesson || !liveClassSelectedClassId) {
      addToast?.(
        zh ? '无法开课' : 'Cannot start',
        zh ? '请先选择课程与班级' : 'Select a course and a class first',
        'warning',
      );
      return;
    }
    setLaunching(true);
    try {
      await onEnterClassroom({
        lessonId: selectedLesson,
        classId: liveClassSelectedClassId,
        teachingModeId: selectedModeId,
      });
    } catch (e) {
      addToast?.(
        zh ? '进入课堂失败' : 'Failed to enter classroom',
        e instanceof Error ? e.message : String(e),
        'error',
      );
    } finally {
      if (mountedRef.current) setLaunching(false);
    }
  }, [addToast, liveClassSelectedClassId, onEnterClassroom, selectedLesson, selectedModeId, zh]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-app text-main">
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1800px] mx-auto">
        {/* 顶部横幅 + 遥测岛 */}
        <section className="bg-surface border border-theme rounded-2xl shadow-3xs p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-2xs font-mono font-semibold px-2 py-0.5 rounded bg-surface-secondary border border-theme text-muted inline-flex items-center gap-1">
                <Clock size={10} />
                {zh ? '今日教学排期 · 准备窗口' : 'Today · Preparation window'}
              </span>
              {currentLesson && (
                <span className="text-2xs font-mono font-semibold px-2 py-0.5 rounded bg-primary-theme-light border border-primary-theme text-primary-theme inline-flex items-center gap-1">
                  <Presentation size={10} />
                  {currentLesson.title}
                </span>
              )}
            </div>
            <h1 className="text-lg font-black tracking-tight text-main">
              {zh ? `${zhGreeting}！今日课堂待开启` : `${enGreeting}! Ready to start`}
            </h1>
            <p className="text-xs text-muted mt-1 leading-relaxed max-w-2xl">
              {zh
                ? '请确认本节课程、授课班级与教学模式，确认无误后启动进入数字赋能课堂。'
                : 'Confirm the course, class and teaching mode, then launch the classroom.'}
            </p>
          </div>

          <div className="xl:w-[560px] shrink-0">
            <TelemetryIsland
              lang={lang}
              seatCount={students.length}
              onlineCount={onlineCount}
              readinessRate={readinessRate}
            />
          </div>
        </section>

        {/* 主工作区：左 8 / 右 4 */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 flex flex-col gap-4 min-w-0">
            <CourseDeck
              lessons={lessons}
              selectedLesson={selectedLesson}
              onSelect={(id) => setSelectedLesson(id)}
              lang={lang}
            />
            <ClassroomDeck
              classes={classes}
              students={students}
              selectedClassId={liveClassSelectedClassId}
              onSelectClass={(id) => setLiveClassSelectedClassId(id)}
              onlineStudentIds={onlineStudentIds}
              modes={modes}
              selectedModeId={selectedModeId}
              onSelectMode={setSelectedModeId}
              modesLoading={modesLoading}
              lang={lang}
            />
            <LaunchDeck
              lessonTitle={currentLesson?.title ?? ''}
              className={currentClass?.name ?? ''}
              seatCount={students.length}
              canLaunch={canLaunch}
              launching={launching}
              onLaunch={() => void handleLaunch()}
              lang={lang}
            />
          </div>

          <div className="xl:col-span-4 flex flex-col gap-4 min-w-0">
            <LessonBlueprint
              lessonTitle={currentLesson?.title ?? ''}
              timelineSegments={timelineSegments}
              lang={lang}
            />
            <InsightDeck students={students} onlineStudentIds={onlineStudentIds} lang={lang} />
            <PreflightDeck seatCount={students.length} onlineCount={onlineCount} lang={lang} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClassroomEntryPortal;
