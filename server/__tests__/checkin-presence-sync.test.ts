import { describe, it, expect } from 'vitest';
import type { Server } from 'socket.io';
import type { EventBusPort } from '../../packages/core/event-bus/index.js';
import { getPresentStudentIds, markStudentCheckedIn, setupPresence } from '../presence.js';

/** presence 只用到 socket 的少数成员，这里给出最小结构化类型，避免测试里堆 `any`。 */
interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  on: (event: string, cb: (data: unknown) => void) => void;
  emit: () => void;
  to: () => { emit: () => void };
  join: () => void;
  leave: () => void;
  trigger: (event: string, data: unknown) => void;
}

/**
 * Phase 2.1：签到写侧同步 presence。
 *
 * 目标：学生只扫码签到、尚未 enter-lesson 时，getPresentStudentIds 仍能立即
 * 计入该生；重复签到幂等；离线学生不被伪造成在线。
 */
function setupPresenceHarness() {
  const connectionHandlers: Array<(socket: FakeSocket) => void> = [];
  const io = {
    on: (event: string, cb: (socket: FakeSocket) => void) => {
      if (event === 'connection') connectionHandlers.push(cb);
    },
    to: () => ({ emit: () => {} }),
  } as unknown as Server;

  setupPresence({
    io,
    eventBus: { publish: async () => {}, subscribe: () => {} } as unknown as EventBusPort,
  });

  function connect(studentId: string) {
    const handlers = new Map<string, (data: unknown) => void>();
    const socket: FakeSocket = {
      id: `sock-${studentId}`,
      data: {},
      on: (event, cb) => handlers.set(event, cb),
      emit: () => {},
      to: () => ({ emit: () => {} }),
      join: () => {},
      leave: () => {},
      trigger: (event, data) => handlers.get(event)?.(data),
    };
    connectionHandlers[connectionHandlers.length - 1](socket);
    socket.trigger('register-student', { studentId, name: studentId });
    return socket;
  }

  return { connect };
}

describe('markStudentCheckedIn（Phase 2.1）', () => {
  it('未 enter-lesson → 签到后立即出现在 present 列表', () => {
    const { connect } = setupPresenceHarness();
    connect('stu-checkin-1');

    expect(getPresentStudentIds('lesson-1')).toEqual([]);
    expect(markStudentCheckedIn('lesson-1', 'stu-checkin-1')).toBe(true);
    expect(getPresentStudentIds('lesson-1')).toEqual(['stu-checkin-1']);
  });

  it('已 enter-lesson 或重复签到 → 幂等，不重复写入', () => {
    const { connect } = setupPresenceHarness();
    const socket = connect('stu-checkin-2');
    socket.trigger('enter-lesson', { studentId: 'stu-checkin-2', lessonId: 'lesson-2' });

    expect(markStudentCheckedIn('lesson-2', 'stu-checkin-2')).toBe(false);
    expect(markStudentCheckedIn('lesson-2', 'stu-checkin-2')).toBe(false);
    expect(getPresentStudentIds('lesson-2')).toEqual(['stu-checkin-2']);
  });

  it('离线学生 / 空参数不写入 presence', () => {
    setupPresenceHarness();

    expect(markStudentCheckedIn('lesson-3', 'offline-student')).toBe(false);
    expect(markStudentCheckedIn('', 'offline-student')).toBe(false);
    expect(markStudentCheckedIn('lesson-3', '')).toBe(false);
    expect(getPresentStudentIds('lesson-3')).toEqual([]);
  });
});
