/**
 * 学生端抢答弹窗回归测试。
 *
 * 背景缺陷：抢答成功后弹窗无法退出 —— 服务端始终返回最新一条 buzzer（不过滤 status），
 * 加上弹窗没有关闭入口 / 教师 reset 后状态不复位，学生被永久锁在全屏遮罩内。
 *
 * 计时说明：本组件用 setInterval 每 2.5s 轮询，测试统一使用假定时器；
 * 断言一律走「微任务刷新 + 有界重试」而非 waitFor，避免 waitFor 与
 * shouldAdvanceTime 组合在并行负载下产生 1s 超时抖动。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { StudentInteractiveOverlay } from '../StudentInteractiveOverlay';

const LESSON_ID = 'lesson_1';
const WINNER_TEXT = '恭喜你率先抢答！';
const BUZZ_BTN_TEXT = '抢！';
const CLOSE_BTN_TEXT = '知道了，返回课堂';

/** 服务端 /api/classroom/sessions/:lessonId 的可变响应 */
let sessionResponse: { hasActiveSession: boolean; activeBuzzer: BuzzerRow | undefined; [k: string]: unknown };
let buzzResponse: { ok: boolean; body: unknown };

interface BuzzerRow {
  id: string;
  title: string;
  status: 'READY' | 'LOCKED';
  winner_student_id?: string | null;
  winner_student_name?: string | null;
  winner_response_time_ms?: number | null;
}

/**
 * 忠实模拟服务端：
 *  - /buzz 命中后把 DB 行原子置为 LOCKED 并写入 winner（与 server/routes/classroom.ts 一致）
 *  - 会话接口在**请求发起时刻**捕获快照，可被 gate 挂起以复现「在途过期快照」竞态
 */
let sessionGate: Promise<void> | null = null;
let releaseSessionGate: (() => void) | null = null;

/** 挂起会话响应（用于制造在途请求） */
function stallSessionResponse(): void {
  sessionGate = new Promise<void>((resolve) => {
    releaseSessionGate = resolve;
  });
}
function releaseStalledSessionResponse(): void {
  releaseSessionGate?.();
  sessionGate = null;
  releaseSessionGate = null;
}

function renderOverlay(studentId = 's_win') {
  return render(<StudentInteractiveOverlay lessonId={LESSON_ID} studentId={studentId} studentName="小明" />);
}

/** 冲刷微任务 + React 副作用 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** 有界重试直到断言通过（不依赖真实时间） */
async function waitUntil(assertion: () => void, label: string): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      assertion();
      return;
    } catch (e) {
      lastError = e;
      await settle();
    }
  }
  throw new Error(`waitUntil 超时：${label}（最后一次错误：${String(lastError)}）`);
}

const expectVisible = (text: string) =>
  waitUntil(() => expect(screen.getByText(text)).toBeTruthy(), `应出现「${text}」`);
const expectHidden = (text: string) =>
  waitUntil(() => expect(screen.queryByText(text)).toBeNull(), `应消失「${text}」`);
const expectHiddenText = (matcher: RegExp) =>
  waitUntil(() => expect(screen.queryByText(matcher)).toBeNull(), `应消失 ${matcher}`);

/** 手动触发一次 2.5s 轮询 */
async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2600);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionGate = null;
  releaseSessionGate = null;
  sessionResponse = {
    hasActiveSession: true,
    stage: 'IN_CLASS_TEACHING',
    activePoll: null,
    activeBuzzer: { id: 'bz_1', title: '全班极速抢答', status: 'READY' },
  };
  buzzResponse = { ok: true, body: { success: true, won: true, winner: { studentId: 's_win' } } };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/buzz')) {
        if (buzzResponse.ok) {
          const w = (buzzResponse.body as any).winner;
          // 服务端原子裁决：命中即把该行置为 LOCKED
          sessionResponse.activeBuzzer = {
            ...(sessionResponse.activeBuzzer as BuzzerRow),
            status: 'LOCKED',
            winner_student_id: w?.studentId ?? null,
            winner_student_name: w?.studentName ?? null,
            winner_response_time_ms: w?.responseTimeMs ?? null,
          };
        }
        return { ok: buzzResponse.ok, json: async () => buzzResponse.body } as Response;
      }
      if (url.includes(`/api/classroom/sessions/${LESSON_ID}`)) {
        // 在请求发起时刻捕获快照（真实服务端语义：响应反映发起时的 DB 状态）
        const snapshot = JSON.parse(JSON.stringify(sessionResponse));
        if (sessionGate) await sessionGate;
        return { ok: true, json: async () => snapshot } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }),
  );
});

afterEach(() => {
  releaseStalledSessionResponse();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StudentInteractiveOverlay · 抢答弹窗', () => {
  it('教师开启抢答时展示「抢！」按钮', async () => {
    renderOverlay();
    await expectVisible(BUZZ_BTN_TEXT);
  });

  it('抢答成功后可以关闭弹窗，回到课堂（不再被全屏遮罩锁死）', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    await expectVisible(WINNER_TEXT);

    fireEvent.click(screen.getByText(CLOSE_BTN_TEXT));
    await expectHidden(WINNER_TEXT);

    // 关闭后即使继续轮询到同一个 LOCKED 的 buzzer，也不该重新弹出
    await tick();
    await tick();
    expect(screen.queryByText(WINNER_TEXT)).toBeNull();
  });

  it('关闭按钮（右上角 X）同样能退出抢答状态', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    await expectVisible(WINNER_TEXT);

    fireEvent.click(screen.getByLabelText('关闭抢答'));
    await expectHidden(WINNER_TEXT);
  });

  it('教师重置同一轮抢答（status 回到 READY）后，学生可再次抢答', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    await expectVisible(WINNER_TEXT);

    // 教师点击 reset：buzzerId 不变，status 变回 READY
    sessionResponse.activeBuzzer = {
      id: 'bz_1',
      title: '全班极速抢答',
      status: 'READY',
      winner_student_id: null,
    };
    await tick();

    await expectVisible(BUZZ_BTN_TEXT);
    expect(screen.queryByText(WINNER_TEXT)).toBeNull();
  });

  it('教师开启新一轮抢答（新的 buzzerId）时弹窗自动重新出现', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);
    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    await expectVisible(WINNER_TEXT);
    fireEvent.click(screen.getByText(CLOSE_BTN_TEXT));
    await expectHidden(WINNER_TEXT);

    sessionResponse.activeBuzzer = { id: 'bz_2', title: '第二轮', status: 'READY' };
    await tick();

    await expectVisible(BUZZ_BTN_TEXT);
  });

  it('未抢到时展示「被抢先」并可关闭', async () => {
    sessionResponse.activeBuzzer = {
      id: 'bz_1',
      title: '全班极速抢答',
      status: 'READY',
    };
    buzzResponse = {
      ok: true,
      body: { success: false, won: false, winner: { studentId: 's_other', studentName: '小红' } },
    };
    renderOverlay('s_lose');
    await expectVisible(BUZZ_BTN_TEXT);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    // 姓名由 JSX 插值拆成多个文本节点，用部分匹配；姓名应立即来自 POST 响应而非等轮询
    await waitUntil(() => expect(screen.getByText(/抢先一步！/)).toBeTruthy(), '应显示被抢先提示');
    expect(screen.getByText(/抢先一步！/).textContent).toContain('小红');

    fireEvent.click(screen.getByText(CLOSE_BTN_TEXT));
    await expectHiddenText(/抢先一步！/);
  });

  it('抢答瞬间在途的过期 READY 快照不会冲掉已判定的结果', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    // 制造竞态：轮询请求在抢答「之前」发出并捕获到 READY 快照，但直到抢答结果返回后才抵达
    stallSessionResponse();
    vi.advanceTimersByTime(2500);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    await expectVisible(WINNER_TEXT);

    // 过期快照此刻才抵达：不得把结果页冲回「抢！」按钮
    releaseStalledSessionResponse();
    await settle();
    await settle();

    expect(screen.getByText(WINNER_TEXT)).toBeTruthy();
    expect(screen.queryByText(BUZZ_BTN_TEXT)).toBeNull();
  });

  it('轮询遵守 2.5s 节流，不会自激成无限请求循环', async () => {
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    // 服务端每次都返回全新对象（真实行为），若 effect 依赖写错会立刻重入轮询
    await vi.advanceTimersByTimeAsync(10_000);
    const sessionCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes(`/api/classroom/sessions/${LESSON_ID}`),
    ).length;

    // 10s 内应约为 1(首次) + 4(每 2.5s 一次)，绝不能是几十上百次
    expect(sessionCalls).toBeGreaterThanOrEqual(2);
    expect(sessionCalls).toBeLessThanOrEqual(7);
  });

  it('抢答请求失败时回退到可重试状态，而不是停在空白界面', async () => {
    buzzResponse = { ok: false, body: { error: 'boom' } };
    renderOverlay('s_win');
    await expectVisible(BUZZ_BTN_TEXT);

    fireEvent.click(screen.getByText(BUZZ_BTN_TEXT));
    // 回退后按钮应重新可用，学生可以再抢一次
    await expectVisible(BUZZ_BTN_TEXT);
  });
});
