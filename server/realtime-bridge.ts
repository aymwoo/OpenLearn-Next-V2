import type { Server } from 'socket.io';
import type { EventBusPort } from '../packages/core/event-bus/index.js';

/**
 * Minimal structural view of the kernel database the realtime bridge needs.
 * Mirrors the `better-sqlite3`-style `prepare().get()/.run()` surface so the
 * bridge can be unit-tested with an in-memory mock (no real DB dependency).
 */
export interface BridgeDb {
  prepare(sql: string): {
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
}

export interface RealtimeBridgeDeps {
  eventBus: EventBusPort;
  io: Server;
  db: BridgeDb;
}

/**
 * Wires kernel domain events (published on `eventBus`) to Socket.IO realtime
 * pushes. Extracted verbatim from `server.ts` (lines 652–803) so the original
 * broadcast behavior is preserved while the monolith is decomposed.
 *
 * Characterization test: `server/__tests__/realtime-bridge.test.ts`.
 */
export function setupRealtimeBridge({ eventBus, io, db }: RealtimeBridgeDeps): void {
  eventBus.subscribe('assignment.graded', (event) => {
    try {
      const payload = event.payload as any;
      const assignment = db.prepare('SELECT title FROM assignments WHERE id = ?').get(payload.assignmentId) as any;
      const assignmentTitle = assignment ? assignment.title : 'Assignment';

      console.log(`[EventBus -> Socket.IO] Broadcasting assignment-graded-toast to student ${payload.studentId}`);
      io.emit('assignment-graded-toast', {
        assignmentId: payload.assignmentId,
        assignmentTitle,
        studentId: payload.studentId,
        score: payload.score,
        feedback: payload.feedback || ''
      });
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error dispatching assignment graded notification:', e);
    }
  });

  const handleRollcallElement = (elementId: string) => {
    try {
      const el = db.prepare('SELECT * FROM whiteboard_elements WHERE id = ?').get(elementId) as any;
      if (el && el.type === 'rollcall') {
        const elData = JSON.parse(el.data);
        if (elData && elData.selectedStudent && elData.status === 'picked') {
          const studentId = elData.selectedStudent.id;
          const studentName = elData.selectedStudent.name;
          let classId = elData.classId || '';
          const lessonId = el.lesson_id;
          if (!classId && lessonId) {
            const sched = db.prepare('SELECT class_id FROM schedules WHERE lesson_id = ? LIMIT 1').get(lessonId) as any;
            if (sched) {
              classId = sched.class_id;
            }
          }
          const pickedTimeStr = elData.pickedTime || new Date().toISOString();
          const pickedTime = new Date(pickedTimeStr).getTime();

          const rollcallId = `rollcall-${elementId}-${pickedTime}`;

          const exists = db.prepare('SELECT id FROM student_rollcalls WHERE id = ?').get(rollcallId);
          if (!exists) {
            db.prepare(
              'INSERT INTO student_rollcalls (id, student_id, class_id, lesson_id, picked_time) VALUES (?, ?, ?, ?, ?)'
            ).run(rollcallId, studentId, classId, lessonId, pickedTime);

            console.log(`[Rollcall] Saved rollcall for student ${studentId} (${studentName})`);

            io.emit('student-picked', {
              rollcallId,
              studentId,
              studentName,
              classId,
              lessonId,
              pickedTime
            });
          }
        }
      }
    } catch (e) {
      console.error('Error handling rollcall element:', e);
    }
  };

  eventBus.subscribe('whiteboard.element_drawn', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.type === 'rollcall') {
        handleRollcallElement(payload.elementId);
      }
      if (payload.lessonId) {
        const syncMsg = { roomId: payload.lessonId, type: 'refresh' };
        // Broadcast to the lesson-specific room (for clients already joined)
        io.to(payload.lessonId).emit('whiteboard-sync', syncMsg);
        // Also broadcast globally so clients not yet in the lesson room can react
        io.to('whiteboard-broadcast').emit('whiteboard-sync', syncMsg);
        console.log(`[EventBus -> Socket.IO] Broadcast whiteboard refresh for lesson "${payload.lessonId}" (element: "${payload.elementId}", type: "${payload.type}")`);
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_drawn:', e);
    }
  });

  eventBus.subscribe('whiteboard.element_updated', (event) => {
    try {
      const payload = event.payload as any;
      handleRollcallElement(payload.elementId);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_updated for rollcall:', e);
    }
  });

  // P0-1：补全 whiteboard.element_deleted、whiteboard.cleared 到 Socket.IO 转发
  // 以及 P1-1：whiteboard.batch_drawn 批量事件的转发
  eventBus.subscribe('whiteboard.batch_drawn', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
        console.log(`[EventBus -> Socket.IO] Broadcast refresh after batch_draw (${payload.count} elements) for lesson "${payload.lessonId}"`);
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.batch_drawn:', e);
    }
  });

  eventBus.subscribe('whiteboard.element_deleted', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.element_deleted:', e);
    }
  });

  eventBus.subscribe('whiteboard.cleared', (event) => {
    try {
      const payload = event.payload as any;
      if (payload.lessonId) {
        io.to(payload.lessonId).emit('whiteboard-sync', {
          roomId: payload.lessonId,
          type: 'refresh'
        });
      }
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing whiteboard.cleared:', e);
    }
  });

  eventBus.subscribe('spotlight:state_updated', (event) => {
    try {
      io.emit('spotlight:state_updated', event.payload);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing spotlight:state_updated:', e);
    }
  });

  eventBus.subscribe('spotlight.state_updated', (event) => {
    try {
      io.emit('spotlight:state_updated', event.payload);
    } catch (e) {
      console.error('[EventBus -> Socket.IO] Error processing spotlight.state_updated:', e);
    }
  });
}
