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
}

/** 班级房间名。与课节房间（直接用 lessonId）互不冲突。 */
export const classRoom = (classId: string): string => `class-${classId}`;

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
export function setupPresence({ io, eventBus, lookupStudentClassIds }: PresenceDeps): void {
  // In-memory status maps
  const onlineStudents = new Map<string, { socketId: string; name: string }>();
  const activeStudentLessons = new Map<string, string>(); // studentId -> lessonId

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
      socket.join(roomId);
    });

    socket.on('whiteboard-update', (data: { roomId: string; type: string; payload: any }) => {
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
        // 1. 发布到服务端 EventBus（自动写入 events 表，审计日志）
        eventBus.publish({
          id: data.id,
          type: data.type,
          source: 'whiteboard',
          payload: data.payload,
          timestamp: data.timestamp,
          correlationId: data.payload.lessonId,
        });

        // 2. 广播到课程房间的其他客户端
        const lessonId = data.payload.lessonId;
        if (lessonId) {
          const roomName = lessonId.startsWith('assignment-') ? lessonId : `lesson-${lessonId}`;
          // 注意：emit 到原始 lessonId（非 roomName），与历史行为一致
          socket.to(data.payload.lessonId).emit('whiteboard-sync', {
            type: 'refresh',
            sourceEvent: data.type,
          });
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
      (data: { classId?: string | null; lessonId: string; elementId: string | null }) => {
        // SEC-AUTH: 仅教师或管理员可广播授课白板的最大化视图
        if (session && !isTeacherOrAdmin) {
          console.warn(`[Presence Security] Unauthorized teacher-broadcast-fullscreen by ${session?.userId}`);
          return socket.emit('error', {
            message: 'Forbidden: Only teachers or administrators can broadcast fullscreen',
          });
        }
        if (!data?.lessonId) return;

        const payload = { lessonId: data.lessonId, elementId: data.elementId ?? null };
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
        return socket.emit('error', { message: 'Forbidden: Only teachers or administrators can broadcast lesson switch' });
      }
      if (!data?.lessonId) return;
      if (data.classId) {
        io.to(classRoom(data.classId)).emit('teacher-switched-lesson', data);
      }
      io.emit('teacher-switched-lesson', data);
    });

    // 教师端课堂控制信令总线（透传至课节房间内所有远程学生端）
    socket.on('teacher-sync-message', (data: { lessonId: string; message: any }) => {
      if (session && !isTeacherOrAdmin) return;
      if (!data?.lessonId || !data.message) return;
      socket.to(data.lessonId).emit('classroom:sync_message', data);
    });

    socket.on('disconnect', () => {
      if (registeredStudentId) {
        onlineStudents.delete(registeredStudentId);
        activeStudentLessons.delete(registeredStudentId);
        console.log(`[Presence] Student offline: ${registeredStudentId}`);
        broadcastPresence();
      }
    });

    // Send initial status immediately on connection
    socket.emit('presence-update', {
      onlineStudentIds: Array.from(onlineStudents.keys()),
      activeStudentLessons: Object.fromEntries(activeStudentLessons.entries()),
    });
  });
}
