import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * 积分（points ledger）变更的共享信号。
 *
 * 背景：`POST /api/students/:id/points`（教师/管理员权限）落 `points_ledger` 后
 * 会 publish `points.awarded`，经 `setupRealtimeBridge` 投递为
 * `classroom:points_awarded`（全局广播，因为积分是**账户级**事实、不隶属某一课节）。
 *
 * 但该事件此前**全平台零监听**，于是：
 *  - 被加分的学生端不会收到任何提示；
 *  - 教师在自己已打开的「学生成长档案 / 积分榜」弹窗里加分后，
 *    界面**不刷新** —— 提示说「已发放」，数字却还是旧的。
 *
 * 之所以独立成 store：消费端分散在 `useClassroomSocket`（socket 生命周期所在）
 * 与深层弹窗组件（`StudentGrowthProfileModal`）之间，后者拿不到前者的返回值。
 * 这与 `whiteboardViewStore` 的动机一致。
 *
 * 注意与 `student:coins_awarded` 的区别：后者是**点名评价**的课堂金币，
 * 只写 `student_rollcalls.reward_coins`，**不写 points_ledger**，两者当前互不重叠。
 * 若将来把点名金币迁到积分台账，这里需要加去重，避免同一次奖励提示两次。
 */
export interface PointsLedgerEvent {
  /** 被加/扣分的学生 */
  studentId: string;
  classId: string;
  /** 正数加分、负数扣分 */
  deltaPoints: number;
  reason: string;
  dimensionId?: string;
  createdAt?: number;
}

export interface PointsLedgerState {
  /** 最近一次变更（null 表示本会话尚未收到） */
  lastEvent: PointsLedgerEvent | null;
  /**
   * 变更计数器。
   *
   * 用它（而非 `lastEvent`）作为 refetch 的依赖：连续两次**内容相同**的变更
   * 也会让它自增，从而避免「对象引用变了但内容没变」这类比较的脆弱性。
   */
  version: number;
  /** 供消费端注册回调（组件卸载时务必退订） */
  subscribe: (fn: (event: PointsLedgerEvent) => void) => () => void;
  /** 由 `useClassroomSocket` 在收到 socket 事件时调用 */
  record: (event: PointsLedgerEvent) => void;
  reset: () => void;
}

type Listener = (event: PointsLedgerEvent) => void;

const listeners = new Set<Listener>();

export const pointsLedgerStore = createStore<PointsLedgerState>((set, get) => ({
  lastEvent: null,
  version: 0,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  record: (event) => {
    set({ lastEvent: event, version: get().version + 1 });
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (e) {
        console.error('[pointsLedgerStore] listener error:', e);
      }
    }
  },
  reset: () => {
    set({ lastEvent: null, version: 0 });
  },
}));

export const usePointsLedgerStore = <T>(selector: (s: PointsLedgerState) => T): T => useStore(pointsLedgerStore, selector);
