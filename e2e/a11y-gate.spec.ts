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
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TABS = [
  { name: '课程管理', hash: '#/courses' },
  { name: '班级管理', hash: '#/classes' },
  { name: '课表管理', hash: '#/timetable' },
  { name: '互动课堂', hash: '#/live_class' },
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

async function expectNoViolations(page: Page, surface: string) {
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
    const studentNum = `STU_A11Y_${suffix}`;

    // 1. 教师侧准备：课节 + 班级 + 学生 + 会话进入课中
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const lessonRes = await request.post('/api/lessons', {
      data: { title: `A11Y 学生端课节 ${suffix}`, content: '无障碍门禁' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    const classRes = await request.post('/api/classes', { data: { name: `A11Y 班级 ${suffix}`, grade: '高一' } });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `A11Y学生${suffix.slice(0, 4)}`, password: 'password123' },
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
      data: { title: `A11Y 投票 ${suffix}`, questionType: 'ABCD', options: ['A', 'B', 'C', 'D'] },
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
      data: { title: '全班极速抢答' },
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
  });

  test('学生端仪表盘与作业作答面板无违规', async ({ page, context, request }) => {
    test.setTimeout(360_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `STU_A11Y2_${suffix}`;

    // 1. 教师侧准备：课节 + 班级 + 学生（不发起课堂，避免 locked_lesson_id
    //    把学生强行推进课中视图 —— 仪表盘只在未锁定时可达）
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const lessonRes = await request.post('/api/lessons', {
      data: { title: `A11Y2 仪表盘课节 ${suffix}`, content: '无障碍门禁' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    const classRes = await request.post('/api/classes', { data: { name: `A11Y2 班级 ${suffix}`, grade: '高一' } });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `A11Y2学生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    const studentId: string = (await stuRes.json()).id;
    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, { data: { studentId } });

    // 2. 布置一份作业（含题目），学生端「作业」Tab 才会出现作答入口
    const asgRes = await request.post('/api/assignments', {
      data: {
        title: `A11Y2 作业 ${suffix}`,
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
    const assignmentTab = page.getByRole('button', { name: /作业提交与互评|Assignments & Peer Reviews/ }).first();
    await expect(assignmentTab).toBeVisible({ timeout: 25_000 });
    await assignmentTab.click();
    await page.waitForTimeout(1500);
    await freezeAnimations(page);
    await expectNoViolations(page, '学生端·作业提交与互评');
  });
});
