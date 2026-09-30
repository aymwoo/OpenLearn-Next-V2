import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pointsLedgerStore } from '../pointsLedgerStore';

/**
 * 积分台账变更的共享信号。
 *
 * 它存在的理由：`classroom:points_awarded`（`points.awarded` 经 realtime bridge
 * 投递）此前全平台零监听，导致「加分成功提示已显示、界面数字却还是旧的」。
 * 消费端分散在 `useClassroomSocket`（socket 生命周期）与深层弹窗之间，
 * 故需要一个两端都能触及的共享 store。
 */
describe('pointsLedgerStore', () => {
  beforeEach(() => {
    pointsLedgerStore.getState().reset();
  });

  it('record 后保存最近事件并自增 version', () => {
    const before = pointsLedgerStore.getState().version;
    pointsLedgerStore.getState().record({
      studentId: 'stu-1',
      classId: 'c1',
      deltaPoints: 5,
      reason: '课堂表现优异',
    });

    const s = pointsLedgerStore.getState();
    expect(s.version).toBe(before + 1);
    expect(s.lastEvent).toMatchObject({ studentId: 'stu-1', deltaPoints: 5, reason: '课堂表现优异' });
  });

  it('内容完全相同的连续两次变更也会自增 version（refetch 不应被内容比较挡住）', () => {
    const payload = { studentId: 'stu-1', classId: 'c1', deltaPoints: 5, reason: 'x' };
    pointsLedgerStore.getState().record(payload);
    const v1 = pointsLedgerStore.getState().version;
    pointsLedgerStore.getState().record(payload);

    expect(pointsLedgerStore.getState().version).toBe(v1 + 1);
  });

  it('subscribe 回调在 record 时被调用，退订后不再调用', () => {
    const fn = vi.fn();
    const unsub = pointsLedgerStore.getState().subscribe(fn);

    pointsLedgerStore.getState().record({ studentId: 'stu-1', classId: 'c1', deltaPoints: 1, reason: 'a' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toMatchObject({ studentId: 'stu-1', deltaPoints: 1 });

    unsub();
    pointsLedgerStore.getState().record({ studentId: 'stu-1', classId: 'c1', deltaPoints: 2, reason: 'b' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('某个订阅者抛错不影响其它订阅者与 version 自增', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const un1 = pointsLedgerStore.getState().subscribe(bad);
    const un2 = pointsLedgerStore.getState().subscribe(good);
    const before = pointsLedgerStore.getState().version;

    expect(() =>
      pointsLedgerStore.getState().record({ studentId: 's', classId: 'c', deltaPoints: 1, reason: 'r' }),
    ).not.toThrow();

    expect(pointsLedgerStore.getState().version).toBe(before + 1);
    un1();
    un2();
  });

  it('reset 归零', () => {
    pointsLedgerStore.getState().record({ studentId: 's', classId: 'c', deltaPoints: 1, reason: 'r' });
    pointsLedgerStore.getState().reset();
    expect(pointsLedgerStore.getState().version).toBe(0);
    expect(pointsLedgerStore.getState().lastEvent).toBeNull();
  });
});
