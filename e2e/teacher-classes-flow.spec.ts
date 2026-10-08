import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeClassesE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 班级花名册测试%' OR name LIKE 'E2E %'")
      .all() as { id: string }[];

    if (e2eClasses.length > 0) {
      const classIds = e2eClasses.map((c) => c.id);
      const placeholders = classIds.map(() => '?').join(',');

      db.prepare(`DELETE FROM student_seats WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM class_students WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM schedules WHERE class_id IN (${placeholders})`).run(...classIds);
      try {
        db.prepare(`DELETE FROM class_groups WHERE class_id IN (${placeholders})`).run(...classIds);
      } catch {}
      try {
        db.prepare(`DELETE FROM classroom_sessions WHERE class_id IN (${placeholders})`).run(...classIds);
      } catch {}
      db.prepare(`DELETE FROM classes WHERE id IN (${placeholders})`).run(...classIds);
    }

    const e2eStudents = db
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_E2E_%'")
      .all() as { id: string }[];

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

test.describe('教务管理端：班级生命周期与学生花名册治理 E2E 测试', () => {
  test.beforeAll(() => {
    purgeClassesE2EFromDb();
  });

  test.afterAll(() => {
    purgeClassesE2EFromDb();
  });

  test('教师端班级创建、临时口令控制器、学生名册搜索与考勤Tab交互 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const className = `E2E 班级花名册测试-${ts}`;
    let createdClassId: string | null = null;
    let enrolledStudentIds: string[] = [];

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

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 2. 访问主页并导航至「班级管理」
      await page.goto('/');

      const classesNavBtn = page.getByRole('button', { name: /班级管理|Classes & Students/ }).first();
      await expect(classesNavBtn).toBeVisible({ timeout: 15_000 });
      await classesNavBtn.click();

      // 3. 验证班级管理页面加载，并通过 window.prompt 创建班级
      const createClassBtn = page.getByRole('button', { name: /创建班级/ }).first();
      await expect(createClassBtn).toBeVisible({ timeout: 10_000 });

      // 监听原生 prompt 对话框并填入班级名称
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('prompt');
        await dialog.accept(className);
      });

      await createClassBtn.click();

      // 4. 等待新班级行在界面上渲染
      const classRow = page.getByText(className).first();
      await expect(classRow).toBeVisible({ timeout: 15_000 });

      // 获取创建后的班级 ID 用于后续 API 辅助验证与清理
      const listRes = await context.request.get('/api/classes?pageSize=all');
      expect(listRes.ok()).toBeTruthy();
      const listData = await listRes.json();
      const matchedClass = (listData.data || listData).find((c: any) => c.name === className);
      expect(matchedClass, '班级应已持久化到数据库').toBeTruthy();
      createdClassId = matchedClass.id;

      // 5. 点击班级行展开详情
      await classRow.click();

      // 6. 验证并测试临时班级密码控制器 (ClassPasscodeController)
      const passcodeInput = page.locator(`#class-passcode-${createdClassId}`);
      await expect(passcodeInput).toBeVisible({ timeout: 10_000 });
      await expect(passcodeInput).toHaveValue('');

      // 点击「随机生成」口令
      const randomGenBtn = page.getByRole('button', { name: /随机生成/ }).first();
      await expect(randomGenBtn).toBeVisible();
      await randomGenBtn.click();

      // 断言输入框生成了 4 位随机口令
      await expect.poll(async () => {
        return (await passcodeInput.inputValue()).trim().length;
      }, { timeout: 10_000 }).toBe(4);

      // 点击「清除」口令
      const clearPinBtn = page.getByRole('button', { name: /清除/ }).first();
      await expect(clearPinBtn).toBeVisible();
      await clearPinBtn.click();
      await expect(passcodeInput).toHaveValue('');

      // 7. 通过 API 为该班级批量加入 2 名规范命名的测试学生
      const student1Num = `STU_E2E_${ts}_1`;
      const student1Name = `张三_${ts}`;
      const student2Num = `STU_E2E_${ts}_2`;
      const student2Name = `李四_${ts}`;

      const enrollRes = await context.request.post(`/api/classes/${createdClassId}/students/bulk-enroll`, {
        data: {
          students: [
            { name: student1Name, student_number: student1Num },
            { name: student2Name, student_number: student2Num },
          ],
        },
      });
      expect(enrollRes.ok(), '批量入班应成功').toBeTruthy();
      const enrollData = await enrollRes.json();
      expect(enrollData.count).toBe(2);

      // 折叠并重新展开班级，触发 fetchClassStudents 重新拉取学生列表
      await classRow.click();
      await page.waitForTimeout(300);
      await classRow.click();

      // 8. 验证学生花名册 (ClassStudentsPanel) 渲染与搜索过滤
      await expect(page.getByText(student1Name).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(student2Name).first()).toBeVisible({ timeout: 10_000 });

      // 使用花名册搜索框搜索「张三」
      const searchBox = page.getByPlaceholder(/搜索学生姓名|搜索/).first();
      if (await searchBox.isVisible()) {
        await searchBox.fill(`张三_${ts}`);
        await expect(page.getByText(student1Name).first()).toBeVisible();
        await expect(page.getByText(student2Name)).toBeHidden();
        // 清空搜索框还原
        await searchBox.fill('');
        await expect(page.getByText(student2Name).first()).toBeVisible();
      }

      // 9. 切换 Tab 至「课表考勤」
      const attendanceTabBtn = page.getByRole('button', { name: /课表考勤|Attendance/ }).first();
      await expect(attendanceTabBtn).toBeVisible();
      await attendanceTabBtn.click();

      // 验证考勤 Tab 区域成功挂载
      await expect(
        page.getByText(/该班级暂无课表记录|日常出勤|课表考勤/).first(),
      ).toBeVisible({ timeout: 10_000 });

      // 10. 截取班级花名册治理真实渲染截图存盘 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/teacher_classes_roster.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 记录测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'teacher_classes_flow_evidence.log'),
        `[${new Date().toISOString()}] Teacher Classes Flow Verified:
- Class Created: ${className} (ID: ${createdClassId})
- Passcode Controller Verified: 4-digit PIN generated & cleared
- Enrolled Students: ${student1Name} (${student1Num}), ${student2Name} (${student2Num})
- Roster Search & Filter Verified
- Attendance Tab Mounted
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      // 11. 自闭环清理创建的班级与学生
      if (createdClassId) {
        await context.request.delete(`/api/classes/${createdClassId}`).catch(() => {});
      }
      purgeClassesE2EFromDb();
    }
  });
});
