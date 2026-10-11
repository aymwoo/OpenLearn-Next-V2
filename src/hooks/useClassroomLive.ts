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
  const [liveClassFeedRaw, setLiveClassFeedRaw] = useState<any[]>([]);
  // v0.6.1 审计 R-7：feed 写入即截断至最近 200 条 —— 此前无上限（40 人班级
  // 按 2s 一条进度事件计一小时约 7.2 万条）且渲染层整表 map，每条新事件
  // 全量重渲染。服务端 feed_replay 本就是有界窗口（最近 12 条），200 条
  // 对课堂时间轴足够。
  const setLiveClassFeed = (
    updater: any[] | ((prev: any[]) => any[]),
  ): void => {
    setLiveClassFeedRaw((prev: any[]) => {
      const next = typeof updater === 'function' ? (updater as (p: any[]) => any[])(prev) : updater;
      return Array.isArray(next) && next.length > 200 ? next.slice(0, 200) : next;
    });
  };
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
    liveClassFeed: liveClassFeedRaw,
    setLiveClassFeed,
    liveClassAcknowledgedMap,
    setLiveClassAcknowledgedMap,
    onlineStudentIds,
    setOnlineStudentIds,
    activeStudentLessons,
    setActiveStudentLessons,
  };
}
