import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { classroomMacroEngine } from '../ecosystem/macro-engine/classroom-macro-engine';
import type { ClassroomSyncChannel } from '../../../services/classroom-sync-channel';
import type { TeacherMiddleTab } from '../map-teacher-middle-tab';

export function useLiveClassroomMacroEngine(options: {
  macroRuntimeRef: MutableRefObject<{
    selectedLesson: string | null;
    classId: string | null;
    lang: string;
    toggleLock: (lock: boolean, mode?: 'full' | 'navigation') => Promise<void>;
    fetchAttempts: () => void;
    addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  }>;
  syncChannelRef: MutableRefObject<ClassroomSyncChannel | null>;
  setLiveClassFeed: Dispatch<SetStateAction<any[]>>;
  setMiddleTab: (tab: TeacherMiddleTab) => void;
  setCollabInitialGalleryMode: (v: boolean) => void;
  setIsGroupCollabOpen: (v: boolean) => void;
}) {
  const {
    macroRuntimeRef,
    syncChannelRef,
    setLiveClassFeed,
    setMiddleTab,
    setCollabInitialGalleryMode,
    setIsGroupCollabOpen,
  } = options;

  useEffect(() => {
    classroomMacroEngine.setStepExecutor(async (step) => {
      const ctx = macroRuntimeRef.current;
      const appendFeed = (message: string, type: 'info' | 'warning' = 'info') => {
        setLiveClassFeed((prev) => [
          {
            id: `macro-${step.id}-${Date.now()}`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            type,
            message,
          },
          ...prev,
        ]);
      };

      switch (step.actionType) {
        case 'BROADCAST_NOTIFICATION': {
          const msg = String(step.payload?.message || step.title);
          syncChannelRef.current?.broadcastMacroNotification(msg, step.title);
          appendFeed(`[宏动作] 广播全班：${msg}`);
          ctx.addToast(step.title, msg, 'info');
          break;
        }
        case 'LOCK_STUDENT_SCREENS': {
          const lockMode: 'full' | 'navigation' = step.payload?.subCanvasReadOnly ? 'navigation' : 'full';
          if (ctx.classId && ctx.selectedLesson) {
            await ctx.toggleLock(true, lockMode);
          } else {
            appendFeed(`[宏动作] ${step.title}（未选择班级，跳过远端锁屏请求）`, 'warning');
          }
          break;
        }
        case 'START_COUNTDOWN': {
          const duration = Number(step.payload?.durationSeconds) || 180;
          window.dispatchEvent(
            new CustomEvent('openlearn:countdown:trigger_start', {
              detail: { duration, label: step.title },
            }),
          );
          appendFeed(`[宏动作] 已启动全班倒计时（${duration} 秒）`);
          break;
        }
        case 'NAVIGATE_VIEW': {
          const target = String(step.payload?.target || '');
          if (target === 'top_performers_leaderboard') {
            setMiddleTab('top_performers');
          } else if (target === 'submissions') {
            setMiddleTab('submissions');
          } else {
            setMiddleTab('whiteboard');
          }
          appendFeed(`[宏动作] 主工作区已切换至 ${target || 'whiteboard'}`);
          break;
        }
        case 'AUTO_COLLECT_QUIZ': {
          ctx.fetchAttempts();
          setMiddleTab('submissions');
          syncChannelRef.current?.broadcastMacroNotification(
            ctx.lang === 'zh' ? '随堂检测时间到，已触发自动收卷与作答汇总！' : 'Time up! Collecting quiz responses.',
            step.title,
          );
          appendFeed(`[宏动作] 已刷新并切换至实时作答汇总清单`);
          break;
        }
        case 'OPEN_GALLERY_WALK': {
          setCollabInitialGalleryMode(true);
          setIsGroupCollabOpen(true);
          const duration = Number(step.payload?.durationSeconds);
          if (duration > 0) {
            window.dispatchEvent(
              new CustomEvent('openlearn:countdown:trigger_start', {
                detail: { duration, label: step.title },
              }),
            );
          }
          appendFeed(`[宏动作] 已开启小组协作画廊互评展台`);
          break;
        }
        case 'HIGHLIGHT_WHITEBOARD': {
          setMiddleTab('whiteboard');
          window.dispatchEvent(
            new CustomEvent('openlearn:whiteboard:focus', {
              detail: { zoomScale: Number(step.payload?.zoomScale) || 1.25 },
            }),
          );
          syncChannelRef.current?.broadcastMacroNotification(
            ctx.lang === 'zh' ? '老师已在主屏黑板聚焦核心讲解区域，请注意观看！' : 'Focus on main whiteboard!',
            step.title,
          );
          ctx.addToast(
            step.title,
            ctx.lang === 'zh' ? '已切回主屏白板并广播课堂聚焦提示。' : 'Focused whiteboard and notified class.',
            'info',
          );
          appendFeed(`[宏动作] 教师白板已切回聚焦视图`);
          break;
        }
      }
      return true;
    });
    return () => {
      classroomMacroEngine.setStepExecutor(async () => true);
    };
  }, [
    macroRuntimeRef,
    syncChannelRef,
    setLiveClassFeed,
    setMiddleTab,
    setCollabInitialGalleryMode,
    setIsGroupCollabOpen,
  ]);
}
