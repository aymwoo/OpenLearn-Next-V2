/**
 * 大屏展台数据源
 *
 * 设计目标（对应「打开大屏展台新开一个窗口并保持连接」）：
 *  - **Socket 主导**：展台独立窗口常驻副屏/投影，必须"一直连着"，不能靠教师
 *    手动刷新。原实现是 2s 轮询 —— 既不是真连接，又在高分辨率副屏上持续空转。
 *    现改为监听课堂事件即时拉取。
 *  - **低频轮询兜底**：Socket 可能因为网络抖动 / 事件在断连窗口内发生而漏事件，
 *    保留一条低频（默认 20s）对账通道，保证最终一致。
 *  - **连接状态可见**：展台常驻无人看管，连接断开必须让教师一眼看到（投影上
 *    投出去的内容如果已经过期，是会被学生看到的）。
 *
 * 独立窗口与教师端同源（window.open），共享会话 cookie，因此无需额外鉴权。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getOptionalSocket } from '../../../services/socket-service';

export interface StageAttendance {
  /** 全平台在线学生数（不限本班） */
  online: number;
  /** 本班在线学生数 */
  onlineInClass: number;
  /** 应到（班级名单人数） */
  expected: number;
  /** 实到（有过课堂痕迹的人数） */
  attended: number;
}

export interface StageFeedItem {
  id: string;
  type: string;
  message: string;
  actorName: string | null;
  at: number;
}

export interface StageCoursewareStats {
  attempts: number;
  participants: number;
  completed: number;
  /** 平均完成度（0-100） */
  avgCompletion: number;
}

export interface StageDisplayData {
  stage: string;
  checkinCode: string | null;
  activePoll: any;
  activeBuzzer: any;
  pacing: { TOO_FAST: number; CONFUSED: number; CLEAR: number };
  classId?: string | null;
  sessionId?: string | null;
  stageStartedAt?: number | null;
  attendance?: StageAttendance;
  feed?: StageFeedItem[];
  courseware?: StageCoursewareStats;
  exitTicketSubmitted?: number;
  [k: string]: unknown;
}

export const EMPTY_STAGE_DATA: StageDisplayData = {
  stage: 'IN_CLASS_TEACHING',
  checkinCode: null,
  activePoll: null,
  activeBuzzer: null,
  pacing: { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 },
  classId: null,
  sessionId: null,
  stageStartedAt: null,
  attendance: { online: 0, onlineInClass: 0, expected: 0, attended: 0 },
  feed: [],
  courseware: { attempts: 0, participants: 0, completed: 0, avgCompletion: 0 },
  exitTicketSubmitted: 0,
};

/** 连接健康度 */
export type FeedHealth = 'live' | 'reconnecting' | 'polling' | 'error';

export interface StageFeed {
  data: StageDisplayData;
  health: FeedHealth;
  /** 最近一次成功取数的时刻（null = 从未成功） */
  lastSyncedAt: number | null;
  /** 手动触发一次同步 */
  refresh: () => Promise<void>;
}

/**
 * 课堂事件 → 需要立即拉取最新快照。
 * 覆盖：阶段推进、投票开始/更新/结束、抢答开始/出赢家/重置、倒计时、节奏信号、
 * 结课通票提交、动态流追加、点名校验。
 */
const LIVE_EVENTS = [
  'classroom:stage_changed',
  'classroom:quick_poll_started',
  'classroom:quick_poll_updated',
  'classroom:quick_poll_closed',
  'classroom:buzzer_ready',
  'classroom:buzzer_winner',
  'classroom:buzzer_reset',
  'classroom:pacing_updated',
  'classroom:countdown_updated',
  'classroom:exit_ticket_submitted',
  'classroom:feed_appended',
  'classroom:pulse_check_requested',
] as const;

/** 对账轮询间隔：Socket 漏事件时的兜底，同时让倒计时/时钟类数据不会长时间不更新 */
const RECONCILE_INTERVAL_MS = 20_000;

export function useStageDisplayFeed(
  lessonId: string | null,
  options: { enabled?: boolean; reconcileMs?: number } = {},
): StageFeed {
  const { enabled = true, reconcileMs = RECONCILE_INTERVAL_MS } = options;

  const [data, setData] = useState<StageDisplayData>(EMPTY_STAGE_DATA);
  const [health, setHealth] = useState<FeedHealth>('polling');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // 请求代次：避免慢响应覆盖新响应（展台在高频事件下会出现并发拉取）
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!lessonId) return;
    const seq = ++seqRef.current;
    try {
      const res = await fetch(`/api/classroom/stage/${encodeURIComponent(lessonId)}/data`);
      if (!res.ok) throw new Error(`stage data HTTP ${res.status}`);
      const json = (await res.json()) as StageDisplayData;
      if (!mountedRef.current || seq !== seqRef.current) return;
      // 接口可能省略 pacing 字段，合并默认值避免右侧栏渲染时读到 undefined
      setData({ ...EMPTY_STAGE_DATA, ...json, pacing: { ...EMPTY_STAGE_DATA.pacing, ...(json.pacing || {}) } });
      setLastSyncedAt(Date.now());
      setHealth((h) => (h === 'reconnecting' ? 'live' : h === 'error' ? 'polling' : h));
    } catch (e) {
      if (!mountedRef.current) return;
      // 拉取失败不抛给 UI：展台要继续展示上一次的好数据，同时用 health 暴露异常
      setHealth((h) => (h === 'live' ? 'reconnecting' : h));
      console.warn('[StageDisplay] sync failed:', e);
    }
  }, [lessonId]);

  // 首次 + 低频对账
  useEffect(() => {
    if (!enabled || !lessonId) return;
    void refresh();
    const timer = setInterval(() => void refresh(), reconcileMs);
    return () => clearInterval(timer);
  }, [enabled, lessonId, reconcileMs, refresh]);

  // Socket 主导的实时通道
  useEffect(() => {
    if (!enabled || !lessonId) return;

    const socket = getOptionalSocket();
    if (!socket) {
      // 没有 socket 实例（测试环境 / 连接尚未建立）：退化为纯轮询，功能不缺失
      setHealth('polling');
      return;
    }

    // 合并多个事件的同一次刷新，避免事件密集时打出一串请求
    let pending: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        void refresh();
      }, 120);
    };

    const handlers = LIVE_EVENTS.map((evt) => {
      const handler = (payload: any) => {
        // 只关心本课节的事件（倒计时/部分事件不带 lessonId，一并接受）
        const payloadLesson = payload?.lessonId;
        if (payloadLesson && payloadLesson !== lessonId) return;
        scheduleRefresh();
      };
      socket.on(evt, handler);
      return [evt, handler] as const;
    });

    const onConnect = () => {
      setHealth('live');
      void refresh();
    };
    const onDisconnect = () => setHealth('reconnecting');
    const onConnectError = () => setHealth('reconnecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    // 已连接时标记为 live。
    // 刻意**不**在这里再调一次 refresh：首次同步已由上面的轮询 effect 负责，
    // 重复调用会让每次挂载都多打一个请求（曾被测试抓到）。
    if (socket.connected) {
      setHealth('live');
    }

    return () => {
      for (const [evt, handler] of handlers) socket.off(evt, handler);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      if (pending) clearTimeout(pending);
    };
  }, [enabled, lessonId, refresh]);

  return { data, health, lastSyncedAt, refresh };
}
