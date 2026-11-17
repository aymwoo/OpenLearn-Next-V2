/**
 * 归属：课堂 / 学生端 —— 课节双栏「全屏」切换
 *
 * Issue IKVSIN：学生视角点击「全屏」按钮无任何反应，界面不进入全屏 / 不展开。
 *
 * 根因（Tailwind v4 类覆盖顺序）：旧实现里「默认态」与「右栏全屏态」产出的是
 * 同一个 class 集合（`w-1/3 md:block hidden`），右栏全屏只是在其后**追加**一个
 * `hidden`；而生成的 CSS 里 `@media (min-width:48rem) { .md\:block { display:block } }`
 * 位于 `.hidden { display:none }` 之后，同层同优先级下胜出 ⇒ 追加的 `hidden`
 * 覆盖不掉 `md:block` ⇒ 桌面端左栏依然可见 ⇒ 视觉上「点了全屏没反应」。
 *
 * 本用例在**真实浏览器**里断言 computed `display`，是级联问题的端到端防线：
 * 纯 DOM 类名断言无法证明 Tailwind 实际生成的 CSS 顺序。
 *
 * 同时覆盖**窄屏（<48rem）**：修复必须只改变「该隐藏却被显示」的桌面端行为，
 * 窄屏下内容栏仍默认不显示（与修复前一致）。
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/** 读取元素在浏览器里真实生效的 computed display。 */
async function computedDisplay(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => window.getComputedStyle(el).display);
}

interface ClassroomFixture {
  classId: string;
  lessonId: string;
  studentId: string;
  studentNum: string;
  studentPassword: string;
  sessionId: string | null;
}

/** 教师建班、建课、建学生并把课节推进到「课中」。 */
async function setupClassroom(request: APIRequestContext): Promise<ClassroomFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const className = `E2E 全屏班级 ${suffix}`;
  const lessonTitle = `E2E 全屏课节 ${suffix}`;
  const studentNum = `STU_FS_${Date.now().toString(36).toUpperCase()}`;
  const studentPwd = '123456';

  const loginRes = await request.post('/api/auth/login', {
    data: { entrance: 'teacher', username: 'admin', password: 'admin' },
  });
  expect(loginRes.ok()).toBeTruthy();

  const classRes = await request.post('/api/classes', { data: { name: className } });
  expect(classRes.ok()).toBeTruthy();
  const classId = (await classRes.json()).id;

  const lessonRes = await request.post('/api/lessons', {
    data: { title: lessonTitle, content: '全屏切换测试内容' },
  });
  expect(lessonRes.ok()).toBeTruthy();
  const lessonData = await lessonRes.json();
  const lessonId = lessonData.result?.lessonId || lessonData.id;

  const stuRes = await request.post('/api/students', {
    data: { student_number: studentNum, name: `全屏学生${suffix.slice(-4)}`, password: studentPwd },
  });
  expect(stuRes.ok()).toBeTruthy();
  const stuData = (await stuRes.json()) as { id: string; initial_password?: string };
  const studentId = stuData.id;
  await request.post(`/api/classes/${classId}/students`, { data: { studentId } });

  const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
    data: { classId },
  });
  expect(initRes.ok()).toBeTruthy();
  const stageRes = await request.post(`/api/classroom/sessions/${lessonId}/stage`, {
    data: { stage: 'IN_CLASS_TEACHING', classId },
  });
  expect(stageRes.ok(), await stageRes.text()).toBeTruthy();

  // 记录会话 id，便于清理时归档（避免残留活跃会话影响其它 e2e 用例）
  const listRes = await request.get(`/api/classroom/sessions?lessonId=${lessonId}&status=active`);
  const sessionId = listRes.ok() ? ((await listRes.json()).items?.[0]?.id ?? null) : null;

  return {
    classId,
    lessonId,
    studentId,
    studentNum,
    // 弱口令（'123456'）会被服务端换成随机初始口令，必须用返回值登录
    studentPassword: stuData.initial_password || studentPwd,
    sessionId,
  };
}

/** 学生登录并进入课节视图（返回课堂 + 跳过破冰弹窗）。 */
async function enterLessonView(student: BrowserContext, studentPage: Page, fixture: ClassroomFixture): Promise<void> {
  const studentLogin = await student.request.post('/api/auth/login', {
    data: { entrance: 'student', studentId: fixture.studentNum, password: fixture.studentPassword },
  });
  expect(studentLogin.ok()).toBeTruthy();
  await studentPage.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });
  await studentPage.goto('/');

  const banner = studentPage.getByTestId('student-active-class-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.getByRole('button', { name: '返回课堂' }).click();
  await expect(studentPage.getByText('Back to Dashboard')).toBeVisible({ timeout: 15_000 });

  // 破冰心情弹窗是 aria-modal 全屏遮罩，会拦截后续点击 —— 先跳过。
  const icebreakerModal = studentPage.getByTestId('student-icebreaker-modal');
  const icebreakerShown = await icebreakerModal
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (icebreakerShown) {
    await studentPage.getByTestId('icebreaker-skip-btn').click();
    await expect(icebreakerModal).toBeHidden({ timeout: 10_000 });
  }

  await expect(studentPage.getByTestId('student-lesson-content-panel')).toBeAttached({ timeout: 20_000 });
  await expect(studentPage.getByTestId('student-lesson-interaction-panel')).toBeAttached({ timeout: 20_000 });
}

/** 清理测试数据。 */
async function cleanupClassroom(request: APIRequestContext, fixture: ClassroomFixture): Promise<void> {
  if (fixture.sessionId) {
    await request.post(`/api/classroom/sessions/${fixture.sessionId}/archive`).catch(() => {});
  }
  await request.delete(`/api/lessons/${fixture.lessonId}`).catch(() => {});
  await request.delete(`/api/students/${fixture.studentId}`).catch(() => {});
  await request.delete(`/api/classes/${fixture.classId}`).catch(() => {});
}

test.describe('学生端课节「全屏」切换 (Issue IKVSIN)', () => {
  test('右栏全屏真正让左栏让位，左栏全屏真正让交互区让位', async ({ browser, request }) => {
    test.setTimeout(180_000);

    const fixture = await setupClassroom(request);
    const student = await browser.newContext();
    const studentPage = await student.newPage();

    try {
      await enterLessonView(student, studentPage, fixture);

      const contentPanel = studentPage.getByTestId('student-lesson-content-panel');
      const interactionPanel = studentPage.getByTestId('student-lesson-interaction-panel');

      // 桌面视口必须落在 md 断点（48rem）之上，否则 `md:block` 根本不生效。
      expect(studentPage.viewportSize()!.width).toBeGreaterThanOrEqual(768);

      // 1. 基线：课程内容默认折叠 ⇒ 左栏不可见，右栏独占整行
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');

      // 2. 展开课程内容 ⇒ 左栏出现（这是「点击全屏看起来没反应」的复现前提）
      await studentPage.getByRole('button', { name: /展开课程内容|Expand Content/ }).click();
      await expect(contentPanel).toBeVisible({ timeout: 10_000 });
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('block');

      const contentBox = await contentPanel.boundingBox();
      const interactionBox = await interactionPanel.boundingBox();
      expect(contentBox).not.toBeNull();
      expect(interactionBox).not.toBeNull();
      // 左栏确实只占了约 1/3，而不是独占整行
      expect(contentBox!.width).toBeLessThan(interactionBox!.width);

      // 3. **核心断言**：点右栏「全屏」⇒ 左栏必须真正让位（display:none）
      //    修复前这里是 'block'（`md:block` 覆盖了 `hidden`）⇒ 全屏「没反应」。
      await studentPage.getByTestId('student-interaction-fullscreen-toggle').click();
      await expect(interactionPanel).toBeVisible({ timeout: 10_000 });
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');

      // 右栏全屏后应独占整行：宽度明显大于并排时的右栏宽度
      const fullInteractionBox = await interactionPanel.boundingBox();
      expect(fullInteractionBox).not.toBeNull();
      expect(fullInteractionBox!.width).toBeGreaterThan(interactionBox!.width);

      // 4. 退出全屏 ⇒ 左栏回到原位
      await studentPage.getByTestId('student-interaction-fullscreen-toggle').click();
      await expect(contentPanel).toBeVisible({ timeout: 10_000 });
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('block');

      // 5. 左栏全屏 ⇒ 交互区必须真正让位
      await studentPage.getByTestId('student-content-fullscreen-toggle').click();
      await expect(contentPanel).toBeVisible({ timeout: 10_000 });
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('block');

      // 截图留证：左栏全屏，交互区已让位
      const shotDir = path.join(process.cwd(), 'artifacts', 'screenshots');
      if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, 'student_fullscreen_layout.png');
      await studentPage.screenshot({ path: shot, fullPage: true });
      expect(fs.existsSync(shot)).toBe(true);

      // 6. 退出左栏全屏 ⇒ 两侧恢复并排
      await studentPage.getByTestId('student-content-fullscreen-toggle').click();
      await expect(interactionPanel).toBeVisible({ timeout: 10_000 });
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');
    } finally {
      await cleanupClassroom(request, fixture);
      await student.close();
    }
  });

  test('窄屏（<48rem）下内容栏保持隐藏，行为与修复前一致', async ({ browser, request }) => {
    test.setTimeout(180_000);

    const fixture = await setupClassroom(request);
    // 500px < 48rem(768px) ⇒ 落在 md 断点之下
    const student = await browser.newContext({ viewport: { width: 500, height: 900 } });
    const studentPage = await student.newPage();

    try {
      await enterLessonView(student, studentPage, fixture);

      const contentPanel = studentPage.getByTestId('student-lesson-content-panel');
      const interactionPanel = studentPage.getByTestId('student-lesson-interaction-panel');
      expect(studentPage.viewportSize()!.width).toBeLessThan(768);

      // 1. 基线：窄屏下内容栏不可见、交互区占满整行（与修复前一致）
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');

      // 2. 展开课程内容后，窄屏仍不显示内容栏（`hidden md:block` 语义）
      await studentPage.getByRole('button', { name: /展开课程内容|Expand Content/ }).click();
      await expect
        .poll(async () => computedDisplay(studentPage, 'student-lesson-content-panel'), { timeout: 10_000 })
        .toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');

      // 3. 右栏全屏 ⇒ 内容栏在窄屏依然隐藏，交互区仍可见（不产生空白页）
      await studentPage.getByTestId('student-interaction-fullscreen-toggle').click();
      expect(await computedDisplay(studentPage, 'student-lesson-content-panel')).toBe('none');
      expect(await computedDisplay(studentPage, 'student-lesson-interaction-panel')).not.toBe('none');

      // 4. 窄屏下内容栏本身被隐藏 ⇒ 其「全屏」按钮不可达（左栏全屏在窄屏无法触发）。
      //    这是修复前就存在的窄屏限制（内容栏 `hidden md:block`），本次修复不改动它。
      await expect(studentPage.getByTestId('student-content-fullscreen-toggle')).toBeHidden();

      // 5. 窄屏下交互区始终可见 —— 不存在「两栏同时消失」的空白页
      await expect(interactionPanel).toBeVisible();
      await expect(contentPanel).toBeHidden();
    } finally {
      await cleanupClassroom(request, fixture);
      await student.close();
    }
  });
});
