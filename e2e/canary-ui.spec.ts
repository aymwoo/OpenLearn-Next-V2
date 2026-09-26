import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const FIXTURE_ZIP_PATH = path.resolve(process.cwd(), 'e2e/fixtures/canary.zip');
const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/canary_teacher_tab.png');

async function ensureLoggedIn(page: Page) {
  // 禁用新手引导弹窗，避免遮挡 UI 交互
  await page.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });

  await page.goto('/');

  const userInput = page.locator('input[placeholder*="教工账户名"]');
  const sidebar = page.locator('aside');

  await Promise.race([
    userInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
    sidebar.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
  ]);

  if (await userInput.isVisible()) {
    await userInput.fill('admin');
    await page.locator('input[placeholder*="输入登录密码"]').fill('admin');
    await page.locator('button:has-text("安全验证登录"), button[type="submit"]').first().click();
    await expect(userInput).toBeHidden({ timeout: 15000 });
  }

  // 确保如果新手引导仍弹出，将其主动关闭
  const tourCloseBtn = page.locator('div.fixed button:has(svg.lucide-x)');
  if (await tourCloseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tourCloseBtn.click().catch(() => {});
  }
}

test.describe('金丝雀阶段 7：前端扩展槽位与 UI 真实渲染', () => {
  let installedPluginId: string | null = null;

  test.beforeAll(async ({ request }) => {
    fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

    // 1. 读取包含 frontend.js 的金丝雀 ZIP 包
    expect(fs.existsSync(FIXTURE_ZIP_PATH)).toBe(true);
    const zipBuffer = fs.readFileSync(FIXTURE_ZIP_PATH);
    expect(zipBuffer.length).toBeGreaterThan(0);

    // 2. 以管理员账号登录获取鉴权 cookie
    const loginRes = await request.post('/api/auth/login', {
      data: {
        entrance: 'teacher',
        username: 'admin',
        password: 'admin',
      },
    });
    expect(loginRes.ok()).toBeTruthy();

    // 2a. 前置幂等清理可能残留的金丝雀插件
    const listRes = await request.get('/api/plugins');
    if (listRes.ok()) {
      const plugins = await listRes.json();
      const arr = Array.isArray(plugins) ? plugins : plugins.plugins || [];
      for (const p of arr) {
        if (p.name?.includes('金丝雀') || p.id?.includes('canary')) {
          await request.delete(`/api/plugins/${encodeURIComponent(p.id)}`);
        }
      }
    }

    // 3. 上传安装金丝雀插件 (inline 模式)
    const uploadRes = await request.post('/api/plugins/upload-zip-raw', {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': 'ext-canary.zip',
        'X-Execution-Mode': 'inline',
        'X-Install-Mode': 'install',
      },
      data: zipBuffer,
    });
    expect(uploadRes.ok()).toBeTruthy();

    const data = await uploadRes.json();
    installedPluginId = data.pluginId || data.manifest?.id;
    expect(installedPluginId).toBeTruthy();

    // 4. 激活插件
    const toggleRes = await request.post(`/api/plugins/${encodeURIComponent(installedPluginId!)}/toggle`);
    expect(toggleRes.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    // 清理卸载金丝雀插件，还原环境
    if (installedPluginId) {
      try {
        await request.delete(`/api/plugins/${encodeURIComponent(installedPluginId)}`);
      } catch {
        // 静默清理
      }
    }
  });

  test('7.1 & 7.6 教师主导航金丝雀 Tab 挂载、React 面板渲染、截图与 Ping 互通 (Generates Artifact: Screenshot)', async ({ page }) => {
    // 1. 登录并进入主应用界面
    await ensureLoggedIn(page);

    // 2. 定位导航侧边栏中的「金丝雀」Tab
    const canaryTabButton = page.locator('button[title="金丝雀"], button:has-text("金丝雀")').first();
    await expect(canaryTabButton).toBeVisible({ timeout: 15000 });

    // 3. 点击 Tab 进入插件面板
    await canaryTabButton.click();

    // 4. 断言插件扩展点组件成功渲染
    const canaryPanel = page.locator('[data-testid="canary-teacher-tab-panel"]');
    await expect(canaryPanel).toBeVisible({ timeout: 10000 });

    // 5. 校验上下文 Props 结构 (lessonId, classId)
    const lessonIdEl = page.locator('[data-testid="canary-prop-lesson-id"]');
    const classIdEl = page.locator('[data-testid="canary-prop-class-id"]');
    await expect(lessonIdEl).toBeVisible();
    await expect(classIdEl).toBeVisible();

    // 6. 捕获真实渲染截图存盘 (Generates Artifact: Screenshot)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

    // 7. 测试前后端互通：点击 Ping 探针按钮
    const pingBtn = page.locator('[data-testid="canary-ping-button"]');
    await expect(pingBtn).toBeVisible({ timeout: 10000 });
    await pingBtn.click({ force: true });

    // 8. 断言回显结果更新且包含 pong: true
    const outputEl = page.locator('[data-testid="canary-ping-output"]');
    await expect(outputEl).not.toHaveText('等待调用', { timeout: 10000 });
    const outputText = await outputEl.textContent();
    expect(outputText).toContain('pong');

    // 9. 记录阶段 7 运行证据日志
    const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LOG_DIR, 'canary_step7_e2e_evidence.log'),
      `[${new Date().toISOString()}] Stage 7 UI E2E Verified:
- Tab Mounted: true
- Panel Rendered: true
- Props Injected: lessonId=${await lessonIdEl.textContent()}, classId=${await classIdEl.textContent()}
- Screenshot Saved: ${SCREENSHOT_PATH}
- Ping Echo Output: ${outputText}
`
    );
  });
});
