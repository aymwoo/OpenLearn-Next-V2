import type { Server } from 'socket.io';
import type { EventBusPort } from '../packages/core/event-bus/index.js';
import { lessonActiveSegments, setActiveSegment } from './shared-state.js';
import { segmentGateService } from './services/segment-gate-service.js';
import { randomId } from './utils/id.js';
import { createLogger } from '../packages/core/observability/logger.js';
import { kernelContainer } from '../packages/core/kernel/index.js';
import { CLASS_LOCK_MESSAGE, loadInProgressSessionClass, loadLessonClassId } from './services/classroom-class-lock.js';

const plog = createLogger('presence');
export interface PresenceDeps {
  io: Server;
  eventBus: EventBusPort;
  /**
   * 查询学生所属的班级 id 列表。
   *
   * 学生 socket 在 `register-student` 时会被加入每个 `class-<classId>` 房间，
   * 使教师端的课堂广播（如白板最大化视图同步）**不再依赖学生当前停留在哪个视图**：
   * 学生在作业工作区时会 `leave-lesson`，互动课件/作业标签页也随时可能卸载白板，
   * 仅靠课节房间会让这些学生收不到广播。
   *
   * 缺省不传时退化为“仅课节房间投递”，保持向后兼容。
   */
  lookupStudentClassIds?: (studentId: string) => string[];
  /**
   * 查询课节当前（最近一次）开课的班级 id；无课堂会话返回 null。
   *
   * SEC-AUTH：`join-room` / `enter-lesson` 需用它判定学生与课节房间的归属
   * （课节房间本身无前缀、与班级无直接外键，映射在 classroom_sessions）。
   * 缺省不传时学生对课节房间不设限，保持向后兼容。
   */
  lookupLessonClassId?: (lessonId: string) => string | null;
  /**
   * 查询教师（或管理员）拥有的班级 id 列表。
   *
   * Issue #242：#212 将课堂事件改为房间定向投递后，教师加入班级房间只剩
   * 前端 syncPresenceAndRooms（socket connect 时刻）一条路径，而教师主 socket
   * 在 connect 时并不知道自己在哪个班级（liveClassSelectedClassId 刷新即清空）
   * —— 教师停留在作业中心/课表时，assignment.submitted 等班级事件静默丢失。
   * 教师 socket 连接时按此清单自动加入所属班级房间，与学生 register-student
   * 的同构逻辑对齐。缺省不传时教师不自动加入班级房间，保持向后兼容。
   */
  lookupTeacherClassIds?: (userId: string) => string[];
  /**
   * 查询教师名下活跃（未归档）课节的 lessonId 列表。
   *
   * progress_mode_changed / quiz_answered 等事件仅投课节房间（payload 不带
   * classId），仅加入班级房间覆盖不到。教师连接时按此清单自动加入课节房间，
   * 使其停留在任意视图都能收到自己课堂的实时事件。
   * 缺省不传时不自动加入课节房间，保持向后兼容。
   */
  lookupTeacherLessonIds?: (userId: string) => string[];
}

/** 班级房间名。与课节房间（直接用 lessonId）互不冲突。 */
export const classRoom = (classId: string): string => `class-${classId}`;

/**
 * 教师/管理员专用的在线状态房间名。
 *
 * `presence-update` 携带全校在线学生 ID 及「学生 → 当前课节」映射，属于教师端的
 * 监控数据。历史上用 `io.emit` 发给全部连接，任何学生登录后都能在 WebSocket 帧里
 * 看到其他班级的在线情况（Issue #133）。现收敛为：连接时仅 `isTeacherOrAdmin`
 * 自动加入本房间，学生永不加入；`presence-update` 只投递到这里。
 */
export const PRESENCE_STAFF_ROOM = 'presence-staff';

/**
 * 全局白板广播房间名。
 *
 * 每个客户端在连接时都会 `join-room 'whiteboard-broadcast'`（见
 * `useClassroomSocket.syncPresenceAndRooms`），**不依赖当前停留在哪个视图**。
 * 这与班级房间同理：学生在仪表盘 / 作业工作区 / 课件标签页时都可能没 join 课节房间，
 * 仅投课节房间会让这些学生收不到白板变更。
 */
export const WHITEBOARD_BROADCAST_ROOM = 'whiteboard-broadcast';

/**
 * 用户私有房间前缀。
 *
 * 连接时按 session.userId 自动加入，仅服务端可投递（客户端 `join-room` 一律拒绝）。
 * 用于账户级/个人事件：作业评分、积分到账、课件 attempt、点名确认等。
 */
export const USER_ROOM_PREFIX = 'user-';
export const userRoom = (userId: string): string => `${USER_ROOM_PREFIX}${userId}`;

/**
 * 是否为「真实课节」房间。
 *
 * 作业工作区会给白板挂一个按学生隔离的**伪课节** id：
 * `assignment-<assignmentId>-student-<studentId>`（`StudentAssignmentWorkPanel`）。
 * 它不是一节课，不能进任何常驻广播房间：
 * - 每个客户端都会收到，本无意义地重拉；
 * - 更糟的是客户端处理器在「当前没有选中课节」时会执行
 *   `setSelectedLesson(roomId)` + `setStudentViewStatus('lesson')`，
 *   把学生拉进一个并不存在的课节视图。
 *
 * 伪课节仍投递到它自己的房间即可 —— 在该作业工作区的学生会正确收到。
 */
export function isRealLessonRoom(roomId: string): boolean {
  return !roomId.startsWith('assignment-');
}

/**
 * 解析作业工作区伪课节 `assignment-<assignmentId>-student-<studentId>` 中的 studentId。
 * 非伪课节返回 null。学生客户端只允许写/加入绑定**自己**的伪课节房间（SEC-AUTH）。
 */
export function pseudoRoomStudentId(roomId: string): string | null {
  if (typeof roomId !== 'string' || !roomId.startsWith('assignment-')) return null;
  const marker = '-student-';
  const idx = roomId.lastIndexOf(marker);
  return idx >= 0 ? roomId.slice(idx + marker.length) : null;
}

/** 课堂事件的定向投递目标。缺省只投课节房间。 */
export interface ClassroomEventTarget {
  /** 事件所属班级。课节开课时必须传，保证已离开课节视图的班级成员仍能收到。 */
  classId?: string | null;
  /** 需要定向投递的个人（被点名学生、积分获得者等），投到各自的 `user-<id>` 房间。 */
  userIds?: Array<string | null | undefined>;
  /** 是否同时投给教师/管理员房间（学生不可见的监控类事件）。 */
  staff?: boolean;
}

/**
 * 课堂事件的投递房间。
 *
 * 历史问题：服务端曾把课堂事件投到 `lesson-${lessonId}`（**带前缀**，无人加入），
 * 再靠紧随其后的全局 `io.emit` 掩盖。后来引入 `classroom-broadcast` 常驻房间，
 * 虽然修好了可达性，却把所有课节的倒计时/投票/抢答/动态流投给了**全平台**客户端。
 *
 * 现在的口径是「课节 + 班级 + 指定用户（+ 教师房间）」的并集：
 * - 课节房间：正在听课的学生与试听端；
 * - 班级房间：已离开课节视图（仪表盘/作业工作区/课件）的班级成员；
 * - 用户房间：账户级事件的唯一接收人；
 * - 教师房间：在线监控类事件，学生永不加入。
 *
 * 作业工作区的伪课节（`assignment-*`）只投它自己的房间，不扩散。
 */
export function classroomEventRooms(lessonId: string | null | undefined, target: ClassroomEventTarget = {}): string[] {
  const rooms = new Set<string>();
  if (typeof lessonId === 'string' && lessonId) {
    if (!isRealLessonRoom(lessonId)) return [lessonId];
    rooms.add(lessonId);
  }
  if (target.classId) rooms.add(classRoom(target.classId));
  for (const userId of target.userIds ?? []) {
    if (userId) rooms.add(userRoom(String(userId)));
  }
  if (target.staff) rooms.add(PRESENCE_STAFF_ROOM);
  return [...rooms];
}

/**
 * 课堂事件投递所需的最小 io 能力。
 *
 * 刻意只声明用到的那一截：真实的 `Server` 满足它，单元测试的轻量 mock 也满足，
 * 而 `Pick<Server, 'to'>` 会把 `BroadcastOperator` 的全部方法都拖进类型契约。
 * `to` 接受房间数组：Socket.IO 会对命中多个房间的客户端去重，避免重复弹窗。
 */
export interface ClassroomEventEmitter {
  to: (room: string | string[]) => { emit: (event: string, ...args: unknown[]) => void };
}

/**
 * 投递一个课堂事件到「课节房间 + 班级房间 + 指定用户房间（+ 教师房间）」。
 *
 * 取代原先的「幽灵房间投递 + 紧跟一行全局 `io.emit`」写法：
 * 房间归属显式化，且每个事件只发一次。
 */
export function emitClassroomEvent(
  io: ClassroomEventEmitter | null | undefined,
  lessonId: string | null | undefined,
  event: string,
  payload: unknown,
  target: ClassroomEventTarget = {},
): void {
  if (!io) return;
  const rooms = classroomEventRooms(lessonId, target);
  if (rooms.length === 0) return;
  io.to(rooms).emit(event, payload);
}

/** 教师端广播白板最大化视图时下发给学生的 Socket.IO 事件名 */
export const WHITEBOARD_FULLSCREEN_CHANGED = 'whiteboard-fullscreen-changed';

/**
 * Socket.IO presence + whiteboard realtime handlers.
 *
 * Extracted verbatim from `server.ts` (the `// In-memory status maps` block
 * through the `io.on('connection', ...)` handler). Behavior is preserved
 * exactly: `onlineStudents`/`activeStudentLessons` are module-internal state
 * here, `lessonActiveSegments` is the shared singleton imported from
 * `./shared-state.js` (the same one `server.ts` feeds into `ServerContext`),
 * and `eventBus` is the kernel's event bus passed in by the caller.
 *
 * Characterization test: `server/__tests__/presence.test.ts`.
 */
let globalOnlineStudentsGetter: (() => string[]) | null = null;
let globalActiveLessonsGetter: (() => Record<string, string>) | null = null;

/** 读取当前实时在线的学生 ID 列表 */
export function getOnlineStudentIds(): string[] {
  return globalOnlineStudentsGetter ? globalOnlineStudentsGetter() : [];
}

/** 学生当前所在课节。`enter-lesson` 写入，`leave-lesson` 与断线删除。 */
export function getActiveStudentLessons(): Record<string, string> {
  return globalActiveLessonsGetter ? { ...globalActiveLessonsGetter() } : {};
}

/**
 * 已经进入某一节 live class 的在场学生。
 *
 * 同时满足两件事才算在场：
 * - Socket.IO `register-student` 之后仍然在线
 * - `enter-lesson` 记录的课节就是这一节
 *
 * `leave-lesson` 或断线会立刻从结果里消失。历史签到行不会把已经离开的学生留在名单里。
 */
export function getPresentStudentIds(lessonId: string | null | undefined): string[] {
  if (!lessonId) return [];
  const online = new Set(getOnlineStudentIds());
  const lessons = getActiveStudentLessons();
  const present: string[] = [];
  for (const [studentId, activeLessonId] of Object.entries(lessons)) {
    if (activeLessonId === lessonId && online.has(studentId)) present.push(studentId);
  }
  return present;
}

export function setupPresence({
  io,
  eventBus,
  lookupStudentClassIds,
  lookupLessonClassId,
  lookupTeacherClassIds,
  lookupTeacherLessonIds,
}: PresenceDeps): void {
  // In-memory status maps
  const onlineStudents = new Map<string, { socketId: string; name: string }>();
  const activeStudentLessons = new Map<string, string>(); // studentId -> lessonId

  globalOnlineStudentsGetter = () => Array.from(onlineStudents.keys());
  globalActiveLessonsGetter = () => Object.fromEntries(activeStudentLessons.entries());

  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  let presenceTrailing = false;

  const presenceSnapshot = () => ({
    onlineStudentIds: Array.from(onlineStudents.keys()),
    activeStudentLessons: Object.fromEntries(activeStudentLessons.entries()),
  });

  /**
   * 按可见范围裁剪 presence 快照（SEC-AUTH / Issue #133）。
   *
   * - 教师 / 管理员：全校全量 —— 在线监控、专注力、点名都依赖它。
   * - 学生：仅本人（是否在线 + 本人所在课节），不暴露其他学生。
   * - 无 session：`NODE_ENV=test` 下握手豁免的 mock 连接，按特权处理；
   *   生产由 `socketAuthMiddleware` 拒绝无 token 连接，不会出现该分支。
   */
  const visiblePresence = (session: any) => {
    if (!session || session.role === 'teacher' || session.role === 'administrator') {
      return presenceSnapshot();
    }
    const selfId: string = session.userId;
    const lessonId = activeStudentLessons.get(selfId);
    return {
      onlineStudentIds: onlineStudents.has(selfId) ? [selfId] : [],
      activeStudentLessons: lessonId ? { [selfId]: lessonId } : {},
    };
  };

  const emitPresenceNow = () => {
    // 只投教师/管理员房间：在线名单是教师端监控数据，不再向全校连接广播
    io.to(PRESENCE_STAFF_ROOM).emit('presence-update', presenceSnapshot());
  };
  const broadcastPresence = () => {
    // 单测同步断言需要每次立即发送；生产用前导+尾随合并防 50 人齐进风暴
    if (process.env.NODE_ENV === 'test') {
      emitPresenceNow();
      return;
    }
    // P1 风暴面收敛：前导立即发送保证单次调用语义，500ms 窗内合并为一次尾随发送
    if (presenceTimer) {
      presenceTrailing = true;
      return;
    }
    emitPresenceNow();
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      if (presenceTrailing) {
        presenceTrailing = false;
        emitPresenceNow();
      }
    }, 500);
  };

  io.on('connection', (socket: any) => {
    let registeredStudentId: string | null = null;
    const session = socket.data?.session;
    const isTeacherOrAdmin = session?.role === 'teacher' || session?.role === 'administrator';

    // 在线状态只对教师/管理员可见（无 session 的测试连接按特权处理）
    if (!session || isTeacherOrAdmin) {
      socket.join(PRESENCE_STAFF_ROOM);
    }

    // Issue #242：教师/管理员连接即加入其任教班级房间与名下活跃课节房间。
    // #212 房间定向投递后，assignment.submitted / student.progress_updated /
    // lesson.progress_mode_changed / whiteboard.quiz_answered 只进
    // lesson/class 房间；教师停留在作业中心或课表（未进 live classroom 视图）
    // 时主 socket 从未加入这些房间，事件静默丢失。归属由服务端按会话查询
    // （班级 owner / 活跃会话 teacher），客户端无法冒领。
    if (isTeacherOrAdmin && session?.userId) {
      try {
        for (const classId of lookupTeacherClassIds?.(String(session.userId)) ?? []) {
          if (classId) socket.join(classRoom(classId));
        }
        for (const lessonId of lookupTeacherLessonIds?.(String(session.userId)) ?? []) {
          // 排除作业工作区伪课节房间（assignment- 前缀由学生专属逻辑管理）
          if (lessonId && isRealLessonRoom(lessonId)) socket.join(lessonId);
        }
      } catch (err) {
        plog.warn({ err }, `[Presence] Failed to resolve rooms for teacher ${session.userId}`);
      }
    }

    // 个人房间：账户级事件（作业评分 / 积分 / 课件 attempt）只投给本人。
    // 由服务端按 session 加入，不依赖客户端声明，也无法被客户端冒用。
    if (session?.userId) {
      socket.join(userRoom(String(session.userId)));
    }

    // ── SEC-AUTH: 房间归属校验 ────────────────────────────────────
    // 握手鉴权在 NODE_ENV=test 下豁免（此时 socket 无 session），与各处理器的
    // `if (session && ...)` 口径一致：无会话一律放行，生产行为由握手层兜底。

    /** 常驻广播房间：任何已连接客户端（教师/学生）都允许加入 */
    const PUBLIC_BROADCAST_ROOMS = new Set([WHITEBOARD_BROADCAST_ROOM]);

    const studentClassIds = (userId: string): string[] => lookupStudentClassIds?.(userId) ?? [];

    /** join-room / enter-lesson 的课节房间归属：学生须属于开课班级；未开课（自学）不设限 */
    const canJoinLessonRoom = (lessonId: string): boolean => {
      const lessonClassId = lookupLessonClassId?.(lessonId) ?? null;
      if (lessonClassId === null) return true;
      return studentClassIds(session.userId!).includes(lessonClassId);
    };

    const canJoinRoom = (roomId: unknown): boolean => {
      if (!session) return true;
      if (typeof roomId !== 'string' || !roomId) return false;
      // 个人房间与教师房间只由服务端按会话加入，任何角色都不得主动订阅
      if (roomId.startsWith(USER_ROOM_PREFIX)) return false;
      if (PUBLIC_BROADCAST_ROOMS.has(roomId)) return true;
      // 在线状态房间只能由连接时的角色判定自动加入，客户端不得主动 join（防学生自荐收听）
      if (roomId === PRESENCE_STAFF_ROOM) return false;
      if (isTeacherOrAdmin) return true;
      // 作业工作区伪课节：学生仅可加入绑定自己的房间
      const pseudoSid = pseudoRoomStudentId(roomId);
      if (pseudoSid !== null) return pseudoSid === session.userId;
      if (roomId.startsWith('class-')) return studentClassIds(session.userId!).includes(roomId.slice('class-'.length));
      return canJoinLessonRoom(roomId);
    };

    /** 白板写信令（whiteboard-update / whiteboard-event）：教师任意房间；学生仅自己的伪课节 */
    const canWriteWhiteboardRoom = (roomId: unknown): boolean => {
      if (!session) return true;
      if (isTeacherOrAdmin) return true;
      return typeof roomId === 'string' && pseudoRoomStudentId(roomId) === session.userId;
    };

    socket.on('register-student', (data: { studentId: string; name: string }) => {
      // SEC-AUTH: 阻止学生客户端伪造他人 studentId
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        plog.warn(`[Presence Security] Student ${session.userId} attempted to impersonate ${data.studentId}`);
        return socket.emit('error', { message: 'Forbidden: Cannot register presence for another student' });
      }
      registeredStudentId = data.studentId;
      onlineStudents.set(data.studentId, { socketId: socket.id, name: data.name });
      plog.info(`[Presence] Student online: ${data.name} (${data.studentId})`);

      // 加入所属班级房间：课堂广播（白板最大化视图等）需要在学生处于
      // 任意视图（含作业工作区）时都能送达
      try {
        for (const classId of lookupStudentClassIds?.(data.studentId) ?? []) {
          socket.join(classRoom(classId));
        }
      } catch (err) {
        plog.warn({ err }, `[Presence] Failed to resolve classes for student ${data.studentId}`);
      }

      broadcastPresence();
    });

    socket.on('enter-lesson', (data: { studentId: string; lessonId: string }) => {
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        return socket.emit('error', { message: 'Forbidden: Cannot enter lesson for another student' });
      }
      // SEC-AUTH: 课节房间归属 —— 开课中的课节仅班级成员可进入（防止跨班收听锁屏/点名广播）
      if (session && !isTeacherOrAdmin && !canJoinLessonRoom(data.lessonId)) {
        plog.warn(`[Presence Security] Student ${session.userId} denied enter-lesson ${data.lessonId}`);
        return socket.emit('error', { message: 'Forbidden: Not allowed to enter this lesson' });
      }
      activeStudentLessons.set(data.studentId, data.lessonId);
      socket.join(data.lessonId);
      plog.info(`[Presence] Student ${data.studentId} entered lesson ${data.lessonId}`);
      broadcastPresence();

      // Send current active segment if it exists
      const activeSeg = lessonActiveSegments.get(data.lessonId);
      if (activeSeg) {
        socket.emit('student-active-segment-changed', {
          lessonId: data.lessonId,
          activeSegmentId: activeSeg,
        });
      }
    });

    socket.on('leave-lesson', (data: { studentId: string }) => {
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        return socket.emit('error', { message: 'Forbidden: Cannot leave lesson for another student' });
      }
      const oldRoom = activeStudentLessons.get(data.studentId);
      if (oldRoom) {
        socket.leave(oldRoom);
      }
      activeStudentLessons.delete(data.studentId);
      plog.info(`[Presence] Student ${data.studentId} left lesson`);
      broadcastPresence();
    });

    socket.on('join-room', (roomId: string) => {
      // SEC-AUTH: 房间归属校验 —— 任意登录者不得加入任意房间收听跨班广播
      if (!canJoinRoom(roomId)) {
        plog.warn(`[Presence Security] ${session?.userId} denied join-room ${roomId}`);
        return socket.emit('error', { message: 'Forbidden: Not allowed to join this room' });
      }
      socket.join(roomId);
    });

    socket.on('whiteboard-update', (data: { roomId: string; type: string; payload: any }) => {
      // SEC-AUTH: 教师可写任意房间；学生仅可写自己作业工作区的伪课节房间
      // （课堂白板对学生只读；HTTP 侧 whiteboard.update 命令已有同口径校验）
      if (!canWriteWhiteboardRoom(data?.roomId)) {
        plog.warn(`[Presence Security] ${session?.userId} denied whiteboard-update for room ${data?.roomId}`);
        return;
      }
      // 实时绘制事件（temp-draw, temp-end, segment-change）：直接广播，不经过 EventBus
      socket.to(data.roomId).emit('whiteboard-sync', data);
    });

    // Step 4 (v5.0): 白板结构化事件 → 服务端 EventBus（审计日志 + 广播）
    socket.on(
      'whiteboard-event',
      (data: {
        type: string;
        payload: { lessonId: string; elementId?: string; elementType?: string; segmentId?: string };
        id: string;
        timestamp: number;
      }) => {
        // SEC-AUTH: 与 whiteboard-update 同口径 —— 教师可写任意课节；学生仅自己的伪课节
        if (!canWriteWhiteboardRoom(data?.payload?.lessonId)) {
          plog.warn(`[Presence Security] ${session?.userId} denied whiteboard-event for ${data?.payload?.lessonId}`);
          return;
        }
        // 1. 发布到服务端 EventBus（自动写入 events 表，审计日志）
        eventBus.publish({
          id: data.id,
          type: data.type,
          source: 'whiteboard',
          payload: data.payload,
          timestamp: data.timestamp,
          correlationId: data.payload.lessonId,
        });

        // 2. 广播到「课节房间 + 全局白板广播房间」的其他客户端。
        //
        //    房间口径与 `server/event-routing.ts` 的 `element_drawn` 对齐：只投课节房间
        //    会漏掉那些没 join 课节房间的学生（停在仪表盘 / 作业工作区 / 课件标签页）。
        //    `socket.to(...)` 而非 `io.to(...)`：发布者本人已在 `onElementUpdate`
        //    之后本地 `fetchElements` 过，无需再拉一次。
        const lessonId = data.payload.lessonId;
        if (lessonId) {
          // roomId 是客户端的硬性要求：`useClassroomSocket` 的处理函数是
          // `if (type === 'refresh' && roomId)`，缺 roomId 会静默丢弃这条刷新。
          const message = {
            type: 'refresh' as const,
            roomId: lessonId,
            sourceEvent: data.type,
          };
          socket.to(lessonId).emit('whiteboard-sync', message);
          socket.to(WHITEBOARD_BROADCAST_ROOM).emit('whiteboard-sync', message);
        }
      },
    );

    // 学生端异常上报：记录到系统审计日志并广播给教师端
    socket.on(
      'student-client-error',
      (data: {
        studentId: string;
        studentName?: string;
        lessonId?: string | null;
        classId?: string | null;
        error: any;
      }) => {
        if (!data || !data.studentId || !data.error) return;

        // SEC-AUTH: 阻止学生客户端伪造他人 studentId 上报错误
        if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
          plog.warn(`[Presence Security] Student ${session.userId} attempted to report error as ${data.studentId}`);
          return;
        }

        const studentName = data.studentName || onlineStudents.get(data.studentId)?.name || data.studentId;
        const lessonId = data.lessonId || activeStudentLessons.get(data.studentId) || null;
        const classId = data.classId || null;

        // 1. 输出到服务端控制台/系统日志
        plog.warn(
          `[Client Diagnostics] Student ${data.studentId} (${studentName}) reported error [${data.error.type || 'runtime'}]: ${data.error.message || data.error.title} (Lesson: ${lessonId || 'N/A'})`,
        );

        // 2. 发布到 EventBus 自动记录在 events 审计日志表中
        eventBus.publish({
          id: randomId('evt_err_'),
          type: 'student.client_error',
          source: 'student_client',
          payload: {
            studentId: data.studentId,
            studentName,
            lessonId,
            classId,
            error: data.error,
          },
          timestamp: data.error.timestamp || Date.now(),
          correlationId: lessonId || undefined,
        });

        // 3. 只投教师/管理员房间：学生端异常属于教师监控数据，
        //    此前全局广播会把任意学生的报错（含课节、姓名）推给所有学生。
        io.to(PRESENCE_STAFF_ROOM).emit('student-error-alert', {
          studentId: data.studentId,
          studentName,
          lessonId,
          classId,
          error: data.error,
        });
      },
    );

    socket.on(
      'teacher-broadcast-fullscreen',
      (data: { classId?: string | null; lessonId: string; elementId: string | null; mode?: 'board' | 'browser' }) => {
        // SEC-AUTH: 仅教师或管理员可广播授课白板的最大化视图
        if (session && !isTeacherOrAdmin) {
          plog.warn(`[Presence Security] Unauthorized teacher-broadcast-fullscreen by ${session?.userId}`);
          return socket.emit('error', {
            message: 'Forbidden: Only teachers or administrators can broadcast fullscreen',
          });
        }
        if (!data?.lessonId) return;

        // mode 区分「白板内最大化」与「整个浏览器全屏」：两者状态独立，
        // 学生端需要分别记录，退出一种不应影响另一种。
        const payload = {
          lessonId: data.lessonId,
          elementId: data.elementId ?? null,
          mode: data.mode === 'browser' ? ('browser' as const) : ('board' as const),
        };
        // 投递到课节房间：学生正停留在该课节的任意标签页（白板/课件/作业）
        io.to(data.lessonId).emit(WHITEBOARD_FULLSCREEN_CHANGED, payload);
        // 再投递到班级房间：学生可能在作业工作区（已 leave-lesson）
        // 或从学习面板直接打开了作业，此时不在课节房间里
        if (data.classId) {
          io.to(classRoom(data.classId)).emit(WHITEBOARD_FULLSCREEN_CHANGED, payload);
        }
      },
    );

    socket.on('teacher-broadcast-segment', (data: { lessonId: string; activeSegmentId: string }) => {
      // SEC-AUTH: 仅教师或管理员可广播环节切换指令
      if (session && !isTeacherOrAdmin) {
        plog.warn(`[Presence Security] Unauthorized teacher-broadcast-segment by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast segments' });
      }
      // 全班指针前进，并冻结其他环节上仍打开的停留。学生能否看到内容由 segment-access 再判。
      if (data.lessonId && data.activeSegmentId) {
        segmentGateService.setClassSegment(data.lessonId, String(data.activeSegmentId).slice(0, 128));
      } else {
        setActiveSegment(data.lessonId, data.activeSegmentId);
      }
      // Broadcast to everyone in the lesson room (including the teacher client)
      io.to(data.lessonId).emit('student-active-segment-changed', data);
    });

    socket.on('teacher-ping-student', (data: { studentId: string; lessonId: string; message?: string }) => {
      // SEC-AUTH: 仅教师或管理员可向学生发起单向提醒
      if (session && !isTeacherOrAdmin) {
        plog.warn(`[Presence Security] Unauthorized teacher-ping-student by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can ping students' });
      }
      plog.info(`[Ping] Teacher pinged student ${data.studentId} for lesson ${data.lessonId}`);
      const studentOnlineInfo = onlineStudents.get(data.studentId);
      if (studentOnlineInfo) {
        io.to(studentOnlineInfo.socketId).emit('student-pinged', {
          lessonId: data.lessonId,
          message: data.message,
        });
      }
    });

    // 教师端全班锁屏指令：课节 + 班级房间，单次联合投递（同一 socket 命中多个房间也只收一次）
    socket.on('teacher-broadcast-lock', (data: { lessonId: string; locked: boolean; classId?: string }) => {
      if (session && !isTeacherOrAdmin) {
        plog.warn(`[Presence Security] Unauthorized teacher-broadcast-lock by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast lock' });
      }
      if (!data?.lessonId) return;
      emitClassroomEvent(
        io,
        data.lessonId,
        'class-lock-status-changed',
        { lessonId: data.lessonId, locked: Boolean(data.locked) },
        { classId: data.classId ?? null },
      );
    });

    // 教师端切换演示 Tab 广播
    socket.on('teacher-broadcast-tab', (data: { lessonId: string; tab: string }) => {
      if (session && !isTeacherOrAdmin) {
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast tab' });
      }
      if (!data?.lessonId) return;
      io.to(data.lessonId).emit('student-lesson-tab-changed', data);
    });

    // 教师端切换课节广播：定向到班级房间，切课只影响本班；无 classId 才回退课节房间，不再全局 io.emit
    socket.on('teacher-broadcast-lesson', (data: { lessonId: string; classId?: string }) => {
      if (session && !isTeacherOrAdmin) {
        return socket.emit('error', {
          message: 'Forbidden: Only teachers or administrators can broadcast lesson switch',
        });
      }
      if (!data?.lessonId) return;
      if (data.classId) {
        const boundClassId = loadInProgressSessionClass(kernelContainer.db, data.lessonId);
        if (boundClassId && boundClassId !== data.classId) {
          return socket.emit('error', { message: CLASS_LOCK_MESSAGE, code: 'CLASS_LOCKED' });
        }
        io.to(classRoom(data.classId)).emit('teacher-switched-lesson', data);
      } else {
        io.to(data.lessonId).emit('teacher-switched-lesson', data);
      }
    });

    // 教师端随机抽问/点名广播
    socket.on(
      'teacher-pick-student',
      (data: { studentId: string; studentName: string; lessonId?: string; classId?: string }) => {
        if (session && !isTeacherOrAdmin) {
          plog.warn(`[Presence Security] Unauthorized teacher-pick-student by ${session?.userId}`);
          return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can pick students' });
        }
        if (!data?.studentId) return;
        // 班级兜底：教师端只传 lessonId 时，从进行中会话/课表反查，
        // 保证事件能投到班级房间（学生离开课节视图后仍会收到点名提示）。
        const classId = data.classId || (data.lessonId ? loadLessonClassId(kernelContainer.db, data.lessonId) : null);
        plog.info(
          `[Presence] Teacher picked student ${data.studentName} (${data.studentId}) for lesson ${data.lessonId}`,
        );
        const payload = {
          studentId: data.studentId,
          studentName: data.studentName,
          lessonId: data.lessonId,
          classId,
          pickedTime: Date.now(),
        };
        // v0.6.1 数据真实性（R-3）：手动抽问与白板 rollcall 同等落库 —— 此前
        // 只有白板路径写 student_rollcalls，学生档案点名记录与公平抽人统计
        // 漏计手动抽问。幂等键 = 手动前缀 + 学生 + 毫秒时间戳。
        try {
          const rollcallId = `rollcall-manual-${data.studentId}-${payload.pickedTime}`;
          kernelContainer.db
            .prepare(
              'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)',
            )
            .run(rollcallId, data.studentId, classId || '', data.lessonId || '', payload.pickedTime);
        } catch (e: any) {
          plog.warn(`[Presence] Failed to persist manual rollcall: ${e?.message}`);
        }
        // 只投「课节 + 班级 + 被点名学生」：既保证全班提示与被抽中者强提醒，
        // 又不会把 A 班的点名串到 B 班。房间数组由 Socket.IO 去重，命中多个也只收一次。
        emitClassroomEvent(io, data.lessonId ?? null, 'student-picked', payload, {
          classId,
          userIds: [data.studentId],
        });
      },
    );

    // 学生端确认答到回传广播
    socket.on('student-acknowledge-pick', (data: { studentId: string; lessonId?: string }) => {
      if (!data?.studentId) return;
      // SEC-AUTH: 阻止学生伪造他人 studentId 确认答到
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        plog.warn(`[Presence Security] Student ${session.userId} attempted to acknowledge as ${data.studentId}`);
        return;
      }
      plog.info(`[Presence] Student acknowledged pick: ${data.studentId}`);
      const classId = data.lessonId ? loadLessonClassId(kernelContainer.db, data.lessonId) : null;
      emitClassroomEvent(
        io,
        data.lessonId ?? null,
        'student-acknowledged',
        { studentId: data.studentId, lessonId: data.lessonId },
        { classId, userIds: [data.studentId], staff: true },
      );
    });

    // 教师端课堂控制信令总线（透传至课节房间内所有远程学生端）
    socket.on('teacher-sync-message', (data: { lessonId: string; message: any }) => {
      if (session && !isTeacherOrAdmin) return;
      if (!data?.lessonId || !data.message) return;
      socket.to(data.lessonId).emit('classroom:sync_message', data);
    });

    socket.on('disconnect', () => {
      if (registeredStudentId) {
        // 竞态保护：仅当当前记录的活跃 socketId 匹配当前断开的 socket 时才删除，
        // 避免学生在页面刷新（F5）或多 Tab 切换时，旧连接的断开抹除新连接已注册的在线态
        const currentRecord = onlineStudents.get(registeredStudentId);
        if (!currentRecord || currentRecord.socketId === socket.id) {
          onlineStudents.delete(registeredStudentId);
          activeStudentLessons.delete(registeredStudentId);
          plog.info(`[Presence] Student offline: ${registeredStudentId}`);
          broadcastPresence();
        } else {
          plog.info(
            `[Presence] Stale socket disconnected for student ${registeredStudentId}, preserved active connection (${currentRecord.socketId})`,
          );
        }
      }
    });

    // 支持客户端随时按需主动请求最新在线列表（学生只能拿到本人状态）
    socket.on('request-presence', () => {
      socket.emit('presence-update', visiblePresence(session));
    });

    // Send initial status immediately on connection（同样按角色裁剪）
    socket.emit('presence-update', visiblePresence(session));
  });
}
