/**
 * 命令面板（Cmd/Ctrl + K）与侧边栏数据源
 *
 * 这条用例同时守两件事：
 * 1. 命令面板能被唤起、搜索、**真正执行**（跳转到目标工作区）；
 * 2. 侧边栏的入口来自 navigation registry —— 跳转后对应按钮变成选中态。
 *
 * 归属：教师工作流 —— 全局命令面板
 */
import { test, expect } from '@playwright/test';

test.describe('全局命令面板（Cmd/Ctrl + K）', () => {
  test('唤起 → 搜索 → 执行跳转命令 → 侧边栏对应入口进入选中态', async ({ page, context }) => {
    test.setTimeout(120_000);

    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
    await page.goto('/');
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 });

    // ── 1. 唤起 ────────────────────────────────────────────────────────
    await page.keyboard.press('Control+k');
    const modal = page.getByTestId('command-palette-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // ── 2. 搜索 ────────────────────────────────────────────────────────
    const search = page.getByTestId('command-search-input');
    await search.fill('班级');
    const cmd = page.getByTestId('command-item-builtin.goto.classes');
    await expect(cmd).toBeVisible({ timeout: 10_000 });

    // ── 3. 执行 ────────────────────────────────────────────────────────
    await cmd.click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    // ── 4. 侧边栏对应入口进入选中态（说明 registry 渲染的按钮确实是活的）──
    const classesBtn = page.locator('#nav_btn_classes');
    await expect(classesBtn).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
  });

  test('Escape 关闭面板', async ({ page, context }) => {
    test.setTimeout(120_000);

    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
    await page.goto('/');
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 });

    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette-modal')).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette-modal')).toBeHidden({ timeout: 10_000 });
  });
});
