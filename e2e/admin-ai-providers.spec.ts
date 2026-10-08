/**
 * e2e/admin-ai-providers.spec.ts
 *
 * OpenLearn V2 管理后台：AI 模型提供商治理 E2E 自动化测试
 * 覆盖链路：
 * 1. 管理员登录并进入「管理后台」-> 切换至「AI 模型提供商」Tab
 * 2. 校验提供商列表视图与空状态/现有状态
 * 3. 展开「添加 AI 提供商」Modal 抽屉，录入 OpenAI 兼容端点、模型代号与 API 密钥并保存至数据库
 * 4. 验证提供商表格成功挂载新记录行与密钥掩码状态
 * 5. 拦截并模拟测试连通性探测（`/api/ai-providers/test`），捕获弹窗反馈
 * 6. 编辑修改提供商模型配置参数并重新保存
 * 7. 真实渲染全幅截图存盘 (Generates Artifact: Screenshot)
 * 8. 触发二次确认弹窗并注销删除提供商记录，验证表格行被移除
 * 9. 输出测试证据日志并执行自闭环清理
 */

import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

function purgeAdminAIProvidersE2EFromDb() {
  const db = new Database(DB_PATH);
  try {
    const e2eProviders = db
      .prepare("SELECT id, name FROM ai_providers WHERE name LIKE '%E2E%' OR name LIKE '%e2e%'")
      .all() as { id: string; name: string }[];

    if (e2eProviders.length > 0) {
      const ids = e2eProviders.map((p) => p.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM ai_providers WHERE id IN (${placeholders})`).run(...ids);
    }
  } finally {
    db.close();
  }
}

test.describe('管理后台：AI 模型提供商治理 E2E 测试', () => {
  test.beforeAll(() => {
    purgeAdminAIProvidersE2EFromDb();
  });

  test.afterAll(() => {
    purgeAdminAIProvidersE2EFromDb();
  });

  test('AI 模型提供商添加、连通性探测、参数修改与注销删除 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
    const timestamp = Date.now();
    const providerName = `E2E_OpenAI_${timestamp}`;
    const initialModel = 'gpt-4o-mini';
    const updatedModel = 'gpt-4o-2024-08-06';
    const apiUrl = 'https://api.openai.com/v1';

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

      // 2. 访问主页并进入管理后台
      await page.goto('/');
      const adminNavBtn = page.locator('#nav_btn_admin_directory, button:has-text("管理后台")').first();
      await expect(adminNavBtn).toBeVisible({ timeout: 15_000 });
      await adminNavBtn.click();

      // 3. 验证管理后台加载并切换至「AI 模型提供商」Tab
      await expect(page.getByText('系统管理与教职后台')).toBeVisible({ timeout: 15_000 });
      const aiProvidersTabBtn = page.getByRole('button', { name: /AI 模型提供商|AI Providers/ }).first();
      await expect(aiProvidersTabBtn).toBeVisible({ timeout: 10_000 });
      await aiProvidersTabBtn.click();

      // 4. 验证 AI 提供商模块挂载
      await expect(page.getByText(/OpenAI 兼容|AI Providers List/i).first()).toBeVisible({ timeout: 10_000 });

      // 5. 点击「添加 AI 提供商」展开录入表单
      const addProviderBtn = page.getByRole('button', { name: /添加 AI 提供商|Add AI Provider/ }).first();
      await expect(addProviderBtn).toBeVisible({ timeout: 10_000 });
      await addProviderBtn.click();

      // 6. 录入提供商参数
      await expect(page.getByText(/添加全新 AI 提供商|服务商名称/i).first()).toBeVisible({ timeout: 10_000 });

      const nameInput = page.getByPlaceholder(/Deepseek, Minimax/i).first();
      await nameInput.fill(providerName);

      const urlInput = page.getByPlaceholder(/api\.deepseek\.com/i).first();
      await urlInput.fill(apiUrl);

      const modelInput = page.getByPlaceholder(/deepseek-chat/i).first();
      await modelInput.fill(initialModel);

      const keyInput = page.locator('form input[type="password"]').first();
      await keyInput.fill('sk-e2e-mock-test-key-987654');

      // 7. 提交保存
      const saveBtn = page.getByRole('button', { name: /保存至数据库|Save Connection/ }).first();
      await saveBtn.click();

      // 8. 验证提供商表格中出现该新纪录行
      const providerRow = page.locator('tr').filter({ hasText: providerName }).first();
      await expect(providerRow).toBeVisible({ timeout: 15_000 });
      await expect(providerRow.getByText(apiUrl)).toBeVisible();
      await expect(providerRow.getByText(initialModel)).toBeVisible();
      await expect(providerRow.getByText(/Key Saved/i)).toBeVisible();

      // 9. 连通性测试（Mock 内部端点防外网依赖与 SSRF 误报）
      await page.route('**/api/ai-providers/test', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, message: 'Mock probe connection success' }),
        });
      });

      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('测试成功');
        await dialog.accept();
      });

      const testConnBtn = providerRow.locator('button[title*="测试连通性"], button:has-text("测试")').first();
      await expect(testConnBtn).toBeVisible();
      await testConnBtn.click();

      // 10. 编辑提供商配置（修改模型代号）
      const editBtn = providerRow.locator('button[title*="编辑配置"], button:has-text("编辑")').first();
      await expect(editBtn).toBeVisible();
      await editBtn.click();

      await expect(page.getByText(/编辑 AI 提供商配置|Edit AI Provider/i).first()).toBeVisible({ timeout: 10_000 });
      const editModelInput = page.getByPlaceholder(/deepseek-chat/i).first();
      await editModelInput.fill(updatedModel);

      const updateSaveBtn = page.getByRole('button', { name: /保存至数据库|Save Connection/ }).first();
      await updateSaveBtn.click();

      // 验证模型代号更新成功
      await expect(providerRow.getByText(updatedModel)).toBeVisible({ timeout: 10_000 });

      // 11. 真实渲染截图存盘 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/admin_ai_providers.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 12. 删除提供商
      page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
      });

      const deleteBtn = providerRow.locator('button[title*="删除"], button:has-text("删除")').first();
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // 验证行已移除
      await expect(page.locator('tr').filter({ hasText: providerName })).toBeHidden({ timeout: 10_000 });

      // 13. 输出测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'admin_ai_providers_evidence.log'),
        `[${new Date().toISOString()}] Admin AI Providers Lifecycle Verified:
- Provider Created: ${providerName} (${apiUrl}, initialModel: ${initialModel})
- Key Masking Verified (Key Saved)
- Connection Probe Tested with Mock Interceptor (status 200)
- Model Configuration Updated to: ${updatedModel}
- Provider Deleted via Confirm Dialog
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      purgeAdminAIProvidersE2EFromDb();
    }
  });
});
