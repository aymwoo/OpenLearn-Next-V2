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
});
