import React, { useState, type MutableRefObject } from 'react';
import { School, ArrowLeftRight, Edit3, Eye, Shield, ShieldAlert, FileEdit } from 'lucide-react';
import { uiStore } from '../../store/uiStore';
import { liveClassStore } from '../../store/liveClassStore';
import { classLockHint } from './class-session-lock';
import { ClassroomToolbarQuickActions } from './ClassroomToolbarQuickActions';
import { ClassroomCountdownWidget } from './ClassroomCountdownWidget';
import type { LockMode } from '../../types/app';
import type { ClassroomSyncChannel } from '../../services/classroom-sync-channel';
import { rememberActiveLesson } from './live-class-resume-memory';

export function LiveClassroomHeaderBar({
  lang,
  liveClassIsActive,
  classes,
  liveClassSelectedClassId,
  userReturnedToPortalRef,
  enteredClassroomRef,
  setEntryDecisionReady,
  setShowSessionPicker,
  setShowEntryPortal,
  setShowSessionManager,
  pendingLessonId,
  setPendingLessonId,
  lessons,
  selectedLesson,
  setIsSwitchLessonConfirmOpen,
  handleEditLesson,
  handleOpenStudentWindow,
  isStudentWindowOpen,
  isClassLocked,
  classLockMode,
  handleToggleClassLock,
  lockingClass,
  setIsDiagnosticCenterOpen,
  setIsMasteryPredictionOpen,
  setCollabInitialGalleryMode,
  setIsGroupCollabOpen,
  setIsShowcaseDiffOpen,
  setIsPeerReviewShowcaseOpen,
  setIsParentNotificationOpen,
  setIsMacroRunnerOpen,
  setIsHardwareSettingsOpen,
  syncChannelRef,
  onlineStudentIds,
  liveClassAcknowledgedMap,
  setLiveClassIsActive,
  addToast,
  prevTimerRunningRef,
  compact = false,
}: {
  lang: string;
  liveClassIsActive: boolean;
  classes: { id: string; name: string }[];
  liveClassSelectedClassId: string | null;
  userReturnedToPortalRef: MutableRefObject<boolean>;
  enteredClassroomRef: MutableRefObject<boolean>;
  setEntryDecisionReady: (v: boolean) => void;
  setShowSessionPicker: (v: boolean) => void;
  setShowEntryPortal: (v: boolean) => void;
  setShowSessionManager: (v: boolean) => void;
  pendingLessonId: string | null;
  setPendingLessonId: (v: string | null) => void;
  lessons: { id: string; title: string }[];
  selectedLesson: string | null;
  setIsSwitchLessonConfirmOpen: (v: boolean) => void;
  handleEditLesson: (lessonId: string) => void;
  handleOpenStudentWindow: () => void;
  isStudentWindowOpen: boolean;
  isClassLocked: boolean;
  classLockMode: LockMode;
  handleToggleClassLock: (lock: boolean, mode?: 'full' | 'navigation') => Promise<void>;
  lockingClass: boolean;
  setIsDiagnosticCenterOpen: (v: boolean) => void;
  setIsMasteryPredictionOpen: (v: boolean) => void;
  setCollabInitialGalleryMode: (v: boolean) => void;
  setIsGroupCollabOpen: (v: boolean) => void;
  setIsShowcaseDiffOpen: (v: boolean) => void;
  setIsPeerReviewShowcaseOpen: (v: boolean) => void;
  setIsParentNotificationOpen: (v: boolean) => void;
  setIsMacroRunnerOpen: (v: boolean) => void;
  setIsHardwareSettingsOpen: (v: boolean) => void;
  syncChannelRef: MutableRefObject<ClassroomSyncChannel | null>;
  onlineStudentIds: string[];
  liveClassAcknowledgedMap: Map<string, boolean>;
  setLiveClassIsActive: (v: boolean) => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  prevTimerRunningRef: MutableRefObject<boolean>;
  /** 白板课：默认只留课题、计时和锁定，其余收进「更多」。 */
  compact?: boolean;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const showSecondary = !compact || moreOpen;
  const lessonTitle =
    lessons.find((item) => item.id === selectedLesson)?.title || (lang === 'zh' ? '未选择课节' : 'No lesson');
  const onTimeRemainingChange = (timeRemaining: number, isRunning: boolean) => {
    const wasRunning = prevTimerRunningRef.current;
    prevTimerRunningRef.current = isRunning;
    liveClassStore.getState().setLiveClassTimeRemaining(timeRemaining);
    if (wasRunning !== isRunning) {
      setLiveClassIsActive(isRunning);
      if (wasRunning && !isRunning) {
        addToast(
          lang === 'zh' ? '⏰ 环节时间到' : '⏰ Phase Timer Ended',
          lang === 'zh'
            ? '当前教学环节设定的时间已耗尽，建议转入下一环节。'
            : 'The current segment duration has elapsed. Transition recommended.',
          'warning',
        );
      }
    }
    syncChannelRef.current?.broadcastSyncTimer(timeRemaining, isRunning);
  };

  return (
    <div className="bg-surface-secondary px-4 py-2.5 border-b border-theme flex items-center justify-between gap-3 shrink-0 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-2.5 select-none shrink-0 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-3 h-3 rounded-full ${liveClassIsActive ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'} absolute`}
            />
            <span className={`w-2 h-2 rounded-full ${liveClassIsActive ? 'bg-emerald-500' : 'bg-rose-500'} relative`} />
          </div>
          {compact ? (
            <h1
              data-testid="teacher-learning-topic"
              className="text-base font-semibold tracking-tight text-main truncate max-w-[14rem] sm:max-w-xs"
            >
              {lessonTitle}
            </h1>
          ) : (
            <h2 className="text-sm font-extrabold tracking-tight text-main flex items-center gap-2 shrink-0">
              {lang === 'zh' ? '🔴 在线课堂' : '🔴 Live Classroom'}
            </h2>
          )}
        </div>

        <div
          id="live-classroom-current-class-badge"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-theme/10 border border-primary-theme/25 text-primary-ink text-xs font-bold select-none shrink-0"
          title={classLockHint(lang)}
          role="status"
        >
          <School size={12} className="shrink-0" />
          <span className="truncate max-w-[120px] sm:max-w-[160px]">
            {classes.find((c) => c.id === liveClassSelectedClassId)?.name ||
              (lang === 'zh' ? '未分配班级' : 'No Class')}
          </span>
          <span data-testid="live-class-lock-hint" className="text-xs font-semibold text-muted truncate max-w-[140px]">
            {classLockHint(lang)}
          </span>
        </div>
        {showSecondary ? (
          <div
            id="teacher-whiteboard-more-panel"
            data-testid="teacher-whiteboard-more-panel"
            data-open="true"
            className="flex items-center gap-1.5"
          >
            <button
              type="button"
              id="live-classroom-back-to-portal"
              onClick={() => {
                userReturnedToPortalRef.current = true;
                enteredClassroomRef.current = false;
                rememberActiveLesson(null);
                setEntryDecisionReady(true);
                setShowSessionPicker(false);
                setShowEntryPortal(true);
              }}
              className="inline-flex items-center text-xs font-medium px-2 py-1 rounded-lg border border-theme text-muted hover:text-main hover:bg-surface shrink-0 cursor-pointer"
              title={
                lang === 'zh'
                  ? '回到起始门户。进行中的课不能换班'
                  : 'Back to the start portal. In-progress lessons stay on this class.'
              }
            >
              {lang === 'zh' ? '返回门户' : 'Back to portal'}
            </button>
            <button
              type="button"
              id="live-classroom-open-sessions"
              onClick={() => setShowSessionManager(true)}
              className="inline-flex items-center text-xs font-medium px-2 py-1 rounded-lg border border-theme text-muted hover:text-main hover:bg-surface shrink-0 cursor-pointer"
              title={lang === 'zh' ? '管理课堂历史与进行中会话' : 'Manage classroom sessions'}
            >
              {lang === 'zh' ? '会话档案' : 'Sessions'}
            </button>
            <button
              type="button"
              id="live-classroom-open-drawer"
              onClick={() => uiStore.getState().setClassroomDrawerTab('plugins')}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-theme text-muted hover:text-primary-theme hover:bg-surface shrink-0 cursor-pointer"
              title={lang === 'zh' ? '课中快捷设置抽屉（插件/班级/系统设置免切白板）' : 'In-Class Settings Drawer'}
            >
              <span>⚙️</span>
              <span>{lang === 'zh' ? '课中设置' : 'Settings'}</span>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              <select
                id="live-classroom-lesson-select"
                aria-label={lang === 'zh' ? '选择授课课程' : 'Select lesson to teach'}
                value={pendingLessonId || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? null : e.target.value;
                  setPendingLessonId(val);
                }}
                className="bg-surface border border-theme rounded-lg text-xs font-semibold px-2.5 py-1.5 focus:ring-1 focus:ring-primary-theme text-main outline-none cursor-pointer hover:bg-surface-secondary transition-colors max-w-[180px] sm:max-w-[240px] truncate"
              >
                <option value="">{lang === 'zh' ? '-- 选择授课课节 --' : '-- Select Lesson --'}</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                id="live-classroom-switch-lesson-btn"
                disabled={!pendingLessonId || pendingLessonId === selectedLesson}
                onClick={() => setIsSwitchLessonConfirmOpen(true)}
                className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  pendingLessonId && pendingLessonId !== selectedLesson
                    ? 'bg-primary-solid hover:opacity-90 text-white shadow-2xs ring-1 ring-primary-theme/50 active:scale-95'
                    : 'bg-surface border border-theme/60 text-muted opacity-45 cursor-not-allowed'
                }`}
                title={
                  pendingLessonId && pendingLessonId !== selectedLesson
                    ? lang === 'zh'
                      ? '点击切换上课课程（将弹出确认框）'
                      : 'Switch lesson (confirmation needed)'
                    : lang === 'zh'
                      ? '在下拉框选择不同课程后点击切换'
                      : 'Select a different lesson to switch'
                }
              >
                <ArrowLeftRight size={12} />
                <span>{lang === 'zh' ? '切换' : 'Switch'}</span>
              </button>

              {selectedLesson && (
                <button
                  type="button"
                  onClick={() => handleEditLesson(selectedLesson)}
                  title={lang === 'zh' ? '进入此课程的课程编辑器' : 'Edit lesson in Lesson Editor'}
                  className="inline-flex items-center gap-1 bg-surface border border-theme hover:border-primary-theme hover:bg-surface-secondary text-main text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <Edit3 size={12} />
                  <span>{lang === 'zh' ? '编辑' : 'Edit'}</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        {compact ? (
          <ClassroomCountdownWidget
            variant="header"
            lessonId={selectedLesson}
            lang={lang === 'zh' ? 'zh' : 'en'}
            syncChannel={syncChannelRef.current}
            onlineStudentCount={onlineStudentIds?.length || liveClassAcknowledgedMap.size || 0}
            onTimeRemainingChange={onTimeRemainingChange}
          />
        ) : null}
        {showSecondary ? (
          <button
            onClick={handleOpenStudentWindow}
            className={`w-8 h-8 rounded-lg transition-all cursor-pointer flex items-center justify-center relative shadow-sm active:scale-95 shrink-0 ${
              isStudentWindowOpen
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400/50 shadow-emerald-500/20'
                : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white'
            }`}
            title={
              lang === 'zh'
                ? isStudentWindowOpen
                  ? '学生端已联动 (独立Tab) - 点击激活'
                  : '学生视角预览 (独立Tab) - 在新窗口中联动打开'
                : isStudentWindowOpen
                  ? 'Student Linked (Focus Tab)'
                  : 'Student Preview (New Tab)'
            }
            aria-label={
              lang === 'zh'
                ? isStudentWindowOpen
                  ? '学生端已联动 (独立Tab)'
                  : '学生视角预览 (独立Tab)'
                : isStudentWindowOpen
                  ? 'Student Linked (Focus Tab)'
                  : 'Student Preview (New Tab)'
            }
          >
            <Eye size={16} />
            {isStudentWindowOpen && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
            )}
          </button>
        ) : null}
        {isClassLocked ? (
          <div className="inline-flex rounded-lg shadow-sm shrink-0">
            <button
              onClick={() => handleToggleClassLock(false)}
              disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
              className={`px-3 py-1.5 rounded-l-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0 text-white ${
                classLockMode === 'navigation' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
              title={
                lang === 'zh'
                  ? `${classLockMode === 'navigation' ? '答题锁定中' : '专注锁定中'} · 点击一键解锁全班`
                  : `${classLockMode === 'navigation' ? 'Answer Lock Active' : 'Focus Lock Active'} · Click to unlock`
              }
            >
              {classLockMode === 'navigation' ? <FileEdit size={12} /> : <ShieldAlert size={12} />}
              <span>
                {classLockMode === 'navigation'
                  ? lang === 'zh'
                    ? '答题锁定 · 解锁'
                    : 'Answer Lock · Unlock'
                  : lang === 'zh'
                    ? '专注锁定 · 解锁'
                    : 'Focus Lock · Unlock'}
              </span>
            </button>
            <button
              onClick={() => handleToggleClassLock(true, classLockMode === 'navigation' ? 'full' : 'navigation')}
              disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
              className={`px-2 py-1.5 rounded-r-lg font-bold text-[11px] flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0 text-white border-l border-white/20 ${
                classLockMode === 'navigation' ? 'bg-amber-700 hover:bg-amber-800' : 'bg-rose-700 hover:bg-rose-800'
              }`}
              title={
                classLockMode === 'navigation'
                  ? lang === 'zh'
                    ? '切换为全班专注锁定（只读跟随，禁止交互）'
                    : 'Switch to Full Focus Lock'
                  : lang === 'zh'
                    ? '切换为全班答题锁定（放开作答，禁止离开）'
                    : 'Switch to Answer Lock'
              }
            >
              <ArrowLeftRight size={11} />
              <span>
                {classLockMode === 'navigation'
                  ? lang === 'zh'
                    ? '切专注'
                    : 'To Focus'
                  : lang === 'zh'
                    ? '切答题'
                    : 'To Answer'}
              </span>
            </button>
          </div>
        ) : (
          <div className="inline-flex rounded-lg shadow-sm shrink-0">
            <button
              onClick={() => handleToggleClassLock(true, 'full')}
              disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
              className="px-2.5 py-1.5 rounded-l-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
              title={
                lang === 'zh'
                  ? '全班专注锁定（只读跟随，限制离开）'
                  : 'Class Focus Lock (Read-only, navigation restricted)'
              }
            >
              <Shield size={12} />
              <span>{lang === 'zh' ? '全班专注' : 'Focus Lock'}</span>
            </button>
            <button
              onClick={() => handleToggleClassLock(true, 'navigation')}
              disabled={lockingClass || !selectedLesson || !liveClassSelectedClassId}
              className="px-2.5 py-1.5 rounded-r-lg font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-l border-amber-700 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
              title={
                lang === 'zh'
                  ? '全班答题锁定（允许正常作答与输入，限制离开）'
                  : 'Class Answer Lock (Allow interaction/submissions, navigation restricted)'
              }
            >
              <FileEdit size={12} />
              <span>{lang === 'zh' ? '答题锁定' : 'Answer Lock'}</span>
            </button>
          </div>
        )}

        {showSecondary ? (
          <ClassroomToolbarQuickActions
            lang={lang as any}
            showUtilities={!compact}
            onOpenDiagnosticCenter={() => setIsDiagnosticCenterOpen(true)}
            onOpenMasteryPrediction={() => setIsMasteryPredictionOpen(true)}
            onOpenGroupCollab={() => {
              setCollabInitialGalleryMode(false);
              setIsGroupCollabOpen(true);
            }}
            onOpenShowcaseDiff={() => setIsShowcaseDiffOpen(true)}
            onOpenPeerReviewShowcase={() => setIsPeerReviewShowcaseOpen(true)}
            onOpenParentNotification={() => setIsParentNotificationOpen(true)}
            onOpenMacroRunner={() => setIsMacroRunnerOpen(true)}
            onOpenHardwareSettings={() => setIsHardwareSettingsOpen(true)}
            onOpenInContextDrawer={(tab) => uiStore.getState().setClassroomDrawerTab(tab || 'plugins')}
            selectedLesson={selectedLesson}
            syncChannel={syncChannelRef.current}
            onlineStudentCount={onlineStudentIds?.length || liveClassAcknowledgedMap.size || 0}
            onTimeRemainingChange={onTimeRemainingChange}
          />
        ) : null}
        {compact ? (
          <button
            type="button"
            data-testid="teacher-whiteboard-more"
            aria-expanded={moreOpen}
            aria-controls="teacher-whiteboard-more-panel"
            onClick={() => setMoreOpen((open) => !open)}
            className="rounded-full px-3 py-1.5 text-sm font-medium cursor-pointer bg-white text-gray-800 border border-gray-200"
          >
            {lang === 'zh' ? '更多' : 'More'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
