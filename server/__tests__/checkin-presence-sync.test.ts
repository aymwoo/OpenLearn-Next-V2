import { describe, it, expect } from 'vitest';
import { getPresentStudentIds, markStudentCheckedIn, setupPresence } from '../presence.js';

/**
 * Phase 2.1：签到写侧同步 presence。
 *
 * 目标：学生只扫码签到、尚未 enter-lesson 时，getPresentStudentIds 仍能立即
 * 计入该生；重复签到幂等；离线学生不被伪造成在线。
 */
function setupPresenceHarness() {
  const connectionHandlers: Array<(socket: any) => void> = [];
  const io = {
    on: (event: string, cb: (socket: any) => void) => {
      if (event === 'connection') connectionHandlers.push(cb);
    },
    to: () => ({ emit: () => {} }),
  } as any;

  setupPresence({
    io,
    eventBus: { publish: async () => {}, subscribe: () => {} } as any,
  });

  function connect(studentId: string) {
    const handlers = new Map<string, (data: any) => void>();
    const socket = {
      id: `sock-${studentId}`,
      data: {},
      on: (event: string, cb: (data: any) => void) => handlers.set(event, cb),
      emit: () => {},
      to: () => ({ emit: () => {} }),
      join: () => {},
      leave: () => {},
      trigger: (event: string, data: unknown) => handlers.get(event)?.(data),
    } as any;
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
