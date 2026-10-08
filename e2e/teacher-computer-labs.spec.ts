import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeComputerLabE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLabs = db
      .prepare("SELECT id FROM computer_labs WHERE room_number LIKE 'E2E %'")
      .all() as { id: string }[];

    if (e2eLabs.length > 0) {
      const labIds = e2eLabs.map((l) => l.id);
      const placeholders = labIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE lab_id IN (${placeholders})`).run(...labIds);
      db.prepare(`DELETE FROM computer_labs WHERE id IN (${placeholders})`).run(...labIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 机房班级%'")
      .all() as { id: string }[];

    if (e2eClasses.length > 0) {
      const classIds = e2eClasses.map((c) => c.id);
      const placeholders = classIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM class_students WHERE class_id IN (${placeholders})`).run(...classIds);
      db.prepare(`DELETE FROM classes WHERE id IN (${placeholders})`).run(...classIds);
    }

    const e2eStudents = db
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_LAB_%'")
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

test.describe('教务管理端：机房物理网格与座位分配治理 E2E 测试', () => {
  test.beforeAll(() => {
    purgeComputerLabE2EFromDb();
  });

  test.afterAll(() => {
    purgeComputerLabE2EFromDb();
  });

  test('机房网格配置、班级机位联动、一键排座持久化与机房删除 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const labName = `E2E 智能机房-${ts}`;
    const className = `E2E 机房班级-${ts}`;
    const student1Name = `机房生A_${ts}`;
    const student1Num = `STU_LAB_${ts}_1`;
    const student2Name = `机房生B_${ts}`;
    const student2Num = `STU_LAB_${ts}_2`;

    let createdClassId: string | null = null;
    let createdLabId: string | null = null;

    try {
      // 1. 教师/管理员登录
      const loginRes = await context.request.post('/api/auth/login', {
        data: {
          entrance: 'teacher',
          username: 'admin',
          password: 'admin',
        },
      });
      expect(loginRes.ok(), '登录管理员应成功').toBeTruthy();

      // 2. 预先通过 API 创建测试班级并批量加入测试学生
      const classRes = await context.request.post('/api/classes', {
        data: { name: className },
      });
      expect(classRes.ok()).toBeTruthy();
      const classData = await classRes.json();
      createdClassId = classData.id;

      const enrollRes = await context.request.post(`/api/classes/${createdClassId}/students/bulk-enroll`, {
        data: {
          students: [
            { name: student1Name, student_number: student1Num },
            { name: student2Name, student_number: student2Num },
          ],
        },
      });
      expect(enrollRes.ok()).toBeTruthy();

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 3. 访问主页并导航至「机房管理」
      await page.goto('/');

      const labNavBtn = page.getByRole('button', { name: /机房管理|Computer Lab Seating/ }).first();
      await expect(labNavBtn).toBeVisible({ timeout: 15_000 });
      await labNavBtn.click();

      // 4. 验证机房管理页面挂载
      await expect(page.getByText('统一机房座位管理')).toBeVisible({ timeout: 15_000 });

      // 5. 点击「新增机房规则」按钮唤起创建表单
      const newLabBtn = page.getByRole('button', { name: /新增机房规则|New Lab Config/ }).first();
      await expect(newLabBtn).toBeVisible({ timeout: 10_000 });
      await newLabBtn.click();

      // 6. 填写机房规格表单 (3 行 × 4 列)
      await expect(page.getByText(/创建全新上机机房|Create Computer Lab/).first()).toBeVisible({ timeout: 10_000 });

      const roomInput = page.getByPlaceholder(/例如：305综合机房|e\.g\./).first();
      await roomInput.fill(labName);

      // 设置行数 3，列数 4
      const rowsInput = page.locator('input[type="number"]').first();
      await rowsInput.fill('3');
      const colsInput = page.locator('input[type="number"]').nth(1);
      await colsInput.fill('4');

      // 提交保存
      const saveLabBtn = page.getByRole('button', { name: /提交保存|Save Config/ }).first();
      await saveLabBtn.click();

      // 7. 验证机房列表中成功出现该机房卡片
      const labItem = page.locator('div', { hasText: labName }).filter({ hasText: /3 行 × 4 列|12 个机位/ }).first();
      await expect(labItem).toBeVisible({ timeout: 15_000 });

      // 获取创建后的 Lab ID
      const labsRes = await context.request.get('/api/labs');
      if (labsRes.ok()) {
        const labsData = await labsRes.json();
        const matched = (Array.isArray(labsData) ? labsData : labsData.data || []).find(
          (l: any) => l.room_number === labName,
        );
        if (matched) createdLabId = matched.id;
      }

      // 8. 测试班级联动与一键排座
      const classSelect = page.locator('select', { hasText: className }).first();
      await expect(classSelect).toBeVisible({ timeout: 10_000 });
      await classSelect.selectOption(createdClassId);

      // 等待学生与机房座位状态加载
      const autoFillBtn = page.getByRole('button', { name: /一键排座|Auto Fill/ }).first();
      await expect(autoFillBtn).toBeVisible({ timeout: 10_000 });
      await autoFillBtn.click();

      // 9. 验证座位网格中点亮了学生姓名
      await expect(page.getByText(student1Name).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(student2Name).first()).toBeVisible({ timeout: 10_000 });

      // 10. 保存排座
      const saveSeatsBtn = page.getByRole('button', { name: /保存排座|Save/ }).first();
      await expect(saveSeatsBtn).toBeVisible();
      await saveSeatsBtn.click();

      // 验证保存成功的持久化提示
      await expect(
        page.getByText(/已成功持久化至系统|Seating assignments saved/i).first(),
      ).toBeVisible({ timeout: 10_000 });

      // 11. 截取机房排座真实全景渲染截图 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/teacher_computer_lab_seating.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 12. 测试删除机房
      await labItem.hover();
      const deleteLabBtn = labItem.locator('button[title*="删除机房"]').first();
      await expect(deleteLabBtn).toBeVisible();

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });

      await deleteLabBtn.click();

      // 验证机房从列表中消失
      await expect(page.getByText(labName)).toBeHidden({ timeout: 10_000 });

      // 13. 写入测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'teacher_computer_labs_flow_evidence.log'),
        `[${new Date().toISOString()}] Teacher Computer Labs Flow Verified:
- Lab Created: ${labName} (3 rows x 4 cols = 12 seats, ID: ${createdLabId})
- Linked Class: ${className} (ID: ${createdClassId})
- Auto Assigned Students: ${student1Name}, ${student2Name}
- Seating Persisted to student_seats
- Lab Deleted with confirmation
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      // 自闭环清理
      if (createdLabId) {
        await context.request.delete(`/api/labs/${createdLabId}`).catch(() => {});
      }
      if (createdClassId) {
        await context.request.delete(`/api/classes/${createdClassId}`).catch(() => {});
      }
      purgeComputerLabE2EFromDb();
    }
  });
});
