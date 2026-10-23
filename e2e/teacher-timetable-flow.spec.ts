/**
 * 归属：教师端 / 课表流程 —— 课表编排与课节生成
 *
 * Issue #230：CI 改为跑 e2e/ 下**全部**用例（pnpm test:e2e），
 * 本注释用于标明该用例覆盖的能力域 —— 新增用例时按同一口径挂靠。
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeTimetableE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 课表班级%'")
      .all() as { id: string }[];

    if (e2eClasses.length > 0) {
      const classIds = e2eClasses.map((c) => c.id);
      const placeholders = classIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM class_students WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM schedules WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM classes WHERE id IN (${placeholders})`).run(...classIds);
    }

    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 课表课程%'")
      .all() as { id: string }[];

    if (e2eLessons.length > 0) {
      const lessonIds = e2eLessons.map((l) => l.id);
      const placeholders = lessonIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM schedules WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM lessons WHERE id IN (${placeholders})`).run(...lessonIds);
    }
  } finally {
    db.close();
  }
}

test.describe('教务管理端：日常课表中心与排课调度 E2E 测试', () => {
  test.beforeAll(() => {
    purgeTimetableE2EFromDb();
  });

  test.afterAll(() => {
    purgeTimetableE2EFromDb();
  });

  test('课表周历看板视图切换、新增排课表单提交、卡片渲染与删除 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const className = `E2E 课表班级-${ts}`;
    const lessonTitle = `E2E 课表课程-${ts}`;
    let createdClassId: string | null = null;
    let createdLessonId: string | null = null;

    try {
      // 1. 教师/管理员鉴权登录
      const loginRes = await context.request.post('/api/auth/login', {
        data: {
          entrance: 'teacher',
          username: 'admin',
          password: 'admin',
        },
      });
      expect(loginRes.ok(), '登录管理员应成功').toBeTruthy();

      // 2. 预先创建测试班级与测试课节
      const classRes = await context.request.post('/api/classes', {
        data: { name: className },
      });
      expect(classRes.ok()).toBeTruthy();
      const classData = await classRes.json();
      createdClassId = classData.id;

      const lessonRes = await context.request.post('/api/lessons', {
        data: { title: lessonTitle, content: '课表测试课节内容' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      createdLessonId = lessonData.result?.lessonId || lessonData.id;

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 3. 访问主页并导航至「课表管理」
      await page.goto('/');

      const timetableNavBtn = page.getByRole('button', { name: /课表管理|Timetable Routine/ }).first();
      await expect(timetableNavBtn).toBeVisible({ timeout: 15_000 });
      await timetableNavBtn.click();

      // 4. 验证课表中心头部与标题挂载
      await expect(page.getByText('班级课表中心 & 动态调整')).toBeVisible({ timeout: 15_000 });

      // 5. 验证顶部 Tab 切换（切换至「临时调休调课」再切回「课表看板」）
      const holidayAdjustTabBtn = page.getByRole('button', { name: /临时调休调课|Holiday Adjusts/ }).first();
      await expect(holidayAdjustTabBtn).toBeVisible();
      await holidayAdjustTabBtn.click();
      await expect(page.getByText(/批量节假日调休排班|开始日期/).first()).toBeVisible({ timeout: 10_000 });

      const scheduleGridTabBtn = page.getByRole('button', { name: /课表看板|Schedule Grid/ }).first();
      await scheduleGridTabBtn.click();
      await expect(page.getByText('班级课表中心 & 动态调整')).toBeVisible();

      // 6. 点击「排定课时」按钮唤起新增排课弹窗
      const scheduleClassBtn = page.getByRole('button', { name: /排定课时|Schedule Class/ }).first();
      await expect(scheduleClassBtn).toBeVisible({ timeout: 10_000 });
      await scheduleClassBtn.click();

      // 7. 填写排课表单
      await expect(page.getByText('为班级排排定课次')).toBeVisible({ timeout: 10_000 });

      // 选择目标班级
      const classSelect = page.locator('select[title="Form Class ID"]');
      await expect(classSelect).toBeVisible();
      await classSelect.selectOption(createdClassId);

      // 选择课题
      if (createdLessonId) {
        const lessonSelect = page.locator('select[title="Form Lesson ID"]');
        await expect(lessonSelect).toBeVisible();
        await lessonSelect.selectOption(createdLessonId);
      }

      // 设置排课日期为今天
      const todayStr = new Date().toISOString().split('T')[0];
      const dateInput = page.locator('form input[type="date"]');
      await dateInput.fill(todayStr);

      // 设置备注
      const notesInput = page.getByPlaceholder(/例如：节假日补课|e\.g\./).first();
      await notesInput.fill(`E2E 排课备注-${ts}`);

      // 点击提交「排定并发布」
      const submitBtn = page.getByRole('button', { name: /排定并发布|Publish & Save/ }).first();
      await submitBtn.click();

      // 8. 验证课表看板中渲染出新建的排课卡片
      const scheduleCard = page.locator('div.rounded-xl', { hasText: `E2E 排课备注-${ts}` }).first();
      await expect(scheduleCard).toBeVisible({ timeout: 15_000 });
      await expect(scheduleCard).toContainText(className);
      await expect(scheduleCard.locator(`div[title="${lessonTitle}"]`)).toBeVisible();

      // 9. 捕获真实课表看板渲染截图 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/teacher_timetable_dashboard.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 10. 测试删除该排课卡片
      await scheduleCard.hover();
      const deleteBtn = scheduleCard.locator('button[title*="删除"]').first();
      await expect(deleteBtn).toBeVisible();

      // 监听删除确认弹窗
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });

      await deleteBtn.click();

      // 验证卡片在视图中被移除
      await expect(scheduleCard).toBeHidden({ timeout: 10_000 });

      // 11. 记录测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'teacher_timetable_flow_evidence.log'),
        `[${new Date().toISOString()}] Teacher Timetable Flow Verified:
- Class: ${className} (ID: ${createdClassId})
- Lesson: ${lessonTitle} (ID: ${createdLessonId})
- Schedule Added: ${todayStr} (Notes: E2E 排课备注-${ts})
- Tabs Navigation (Holiday Adjusts <-> Schedule Grid) Verified
- Schedule Card Rendered on Calendar Grid
- Schedule Card Deleted with confirm dialog
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      // 自闭环清理
      if (createdLessonId) {
        await context.request.delete(`/api/lessons/${createdLessonId}`).catch(() => {});
      }
      if (createdClassId) {
        await context.request.delete(`/api/classes/${createdClassId}`).catch(() => {});
      }
      purgeTimetableE2EFromDb();
    }
  });

  test('课表识别草稿持久化：完成徽标直达 AI 识别子页，刷新后现场不丢 (Issue #89)', async ({ page, context }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const subjectA = `E2E 识别数学-${ts}`;
    const subjectB = `E2E 识别语文-${ts}`;

    // 1. 教师/管理员鉴权登录
    const loginRes = await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    expect(loginRes.ok(), '登录管理员应成功').toBeTruthy();

    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    // 2. 预置已完成的识别任务与草稿到 sessionStorage（模拟上一次会话识别完成后的现场）
    await page.addInitScript(
      ({ subjectA, subjectB }) => {
        const entries = [
          { dayOfWeek: 1, periodNumber: 1, timeSlot: '08:00 - 08:40', className: '高一(1)班', subject: subjectA, location: '机房1' },
          { dayOfWeek: 2, periodNumber: 2, timeSlot: '08:50 - 09:30', className: '高一(2)班', subject: subjectB, location: '教室2' },
        ];
        sessionStorage.setItem(
          'openlearn_timetable_ocr_task',
          JSON.stringify({
            id: 'task_ocr_e2e',
            type: 'timetable_ocr',
            title: '课表图片 AI 识别',
            status: 'completed',
            startedAt: Date.now(),
            completedAt: Date.now(),
            result: { entries, providerUsed: { id: 'prov_e2e', name: 'E2E Provider', model_name: 'e2e-model' } },
          }),
        );
        sessionStorage.setItem(
          'openlearn_timetable_ocr_draft',
          JSON.stringify({
            imagePreview: null,
            imageBase64: null,
            fileName: 'E2E 课表.png',
            providerId: '',
            entries,
            selected: [0, 1],
            updatedAt: Date.now(),
          }),
        );
      },
      { subjectA, subjectB },
    );

    // 3. 进入平台：默认落在互动课堂（非课表页），顶栏应出现「识别已完成」徽标
    await page.goto('/');
    const ocrBadge = page.getByText(/课表识别已完成/).first();
    await expect(ocrBadge).toBeVisible({ timeout: 15_000 });

    // 4. 点击徽标 → 直达课表中心并自动落在「AI 图片识课」子页，识别结果与勾选现场恢复
    await ocrBadge.click();
    await expect(page.getByText('班级课表中心 & 动态调整')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已恢复上次的识别结果/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(subjectA).first()).toBeVisible();
    await expect(page.getByText(subjectB).first()).toBeVisible();

    // 5. 刷新页面：草稿从 sessionStorage 恢复，仍落在识别子页且结果还在
    await page.reload();
    await expect(page.getByText('班级课表中心 & 动态调整')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已恢复上次的识别结果/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(subjectA).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(subjectB).first()).toBeVisible({ timeout: 10_000 });

    // 6. 截图留证 (Generates Artifact: Screenshot)
    const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/teacher_timetable_ocr_draft_restore.png');
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);
  });

  test('课表「快速开始上课」：一键初始化会话直达授课视图，回页后显示进入课堂 (Issue #90)', async ({ page, context }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const className = `E2E 课表班级-${ts}`;
    const lessonTitle = `E2E 课表课程-${ts}`;
    let createdClassId: string | null = null;
    let createdLessonId: string | null = null;

    try {
      // 1. 教师/管理员鉴权登录
      const loginRes = await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(loginRes.ok(), '登录管理员应成功').toBeTruthy();

      // 2. 创建班级与课程，并为今天排一节覆盖当前时刻的课
      const classRes = await context.request.post('/api/classes', { data: { name: className } });
      expect(classRes.ok()).toBeTruthy();
      createdClassId = (await classRes.json()).id;

      const lessonRes = await context.request.post('/api/lessons', {
        data: { title: lessonTitle, content: '课表快速开课测试' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      createdLessonId = lessonData.result?.lessonId || lessonData.id;
      expect(createdLessonId).toBeTruthy();

      const pad = (n: number) => String(n).padStart(2, '0');
      const now = new Date();
      const timeSlot = `${pad(now.getHours())}:00 - ${pad(Math.min(now.getHours() + 1, 23))}:59`;
      const today = new Date().toISOString().split('T')[0];
      const batchRes = await context.request.post(`/api/classes/${createdClassId}/schedules/batch`, {
        data: {
          schedules: [
            {
              lessonId: createdLessonId,
              scheduledDate: today,
              timeSlot,
              status: 'scheduled',
            },
          ],
        },
      });
      expect(batchRes.ok(), await batchRes.text()).toBeTruthy();

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 3. 进入课表管理：顶部快捷卡片应定位到当前正在进行的课
      await page.goto('/');
      const timetableNavBtn = page.getByRole('button', { name: /课表管理|Timetable Routine/ }).first();
      await expect(timetableNavBtn).toBeVisible({ timeout: 15_000 });
      await timetableNavBtn.click();
      await expect(page.getByText('班级课表中心 & 动态调整')).toBeVisible({ timeout: 15_000 });

      const quickCard = page.getByTestId('timetable-quick-start-card');
      await expect(quickCard).toBeVisible({ timeout: 10_000 });
      await expect(quickCard.getByText(lessonTitle)).toBeVisible();

      // 4. 点击「开始上课」→ 轻量确认框 → 确认
      await quickCard.getByRole('button', { name: /开始上课/ }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole('button', { name: '开始上课' }).click();

      // 5. 直达授课视图（hash 切到 live_class），服务端会话已创建
      await expect(page).toHaveURL(/#\/live_class/, { timeout: 15_000 });
      const sessionsRes = await context.request.get(
        `/api/classroom/sessions?lessonId=${createdLessonId}&status=active`,
      );
      expect(sessionsRes.ok()).toBeTruthy();
      const sessionsData = await sessionsRes.json();
      expect(sessionsData.items?.length || 0).toBeGreaterThanOrEqual(1);

      // 6. 回到课表页：入口变为「进入课堂」
      await timetableNavBtn.click();
      await expect(page.getByTestId('timetable-quick-start-card').getByRole('button', { name: /进入课堂/ })).toBeVisible(
        { timeout: 10_000 },
      );

      // 7. 截图留证 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/teacher_timetable_quick_start.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);
    } finally {
      if (createdLessonId) {
        await context.request.delete(`/api/lessons/${createdLessonId}`).catch(() => {});
      }
      if (createdClassId) {
        await context.request.delete(`/api/classes/${createdClassId}`).catch(() => {});
      }
      purgeTimetableE2EFromDb();
    }
  });
});
