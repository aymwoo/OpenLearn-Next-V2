/**
 * 无障碍门禁（axe-core，WCAG 2.0/2.1 A + AA）
 *
 * 覆盖登录页与教师端主要工作区，断言**零违规**。与 `live-class-contrast.spec.ts`
 * （只查 color-contrast、逐主题）互补：这里跑完整规则集，能挡住 button-name /
 * select-name / 结构性 ARIA 等回归。
 *
 * 两条实现约定（与 contrast spec 相同，都是踩过的坑）：
 * 1. 每个页面只跑一次 axe —— 同一 document 上重复 analyze 会把元素 computed
 *    color 留在错误状态，导致下一次检查报出并不存在的违规。
 * 2. 审计前冻结动画 —— axe 按元素不透明度混合前景/背景，动效中途采样会产生假阳性。
 *    注意：冻结 CSS 动画/过渡**挡不住 motion.js**（它用 rAF 直接改 style），
 *    所以另有 settleOverlays() 等浮层稳定。
 * 归属：无障碍 —— axe-core 全站无障碍门禁（WCAG 2.0/2.1 A+AA）
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * 本 spec 建的测试数据统一前缀。
 *
 * ## 为什么必须共用一个常量
 *
 * 此前这里踩过一个「创建用的前缀」与「清理用的前缀」不一致的坑：三个用例分别建
 * `A11Y 学生端课节` / `A11Y 测评班` / `A11Y2 仪表盘课节`，而 `afterAll` 只按
 * `startsWith(LESSON_PREFIX)` 过滤 —— 于是只有第三块的数据被删，前两块每跑一次就永久
 * 留下 1 个空课节 + 2 个空班级（实测：开发库里堆了 5 个空白课节 + 10 个空班级，
 * 而 `A11Y2` 前缀的残留为 0）。
 *
 * 现在创建与清理都从这一组常量派生，不可能再漂移。
 */
const TEST_TAG = 'A11Y';
/** 课节标题前缀 */
const LESSON_PREFIX = `${TEST_TAG} `;
/** 班级名称前缀 */
const CLASS_PREFIX = `${TEST_TAG} `;
/** 学生学号前缀（学生名另用 `${TEST_TAG}学生` 形式） */
const STUDENT_PREFIX = `STU_${TEST_TAG}_`;

/**
 * 教师端扫描前先播一份「像在用」的数据。
 *
 * ## 为什么必须要播种
 *
 * 无障碍门禁原来跑在**空库**上：没排课的课表页不渲染「上午课程」徽标与「午休时间」胶囊，
 * 没班级的班级页不渲染花名册……于是门禁一直是绿的。一旦库里有真实数据，同一批页面
 * 立刻报 `color-contrast` —— 实测已经因此漏过两次真实违规：
 *   1. 全局 toast 说明文字（弹出来那 0.3 秒不可读）；
 *   2. 课表页 `text-sky-600 on bg-sky-50`（3.84:1）与 `text-slate-400 on white`（2.56:1）。
 *
 * 两者都是「内容一出现就违规」，靠人肉看着库状态去发现不可持续。所以这里在扫教师端
 * 9 个页面前，先用真实 API 建一个「有排课、有学生、有课节」的最小现场 —— 让这一类
 * 问题**在 CI 里就红**，而不是等老师看到。
 *
 * 注意：这里播种的数据量刻意很小（1 班 / 2 学生 / 1 课节 / 2 条排课），
 * 目标是**触发填充态渲染**，不是造一个完整学期。
 */
interface SeededFixture {
  classId?: string;
  lessonId?: string;
}

async function seedTeacherWorkspaceData(request: import('@playwright/test').APIRequestContext): Promise<SeededFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const seeded: SeededFixture = {};

  // 1. 课节
  const lessonRes = await request.post('/api/lessons', {
    data: { title: `${LESSON_PREFIX}门禁现场课节 ${suffix}`, content: '无障碍门禁数据现场' },
  });
  if (lessonRes.ok()) {
    const body = await lessonRes.json();
    seeded.lessonId = body?.result?.lessonId || body?.id;
  }

  // 2. 班级
  const classRes = await request.post('/api/classes', {
    data: { name: `${CLASS_PREFIX}门禁现场班级 ${suffix}`, grade: '高一' },
  });
  if (classRes.ok()) {
    seeded.classId = (await classRes.json())?.id;
  }

  // 3. 两名学生入班（班级页 / 课堂页的花名册填充态）
  if (seeded.classId) {
    await request
      .post(`/api/classes/${seeded.classId}/students/bulk-enroll`, {
        data: {
          students: [
            { name: `${TEST_TAG}甲生`, student_number: `${STUDENT_PREFIX}${suffix}_1` },
            { name: `${TEST_TAG}乙生`, student_number: `${STUDENT_PREFIX}${suffix}_2` },
          ],
        },
      })
      .catch(() => {});
  }

  // 4. 两条排课（今天的上午 + 下午）—— 课表页的分行渲染靠它触发
  if (seeded.classId && seeded.lessonId) {
    const today = new Date().toISOString().split('T')[0];
    await request
      .post(`/api/classes/${seeded.classId}/schedules/batch`, {
        data: {
          schedules: [
            { lessonId: seeded.lessonId, scheduledDate: today, timeSlot: '08:00 - 08:45', status: 'scheduled' },
            { lessonId: seeded.lessonId, scheduledDate: today, timeSlot: '14:00 - 14:45', status: 'scheduled' },
          ],
        },
      })
      .catch(() => {});
  }

  return seeded;
}

const TABS = [
  { name: '课程管理', hash: '#/courses' },
  { name: '班级管理', hash: '#/classes' },
  { name: '课表管理', hash: '#/timetable' },
  { name: '互动课堂', hash: '#/live_class' },
  { name: '测评中心', hash: '#/assessments' },
  { name: '插件中心', hash: '#/plugins' },
  { name: '管理后台', hash: '#/admin' },
  { name: '帮助文档', hash: '#/help' },
  { name: '工作台', hash: '#/dashboard' },
];

async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * 等浮层（toast）稳定后再扫描。
 *
 * 背景：toast 是**全局**浮层，由上一个工作区的动作触发 —— 例如进入「互动课堂」时
 * 会自动锁定全班并弹一条「🔒 锁状态更新」。而 SPA 的 hash 路由切换**不重新加载页面**
 * （`page.goto('/#/x')` 在只改 hash 时是同文档导航），于是这条 toast 会跨工作区残留。
 *
 * 实测（2026-10-25）：它恰好在「测评中心」的扫描窗口里入场，axe 按元素不透明度混合
 * 前景/背景 → 报出一条并不存在的对比度违规，让整条无障碍门禁在「单跑绿 / 全量跑红」
 * 之间摇摆（`e2e-full-coverage` job 因带 continue-on-error 一直没人看见）。
 *
 * 这里等入场动画跑完（不透明度归位）再扫描：既保留「toast 自身也要合规」的覆盖，
 * 又让门禁不再依赖 toast 出现的时机。配合 ToastContainer 不再做透明度淡入
 * （文字全程以完整不透明度渲染），这一步实际上总是立即满足。
 */
async function settleOverlays(page: Page) {
  await page
    .waitForFunction(
      () => {
        const toasts = Array.from(document.querySelectorAll('[id^="toast-"]'));
        return toasts.every((t) => Number(getComputedStyle(t).opacity) >= 0.99);
      },
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {
      // 超时不视为失败：没有 toast 时条件立即成立；始终不满足时由随后的 axe 断言兜底。
    });
}

async function expectNoViolations(page: Page, surface: string) {
  await settleOverlays(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const offenders = results.violations.flatMap((v) =>
    v.nodes.slice(0, 5).map((n) => {
      const html = (n.html || '').replace(/\s+/g, ' ').slice(0, 160);
      return `[${v.id}/${v.impact}] ${n.target.join(' ')} :: ${html}`;
    }),
  );
  expect(offenders, `${surface} 存在 WCAG A/AA 违规：\n${offenders.join('\n')}`).toEqual([]);
}

test.describe('无障碍门禁（WCAG 2.0/2.1 A+AA）', () => {
  test('登录页无违规', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(1500);
    await freezeAnimations(page);
    await expectNoViolations(page, '登录页');
    await ctx.close();
  });

  test('教师端主要工作区无违规', async ({ page, context }) => {
    test.setTimeout(300_000);
    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto('/');
    // 侧边栏只在已登录的教师壳里渲染 —— 用它而不是文本长度判断「壳已就绪」。
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 });

    // 先播一份数据现场，让 9 个页面进入「填充态」再扫 ——
    // 否则空库下不渲染的元素（课表分行、花名册…）永远不会被检查到。
    await seedTeacherWorkspaceData(context.request);
    // 播种后重新载入，确保各页首次拉取就带着数据
    await page.reload();
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 });

    for (const tab of TABS) {
      await page.goto(`/${tab.hash}`);
      // 侧边栏 + 主体渲染完成（页面数据依赖若干接口，给足时间）
      await page.waitForTimeout(2500);
      await freezeAnimations(page);
      await expectNoViolations(page, tab.name);
    }
  });

  test('学生端课中界面与互动浮层无违规', async ({ page, context, request }) => {
    test.setTimeout(360_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `${STUDENT_PREFIX}${suffix}`;

    // 1. 教师侧准备：课节 + 班级 + 学生 + 会话进入课中
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const lessonRes = await request.post('/api/lessons', {
      data: { title: `${LESSON_PREFIX}学生端课节 ${suffix}`, content: '无障碍门禁' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    const classRes = await request.post('/api/classes', {
      data: { name: `${CLASS_PREFIX}班级 ${suffix}`, grade: '高一' },
    });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `${TEST_TAG}学生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
      data: { studentId: (await stuRes.json()).id },
    });

    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
      data: { classId, teachingModeId: 'lecture' },
    });
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
      data: { stage: 'IN_CLASS_TEACHING', classId },
    });

    // 2. 学生登录并进入课中
    await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    const studentUrl = `/?mode=student_live&lessonId=${encodeURIComponent(lessonId)}`;
    const loadStudent = async () => {
      await page.goto(studentUrl);
      // 底部「课堂互动工具栏」只在学生壳渲染出来后存在
      await page.waitForSelector('aside[aria-label="课堂互动工具栏"]', { timeout: 30_000 });
      await freezeAnimations(page);
    };

    // 3. 学生端课中壳（含白板/课件/作业 Tab 与互动浮层槽位）
    await loadStudent();
    await expectNoViolations(page, '学生端课中界面');

    // 4. 极速投票作答卡
    const pollRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll`, {
      data: { title: `${TEST_TAG} 投票 ${suffix}`, questionType: 'ABCD', options: ['A', 'B', 'C', 'D'] },
    });
    expect(pollRes.ok()).toBeTruthy();
    await loadStudent();
    await expect(page.locator('[data-testid="student-quick-poll-card"]')).toBeVisible({ timeout: 25_000 });
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·极速投票作答卡');

    // 5. 毫秒抢答模态
    await request.post(
      `/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll/${encodeURIComponent(
        (await pollRes.json()).poll?.id ?? '',
      )}/close`,
    );
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/buzzer`, {
      data: { title: `${TEST_TAG} 全班极速抢答` },
    });
    await loadStudent();
    await expect(page.getByRole('button', { name: '抢！' })).toBeVisible({ timeout: 25_000 });
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·毫秒抢答');

    // 6. 结课通票模态（WRAP_UP_EXIT_TICKET 阶段自动弹出）
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
      data: { stage: 'WRAP_UP_EXIT_TICKET', classId },
    });
    await loadStudent();
    await expect(page.locator('[data-testid="adaptive-exit-ticket-modal"]')).toBeVisible({ timeout: 25_000 });
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·结课通票');

    // 结课归档，防止未结束的通票状态泄漏到后续测试
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
      data: { stage: 'ARCHIVED_REPORT', classId },
    });
  });

  test('学生端「我的测评」列表与作答界面无违规', async ({ page, context, request }) => {
    test.setTimeout(360_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `${STUDENT_PREFIX}${suffix}`;

    // 1. 教师侧准备：班级 + 学生 + 一份已发布的测评
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const classRes = await request.post('/api/classes', { data: { name: `${CLASS_PREFIX}测评班 ${suffix}` } });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `${TEST_TAG}测评生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
      data: { studentId: (await stuRes.json()).id },
    });

    const assessmentRes = await request.post('/api/assessments', {
      data: { kind: 'quiz', title: `${TEST_TAG} 测评 ${suffix}`, description: '无障碍门禁覆盖' },
    });
    expect(assessmentRes.ok()).toBeTruthy();
    const assessmentId: string = (await assessmentRes.json()).id;
    const itemsRes = await request.put(`/api/assessments/${encodeURIComponent(assessmentId)}/items`, {
      data: {
        items: [
          {
            type: 'single_choice',
            stem: '生态系统能量最终来源？',
            config: { options: ['太阳能', '地热', '化学能'] },
            answerKey: { index: 0 },
            maxScore: 5,
            sortOrder: 0,
          },
          {
            type: 'fill_blank',
            stem: '生产者通过____作用固定太阳能。',
            config: { blanks: [{ id: 'b1' }] },
            answerKey: { blanks: [['光合作用']] },
            maxScore: 5,
            sortOrder: 1,
          },
        ],
      },
    });
    expect(itemsRes.ok()).toBeTruthy();
    const publishRes = await request.post(`/api/assessments/${encodeURIComponent(assessmentId)}/publish`, {
      data: { classId },
    });
    expect(publishRes.ok()).toBeTruthy();

    // 2. 学生登录（仪表盘 → 我的测评）
    await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto('/');
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 }).catch(() => {});

    const openAssessments = page.getByRole('button', { name: /打开我的测评/ });
    await openAssessments.waitFor({ state: 'visible', timeout: 30_000 });

    // 若有结课通票或引导遮罩层拦截，优先关闭
    const exitTicketClose = page.locator('[data-testid="adaptive-exit-ticket-modal"] button[aria-label="Close"]');
    if (await exitTicketClose.isVisible({ timeout: 1500 }).catch(() => false)) {
      await exitTicketClose.click();
      await page.waitForTimeout(300);
    }

    await openAssessments.click();

    // 3. 列表（待完成）
    await page.locator('[data-testid="student-pending-list"]').waitFor({ state: 'visible', timeout: 30_000 });
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·我的测评列表');

    // 4. 作答界面（含单选与填空控件、倒计时）
    await page
      .getByRole('button', { name: /开始作答/ })
      .first()
      .click();
    await page.locator('[data-testid^="answer-item-"]').first().waitFor({ state: 'visible', timeout: 30_000 });
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·测评作答界面');
  });

  test('学生端仪表盘与作业作答面板无违规', async ({ page, context, request }) => {
    test.setTimeout(360_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `${STUDENT_PREFIX}${suffix}`;

    // 1. 教师侧准备：课节 + 班级 + 学生（不发起课堂，避免 locked_lesson_id
    //    把学生强行推进课中视图 —— 仪表盘只在未锁定时可达）
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const lessonRes = await request.post('/api/lessons', {
      data: { title: `${LESSON_PREFIX}仪表盘课节 ${suffix}`, content: '无障碍门禁' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    const classRes = await request.post('/api/classes', {
      data: { name: `${CLASS_PREFIX}班级 ${suffix}`, grade: '高一' },
    });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `${TEST_TAG}学生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    const studentId: string = (await stuRes.json()).id;
    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, { data: { studentId } });

    // 2. 布置一份作业（含题目），学生端「作业」Tab 才会出现作答入口
    const asgRes = await request.post('/api/assignments', {
      data: {
        title: `${TEST_TAG} 作业 ${suffix}`,
        description: '无障碍门通用例',
        classId,
        lessonId,
        dueDate: null,
        questions: [
          {
            id: 'q1',
            type: 'single_choice',
            question: '无障碍的核心目标是什么？',
            options: ['更漂亮', '让所有人都能用', '更快的加载', '更少的代码'],
            correctAnswer: 1,
          },
          {
            id: 'q2',
            type: 'true_false',
            question: '对比度需要达到 WCAG AA。',
            correctAnswer: true,
          },
        ],
      },
    });
    expect(asgRes.ok()).toBeTruthy();

    // 3. 学生登录（不传 lessonId → 不进入课中锁定视图）
    await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    // 4. 学生仪表盘：学生端未锁定课节时的默认视图。
    //    注意「有活跃课堂」会锁到课中视图，所以这里不 init 会话。
    await page.goto('/?mode=student_live');
    await page.waitForTimeout(2500);
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端仪表盘');

    // 5. 作业提交与互评面板：学生端课中视图的作业 Tab（该视图下才有作业入口）
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
      data: { classId, teachingModeId: 'lecture' },
    });
    await page.goto(`/?mode=student_live&lessonId=${encodeURIComponent(lessonId)}`);
    // Issue #131: 课前破冰打卡弹窗会在进入课中视图时自动弹出，先跳过以免遮挡后续交互
    const icebreakerModal = page.getByTestId('student-icebreaker-modal');
    const modalShown = await icebreakerModal
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (modalShown) {
      await page.getByTestId('icebreaker-skip-btn').click();
    }
    const assignmentTab = page.getByRole('button', { name: /作业提交与互评|Assignments & Peer Reviews/ }).first();
    await expect(assignmentTab).toBeVisible({ timeout: 25_000 });
    await assignmentTab.click();
    await page.waitForTimeout(1500);
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·作业提交与互评');
  });

  // 清理：本用例建的课节/班级/学生/课堂会话一律不留残。
  // 否则未归档的会话会以「进行中的课堂会话」出现在后续用例的互动课堂首屏，
  // 既改变被检查的页面（a11y 结论不再可比），也让断言时序相关。
  test.afterAll(async ({ request }) => {
    await request
      .post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      })
      .catch(() => {});

    const lessonsRes = await request.get('/api/lessons').catch(() => null);
    if (lessonsRes?.ok()) {
      const lessons = await lessonsRes.json();
      const arr = Array.isArray(lessons) ? lessons : (lessons?.lessons ?? lessons?.data ?? []);
      for (const l of arr) {
        if (String(l.title ?? '').startsWith(LESSON_PREFIX)) {
          await request.delete(`/api/lessons/${encodeURIComponent(l.id)}`).catch(() => {});
        }
      }
    }

    const classesRes = await request.get('/api/classes').catch(() => null);
    if (classesRes?.ok()) {
      const classes = await classesRes.json();
      const arr = Array.isArray(classes) ? classes : (classes?.classes ?? classes?.data ?? []);
      for (const c of arr) {
        if (String(c.name ?? '').startsWith(CLASS_PREFIX)) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }

    const studentsRes = await request.get('/api/students').catch(() => null);
    if (studentsRes?.ok()) {
      const students = await studentsRes.json();
      const arr = Array.isArray(students) ? students : (students?.students ?? students?.data ?? []);
      for (const s of arr) {
        if (String(s.student_number ?? '').startsWith(STUDENT_PREFIX)) {
          await request.delete(`/api/students/${encodeURIComponent(s.id)}`).catch(() => {});
        }
      }
    }
  });
});
