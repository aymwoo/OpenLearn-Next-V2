import type { Server } from 'socket.io';
import type { EventBusPort } from '../packages/core/event-bus/index.js';
import { lessonActiveSegments } from './shared-state.js';

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
}

/** 班级房间名。与课节房间（直接用 lessonId）互不冲突。 */
export const classRoom = (classId: string): string => `class-${classId}`;

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
 * 常驻课堂广播房间名。
 *
 * 与白板广播房间同构：连接即加入，课堂事件（倒计时 / 投票 / 抢答 / 阶段 / 节奏信号）
 * 同时投递到「课节房间 + 本房间」，使**尚未进入课节视图**的客户端也能收到并预热状态。
 */
export const CLASSROOM_BROADCAST_ROOM = 'classroom-broadcast';

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

/**
 * 课堂事件的投递房间。
 *
 * 历史上服务端有 13 处投到 `lesson-${lessonId}`（**带前缀**），而客户端加入的
 * 课节房间是**裸 lessonId**（`enter-lesson` 的 `socket.join(data.lessonId)`），
 * 那些投递打进了无人加入的房间；其中 11 处靠紧随其后的 `io.emit(...)` 全局广播
 * 掩盖，于是功能看似正常、代价是全平台串流量。`classroom:exit_ticket_submitted`
 * 没有全局兜底，因此彻底失效。
 */
export function classroomEventRooms(lessonId: string | null | undefined): string[] {
  if (typeof lessonId !== 'string' || !lessonId) return [CLASSROOM_BROADCAST_ROOM];
  if (!isRealLessonRoom(lessonId)) return [lessonId];
  return [lessonId, CLASSROOM_BROADCAST_ROOM];
}

/**
 * 课堂事件投递所需的最小 io 能力。
 *
 * 刻意只声明用到的那一截：真实的 `Server` 满足它，单元测试的轻量 mock 也满足，
 * 而 `Pick<Server, 'to'>` 会把 `BroadcastOperator` 的全部方法都拖进类型契约。
 */
export interface ClassroomEventEmitter {
  to: (room: string) => { emit: (event: string, ...args: unknown[]) => void };
}

/**
 * 投递一个课堂事件到「课节房间 + 常驻课堂广播房间」。
 *
 * 取代原先的「幽灵房间投递 + 紧跟一行全局 `io.emit`」写法：
 * 房间归属显式化，且每个事件只发一次。
 */
export function emitClassroomEvent(
  io: ClassroomEventEmitter | null | undefined,
  lessonId: string | null | undefined,
  event: string,
  payload: unknown,
): void {
  if (!io) return;
  for (const room of classroomEventRooms(lessonId)) {
    io.to(room).emit(event, payload);
  }
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

/** 读取当前实时在线的学生 ID 列表 */
export function getOnlineStudentIds(): string[] {
  return globalOnlineStudentsGetter ? globalOnlineStudentsGetter() : [];
}

export function setupPresence({ io, eventBus, lookupStudentClassIds, lookupLessonClassId }: PresenceDeps): void {
  // In-memory status maps
  const onlineStudents = new Map<string, { socketId: string; name: string }>();
  const activeStudentLessons = new Map<string, string>(); // studentId -> lessonId

  globalOnlineStudentsGetter = () => Array.from(onlineStudents.keys());

  const broadcastPresence = () => {
    io.emit('presence-update', {
      onlineStudentIds: Array.from(onlineStudents.keys()),
      activeStudentLessons: Object.fromEntries(activeStudentLessons.entries()),
    });
  };

  io.on('connection', (socket: any) => {
    let registeredStudentId: string | null = null;
    const session = socket.data?.session;
    const isTeacherOrAdmin = session?.role === 'teacher' || session?.role === 'administrator';

    // ── SEC-AUTH: 房间归属校验 ────────────────────────────────────
    // 握手鉴权在 NODE_ENV=test 下豁免（此时 socket 无 session），与各处理器的
    // `if (session && ...)` 口径一致：无会话一律放行，生产行为由握手层兜底。

    /** 常驻广播房间：任何已连接客户端（教师/学生）都允许加入 */
    const PUBLIC_BROADCAST_ROOMS = new Set([WHITEBOARD_BROADCAST_ROOM, CLASSROOM_BROADCAST_ROOM]);

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
      if (PUBLIC_BROADCAST_ROOMS.has(roomId)) return true;
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
        console.warn(`[Presence Security] Student ${session.userId} attempted to impersonate ${data.studentId}`);
        return socket.emit('error', { message: 'Forbidden: Cannot register presence for another student' });
      }
      registeredStudentId = data.studentId;
      onlineStudents.set(data.studentId, { socketId: socket.id, name: data.name });
      console.log(`[Presence] Student online: ${data.name} (${data.studentId})`);

      // 加入所属班级房间：课堂广播（白板最大化视图等）需要在学生处于
      // 任意视图（含作业工作区）时都能送达
      try {
        for (const classId of lookupStudentClassIds?.(data.studentId) ?? []) {
          socket.join(classRoom(classId));
        }
      } catch (err) {
        console.warn(`[Presence] Failed to resolve classes for student ${data.studentId}`, err);
      }

      broadcastPresence();
    });

    socket.on('enter-lesson', (data: { studentId: string; lessonId: string }) => {
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        return socket.emit('error', { message: 'Forbidden: Cannot enter lesson for another student' });
      }
      // SEC-AUTH: 课节房间归属 —— 开课中的课节仅班级成员可进入（防止跨班收听锁屏/点名广播）
      if (session && !isTeacherOrAdmin && !canJoinLessonRoom(data.lessonId)) {
        console.warn(`[Presence Security] Student ${session.userId} denied enter-lesson ${data.lessonId}`);
        return socket.emit('error', { message: 'Forbidden: Not allowed to enter this lesson' });
      }
      activeStudentLessons.set(data.studentId, data.lessonId);
      socket.join(data.lessonId);
      console.log(`[Presence] Student ${data.studentId} entered lesson ${data.lessonId}`);
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
      console.log(`[Presence] Student ${data.studentId} left lesson`);
      broadcastPresence();
    });

    socket.on('join-room', (roomId: string) => {
      // SEC-AUTH: 房间归属校验 —— 任意登录者不得加入任意房间收听跨班广播
      if (!canJoinRoom(roomId)) {
        console.warn(`[Presence Security] ${session?.userId} denied join-room ${roomId}`);
        return socket.emit('error', { message: 'Forbidden: Not allowed to join this room' });
      }
      socket.join(roomId);
    });

    socket.on('whiteboard-update', (data: { roomId: string; type: string; payload: any }) => {
      // SEC-AUTH: 教师可写任意房间；学生仅可写自己作业工作区的伪课节房间
      // （课堂白板对学生只读；HTTP 侧 whiteboard.update 命令已有同口径校验）
      if (!canWriteWhiteboardRoom(data?.roomId)) {
        console.warn(`[Presence Security] ${session?.userId} denied whiteboard-update for room ${data?.roomId}`);
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
          console.warn(`[Presence Security] ${session?.userId} denied whiteboard-event for ${data?.payload?.lessonId}`);
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
          console.warn(`[Presence Security] Student ${session.userId} attempted to report error as ${data.studentId}`);
          return;
        }

        const studentName = data.studentName || onlineStudents.get(data.studentId)?.name || data.studentId;
        const lessonId = data.lessonId || activeStudentLessons.get(data.studentId) || null;
        const classId = data.classId || null;

        // 1. 输出到服务端控制台/系统日志
        console.warn(
          `[Client Diagnostics] Student ${data.studentId} (${studentName}) reported error [${data.error.type || 'runtime'}]: ${data.error.message || data.error.title} (Lesson: ${lessonId || 'N/A'})`,
        );

        // 2. 发布到 EventBus 自动记录在 events 审计日志表中
        eventBus.publish({
          id: `evt_err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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

        // 3. 广播给教师端实时感知
        io.emit('student-error-alert', {
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
          console.warn(`[Presence Security] Unauthorized teacher-broadcast-fullscreen by ${session?.userId}`);
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
        console.warn(`[Presence Security] Unauthorized teacher-broadcast-segment by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast segments' });
      }
      // Store the active segment in memory
      lessonActiveSegments.set(data.lessonId, data.activeSegmentId);
      // Broadcast to everyone in the lesson room (including the teacher client)
      io.to(data.lessonId).emit('student-active-segment-changed', data);
    });

    socket.on('teacher-ping-student', (data: { studentId: string; lessonId: string; message?: string }) => {
      // SEC-AUTH: 仅教师或管理员可向学生发起单向提醒
      if (session && !isTeacherOrAdmin) {
        console.warn(`[Presence Security] Unauthorized teacher-ping-student by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can ping students' });
      }
      console.log(`[Ping] Teacher pinged student ${data.studentId} for lesson ${data.lessonId}`);
      const studentOnlineInfo = onlineStudents.get(data.studentId);
      if (studentOnlineInfo) {
        io.to(studentOnlineInfo.socketId).emit('student-pinged', {
          lessonId: data.lessonId,
          message: data.message,
        });
      }
    });

    // 教师端全班锁屏指令全网广播
    socket.on('teacher-broadcast-lock', (data: { lessonId: string; locked: boolean; classId?: string }) => {
      if (session && !isTeacherOrAdmin) {
        console.warn(`[Presence Security] Unauthorized teacher-broadcast-lock by ${session?.userId}`);
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast lock' });
      }
      if (!data?.lessonId) return;
      io.to(data.lessonId).emit('class-lock-status-changed', {
        lessonId: data.lessonId,
        locked: Boolean(data.locked),
      });
      if (data.classId) {
        io.to(classRoom(data.classId)).emit('class-lock-status-changed', {
          lessonId: data.lessonId,
          locked: Boolean(data.locked),
        });
      }
    });

    // 教师端切换演示 Tab 广播
    socket.on('teacher-broadcast-tab', (data: { lessonId: string; tab: string }) => {
      if (session && !isTeacherOrAdmin) {
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast tab' });
      }
      if (!data?.lessonId) return;
      io.to(data.lessonId).emit('student-lesson-tab-changed', data);
    });

    // 教师端切换课节广播
    socket.on('teacher-broadcast-lesson', (data: { lessonId: string; classId?: string }) => {
      if (session && !isTeacherOrAdmin) {
        return socket.emit('error', {
          message: 'Forbidden: Only teachers or administrators can broadcast lesson switch',
        });
      }
      if (!data?.lessonId) return;
      if (data.classId) {
        io.to(classRoom(data.classId)).emit('teacher-switched-lesson', data);
      }
      io.emit('teacher-switched-lesson', data);
    });

    // 教师端随机抽问/点名广播
    socket.on(
      'teacher-pick-student',
      (data: { studentId: string; studentName: string; lessonId?: string; classId?: string }) => {
        if (session && !isTeacherOrAdmin) {
          console.warn(`[Presence Security] Unauthorized teacher-pick-student by ${session?.userId}`);
          return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can pick students' });
        }
        if (!data?.studentId) return;
        console.log(`[Presence] Teacher picked student ${data.studentName} (${data.studentId}) for lesson ${data.lessonId}`);
        const payload = {
          studentId: data.studentId,
          studentName: data.studentName,
          lessonId: data.lessonId,
          classId: data.classId,
          pickedTime: Date.now(),
        };
        if (data.lessonId) {
          io.to(data.lessonId).emit('student-picked', payload);
        }
        if (data.classId) {
          io.to(classRoom(data.classId)).emit('student-picked', payload);
        }
        io.emit('student-picked', payload);
      },
    );

    // 学生端确认答到回传广播
    socket.on('student-acknowledge-pick', (data: { studentId: string; lessonId?: string }) => {
      if (!data?.studentId) return;
      // SEC-AUTH: 阻止学生伪造他人 studentId 确认答到
      if (session && !isTeacherOrAdmin && session.userId !== data.studentId) {
        console.warn(`[Presence Security] Student ${session.userId} attempted to acknowledge as ${data.studentId}`);
        return;
      }
      console.log(`[Presence] Student acknowledged pick: ${data.studentId}`);
      io.emit('student-acknowledged', { studentId: data.studentId, lessonId: data.lessonId });
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
          console.log(`[Presence] Student offline: ${registeredStudentId}`);
          broadcastPresence();
        } else {
          console.log(
            `[Presence] Stale socket disconnected for student ${registeredStudentId}, preserved active connection (${currentRecord.socketId})`,
          );
        }
      }
    });

    // 支持客户端随时按需主动请求最新在线列表
    socket.on('request-presence', () => {
      socket.emit('presence-update', {
        onlineStudentIds: Array.from(onlineStudents.keys()),
        activeStudentLessons: Object.fromEntries(activeStudentLessons.entries()),
      });
    });

    // Send initial status immediately on connection
    socket.emit('presence-update', {
      onlineStudentIds: Array.from(onlineStudents.keys()),
      activeStudentLessons: Object.fromEntries(activeStudentLessons.entries()),
    });
  });
}
