// server/event-routing.ts
//
// 内核事件 → Socket.IO 投递的**声明式路由表**。
//
// 取代此前 `realtime-bridge.ts` 里逐条手写 `eventBus.subscribe(...)` 的做法：
// 过去每加一种事件都要在 bridge 里再写一个订阅块，事件名在点号风格与短横线
// 风格之间被隐式改写（`whiteboard.element_drawn` → `whiteboard-sync`），且
// `eventId / correlationId / type` 在投递时全部丢失，前端无法串联同一条业务流。
//
// 现在：一条事件 = 表里一行声明。路由集中、可枚举、可单测。
// 投递时统一附加 `_meta`（事件 ID / 类型 / 来源 / 时间 / correlationId），
// 便于前端做去重、排序与「迟到学生补齐上下文」。

import type { Server } from 'socket.io';
import type { PlatformEvent } from '../packages/core/event-bus/index.js';

/**
 * Minimal structural view of the kernel database the routes need.
 * Mirrors the `better-sqlite3` `prepare().get()/.run()` surface so routes can
 * be unit-tested with an in-memory mock.
 */
export interface RouteDb {
  prepare(sql: string): {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
}

export interface SocketRouteDeps {
  io: Server;
  db: RouteDb;
}

/** 内核事件元信息，随 socket payload 的 `_meta` 字段下发。 */
export interface EventMeta {
  eventId: string;
  type: string;
  source: string;
  timestamp: number;
  correlationId?: string;
}

export interface SocketRoute<TPayload = any> {
  /** 内核事件类型（点号 + 过去式）。 */
  readonly eventType: string;
  /** 下发给前端的 Socket 事件名。缺省应与内核名一致（事件名守恒）。 */
  readonly socketEvent: string;
  /**
   * 目标房间。`null` 表示全局广播；返回空数组表示「只执行 effect，不投递」。
   */
  readonly rooms: (event: PlatformEvent<TPayload>) => string[] | null;
  /** payload 转换。默认原样透传 `event.payload`。 */
  readonly map?: (event: PlatformEvent<TPayload>, deps: SocketRouteDeps) => unknown;
  /** 投递前执行的副作用（落库等）。 */
  readonly effect?: (event: PlatformEvent<TPayload>, deps: SocketRouteDeps) => void;
  /** 是否附加 `_meta`（默认 true）。关闭仅用于严格兼容旧前端契约的路由。 */
  readonly attachMeta?: boolean;
  /** 人类可读说明，供审计与排障。 */
  readonly description: string;
}

export const WHITEBOARD_BROADCAST_ROOM = 'whiteboard-broadcast';

const TITLE_SQL = 'SELECT title FROM assignments WHERE id = ?';
const ELEMENT_SQL = 'SELECT * FROM whiteboard_elements WHERE id = ?';
const SCHEDULE_SQL = 'SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1';
const ROLLCALL_EXISTS_SQL = 'SELECT id FROM student_rollcalls WHERE id = ?';
const ROLLCALL_INSERT_SQL =
  'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)';

function lessonRoom(event: PlatformEvent<any>): string[] | null {
  const lessonId = event.payload?.lessonId;
  return typeof lessonId === 'string' && lessonId ? [lessonId] : [];
}

function lessonAndBroadcastRooms(event: PlatformEvent<any>): string[] | null {
  const rooms = lessonRoom(event);
  return rooms === null || rooms.length === 0 ? [] : [...rooms, WHITEBOARD_BROADCAST_ROOM];
}

function refreshMessage(event: PlatformEvent<any>) {
  return { roomId: event.payload?.lessonId, type: 'refresh' as const };
}

/**
 * 点名元素落库 + 广播 `student-picked`。
 * 逻辑逐行保持与原有实现一致（含幂等：同一 rollcallId 只插入一次）。
 */
function handleRollcallElement(elementId: string, deps: SocketRouteDeps): void {
  try {
    const el = deps.db.prepare(ELEMENT_SQL).get(elementId) as any;
    if (!el || el.type !== 'rollcall') return;

    const elData = JSON.parse(el.data);
    if (!elData?.selectedStudent || elData.status !== 'picked') return;

    const studentId = elData.selectedStudent.id;
    const studentName = elData.selectedStudent.name;
    let classId: string = elData.classId || '';
    const lessonId = el.lesson_id;

    if (!classId && lessonId) {
      const sched = deps.db.prepare(SCHEDULE_SQL).get(lessonId) as any;
      if (sched) classId = sched.class_id;
    }

    const pickedTimeStr = elData.pickedTime || new Date().toISOString();
    const pickedTime = new Date(pickedTimeStr).getTime();
    const rollcallId = `rollcall-${elementId}-${pickedTime}`;

    const exists = deps.db.prepare(ROLLCALL_EXISTS_SQL).get(rollcallId);
    if (exists) return;

    deps.db.prepare(ROLLCALL_INSERT_SQL).run(rollcallId, studentId, classId, lessonId, pickedTime);
    console.log(`[Rollcall] Saved rollcall for student ${studentId} (${studentName})`);

    deps.io.emit('student-picked', {
      rollcallId,
      studentId,
      studentName,
      classId,
      lessonId,
      pickedTime,
    });
  } catch (e) {
    console.error('Error handling rollcall element:', e);
  }
}

export const SOCKET_ROUTES: readonly SocketRoute[] = [
  // ── 作业批改 ────────────────────────────────────────────────────────────
  {
    eventType: 'assignment.graded',
    socketEvent: 'assignment-graded-toast',
    rooms: () => null,
    map: (event, deps) => {
      const payload = event.payload as any;
      const assignment = deps.db.prepare(TITLE_SQL).get(payload.assignmentId) as any;
      return {
        assignmentId: payload.assignmentId,
        assignmentTitle: assignment ? assignment.title : 'Assignment',
        studentId: payload.studentId,
        score: payload.score,
        feedback: payload.feedback || '',
      };
    },
    description: '作业批改完成 → 全局 Toast（含作业标题）',
  },

  // ── 白板协同 ────────────────────────────────────────────────────────────
  // 注意：`whiteboard-sync` 是历史遗留的 socket 事件名（前端仍在监听），
  // 因此这里显式声明而非沿用内核事件名。待前端迁移到 `whiteboard.element_drawn`
  // 后可改为事件名守恒。
  {
    eventType: 'whiteboard.element_drawn',
    socketEvent: 'whiteboard-sync',
    rooms: lessonAndBroadcastRooms,
    map: refreshMessage,
    effect: (event, deps) => {
      if ((event.payload as any)?.type === 'rollcall') {
        handleRollcallElement((event.payload as any).elementId, deps);
      }
    },
    description: '白板元素新增 → 课节房间 + 广播房间刷新（点名元素另落库）',
  },
  {
    eventType: 'whiteboard.element_updated',
    socketEvent: 'whiteboard-sync',
    rooms: () => [],
    effect: (event, deps) => handleRollcallElement((event.payload as any)?.elementId, deps),
    description: '白板元素更新 → 仅处理点名落库，不触发全量刷新',
  },
  {
    eventType: 'whiteboard.batch_drawn',
    socketEvent: 'whiteboard-sync',
    rooms: lessonRoom,
    map: refreshMessage,
    description: '白板批量绘制 → 课节房间刷新',
  },
  {
    eventType: 'whiteboard.element_deleted',
    socketEvent: 'whiteboard-sync',
    rooms: lessonRoom,
    map: refreshMessage,
    description: '白板元素删除 → 课节房间刷新',
  },
  {
    eventType: 'whiteboard.cleared',
    socketEvent: 'whiteboard-sync',
    rooms: lessonRoom,
    map: refreshMessage,
    description: '白板清空 → 课节房间刷新',
  },
  {
    eventType: 'whiteboard.quiz_answered',
    socketEvent: 'whiteboard-quiz-answered',
    rooms: () => null,
    description: '随堂练习作答 → 全局广播（教师/学生面板均可摄取）',
  },

  // ── 课堂状态 ────────────────────────────────────────────────────────────
  {
    eventType: 'classroom.lock_changed',
    socketEvent: 'class-lock-status-changed',
    rooms: () => null,
    description: '全班锁屏/解锁 → 全局广播',
  },
  {
    eventType: 'student.notification_acknowledged',
    socketEvent: 'student-acknowledged',
    rooms: () => null,
    description: '学生已读通知 → 全局广播',
  },
  {
    eventType: 'student.progress_updated',
    socketEvent: 'student-progress-updated',
    rooms: () => null,
    description: '学生课节进度变化 → 全局广播',
  },
  {
    eventType: 'courseware.attempt_updated',
    socketEvent: 'courseware-attempt-updated',
    rooms: () => null,
    description: '课件 attempt 日志/提交/认领 → 全局广播（仅失效通知，客户端需回拉）',
  },
  {
    eventType: 'lesson.progress_mode_changed',
    socketEvent: 'lesson-progress-mode-changed',
    rooms: () => null,
    description: '课节进度模式切换 → 全局广播',
  },
  {
    eventType: 'points.awarded',
    socketEvent: 'classroom:points_awarded',
    rooms: () => null,
    description: '课堂归因加分/扣分变更 → 全局广播',
  },

  // ── 聚焦（spotlight）────────────────────────────────────────────────────
  // 历史遗留：内核侧同时存在 `spotlight:state_updated`（冒号）与
  // `spotlight.state_updated`（点号）两种拼写，两者都投递到同一个 socket 名。
  // 收敛命名时会一并清理，此处先双轨保持兼容。
  {
    eventType: 'spotlight:state_updated',
    socketEvent: 'spotlight:state_updated',
    rooms: () => null,
    description: '聚焦状态更新（旧冒号拼写）→ 全局广播',
  },
  {
    eventType: 'spotlight.state_updated',
    socketEvent: 'spotlight:state_updated',
    rooms: () => null,
    description: '聚焦状态更新（点号拼写）→ 全局广播',
  },
];

function buildMeta(event: PlatformEvent): EventMeta {
  const meta: EventMeta = {
    eventId: event.id,
    type: event.type,
    source: event.source,
    timestamp: event.timestamp,
  };
  if (event.correlationId) meta.correlationId = event.correlationId;
  return meta;
}

/**
 * 附加 `_meta`。仅对「普通对象」payload 生效——基本类型与数组没有空间挂字段，
 * 强行包装会破坏既有前端契约，因此直接原样透传。
 */
function attachMeta(payload: unknown, event: PlatformEvent): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), _meta: buildMeta(event) };
}

/**
 * 创建一个「内核事件 → Socket」派发器。同一事件类型重复注册会直接抛错，
 * 避免两张路由表互相覆盖却无人察觉。
 */
export function createRouteDispatcher(routes: readonly SocketRoute[], deps: SocketRouteDeps) {
  const byType = new Map<string, SocketRoute>();
  for (const route of routes) {
    if (byType.has(route.eventType)) {
      throw new Error(`[event-routing] duplicate socket route for event type "${route.eventType}"`);
    }
    byType.set(route.eventType, route);
  }

  return function dispatch(event: PlatformEvent): void {
    const route = byType.get(event.type);
    if (!route) return;

    try {
      route.effect?.(event, deps);

      const mapped = route.map ? route.map(event, deps) : event.payload;
      const payload = route.attachMeta === false ? mapped : attachMeta(mapped, event);

      const rooms = route.rooms(event);
      if (rooms === null) {
        deps.io.emit(route.socketEvent, payload);
        return;
      }
      for (const room of rooms) {
        if (room) deps.io.to(room).emit(route.socketEvent, payload);
      }
    } catch (e) {
      console.error(`[event-routing] Error dispatching "${event.type}" to "${route.socketEvent}":`, e);
    }
  };
}
