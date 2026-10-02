/**
 * useClassroomLive — 实时课堂互动横幅/动态流/在线名册（C1-R2f）。
 *
 * 原 App.tsx 内联 state 与两个 effect 迁入；ClassroomSyncChannel 学生订阅
 * effect（依赖视图收口）仍留在 App.tsx（红线：不可合并/搬迁）。
 */
import { useEffect, useState } from 'react';

export function useClassroomLive() {
  const [pickedAlertData, setPickedAlertData] = useState<{
    studentId: string;
    studentName: string;
    rollcallId?: string;
  } | null>(null);
  const [pickedAnnouncement, setPickedAnnouncement] = useState<{ studentName: string; studentId: string } | null>(null);

  // 全班随机抽问横幅自动消失（8秒后自动淡出）
  useEffect(() => {
    if (pickedAnnouncement) {
      const timer = setTimeout(() => {
        setPickedAnnouncement(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [pickedAnnouncement]);

  // 被抽中学生端着重播放提示音效（Web Audio API）
  useEffect(() => {
    if (pickedAlertData) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(587.33, now); // D5
          osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.25); // A5
          gain.gain.setValueAtTime(0.25, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.8);
        }
      } catch (_) {}
    }
  }, [pickedAlertData]);

  const [liveClassTimeRemaining, setLiveClassTimeRemaining] = useState(0);
  const [liveClassFeed, setLiveClassFeed] = useState<any[]>([]);
  const [liveClassAcknowledgedMap, setLiveClassAcknowledgedMap] = useState<Map<string, boolean>>(new Map());
  const [onlineStudentIds, setOnlineStudentIds] = useState<string[]>([]);
  const [activeStudentLessons, setActiveStudentLessons] = useState<Record<string, string>>({});

  return {
    pickedAlertData,
    setPickedAlertData,
    pickedAnnouncement,
    setPickedAnnouncement,
    liveClassTimeRemaining,
    setLiveClassTimeRemaining,
    liveClassFeed,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    onlineStudentIds,
    setOnlineStudentIds,
    activeStudentLessons,
    setActiveStudentLessons,
  };
}
