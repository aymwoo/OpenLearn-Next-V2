import type { Server } from 'socket.io';
import type { EventBusPort } from '../packages/core/event-bus/index.js';
import { lessonActiveSegments } from './shared-state.js';

export interface PresenceDeps {
  io: Server;
  eventBus: EventBusPort;
}

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
export function setupPresence({ io, eventBus }: PresenceDeps): void {
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

    socket.on('register-student', (data: { studentId: string; name: string }) => {
      registeredStudentId = data.studentId;
      onlineStudents.set(data.studentId, { socketId: socket.id, name: data.name });
      console.log(`[Presence] Student online: ${data.name} (${data.studentId})`);
      broadcastPresence();
    });

    socket.on('enter-lesson', (data: { studentId: string; lessonId: string }) => {
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

    socket.on('teacher-broadcast-segment', (data: { lessonId: string; activeSegmentId: string }) => {
      // Store the active segment in memory
      lessonActiveSegments.set(data.lessonId, data.activeSegmentId);
      // Broadcast to everyone in the lesson room (including the teacher client)
      io.to(data.lessonId).emit('student-active-segment-changed', data);
    });

    socket.on('teacher-ping-student', (data: { studentId: string; lessonId: string; message?: string }) => {
      console.log(`[Ping] Teacher pinged student ${data.studentId} for lesson ${data.lessonId}`);
      const studentOnlineInfo = onlineStudents.get(data.studentId);
      if (studentOnlineInfo) {
        io.to(studentOnlineInfo.socketId).emit('student-pinged', {
          lessonId: data.lessonId,
          message: data.message,
        });
      }
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
