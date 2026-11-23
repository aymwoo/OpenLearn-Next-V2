/**
 * 课堂倒计时的统一回落逻辑：写入 liveClassStore、同步「课堂进行中」状态并广播计时。
 * 顶栏快捷工具与白板工具栏里的倒计时共用同一份实现，避免两处行为漂移。
 */
import { liveClassStore } from '../../store/liveClassStore';
import type { ClassroomSyncChannel } from '../../services/classroom-sync-channel';

export interface LiveTimeRemainingDeps {
  lang: string;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  prevTimerRunningRef: { current: boolean };
  setLiveClassIsActive: (v: boolean) => void;
  syncChannelRef: { current: ClassroomSyncChannel | null };
}

export function createLiveTimeRemainingHandler(deps: LiveTimeRemainingDeps) {
  return (timeRemaining: number, isRunning: boolean) => {
    const wasRunning = deps.prevTimerRunningRef.current;
    deps.prevTimerRunningRef.current = isRunning;
    liveClassStore.getState().setLiveClassTimeRemaining(timeRemaining);
    if (wasRunning !== isRunning) {
      deps.setLiveClassIsActive(isRunning);
      if (wasRunning && !isRunning) {
        deps.addToast(
          deps.lang === 'zh' ? '⏰ 环节时间到' : '⏰ Phase Timer Ended',
          deps.lang === 'zh'
            ? '当前教学环节设定的时间已耗尽，建议转入下一环节。'
            : 'The current segment duration has elapsed. Transition recommended.',
          'warning',
        );
      }
    }
    deps.syncChannelRef.current?.broadcastSyncTimer(timeRemaining, isRunning);
  };
}
