import { describe, it, expect } from 'vitest';
import {
  classroomEventRooms,
  emitClassroomEvent,
  isRealLessonRoom,
  PRESENCE_STAFF_ROOM,
  userRoom,
} from '../presence.js';

/**
 * 课堂事件的投递房间口径。
 *
 * 历史包袱：先是投到 `lesson-${lessonId}`（**带前缀**，无人加入的幽灵房间），
 * 后来用 `classroom-broadcast` 常驻房间兜底 —— 可达性修好了，却把每个课节的
 * 倒计时/投票/抢答/动态流投给了全平台客户端。
 *
 * 本测试锁死当前口径：课节房间 + 班级房间 + 指定用户房间（+ 教师房间）的并集，
 * 防止退化回全局广播，或把 A 班事件串到 B 班。
 */

type Emitted = { rooms: string | string[]; event: string; payload: unknown };

function buildIo() {
  const emitted: Emitted[] = [];
  const io = {
    to: (rooms: string | string[]) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ rooms, event, payload });
      },
    }),
  };
  return { emitted, io };
}

describe('classroomEventRooms', () => {
  it('真实课节 → 课节房间', () => {
    expect(classroomEventRooms('L1')).toEqual(['L1']);
  });

  it('班级 / 用户 / 教师目标按并集去重投递', () => {
    expect(
      classroomEventRooms('L1', {
        classId: 'C1',
        userIds: ['stu_1', null, undefined, ''],
        staff: true,
      }),
    ).toEqual(['L1', 'class-C1', userRoom('stu_1'), PRESENCE_STAFF_ROOM]);
  });

  it('作业工作区的伪课节只投自己的房间，不扩散到班级/教师房间', () => {
    // 客户端在「当前没有选中课节」时会 setSelectedLesson(roomId) +
    // setStudentViewStatus('lesson')，把学生拉进一个并不存在的课节视图
    expect(
      classroomEventRooms('assignment-a1-student-stu_alice', {
        classId: 'C1',
        userIds: ['stu_alice'],
        staff: true,
      }),
    ).toEqual(['assignment-a1-student-stu_alice']);
  });

  it('缺少 lessonId 时使用班级/用户/教师房间，不制造 undefined 房间', () => {
    expect(classroomEventRooms(null)).toEqual([]);
    expect(classroomEventRooms(undefined)).toEqual([]);
    expect(classroomEventRooms('')).toEqual([]);
    expect(classroomEventRooms(null, { classId: 'C1' })).toEqual(['class-C1']);
    expect(classroomEventRooms(null, { userIds: ['u1'] })).toEqual([userRoom('u1')]);
    expect(classroomEventRooms(null, { staff: true })).toEqual([PRESENCE_STAFF_ROOM]);
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
  it('并集单次投递（Socket.IO 对多房间命中去重）', () => {
    const { emitted, io } = buildIo();

    emitClassroomEvent(io, 'L1', 'classroom:buzzer_winner', { studentName: '王超' }, { classId: 'C1' });

    // 关键回归点：不能再退回「逐房间 emit 多次」或「全局 io.emit」，
    // 否则同时命中课节/班级房间的客户端会重复弹窗。
    expect(emitted).toEqual([
      {
        rooms: ['L1', 'class-C1'],
        event: 'classroom:buzzer_winner',
        payload: { studentName: '王超' },
      },
    ]);
  });

  it('没有任何目标房间时静默跳过', () => {
    const { emitted, io } = buildIo();

    emitClassroomEvent(io, null, 'classroom:stage_changed', {});

    expect(emitted).toEqual([]);
  });

  it('io 缺失时静默跳过（不抛错）', () => {
    expect(() => emitClassroomEvent(null, 'L1', 'classroom:stage_changed', {})).not.toThrow();
    expect(() => emitClassroomEvent(undefined, 'L1', 'classroom:stage_changed', {})).not.toThrow();
  });
});
