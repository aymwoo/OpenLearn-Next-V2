import { describe, it, expect, vi } from 'vitest';
import { CLASSROOM_BROADCAST_ROOM, classroomEventRooms, emitClassroomEvent, isRealLessonRoom } from '../presence.js';

/**
 * 课堂事件的投递房间口径。
 *
 * 历史包袱：服务端有 13 处投到 `lesson-${lessonId}`（**带前缀**），而客户端加入的
 * 课节房间是**裸 lessonId**（`enter-lesson` 的 `socket.join(data.lessonId)`）。
 * 那些投递打进了无人加入的房间；其中 11 处靠紧随其后的 `io.emit(...)` 全局广播
 * 掩盖，于是功能看似正常、代价是全平台串流量，而 `classroom:exit_ticket_submitted`
 * 没有兜底，彻底失效。
 *
 * 本测试锁死「课节房间 + 常驻课堂广播房间」这一口径，防止退化回全局广播或幽灵房间。
 */

type Emitted = { room: string; event: string; payload: unknown };

function buildIo() {
  const emitted: Emitted[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  };
  return { emitted, io };
}

describe('classroomEventRooms', () => {
  it('真实课节 → 课节房间 + 常驻课堂广播房间', () => {
    expect(classroomEventRooms('L1')).toEqual(['L1', CLASSROOM_BROADCAST_ROOM]);
  });

  it('作业工作区的伪课节只投自己的房间，不进广播房间', () => {
    // 客户端在「当前没有选中课节」时会 setSelectedLesson(roomId) +
    // setStudentViewStatus('lesson')，把学生拉进一个并不存在的课节视图
    expect(classroomEventRooms('assignment-a1-student-stu_alice')).toEqual(['assignment-a1-student-stu_alice']);
  });

  it('缺少 lessonId 时只投常驻广播房间（不制造 undefined 房间）', () => {
    expect(classroomEventRooms(null)).toEqual([CLASSROOM_BROADCAST_ROOM]);
    expect(classroomEventRooms(undefined)).toEqual([CLASSROOM_BROADCAST_ROOM]);
    expect(classroomEventRooms('')).toEqual([CLASSROOM_BROADCAST_ROOM]);
  });
});

describe('isRealLessonRoom', () => {
  it.each([
    ['L1', true],
    ['lesson-abc', true],
    ['assignment-a1-student-stu_alice', false],
  ])('%s → %s', (roomId, expected) => {
    expect(isRealLessonRoom(roomId)).toBe(expected);
  });
});

describe('emitClassroomEvent', () => {
  it('每个事件只投递一次，覆盖课节房间与广播房间', () => {
    const { emitted, io } = buildIo();

    emitClassroomEvent(io, 'L1', 'classroom:buzzer_winner', { studentName: '王超' });

    // 关键回归点：原实现是「幽灵房间 + 紧随的 io.emit」，
    // 若只改房间名而不删 io.emit，就会变成同一个事件推两次
    expect(emitted).toEqual([
      { room: 'L1', event: 'classroom:buzzer_winner', payload: { studentName: '王超' } },
      { room: CLASSROOM_BROADCAST_ROOM, event: 'classroom:buzzer_winner', payload: { studentName: '王超' } },
    ]);
  });

  it('结课通票事件不再只投幽灵房间（此前无任何兜底 → 彻底失效）', () => {
    const { emitted, io } = buildIo();

    emitClassroomEvent(io, 'L1', 'classroom:exit_ticket_submitted', { totalSubmitted: 3 });

    expect(emitted.map((e) => e.room)).toEqual(['L1', CLASSROOM_BROADCAST_ROOM]);
  });

  it('io 缺失时静默跳过（不抛错）', () => {
    expect(() => emitClassroomEvent(null, 'L1', 'classroom:stage_changed', {})).not.toThrow();
    expect(() => emitClassroomEvent(undefined, 'L1', 'classroom:stage_changed', {})).not.toThrow();
  });
});
