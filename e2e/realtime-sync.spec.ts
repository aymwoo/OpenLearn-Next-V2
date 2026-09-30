import {
  test,
  expect,
  // 顶层导出的 `request` 是「API 上下文工厂」（有 newContext）；
  // 而 `beforeAll` 里解构到的 `request` fixture 本身就是一个 context，没有 newContext。
  // 这里要的是前者 —— 用来建一个不依附于任何 fixture 生命周期的独立会话。
  request as apiRequestFactory,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from '@playwright/test';
import {
  provisionRealtimeFixture,
  seedRollcallElement,
  createTeacherApi,
  updateElement,
  type RealtimeFixture,
} from './fixtures/realtime-sync';

/**
 * 「教师端操作 → 学生端实时可见」的端到端验证。
 *
 * ## 这份 spec 存在的唯一理由
 *
 * 这一轮排查出的 bug 有一个共同特征：**只在跨端时才能复现，且修复前的验证全是 mock**。
 *   - `ClassroomSyncChannel` 在构造函数里抓 socket → 跨机监听永久缺失，
 *     而同机多标签页走 BroadcastChannel 恰好把它掩盖；
 *   - `io.to('lesson-<id>')` 幽灵房间 → 单 context 时投递对象恰好在房间里；
 *   - `frontendEventBus` 的 socket 桥从未接线 → 代码看起来在广播，实际什么都没发生。
 *
 * 假 socket 证明不了跨机投递真的通，所以这里用**真实服务端 + 真实浏览器**。
 *
 * ## 关键设计：教师侧走 API，学生侧走浏览器
 *
 * 教师动作全部由 HTTP 触发（不点教师 UI），因此浏览器里**不存在第二个
 * BroadcastChannel 对端** —— 学生只能靠真实的 socket 收到事件。
 * 这正是被修坏的那条通路，本 spec 因此对其敏感。
 *
 * 代价与边界（如实说明）：本 spec 验证**传输链路**（服务端广播 → socket → 学生端渲染），
 * 不验证教师按钮的点击行为本身（那部分由单元测试覆盖）。
 *
 * ## 资源与登录预算
 *
 * 登录接口限流 **5 次/IP/分钟**（`server.ts` 的 `loginLimiter`）。全文件只登录两次：
 * 教师一次（自建 API context）、学生一次（浏览器 context）。
 * 撞限流会返回 429，很容易被误读成「同步失败」，所以绝不能每用例登录一次。
 */
const TOUR_KEY = 'edu_os_tour_completed';
/** 课表卡片上的「进入课堂」按钮（中英文两种文案） */
const JOIN_LESSON = 'button:has-text("进入课堂"), button:has-text("Join Class")';
/** 全屏抽中弹窗上的答到确认按钮 */
const ACK_PICK = 'button:has-text("我已准备好")';
/** 全屏抽中弹窗的标题 */
const PICK_ALERT_TITLE = '闪电抽问：老师抽中了你！';

test.describe.configure({ mode: 'serial' });

test.describe('课堂实时同步（跨端）', () => {
  let fx: RealtimeFixture;
  let api: APIRequestContext;
  let ctx: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    api = await createTeacherApi(apiRequestFactory);
    fx = await provisionRealtimeFixture(api);

    ctx = await browser.newContext();
    page = await ctx.newPage();
    await page.addInitScript((k) => localStorage.setItem(k, 'true'), TOUR_KEY);
    await page.goto('/');

    // 学生登录：切到「学生自助端」页签 → 填学号 → 填密码
    await page.locator('button:has-text("学生自助端")').first().click();
    const idInput = page.locator('input[placeholder*="手工输入您的特有学号"]');
    await expect(idInput).toBeVisible({ timeout: 30_000 });
    await idInput.fill(fx.studentNumber);
    await page.locator('input[placeholder*="输入个人密码或临时班级密码"]').fill(fx.studentPassword);
    await page.locator('button[type="submit"]').first().click();
    await expect(idInput).toBeHidden({ timeout: 30_000 });

    // 立刻确认真的进了仪表盘 —— 否则后面只会报「找不到进入课堂按钮」这种
    // 与真实原因无关的失败，把排查方向带偏。
    // 必须用会自动重试的 expect().toBeVisible()：locator.isVisible() 是立即查询、
    // 忽略 timeout，仪表盘异步加载完成前必然为 false。
    try {
      await expect(page.locator(JOIN_LESSON).first()).toBeVisible({ timeout: 30_000 });
    } catch {
      const body = await page
        .locator('body')
        .innerText()
        .catch(() => '');
      throw new Error(`学生登录后未进入仪表盘。页面内容：\n${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    }

    // 进入课节：selectedLesson 只能由 UI 交互设置，API 绕不过去
    await page.locator(JOIN_LESSON).first().click();
  });

  test.afterAll(async () => {
    await ctx?.close().catch(() => undefined);
    // 兜底删除；权威清理由 global-teardown 的 cleanup-test-data.mjs 负责
    if (fx?.studentId) {
      await api?.delete(`/api/students/${fx.studentId}`).catch(() => undefined);
    }
    await api?.dispose().catch(() => undefined);
  });

  /** 关掉全屏抽中弹窗，避免它的遮罩挡住后续断言 */
  async function dismissPickAlert(): Promise<void> {
    const ack = page.locator(ACK_PICK);
    if (await ack.isVisible().catch(() => false)) {
      await ack.click();
      await expect(ack).toBeHidden({ timeout: 10_000 });
    }
  }

  test('教师中途启动的倒计时，远程学生能实时看到（不刷新页面）', async () => {
    // 先重置，让本用例对 retry 幂等（倒计时状态在服务端内存里，跨用例/重试会残留）
    const resetRes = await api.post(`/api/classroom/sessions/${fx.lessonId}/countdown`, {
      data: { action: 'reset' },
    });
    expect(resetRes.ok(), '重置倒计时应成功').toBeTruthy();

    // 教师此刻没有倒计时 —— 横幅不应出现
    await expect(page.locator('#student-classroom-countdown-banner')).toHaveCount(0, { timeout: 15_000 });

    // 教师启动倒计时。走真实 HTTP、不点教师 UI ⇒ 浏览器里没有 BroadcastChannel 对端，
    // 学生只能靠 socket 收到 —— 正是被修坏的那条通路。
    const startRes = await api.post(`/api/classroom/sessions/${fx.lessonId}/countdown`, {
      data: { action: 'start', duration: 300, label: 'E2E 限时任务' },
    });
    expect(startRes.ok(), '教师启动倒计时应成功').toBeTruthy();

    const banner = page.locator('#student-classroom-countdown-banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('E2E 限时任务');
    // 5:00 起算，容忍传输与渲染的秒级误差
    await expect(banner.locator('#student-countdown-digits')).toHaveText(/0[45]:\d{2}/, { timeout: 20_000 });
  });

  test('教师抽中学生后，白板点名组件与全屏提示同步到远程学生', async () => {
    await dismissPickAlert();
    const elementId = await seedRollcallElement(api, fx.lessonId, { status: 'idle' });
    await expect(page.getByText('抽中的幸运答题者')).toHaveCount(0, { timeout: 15_000 });

    // 教师点「开始随机点名」后的持久化结果
    await updateElement(api, fx.lessonId, elementId, {
      status: 'picked',
      classId: fx.classId,
      selectedStudent: { id: fx.studentId, name: fx.studentName, student_number: fx.studentNumber },
      pickedTime: new Date().toISOString(),
      evaluation: null,
    });

    // ① 白板上的点名组件应刷新为该学生
    await expect(page.getByText('抽中的幸运答题者')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(fx.studentName).first()).toBeVisible();
    // ② 屏幕级强提示（而非通知铃铛里一条静默记录）
    await expect(page.getByText(PICK_ALERT_TITLE).first()).toBeVisible({ timeout: 30_000 });

    await dismissPickAlert();
  });

  test('教师评价并发放金币后，远程学生收到奖励到账提示', async () => {
    await dismissPickAlert();
    const elementId = await seedRollcallElement(api, fx.lessonId, { status: 'idle' });
    await updateElement(api, fx.lessonId, elementId, {
      status: 'picked',
      classId: fx.classId,
      selectedStudent: { id: fx.studentId, name: fx.studentName, student_number: fx.studentNumber },
      pickedTime: new Date().toISOString(),
      evaluation: null,
    });
    await expect(page.getByText(PICK_ALERT_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await dismissPickAlert();

    const evalRes = await api.post('/api/rollcalls/evaluate', {
      data: {
        studentId: fx.studentId,
        studentName: fx.studentName,
        classId: fx.classId,
        lessonId: fx.lessonId,
        rating: 'excellent',
        rewardCoins: 10,
        difficulty: 'intermediate',
      },
    });
    expect(evalRes.ok(), '教师评价应成功').toBeTruthy();

    await expect(page.getByText(/\+10 金币/).first()).toBeVisible({ timeout: 30_000 });
  });
});
