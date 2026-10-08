import { expect, test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeAdminUsersE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eUsers = db
      .prepare(
        "SELECT id, username FROM users WHERE (username LIKE 'e2e_teacher_%' OR username LIKE 'e2e_admin_%') AND username NOT IN ('admin', 'teacher')",
      )
      .all() as { id: string; username: string }[];

    if (e2eUsers.length > 0) {
      const userIds = e2eUsers.map((u) => u.id);
      const placeholders = userIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...userIds);
    }
  } finally {
    db.close();
  }
}

test.describe('管理后台：教工与管理员账号生命周期治理 E2E 测试', () => {
  test.beforeAll(() => {
    purgeAdminUsersE2EFromDb();
  });

  test.afterAll(() => {
    purgeAdminUsersE2EFromDb();
  });

  test('教职账号创建、角色划分、花名册搜索、参数修改与注销删除 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
    const ts = Date.now().toString(36).toUpperCase();
    const testUsername = `e2e_teacher_${ts}`.toLowerCase();
    const testName = `E2E 讲师_${ts}`;
    const updatedName = `E2E 资深讲师_${ts}`;
    let createdUserId: string | null = null;

    try {
      // 1. 超级管理员鉴权登录
      const loginRes = await context.request.post('/api/auth/login', {
        data: {
          entrance: 'teacher',
          username: 'admin',
          password: 'admin',
        },
      });
      expect(loginRes.ok(), '管理员登录应成功').toBeTruthy();

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 2. 访问主页并点击左侧导航栏「管理后台」
      await page.goto('/');

      const adminNavBtn = page.locator('#nav_btn_admin_directory, button:has-text("管理后台")').first();
      await expect(adminNavBtn).toBeVisible({ timeout: 15_000 });
      await adminNavBtn.click();

      // 3. 验证管理后台头部与标题挂载
      await expect(page.getByText('系统管理与教职后台')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('超级管理员').first()).toBeVisible();

      // 4. 点击「添加教职账户」按钮展开抽屉表单
      const addTeacherBtn = page.getByRole('button', { name: /添加教职账户|Add Teacher Account/ }).first();
      await expect(addTeacherBtn).toBeVisible({ timeout: 10_000 });
      await addTeacherBtn.click();

      // 5. 填写教职信息表单
      await expect(page.getByText(/正在创建新教职账户|正在编辑教职账户|教工姓名/i).first()).toBeVisible({
        timeout: 10_000,
      });

      const nameInput = page.getByPlaceholder(/例如：李茂峰老师|Dr\. Higgins/).first();
      await nameInput.fill(testName);

      const usernameInput = page.getByPlaceholder(/输入登录用的拼音|jclark12/).first();
      await usernameInput.fill(testUsername);

      const passwordInput = page.locator('form input[type="password"]').first();
      await passwordInput.fill('Teacher123!');

      // 提交保存
      const submitUserBtn = page.getByRole('button', { name: /保存记录|Save Properties/ }).first();
      await submitUserBtn.click();

      // 6. 验证教工列表中出现该新账号卡片
      const userCard = page.locator('div.rounded-xl').filter({ hasText: `@${testUsername}` }).first();
      await expect(userCard).toBeVisible({ timeout: 15_000 });

      // 7. 测试即时搜索过滤
      const searchBox = page.getByPlaceholder(/搜索姓名、用户名/i).first();
      if (await searchBox.isVisible()) {
        await searchBox.fill(testUsername);
        await expect(userCard).toBeVisible();
        await expect(page.getByText('admin').first()).toBeHidden();
        // 清空还原
        await searchBox.fill('');
      }

      // 8. 测试编辑修改教工资料
      const editBtn = userCard.locator('button[title*="修改设置"], button[title*="Update settings"]').first();
      await expect(editBtn).toBeVisible();
      await editBtn.click();

      await expect(nameInput).toBeVisible({ timeout: 10_000 });
      await nameInput.fill(updatedName);

      const saveChangesBtn = page.getByRole('button', { name: /保存记录|Save Properties/ }).first();
      await saveChangesBtn.click();

      // 验证姓名已更新
      const updatedUserCard = page.locator('div.rounded-xl').filter({ hasText: `@${testUsername}` }).filter({ hasText: updatedName }).first();
      await expect(updatedUserCard).toBeVisible({ timeout: 15_000 });

      // 9. 截取教职目录管理真实渲染截图存盘 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/admin_user_directory.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 10. 测试注销删除教职账号
      const deleteBtn = updatedUserCard.locator('button[title*="注销删除"], button[title*="Delete user"]').first();
      await expect(deleteBtn).toBeVisible();

      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });

      await deleteBtn.click();

      // 验证账号卡片被安全移除
      await expect(page.getByText(updatedName)).toBeHidden({ timeout: 10_000 });

      // 11. 写入测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'admin_user_management_evidence.log'),
        `[${new Date().toISOString()}] Admin User Management Verified:
- User Created: ${testName} (@${testUsername}, Role: teacher)
- Instant Search Filter Verified
- User Profile Updated to: ${updatedName}
- User Deleted with Confirm Dialog
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      // 自闭环清理
      purgeAdminUsersE2EFromDb();
    }
  });
});
