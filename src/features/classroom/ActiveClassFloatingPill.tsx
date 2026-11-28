import React, { useState } from 'react';
import {
  Radio,
  ArrowRight,
  Clock,
  Users,
  Shield,
  ShieldAlert,
  MonitorPlay,
  ChevronUp,
  ChevronDown,
  Archive,
  Loader2,
  Power,
  AlertTriangle,
} from 'lucide-react';
import { useAppStore, appStore } from '../../store/appStore';
import { useLiveClassStore } from '../../store/liveClassStore';
import { useOptionalAppData } from '../../context/AppDataContext';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import { useStageDisplayWindow } from './stage-display/useStageDisplayWindow';

export interface ActiveClassFloatingPillProps {
  className?: string;
}

export function ActiveClassFloatingPill({ className = '' }: ActiveClassFloatingPillProps) {
  const appData = useOptionalAppData();
  const lang = useAppStore((s) => s.lang);
  const teacherTab = useAppStore((s) => s.teacherTab);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const lessons = useAppStore((s) => s.lessons);
  const classes = useAppStore((s) => s.classes);

  const liveClassIsActive = useLiveClassStore((s) => s.liveClassIsActive);
  const liveClassTimeRemaining = useLiveClassStore((s) => s.liveClassTimeRemaining);
  const liveClassSelectedClassId = useLiveClassStore((s) => s.liveClassSelectedClassId);
  const onlineStudentIds = useLiveClassStore((s) => s.onlineStudentIds);

  const [isMinimized, setIsMinimized] = useState(false);
  const [lockingClass, setLockingClass] = useState(false);
  /** 结束课程：选择「归档并结束」还是「直接结束」的弹层 */
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  /** 「直接结束」会级联删除会话，需二次确认 */
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [endSessionId, setEndSessionId] = useState<string | null>(null);
  const [endPhase, setEndPhase] = useState<'resolving' | 'archiving' | 'deleting' | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const { openStageWindow } = useStageDisplayWindow();
  const zh = lang === 'zh';

  // 仅当不在互动课堂页面（teacherTab !== 'live_class'）且存在正在进行的课节时显示
  const hasActiveSession = Boolean(selectedLesson && (liveClassIsActive || liveClassTimeRemaining > 0));
  if (teacherTab === 'live_class' || !hasActiveSession) {
    return null;
  }

  const currentLesson = lessons.find((l) => l.id === selectedLesson);
  const currentClass = classes.find((c) => c.id === liveClassSelectedClassId);

  const students = appData?.students || [];
  const lockedStudents = students.filter((s: any) => s.locked_lesson_id === selectedLesson);
  const isClassLocked = Boolean(liveClassSelectedClassId && lockedStudents.length > 0);

  const notify = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error' = 'success'): void => {
    appStore.getState().addToast({ id: Math.random().toString(16).slice(2), title, message, type });
  };

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleToggleClassLock = async () => {
    if (!liveClassSelectedClassId || !selectedLesson) return;
    setLockingClass(true);
    try {
      const endpoint = isClassLocked
        ? `/api/classes/${liveClassSelectedClassId}/unlock_lesson`
        : `/api/classes/${liveClassSelectedClassId}/lock_lesson`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: !isClassLocked ? JSON.stringify({ lessonId: selectedLesson, mode: 'full' }) : undefined,
      });
      if (res.ok && appData?.fetchStudents) {
        await appData.fetchStudents();
      }
    } catch (err) {
      console.error('Failed to toggle class lock from pill:', err);
    } finally {
      setLockingClass(false);
    }
  };

  const handleOpenStage = () => {
    if (!selectedLesson) return;
    openStageWindow({
      lessonId: selectedLesson,
      lessonTitle: currentLesson?.title,
      lang: lang === 'en' ? 'en' : 'zh',
    });
  };

  const closeEndDialog = () => {
    if (endPhase) return;
    setEndDialogOpen(false);
    setDeleteConfirmOpen(false);
    setEndError(null);
    setEndSessionId(null);
  };

  /** 打开结束弹层时先向服务端确认会话 id：顺手清掉「会话已结束但本地仍有残留」的悬浮胶囊。 */
  const handleOpenEndDialog = async () => {
    if (!selectedLesson) return;
    setEndDialogOpen(true);
    setEndError(null);
    setEndSessionId(null);
    setEndPhase('resolving');
    try {
      const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(selectedLesson)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as {
        hasActiveSession?: boolean;
        session?: { id?: string } | null;
      } | null;
      if (!data?.hasActiveSession || !data.session?.id) {
        appStore.getState().endLiveClassSession();
        setEndDialogOpen(false);
        notify(
          zh ? '本节课已结束' : 'Class already ended',
          zh
            ? '没有进行中的课堂会话，正在授课面板已收起。'
            : 'No active classroom session; the live pill was dismissed.',
          'info',
        );
        return;
      }
      setEndSessionId(String(data.session.id));
    } catch (err) {
      console.error('Failed to resolve classroom session from pill:', err);
      setEndError(zh ? '无法读取当前课堂会话，请稍后重试。' : 'Failed to load the current session. Please retry.');
    } finally {
      setEndPhase(null);
    }
  };

  /** 归档并结束：封存会话 → 移入「已归档战报」，随后收起悬浮胶囊。 */
  const handleArchiveAndEnd = async () => {
    if (!endSessionId) return;
    setEndPhase('archiving');
    setEndError(null);
    try {
      const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(endSessionId)}/archive`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setEndDialogOpen(false);
      appStore.getState().endLiveClassSession();
      notify(
        zh ? '归档成功，课程已结束' : 'Archived and ended',
        zh
          ? '本次课堂会话已封存并移入「已归档战报」库，可在课堂档案中回看。'
          : 'The session was sealed into the archived reports and can be reviewed there.',
        'success',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : zh ? '未知错误' : 'Unknown error';
      setEndError(message);
      notify(zh ? '归档失败' : 'Failed to archive', message, 'error');
    } finally {
      setEndPhase(null);
    }
  };

  /** 直接结束：级联删除本次课堂会话及随堂数据（不可恢复，也不会生成归档战报）。 */
  const handleDeleteAndEnd = async () => {
    if (!endSessionId) return;
    setEndPhase('deleting');
    setEndError(null);
    try {
      const res = await fetch(`/api/classroom/sessions/${encodeURIComponent(endSessionId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setDeleteConfirmOpen(false);
      setEndDialogOpen(false);
      appStore.getState().endLiveClassSession();
      notify(
        zh ? '课程已结束' : 'Class ended',
        zh
          ? '本次课堂会话及随堂数据已删除（未归档），正在授课面板已收起。'
          : 'The session and its in-class data were deleted (not archived); the live pill was dismissed.',
        'success',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : zh ? '未知错误' : 'Unknown error';
      setEndError(message);
      notify(zh ? '结束失败' : 'Failed to end the class', message, 'error');
    } finally {
      setEndPhase(null);
    }
  };

  const busy = endPhase !== null;
  const canEnd = Boolean(endSessionId) && !busy;

  return (
    <>
      <div
        id="active-class-floating-pill"
        data-testid="active-class-floating-pill"
        className={`fixed top-18 right-6 z-40 transition-all duration-200 select-none ${className}`}
      >
        <div className="bg-slate-900/90 dark:bg-slate-950/95 text-white backdrop-blur-md border border-indigo-500/40 rounded-2xl shadow-2xl p-2.5 sm:px-4 sm:py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
          {/* Live indicator */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
            </span>
            <span className="text-xs font-black tracking-wide text-rose-300 uppercase shrink-0">
              {lang === 'zh' ? '正在授课' : 'LIVE'}
            </span>
          </div>

          {/* Lesson & Class Info */}
          {!isMinimized && (
            <div className="flex items-center gap-2 max-w-[200px] sm:max-w-[260px] truncate border-l border-slate-700/80 pl-2.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-100 truncate" title={currentLesson?.title || '授课中'}>
                  {currentLesson?.title || (lang === 'zh' ? '当前课程' : 'Current Lesson')}
                </div>
                <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
                  <span>{currentClass?.name || (lang === 'zh' ? '班级授课中' : 'In Class')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Countdown & Online count */}
          {!isMinimized && (
            <div className="hidden md:flex items-center gap-2.5 border-l border-slate-700/80 pl-2.5 text-xs font-mono font-bold">
              {liveClassTimeRemaining > 0 && (
                <span
                  className="flex items-center gap-1 text-amber-300"
                  title={lang === 'zh' ? '环节剩余时间' : 'Time Remaining'}
                >
                  <Clock size={12} className="text-amber-400" />
                  <span>{formatTime(liveClassTimeRemaining)}</span>
                </span>
              )}
              <span
                className="flex items-center gap-1 text-emerald-300"
                title={lang === 'zh' ? '在线学生人数' : 'Online Students'}
              >
                <Users size={12} className="text-emerald-400" />
                <span>{onlineStudentIds.length}</span>
              </span>
            </div>
          )}

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 shrink-0 pl-1">
            {/* Quick Lock/Unlock Button */}
            {!isMinimized && liveClassSelectedClassId && (
              <button
                type="button"
                disabled={lockingClass}
                onClick={handleToggleClassLock}
                className={`p-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 shrink-0 ${
                  isClassLocked
                    ? 'bg-rose-600/80 hover:bg-rose-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                }`}
                title={
                  isClassLocked
                    ? lang === 'zh'
                      ? '全班专注锁定中，点击一键解锁'
                      : 'Class is locked. Click to unlock'
                    : lang === 'zh'
                      ? '一键全班专注锁定'
                      : 'Class Focus Lock'
                }
              >
                {isClassLocked ? <ShieldAlert size={13} /> : <Shield size={13} />}
              </button>
            )}

            {/* Open Stage Window in background */}
            {!isMinimized && (
              <button
                type="button"
                onClick={handleOpenStage}
                className="p-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer shrink-0"
                title={lang === 'zh' ? '独立展台投屏到副屏' : 'Stage Display on Second Screen'}
              >
                <MonitorPlay size={13} />
              </button>
            )}

            {/* Return to Live Class Button */}
            <button
              type="button"
              onClick={() => setTeacherTab('live_class')}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 active:scale-95 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-indigo-900/30 transition-all cursor-pointer shrink-0"
              title={lang === 'zh' ? '返回互动课堂白板（瞬时秒切）' : 'Return to Live Classroom'}
            >
              <span>{lang === 'zh' ? '返回白板' : 'Back to Whiteboard'}</span>
              <ArrowRight size={13} />
            </button>

            {/* End Class Button：选择「归档并结束」或「直接结束」 */}
            <button
              type="button"
              data-testid="active-pill-end-class-btn"
              onClick={() => void handleOpenEndDialog()}
              disabled={busy}
              className="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-rose-900/30 transition-all cursor-pointer shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
              title={
                lang === 'zh' ? '结束本次课程（可选择归档或直接结束）' : 'End this class (archive or end directly)'
              }
            >
              <Power size={13} />
              <span>{lang === 'zh' ? '结束课程' : 'End Class'}</span>
            </button>

            {/* Minimize / Expand Toggle */}
            <button
              type="button"
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title={isMinimized ? (lang === 'zh' ? '展开' : 'Expand') : lang === 'zh' ? '折叠' : 'Minimize'}
            >
              {isMinimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* 结束课程 · 选择归档或直接结束 */}
      <AccessibleDialog
        open={endDialogOpen}
        onClose={closeEndDialog}
        ariaLabelledBy="active-pill-end-title"
        variant="danger"
      >
        <DialogHeader>
          <DialogTitle
            id="active-pill-end-title"
            icon={<AlertTriangle size={18} />}
            iconVariant="danger"
            description={
              zh
                ? '归档并结束会封存本次会话并移入「已归档战报」；直接结束会删除本次会话与随堂数据，且不会生成战报。'
                : 'Archive & end seals the session into archived reports; ending directly deletes the session and its in-class data without a report.'
            }
          >
            {zh ? '结束本次课程？' : 'End this class?'}
          </DialogTitle>
          <DialogCloseButton label={zh ? '取消' : 'Cancel'} onClick={closeEndDialog} />
        </DialogHeader>

        <DialogBody>
          <p className="text-xs text-secondary">
            {endPhase === 'resolving'
              ? zh
                ? '正在读取当前课堂会话…'
                : 'Loading the current classroom session…'
              : zh
                ? '建议选择「归档并结束」以保留本节学情与课堂动态；若数据无需留存再选择「直接结束」。'
                : 'Prefer “Archive & end” to keep this lesson’s data. Choose “End directly” only when the records are disposable.'}
          </p>
          {endError && (
            <p className="mt-2 text-xs text-rose-500" role="alert">
              {endError}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogButton variant="secondary" autoFocus onClick={closeEndDialog} disabled={busy}>
            {zh ? '取消' : 'Cancel'}
          </DialogButton>
          <DialogButton variant="primary" onClick={() => void handleArchiveAndEnd()} disabled={!canEnd}>
            {endPhase === 'archiving' ? (
              <>
                <Loader2 size={13} className="animate-spin mr-1" />
                {zh ? '归档中…' : 'Archiving…'}
              </>
            ) : (
              <>
                <Archive size={13} className="mr-1" />
                {zh ? '归档并结束' : 'Archive & End'}
              </>
            )}
          </DialogButton>
          <DialogButton
            variant="danger"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={!canEnd}
            data-testid="active-pill-end-direct-btn"
          >
            <Power size={13} className="mr-1" />
            {zh ? '直接结束' : 'End Directly'}
          </DialogButton>
        </DialogFooter>
      </AccessibleDialog>

      {/* 直接结束 · 删除不可恢复，二次确认 */}
      <AccessibleDialog
        open={deleteConfirmOpen}
        onClose={() => {
          if (!endPhase) setDeleteConfirmOpen(false);
        }}
        ariaLabelledBy="active-pill-delete-title"
        variant="danger"
      >
        <DialogHeader>
          <DialogTitle
            id="active-pill-delete-title"
            icon={<AlertTriangle size={18} />}
            iconVariant="danger"
            description={
              zh
                ? '本次课堂会话及其随堂数据（即时投票、结课通票、课堂动态、互评等）将被永久删除，且不会生成归档战报。此操作不可撤销。'
                : 'This session and its in-class data (polls, exit tickets, feed, peer review…) will be permanently deleted with no archived report. This cannot be undone.'
            }
          >
            {zh ? '确认直接结束课程？' : 'End this class without archiving?'}
          </DialogTitle>
          <DialogCloseButton
            label={zh ? '取消' : 'Cancel'}
            onClick={() => {
              if (!endPhase) setDeleteConfirmOpen(false);
            }}
          />
        </DialogHeader>

        <DialogFooter>
          <DialogButton variant="secondary" autoFocus onClick={() => setDeleteConfirmOpen(false)} disabled={busy}>
            {zh ? '取消' : 'Cancel'}
          </DialogButton>
          <DialogButton variant="danger" onClick={() => void handleDeleteAndEnd()} disabled={!canEnd}>
            {endPhase === 'deleting' ? (
              <>
                <Loader2 size={13} className="animate-spin mr-1" />
                {zh ? '删除中…' : 'Deleting…'}
              </>
            ) : zh ? (
              '确认删除并结束'
            ) : (
              'Delete & End'
            )}
          </DialogButton>
        </DialogFooter>
      </AccessibleDialog>
    </>
  );
}
