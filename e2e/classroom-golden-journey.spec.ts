/**
 * 归属：课堂 / 黄金旅程 —— 建课→上课→互动→下課的端到端黄金旅程
 *
 * Issue #230：CI 改为跑 e2e/ 下**全部**用例（pnpm test:e2e），
 * 本注释用于标明该用例覆盖的能力域 —— 新增用例时按同一口径挂靠。
 */
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { enterEntryPortal } from './fixtures/classroom-entry';

function logEvidence(msg: string) {
  const logDir = path.resolve(process.cwd(), 'artifacts/logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const logFile = path.join(logDir, 'e2e_golden_journey.log');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(`[GoldenJourney] ${msg}`);
}

function purgeGoldenJourneyFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db.prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 黄金旅程%'").all() as { id: string }[];

    if (e2eLessons.length > 0) {
      const lessonIds = e2eLessons.map((l) => l.id);
      const placeholders = lessonIds.map(() => '?').join(',');

      db.prepare(`DELETE FROM whiteboard_elements WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM student_lesson_progress WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM schedules WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM assignments WHERE lesson_id IN (${placeholders})`).run(...lessonIds);

      try {
        const sessions = db
          .prepare(`SELECT id FROM classroom_sessions WHERE lesson_id IN (${placeholders})`)
          .all(...lessonIds) as { id: string }[];
        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);
          const sPlaceholders = sessionIds.map(() => '?').join(',');
          try {
            db.prepare(
              `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders}))`,
            ).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_buzzers WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_exit_tickets WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_feed WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_pacing_signals WHERE session_id IN (${sPlaceholders})`).run(
              ...sessionIds,
            );
          } catch {}
        }
        db.prepare(`DELETE FROM classroom_sessions WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      } catch {}

      db.prepare(`DELETE FROM lessons WHERE id IN (${placeholders})`).run(...lessonIds);
    }

    const e2eClasses = db.prepare("SELECT id FROM classes WHERE name LIKE 'E2E 黄金班级%'").all() as { id: string }[];

    if (e2eClasses.length > 0) {
      const classIds = e2eClasses.map((c) => c.id);
      const placeholders = classIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM class_students WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM schedules WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM classes WHERE id IN (${placeholders})`).run(...classIds);
    }

    const e2eStudents = db.prepare("SELECT id FROM students WHERE student_number LIKE 'STU_GOLDEN_%'").all() as {
      id: string;
    }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const placeholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${placeholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${placeholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${placeholders})`).run(...studentIds);
    }
  } finally {
    db.close();
  }
}

async function cleanupGoldenJourneyViaApi(request: APIRequestContext) {
  await request
    .post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    })
    .catch(() => {});

  try {
    const listRes = await request.get('/api/lessons');
    if (listRes.ok()) {
      const lessons = await listRes.json();
      const arr = Array.isArray(lessons) ? lessons : [];
      for (const l of arr) {
        if (l.title?.startsWith('E2E 黄金旅程')) {
          await request.delete(`/api/lessons/${encodeURIComponent(l.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  try {
    const cRes = await request.get('/api/classes');
    if (cRes.ok()) {
      const classes = await cRes.json();
      const arr = Array.isArray(classes) ? classes : [];
      for (const c of arr) {
        if (c.name?.startsWith('E2E 黄金班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

test.describe('师生双端一镜到底课堂全生命周期黄金旅程 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupGoldenJourneyViaApi(request);
    purgeGoldenJourneyFromDb();
    logEvidence('beforeAll 清理就绪');
  });

  test.afterAll(async ({ request }) => {
    await cleanupGoldenJourneyViaApi(request);
    purgeGoldenJourneyFromDb();
    logEvidence('afterAll 清理就绪');
  });

  test('打通 Stage 1 课前准备 → Stage 2 课中授课与中控互动 → Stage 3 课后自适应小结 → Stage 4 全景简报与双向流转 (Generates Artifact: Screenshot)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 黄金旅程全流程 ${suffix}`;
    const className = `E2E 黄金班级 ${suffix}`;
    const stuNum = `STU_GOLDEN_${suffix}`;
    const studentName = `黄金体验生_${suffix.slice(0, 4)}`;

    let lessonId = '';
    let classId = '';
    let studentId = '';

    // 创建截图输出目录
    const screenshotDir = path.resolve(process.cwd(), 'artifacts/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // 0. 准备测试数据 (创建课程、班级、绑定学生)
    logEvidence('Step 0: 初始化课节与班级数据');
    const adminLogin = await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    expect(adminLogin.ok()).toBeTruthy();

    const clsRes = await request.post('/api/classes', {
      data: { name: className, description: 'Golden Journey Fixture Class' },
    });
    expect(clsRes.ok()).toBeTruthy();
    const clsData = await clsRes.json();
    classId = clsData.id;

    const lessonRes = await request.post('/api/lessons', {
      data: {
        title: lessonTitle,
        content: '变力做功微元法与物理探究全景授课',
        timeline: JSON.stringify([
          { id: 'seg_intro', title: '1. 情境导入: 变力功现象', duration: 300 },
          { id: 'seg_core', title: '2. 核心探究: 微元累加积分法', duration: 600 },
          { id: 'seg_quiz', title: '3. 课堂实战: 极速投票与反馈', duration: 300 },
        ]),
      },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonData = await lessonRes.json();
    lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;
    expect(lessonId).toBeTruthy();

    // 初始化课堂会话，注入真实自适应题目与进阶挑战题
    const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
      data: {
        classId,
        teachingModeId: 'lecture',
        exitTicketCoreQuestion: {
          id: 'core-golden-1',
          question: '关于变力沿曲线轨道做功过程，下列说法严格正确的是：',
          options: [
            { key: 'A', text: '可以直接利用恒力做功公式 W = F·s·cosθ 统一计算' },
            { key: 'B', text: '可将位移划分为无限小微元 Δs，在每个微元内以恒代变累加求和' },
            { key: 'C', text: '只要动能有变化，机械能一定严格守恒' },
            { key: 'D', text: '变力做功的数值与运动路径完全无关' },
          ],
          correctOption: 'B',
          explanation:
            '变力方向或大小随位置改变，不能直接套用恒力公式；微元法（微分与积分思想）是求解变力功的根本物理方法。',
          scaffoldHint:
            '⚠️ 巩固支架提示：请回顾牛顿第二定律与微积分思想，变力无法一次求和，必须采用 F-s 面积或微元累加！',
        },
        exitTicketChallengeQuestion: {
          id: 'challenge-golden-1',
          title: '高阶思维跃迁：变力与非弹性碰撞复合临界',
          prompt: '若物块在变阻力 f = -kv 作用下滑动并与弹性挡板碰撞，下列守恒与极限关系成立的是：',
          options: [
            { key: 'A', text: '全程动量守恒且机械能保持守恒' },
            { key: 'B', text: '当速度衰减为 0 前，系统动量损耗率与瞬时阻力成正比' },
            { key: 'C', text: '滑动阻力做功仅取决于物块最终停止位置与重力势能无关' },
            { key: 'D', text: '以上均不正确' },
          ],
          correctOption: 'B',
          rewardBadge: '🏅 物理探究思维跃迁徽章',
        },
      },
    });
    expect(initRes.ok()).toBeTruthy();

    // 录入学生并加入班级
    const stuRes = await request.post('/api/students', {
      data: { name: studentName, student_number: stuNum, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();
    const stuData = await stuRes.json();
    studentId = stuData.id;
    await request.post(`/api/classes/${classId}/students`, { data: { studentId } });

    // ── 建立双浏览器 Context ──
    const teacherContext: BrowserContext = await browser.newContext();
    const studentContext: BrowserContext = await browser.newContext();

    const teacherPage: Page = await teacherContext.newPage();
    const studentPage: Page = await studentContext.newPage();

    try {
      // 教师端登录
      await teacherContext.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      await teacherPage.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));

      // 学生端登录
      await studentContext.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: stuNum, password: 'password123' },
      });
      await studentPage.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));

      // =========================================================================
      // Stage 1: 课前准备阶段 (PRE_CLASS_READY)
      // =========================================================================
      logEvidence('Stage 1: 教师通过开课门户选班并启动课堂');
      await teacherPage.goto(`/?mode=teacher_live&lessonId=${lessonId}`);

      // Issue #91：首屏是「进行中的课堂会话」列表 —— 回到起始门户再走选班开课流程。
      await enterEntryPortal(teacherPage);

      // 开课门户：等待并选择班级，点击「开始上课」
      const classSelectBtn = teacherPage.getByRole('button', { name: new RegExp(className) }).first();
      await expect(classSelectBtn).toBeVisible({ timeout: 15_000 });
      await classSelectBtn.click();

      const startClassBtn = teacherPage.getByRole('button', { name: /开始上课/ });
      await expect(startClassBtn).toBeEnabled({ timeout: 10_000 });
      await startClassBtn.click();

      await expect(teacherPage.locator('#pre-class-ready-view')).toBeVisible({ timeout: 20_000 });
      await expect(teacherPage.locator('#pre-class-ready-view').getByText(lessonTitle)).toBeVisible();

      // 验证环境一键飞检弹窗
      const healthcheckBtn = teacherPage.locator('button:has-text("环境一键飞检")');
      await expect(healthcheckBtn).toBeVisible();
      await healthcheckBtn.click();
      const healthModal = teacherPage.locator('[data-testid="preflight-health-modal"]');
      await expect(healthModal).toBeVisible({ timeout: 10_000 });
      const dismissHealthBtn = healthModal.locator('button:has-text("完成自检并返回")');
      await dismissHealthBtn.click();
      await expect(healthModal).toBeHidden({ timeout: 5_000 });

      // 学生端加入课前课堂
      await studentPage.goto(`/?mode=student_live&lessonId=${lessonId}`);
      await expect(studentPage.getByText('互动课堂 · 学生端')).toBeVisible({ timeout: 20_000 });

      // Issue #131：进入课中视图会自动弹出「课前破冰心情打卡」弹窗，
      // 它是 aria-modal 的全屏遮罩，会拦截浮动工具栏的点击 —— 先跳过。
      const icebreakerModal = studentPage.getByTestId('student-icebreaker-modal');
      const icebreakerShown = await icebreakerModal
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (icebreakerShown) {
        await studentPage.getByTestId('icebreaker-skip-btn').click();
        await expect(icebreakerModal).toBeHidden({ timeout: 10_000 });
      }

      // 截图存盘：Stage 1 课前准备
      const STAGE1_SHOT = path.join(screenshotDir, 'golden_journey_stage1_pre_class.png');
      await teacherPage.screenshot({ path: STAGE1_SHOT });
      expect(fs.existsSync(STAGE1_SHOT)).toBe(true);
      logEvidence('Stage 1 课前准备完成并存盘');

      // 教师点击 Hero CTA: 进入正式课中授课 (IN_CLASS_TEACHING)
      const startTeachBtn = teacherPage.locator('button#pre-class-start-teaching-btn');
      await expect(startTeachBtn).toBeVisible();
      await startTeachBtn.click();

      // =========================================================================
      // Stage 2: 课中授课与中控互动 (IN_CLASS_TEACHING)
      // =========================================================================
      logEvidence('Stage 2: 推进至课中授课白板');
      await expect(teacherPage.getByText('教学步骤与页面大纲')).toBeVisible({ timeout: 20_000 });
      await expect(teacherPage.getByText('Live Broadcaster Connected')).toBeVisible({ timeout: 15_000 });

      // 1. 发起限时倒计时测试
      logEvidence('Stage 2: 启动限时倒计时');
      const startCountdownBtn = teacherPage.locator('#classroom-countdown-start-btn');
      await expect(startCountdownBtn).toBeVisible();
      await startCountdownBtn.click();

      // 学生端感知倒计时横幅
      const studentCountdownBanner = studentPage.locator('#student-classroom-countdown-banner');
      await expect(studentCountdownBanner).toBeVisible({ timeout: 15_000 });

      // 2. 教师端发起极速投票 (Quick Poll)
      logEvidence('Stage 2: 教师发起极速投票');
      const quickPollBtn = teacherPage.locator('button:has-text("极速投票")');
      await expect(quickPollBtn).toBeVisible();
      await quickPollBtn.click();

      await expect(teacherPage.getByText('极速投票配置')).toBeVisible({ timeout: 10_000 });
      const launchPollBtn = teacherPage.locator('button:has-text("立即发布")');
      await expect(launchPollBtn).toBeVisible();
      await launchPollBtn.click();

      // 学生端弹出投票卡片并作答
      logEvidence('Stage 2: 学生端接收投票卡并投票');
      const pollCard = studentPage.locator('[data-testid="student-quick-poll-card"]');
      await expect(pollCard).toBeVisible({ timeout: 20_000 });
      const pollOptionB = pollCard.getByRole('button', { name: 'B', exact: true });
      await expect(pollOptionB).toBeVisible();
      await pollOptionB.click();
      await expect(studentPage.getByText('已提交')).toBeVisible({ timeout: 10_000 });

      // 教师端统计人数实时更新并关闭投票
      logEvidence('Stage 2: 教师端结束投票');
      const closePollBtn = teacherPage.locator('button:has-text("结束投票")');
      await expect(closePollBtn).toBeVisible({ timeout: 15_000 });
      await closePollBtn.click();

      // 教师端解除专注锁定，放开学生节奏信号与互动
      logEvidence('Stage 2: 教师端解除专注锁定');
      const unlockClassBtn = teacherPage.locator('button:has-text("锁定 · 解锁")').first();
      if (await unlockClassBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await unlockClassBtn.click();
      }

      // 3. 学生端反馈学习节奏晴雨表 (Too Fast)
      logEvidence('Stage 2: 学生发送节奏信号');
      const tooFastBtn = studentPage.locator('button:has-text("讲太快")');
      await expect(tooFastBtn).toBeVisible();
      await expect(tooFastBtn).toBeEnabled({ timeout: 10_000 });
      await tooFastBtn.click();

      // 截图存盘：Stage 2 课中授课
      const STAGE2_SHOT = path.join(screenshotDir, 'golden_journey_stage2_live_teaching.png');
      await teacherPage.screenshot({ path: STAGE2_SHOT });
      expect(fs.existsSync(STAGE2_SHOT)).toBe(true);

      // 教师点击推进进入课后小结
      logEvidence('Stage 2 -> Stage 3: 教师点击推进进入课后');
      const advanceToWrapupBtn = teacherPage.locator('button:has-text("完成授课，进入课后")');
      await expect(advanceToWrapupBtn).toBeVisible();
      await advanceToWrapupBtn.click();

      // =========================================================================
      // Stage 3: 课后小结与自适应通票闭环 (WRAP_UP_EXIT_TICKET)
      // =========================================================================
      logEvidence('Stage 3: 进入课后小结');
      await expect(teacherPage.locator('button#post-class-advance-report-btn')).toBeVisible({ timeout: 20_000 });

      // 学生端自动弹出 60s 自适应结课通票
      logEvidence('Stage 3: 学生端弹出自适应结课通票');
      const ticketModal = studentPage.locator('[data-testid="adaptive-exit-ticket-modal"]');
      await expect(ticketModal).toBeVisible({ timeout: 25_000 });

      // 作答核心概念必做题 (选项 B)
      const coreOptB = ticketModal.locator('button').filter({ hasText: '可将位移划分为无限小微元' }).first();
      await expect(coreOptB).toBeVisible();
      await coreOptB.click();
      const confirmCoreBtn = ticketModal.getByRole('button', { name: '确认本题答案' });
      await confirmCoreBtn.click();

      // 验证概念通关并解锁 Lv.2 挑战题分支
      await expect(studentPage.getByText('✓ 概念通关')).toBeVisible({ timeout: 10_000 });
      const challengeBranch = studentPage.locator('[data-testid="challenge-branch"]');
      await expect(challengeBranch).toBeVisible();

      // 作答挑战题 (选项 B)
      const chalOptB = challengeBranch.locator('button').filter({ hasText: '当速度衰减为 0 前' }).first();
      await chalOptB.click();

      // 填写卡点与建议并提交
      const confusedInput = ticketModal.locator('input[placeholder*="卡点"]');
      await confusedInput.fill('微积分微元思想在力矩与动量中的复合迁移');
      const submitTicketBtn = ticketModal.getByRole('button', { name: '提交自适应结课通票' });
      await submitTicketBtn.click();

      // 验证提交成功并关闭
      await expect(studentPage.getByText('结课通票提交成功！')).toBeVisible({ timeout: 15_000 });
      await ticketModal.getByRole('button', { name: '完成' }).click();
      await expect(ticketModal).toBeHidden({ timeout: 10_000 });

      // 教师端切到通票学情 Tab 查看词云与点亮知识树
      logEvidence('Stage 3: 教师端查看词云与点亮知识树');
      const exitTicketTab = teacherPage.locator('button:has-text("60s 结课通票反馈")');
      await expect(exitTicketTab).toBeVisible();
      await exitTicketTab.click();

      const openTreeBtn = teacherPage.locator('button:has-text("点亮本堂课知识树")');
      await expect(openTreeBtn).toBeVisible({ timeout: 15_000 });
      await openTreeBtn.click();

      const treeModal = teacherPage.locator('[data-testid="knowledge-tree-lighting-modal"]');
      await expect(treeModal).toBeVisible({ timeout: 10_000 });
      const lightTreeBtn = treeModal.locator('button:has-text("点亮本堂课困惑点知识树")');
      await expect(lightTreeBtn).toBeVisible();
      await lightTreeBtn.click();

      // 验证勋章点亮
      await expect(treeModal.locator('[data-testid="tree-lit-badge"]')).toBeVisible({ timeout: 10_000 });
      await treeModal.locator('button[aria-label="Close"]').click();
      await expect(treeModal).toBeHidden({ timeout: 5_000 });

      // 教师输入反思备忘录
      const hwTab = teacherPage.locator('button:has-text("课后任务下发与反思备忘")');
      await hwTab.click();
      const reflectionArea = teacherPage.locator('textarea[placeholder*="记录本次课的教学亮点"]');
      await expect(reflectionArea).toBeVisible();
      await reflectionArea.fill('本节课微元法实验引入反响强烈，部分同学在非弹性极限时仍存卡点，下次课需增加微元图解。');
      await teacherPage.locator('button:has-text("保存反思记录")').click();

      // 截图存盘：Stage 3 课后小结
      const STAGE3_SHOT = path.join(screenshotDir, 'golden_journey_stage3_post_class.png');
      await teacherPage.screenshot({ path: STAGE3_SHOT });
      expect(fs.existsSync(STAGE3_SHOT)).toBe(true);

      // 推进至结课报告
      logEvidence('Stage 3 -> Stage 4: 推进至全景简报');
      const advanceReportBtn = teacherPage.locator('button#post-class-advance-report-btn');
      await expect(advanceReportBtn).toBeVisible();
      await advanceReportBtn.click();

      // =========================================================================
      // Stage 4: 课节全景简报看板与双向回退校验 (ARCHIVED_REPORT)
      // =========================================================================
      logEvidence('Stage 4: 进入全景学情看板');
      await expect(teacherPage.locator('#classroom-briefing-view')).toBeVisible({ timeout: 20_000 });
      await expect(teacherPage.getByText('课堂学情全景简报')).toBeVisible();

      // 校验 KPI 看板关键卡片
      await expect(teacherPage.getByText('全班出勤率')).toBeVisible();
      await expect(teacherPage.getByText('随堂测验正确率')).toBeVisible();
      await expect(teacherPage.getByText('结课通票评分')).toBeVisible();
      await expect(teacherPage.getByText('教学节奏晴雨表')).toBeVisible();

      // 验证 CSV 导出按钮
      const exportCsvBtn = teacherPage.locator('#briefing-export-csv-btn');
      await expect(exportCsvBtn).toBeVisible();

      // 验证双向回退能力：从简报回退课中白板
      logEvidence('Stage 4: 测试双向回退能力（简报 -> 课中白板）');
      const backToTeachingBtn = teacherPage.locator('button:has-text("返回课中白板")');
      await expect(backToTeachingBtn).toBeVisible();
      await backToTeachingBtn.click();
      await expect(teacherPage.getByText('教学步骤与页面大纲')).toBeVisible({ timeout: 15_000 });

      // 再次推进至简报完成闭环
      const advanceAgainBtn = teacherPage.locator('button:has-text("完成授课，进入课后")');
      await advanceAgainBtn.click();
      await expect(teacherPage.locator('button#post-class-advance-report-btn')).toBeVisible({ timeout: 15_000 });
      await teacherPage.locator('button#post-class-advance-report-btn').click();
      await expect(teacherPage.locator('#classroom-briefing-view')).toBeVisible({ timeout: 15_000 });
      await expect(teacherPage.getByText('课堂学情全景简报')).toBeVisible();

      // 截图存盘：Stage 4 课节全景简报
      const STAGE4_SHOT = path.join(screenshotDir, 'golden_journey_stage4_briefing.png');
      await teacherPage.screenshot({ path: STAGE4_SHOT });
      expect(fs.existsSync(STAGE4_SHOT)).toBe(true);

      logEvidence('黄金旅程端到端全流程 100% 成功达成！');
    } finally {
      await teacherContext.close().catch(() => {});
      await studentContext.close().catch(() => {});
      if (lessonId) {
        await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      }
      if (classId) {
        await request.delete(`/api/classes/${classId}`).catch(() => {});
      }
    }
  });
});
