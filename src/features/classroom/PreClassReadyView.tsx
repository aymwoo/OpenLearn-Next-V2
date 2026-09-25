import React, { useState, useEffect } from 'react';
import {
  Play,
  Users,
  CheckCircle2,
  Clock,
  Sparkles,
  Send,
  Bell,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ExternalLink,
  ListChecks,
  AlertCircle,
  Activity,
  Layers,
  FileText,
  Volume2,
  HelpCircle,
  QrCode,
  KeyRound,
} from 'lucide-react';
import type { StudentType } from '../../types/app';
import { PreClassDiagnosticHub } from './PreClassDiagnosticHub';
import { PreflightHealthModal } from './PreflightHealthModal';

export interface PreClassReadyViewProps {
  selectedLesson: string | null;
  lessonTitle: string;
  selectedClassId: string | null;
  className: string;
  students: StudentType[];
  onlineStudentIds: string[];
  timelineSegments: any[];
  lang: 'zh' | 'en';
  isClassLocked: boolean;
  onToggleClassLock: () => void;
  onStartClass: () => void;
  onPingStudent?: (studentId: string, message?: string) => void;
  onOpenStudentWindow: () => void;
  isStudentWindowOpen: boolean;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onBroadcastNotice?: (msg: string) => void;
}

export function PreClassReadyView({
  selectedLesson,
  lessonTitle,
  selectedClassId,
  className,
  students,
  onlineStudentIds,
  timelineSegments,
  lang,
  isClassLocked,
  onToggleClassLock,
  onStartClass,
  onPingStudent,
  onOpenStudentWindow,
  isStudentWindowOpen,
  addToast,
  onBroadcastNotice,
}: PreClassReadyViewProps) {
  const [isHealthModalOpen, setIsHealthModalOpen] = useState(false);
  const [dynamicCode, setDynamicCode] = useState(() => Math.floor(1000 + Math.random() * 9000).toString());
  const [codeCountdown, setCodeCountdown] = useState(5);

  // 动态签到码每 5 秒平滑轮换更新，防代签
  useEffect(() => {
    const timer = setInterval(() => {
      setCodeCountdown((prev) => {
        if (prev <= 1) {
          setDynamicCode(Math.floor(1000 + Math.random() * 9000).toString());
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Pre-flight preparation checklists
  const [checklist, setChecklist] = useState<Record<string, boolean>>({
    resources: true,
    audioVideo: true,
    sandbox: true,
    objective: true,
  });

  // Warm-up thought starter message
  const [warmupText, setWarmupText] = useState(
    lang === 'zh'
      ? '请同学们打开课本对应单元，准备好随堂笔记本，并保持网络通畅。'
      : 'Please open your course materials and ensure your screen is active.',
  );
  const [isBroadcastingNotice, setIsBroadcastingNotice] = useState(false);
  const [markedPresentIds, setMarkedPresentIds] = useState<Set<string>>(new Set());

  const toggleCheck = (key: string) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleBroadcastWarmup = () => {
    if (!warmupText.trim()) return;
    setIsBroadcastingNotice(true);
    if (onBroadcastNotice) {
      onBroadcastNotice(warmupText);
    }
    setTimeout(() => {
      setIsBroadcastingNotice(false);
      addToast(
        lang === 'zh' ? '📢 课前提示已广播' : '📢 Warm-up Notice Sent',
        lang === 'zh' ? '全班学生屏幕已接收到课前热身提示。' : 'Notice sent to all student screens.',
        'success',
      );
    }, 400);
  };

  const handleMarkAllPresent = () => {
    const allIds = new Set(students.map((s) => s.id));
    setMarkedPresentIds(allIds);
    addToast(
      lang === 'zh' ? '✓ 全员签到就绪' : '✓ All Marked Ready',
      lang === 'zh' ? `已将全班 ${students.length} 名学生标记为课前签到。` : 'Marked all students ready.',
      'success',
    );
  };

  const toggleStudentCheckin = (id: string) => {
    setMarkedPresentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Metrics
  const totalCount = students.length;
  const onlineCount = students.filter((s) => onlineStudentIds.includes(s.id)).length;
  const readyCount = students.filter((s) => onlineStudentIds.includes(s.id) || markedPresentIds.has(s.id)).length;
  const readyPercent = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;
  const totalDuration = timelineSegments.reduce((acc, cur) => acc + (cur.duration || 300), 0);
  const durationMins = Math.round(totalDuration / 60);

  return (
    <div id="pre-class-ready-view" className="flex-1 flex flex-col min-h-0 bg-surface-secondary/20 p-4 gap-4 overflow-y-auto">
      {/* 1. Header Banner: Hero Call-to-Action */}
      <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Clock size={24} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                {lang === 'zh' ? '阶段 1 / 4 · 课前准备与就绪' : 'Stage 1/4 · Pre-Class Preparation'}
              </span>
              <span className="text-xs text-muted flex items-center gap-1 font-mono">
                <Activity size={11} className="text-emerald-500" />
                {lang === 'zh' ? '预备就绪中' : 'Standby'}
              </span>
            </div>
            <h1 className="text-lg font-black text-main tracking-tight mt-1 flex items-center gap-2">
              <span>{lessonTitle || (lang === 'zh' ? '未选定课程' : 'Untitled Lesson')}</span>
              {className && (
                <span className="text-xs font-semibold px-2 py-0.5 bg-surface-secondary rounded-lg border border-theme text-muted">
                  {className}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {lang === 'zh'
                ? `预计授课时长: ${durationMins} 分钟 · 共 ${timelineSegments.length} 个教学环节 · 白板仅在进入课中授课时展示`
                : `Est. Duration: ${durationMins} mins · ${timelineSegments.length} segments · Whiteboard activates in-class`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap w-full md:w-auto justify-end">
          {/* Pre-flight Environmental Healthcheck Button */}
          <button
            id="pre-class-healthcheck-btn"
            type="button"
            onClick={() => setIsHealthModalOpen(true)}
            className="px-3 py-2 text-xs font-bold rounded-xl border border-teal-500/30 bg-teal-50/60 dark:bg-teal-950/20 text-teal-700 dark:text-teal-300 hover:bg-teal-100/60 dark:hover:bg-teal-900/40 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
            title={lang === 'zh' ? '一键自检局域网延迟、课件与沙箱健康度' : 'Environmental Healthcheck'}
          >
            <ShieldCheck size={14} className="text-teal-600 dark:text-teal-400" />
            <span>{lang === 'zh' ? '环境一键飞检' : 'Healthcheck'}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </button>

          <button
            id="pre-class-open-student-tab-btn"
            type="button"
            onClick={onOpenStudentWindow}
            className={`px-3 py-2 text-xs font-bold rounded-xl border border-theme transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs hover:bg-surface-secondary ${
              isStudentWindowOpen ? 'text-emerald-600 border-emerald-500/40 bg-emerald-50/50' : 'text-main'
            }`}
          >
            <ExternalLink size={13} />
            <span>{isStudentWindowOpen ? (lang === 'zh' ? '学生端已联动' : 'Student Linked') : (lang === 'zh' ? '学生视角联动Tab' : 'Student Tab')}</span>
          </button>

          <button
            id="pre-class-toggle-lock-btn"
            type="button"
            onClick={onToggleClassLock}
            disabled={!selectedClassId}
            className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs disabled:opacity-50 ${
              isClassLocked
                ? 'bg-rose-500/10 text-rose-600 border-rose-500/30 hover:bg-rose-500/20'
                : 'bg-surface-secondary text-muted border-theme hover:text-main'
            }`}
          >
            {isClassLocked ? <ShieldAlert size={13} className="text-rose-500" /> : <Shield size={13} />}
            <span>{isClassLocked ? (lang === 'zh' ? '全班专注已锁定' : 'Focus Locked') : (lang === 'zh' ? '预设专注锁定' : 'Preset Lock')}</span>
          </button>

          {/* Primary Action Button: Enter In-Class Teaching */}
          <button
            id="pre-class-start-teaching-btn"
            type="button"
            onClick={onStartClass}
            className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold rounded-xl text-xs flex items-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
          >
            <Play size={14} className="fill-white" />
            <span>{lang === 'zh' ? '一键开启课中授课 (进入白板)' : 'Start In-Class Teaching (Launch Whiteboard)'}</span>
          </button>
        </div>
      </div>

      {/* 2. Main Content Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Left Column (5 cols): Diagnostic Hub & Checklist */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Pre-lesson Diagnostic Hub: Top 3 Mistake Concepts & Video Prep */}
          <PreClassDiagnosticHub
            lessonId={selectedLesson}
            classId={selectedClassId}
            lang={lang}
          />

          {/* Card: Pre-flight Checklist */}
          <div className="bg-surface border border-theme rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-theme pb-2.5">
              <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                <ListChecks size={14} className="text-primary-theme" />
                <span>{lang === 'zh' ? '备课预检与教学就绪项' : 'Pre-flight Readiness Checklist'}</span>
              </span>
              <span className="text-xs text-muted font-semibold">
                {Object.values(checklist).filter(Boolean).length} / 4 就绪
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <label
                onClick={() => toggleCheck('resources')}
                className="flex items-start gap-2.5 p-2.5 rounded-xl border border-theme/60 hover:bg-surface-secondary/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checklist.resources}
                  onChange={() => {}}
                  className="mt-0.5 rounded text-primary-theme focus:ring-primary-theme cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-xs font-bold text-main">{lang === 'zh' ? '课件与互动资源已就绪' : 'Courseware & Resources Ready'}</div>
                  <div className="text-[11px] text-muted">{lang === 'zh' ? '已校验实验沙箱、微前端挂载点及白板插槽' : 'Sandbox and extensions verified'}</div>
                </div>
                {checklist.resources && <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />}
              </label>

              <label
                onClick={() => toggleCheck('audioVideo')}
                className="flex items-start gap-2.5 p-2.5 rounded-xl border border-theme/60 hover:bg-surface-secondary/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checklist.audioVideo}
                  onChange={() => {}}
                  className="mt-0.5 rounded text-primary-theme focus:ring-primary-theme cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-xs font-bold text-main">{lang === 'zh' ? '广播同步信道与大屏投屏' : 'Broadcast & Stage Mirroring'}</div>
                  <div className="text-[11px] text-muted">{lang === 'zh' ? 'Socket.IO 实时通信广播就绪，全屏大屏展台待命' : 'Real-time WebSocket connection active'}</div>
                </div>
                {checklist.audioVideo && <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />}
              </label>

              <label
                onClick={() => toggleCheck('sandbox')}
                className="flex items-start gap-2.5 p-2.5 rounded-xl border border-theme/60 hover:bg-surface-secondary/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checklist.sandbox}
                  onChange={() => {}}
                  className="mt-0.5 rounded text-primary-theme focus:ring-primary-theme cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-xs font-bold text-main">{lang === 'zh' ? '安全沙箱与专注模式策略' : 'Sandbox & Anti-Distraction Guard'}</div>
                  <div className="text-[11px] text-muted">{lang === 'zh' ? 'iframe CSP 隔离与学生端防作弊专注锁定待发' : 'CSP frame sandbox configured'}</div>
                </div>
                {checklist.sandbox && <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />}
              </label>

              <label
                onClick={() => toggleCheck('objective')}
                className="flex items-start gap-2.5 p-2.5 rounded-xl border border-theme/60 hover:bg-surface-secondary/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checklist.objective}
                  onChange={() => {}}
                  className="mt-0.5 rounded text-primary-theme focus:ring-primary-theme cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-xs font-bold text-main">{lang === 'zh' ? '教学目标与重难点梳理' : 'Key Teaching Goals Set'}</div>
                  <div className="text-[11px] text-muted">{lang === 'zh' ? '导入、探究、练习与评价环节时序已锚定' : 'Segments timing calibrated'}</div>
                </div>
                {checklist.objective && <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />}
              </label>
            </div>
          </div>

          {/* Card: Segments Timeline Overview */}
          <div className="bg-surface border border-theme rounded-2xl p-4 shadow-sm flex flex-col gap-2.5 flex-1 min-h-[180px]">
            <div className="flex items-center justify-between border-b border-theme pb-2">
              <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                <Layers size={14} className="text-primary-theme" />
                <span>{lang === 'zh' ? '授课环节大纲预演' : 'Segments Timeline Preview'}</span>
              </span>
              <span className="text-[11px] text-muted font-mono">{timelineSegments.length} 个环节</span>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto pr-1">
              {timelineSegments.length > 0 ? (
                timelineSegments.map((seg, idx) => (
                  <div
                    key={seg.id || idx}
                    className="p-2.5 rounded-xl bg-surface-secondary/60 border border-theme/70 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-lg bg-primary-theme/10 text-primary-theme font-black flex items-center justify-center text-[10px] shrink-0">
                        {idx + 1}
                      </span>
                      <div className="truncate">
                        <div className="font-bold text-main truncate">{seg.title}</div>
                        {seg.description && <div className="text-[10px] text-muted truncate">{seg.description}</div>}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-muted shrink-0 flex items-center gap-1">
                      <Clock size={10} />
                      {Math.round((seg.duration || 300) / 60)} 分钟
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-xs text-muted italic">
                  {lang === 'zh' ? '暂未配置环节大纲，系统将在课中按默认时长授课' : 'No custom segments'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): Student Attendance Roster & Warm-up Broadcast */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Card: Student Attendance & Readiness Status */}
          <div className="bg-surface border border-theme rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-theme pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                  <Users size={14} className="text-primary-theme" />
                  <span>{lang === 'zh' ? '学生到课与设备就绪监控' : 'Student Readiness & Attendance'}</span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-primary-theme/10 text-primary-theme border border-primary-theme/20">
                  {readyCount} / {totalCount} ({readyPercent}%)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMarkAllPresent}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface-secondary hover:bg-surface border border-theme text-main transition-colors cursor-pointer"
                >
                  {lang === 'zh' ? '全员标记已就绪' : 'Mark All Ready'}
                </button>
              </div>
            </div>

            {/* Quick Readiness Progress Bar */}
            <div className="w-full bg-surface-secondary h-2 rounded-full overflow-hidden border border-theme/40">
              <div
                className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full transition-all duration-500"
                style={{ width: `${readyPercent}%` }}
              />
            </div>

            {/* Dynamic Anti-Proxy OTP Checkin Banner */}
            <div className="p-2.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <KeyRound size={16} />
                </div>
                <div>
                  <div className="font-bold text-main flex items-center gap-1.5">
                    <span>{lang === 'zh' ? '防代签动态签到码' : 'Dynamic Check-in OTP'}</span>
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono font-bold">
                      ({codeCountdown}s 后滚动)
                    </span>
                  </div>
                  <div className="text-[10px] text-muted">
                    {lang === 'zh' ? '学生端在就绪屏输入该验证码或扫码即可秒就绪' : 'Students input code or scan to check in'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="px-3 py-1 bg-white dark:bg-slate-900 border-2 border-indigo-500 rounded-lg text-lg font-black font-mono text-indigo-600 dark:text-indigo-400 tracking-widest shadow-2xs">
                  {dynamicCode}
                </div>
              </div>
            </div>

            {/* Students Table / Grid */}
            <div className="max-h-[260px] overflow-y-auto border border-theme/70 rounded-xl divide-y divide-border/60 bg-surface-secondary/20">
              {students.length > 0 ? (
                students.map((st) => {
                  const isOnline = onlineStudentIds.includes(st.id);
                  const isMarked = markedPresentIds.has(st.id);
                  const isReady = isOnline || isMarked;

                  return (
                    <div
                      key={st.id}
                      className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-surface-secondary transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isOnline ? 'bg-emerald-500 shadow-xs shadow-emerald-500/50' : 'bg-slate-300 dark:bg-slate-600'
                          }`}
                          title={isOnline ? '在线连接活跃' : '离线未连入'}
                        />
                        <span className="font-bold text-main truncate">{st.name}</span>
                        {st.student_number && (
                          <span className="font-mono text-[10px] text-muted">({st.student_number})</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleStudentCheckin(st.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                            isReady
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                          }`}
                        >
                          {isReady ? (lang === 'zh' ? '✓ 已就绪' : 'Ready') : (lang === 'zh' ? '未就绪' : 'Pending')}
                        </button>

                        <button
                          type="button"
                          onClick={() => onPingStudent?.(st.id, lang === 'zh' ? '请尽快进入课堂' : 'Please join class')}
                          className="p-1 text-muted hover:text-primary-theme hover:bg-surface rounded transition-colors cursor-pointer"
                          title={lang === 'zh' ? '给该学生发送连接提醒' : 'Ping Student'}
                        >
                          <Bell size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-muted italic">
                  {lang === 'zh' ? '该班级暂未关联学生名单' : 'No students found for this class'}
                </div>
              )}
            </div>
          </div>

          {/* Card: Warm-up Broadcast to Student Screens */}
          <div className="bg-surface border border-theme rounded-2xl p-4 shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-500" />
                <span>{lang === 'zh' ? '课前热身提示与学生端广播' : 'Pre-Class Warm-up Notice'}</span>
              </span>
              <span className="text-[11px] text-muted">{lang === 'zh' ? '实时推送至学生待命屏' : 'Pushed to student stand-by UI'}</span>
            </div>

            <div className="flex flex-col gap-2">
              <textarea
                value={warmupText}
                onChange={(e) => setWarmupText(e.target.value)}
                rows={2}
                placeholder={lang === 'zh' ? '输入广播给全班学生的课前热身指导...' : 'Type a warm-up prompt for students...'}
                className="w-full bg-surface-secondary border border-theme rounded-xl p-2.5 text-xs text-main placeholder-muted focus:ring-1 focus:ring-primary-theme outline-none resize-none"
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[11px] text-muted">
                  <span>{lang === 'zh' ? '预设提示：' : 'Presets:'}</span>
                  <button
                    type="button"
                    onClick={() => setWarmupText(lang === 'zh' ? '请大家翻到课本对应章节，准备思考探究题。' : 'Open chapter materials.')}
                    className="hover:text-primary-theme underline cursor-pointer"
                  >
                    {lang === 'zh' ? '预备教材' : 'Textbook'}
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setWarmupText(lang === 'zh' ? '课前思考：如何用生活中的常见现象解释本节核心定律？' : 'Pre-class thought starter')}
                    className="hover:text-primary-theme underline cursor-pointer"
                  >
                    {lang === 'zh' ? '思考题' : 'Question'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleBroadcastWarmup}
                  disabled={isBroadcastingNotice || !warmupText.trim()}
                  className="px-3.5 py-1.5 bg-primary-theme hover:bg-primary-theme-hover text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Send size={12} />
                  <span>{isBroadcastingNotice ? (lang === 'zh' ? '广播中...' : 'Sending...') : (lang === 'zh' ? '广播到学生端' : 'Broadcast to Students')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PreflightHealthModal
        isOpen={isHealthModalOpen}
        onClose={() => setIsHealthModalOpen(false)}
        classId={selectedClassId}
        className={className}
        lang={lang}
      />
    </div>
  );
}
