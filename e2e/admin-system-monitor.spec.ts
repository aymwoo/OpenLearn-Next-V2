/**
 * e2e/admin-system-monitor.spec.ts
 *
 * OpenLearn V2 管理后台：系统监控、SQLite 体检指标与站点全局配置 E2E 自动化测试
 * 覆盖链路：
 * 1. 管理员登录并进入「管理后台」-> 切换至「系统监控」Tab
 * 2. 校验 SQLite 数据库监控指标（健康状态、实体表数量、数据总行数）
 * 3. 校验 SQLite PRAGMA 物理控制参数面板（WAL 模式、扇区大小、分配页面等）
 * 4. 触发物理完整性自检交互（PRAGMA integrity_check）并捕获弹窗确认
 * 5. 切换至「站点信息设置」Tab，校验站点名称/口号输入控件与 DemoDataPanel 挂载
 * 6. 修改站点名称与标语并提交保存，验证成功提示反馈，随后自动恢复初始配置保持状态纯净
 * 7. 检验演示数据（Demo）状态查询与一键刷新功能
 * 8. 真实渲染全幅截图存盘 (Generates Artifact: Screenshot)
 * 9. 输出测试证据日志
 */

import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

function resetSiteSettingsInDb() {
  const db = new Database(DB_PATH);
  try {
    db.prepare("DELETE FROM site_settings WHERE id = 'global'").run();
  } finally {
    db.close();
  }
}

test.describe('管理后台：系统监控与全局配置 E2E 测试', () => {
  test.beforeAll(() => {
    resetSiteSettingsInDb();
  });

  test.afterAll(() => {
    resetSiteSettingsInDb();
  });

  test('SQLite引擎监控、实体表统计、站点全局设置与演示数据状态联动 (Generates Artifact: Screenshot)', async ({
    page,
    context,
  }) => {
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

      await expect(page.getByText('系统管理与教职后台')).toBeVisible({ timeout: 15_000 });

      // 3. 切换至「系统监控」Tab
      const monitorTabBtn = page.getByRole('button', { name: /系统监控|System Monitor/ }).first();
      await expect(monitorTabBtn).toBeVisible({ timeout: 10_000 });
      await monitorTabBtn.click();

      // 4. 验证 SQLite 核心监控卡片指标渲染
      await expect(page.getByText(/SQLite引擎状况|SQLite Health Status/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/运行正常|连接正常|Healthy|Connected/i).first()).toBeVisible();

      await expect(page.getByText(/核心实体数据表|Database Table Count/i).first()).toBeVisible();
      await expect(page.getByText(/系统数据承载行|Total Records Managed/i).first()).toBeVisible();

      // 验证物理控制参数 (PRAGMA)
      await expect(page.getByText(/物理控制参数 \(PRAGMA\)|SQLite Physical PRAGMAs/i).first()).toBeVisible();
      await expect(page.getByText(/日志记录模式|Journal Write Mode/i).first()).toBeVisible();
      await expect(page.getByText(/WAL/i).first()).toBeVisible();

      // 5. 触发物理文件自检弹窗测试
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('完整性检测通过');
        await dialog.accept();
      });

      const integrityBtn = page.getByRole('button', { name: /立即执行物理文件自检|Run Consistency/i }).first();
      await expect(integrityBtn).toBeVisible();
      await integrityBtn.click();

      // 6. 切换至「站点信息设置」Tab
      const siteSettingsTabBtn = page.getByRole('button', { name: /站点信息设置|Site Settings/ }).first();
      await expect(siteSettingsTabBtn).toBeVisible({ timeout: 10_000 });
      await siteSettingsTabBtn.click();

      // 7. 验证站点信息与演示数据面板均已挂载
      await expect(page.getByText(/平台站点信息|Platform Site Info/i).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/演示数据（Demo）/i).first()).toBeVisible({ timeout: 10_000 });

      // 8. 更改站点名称并保存
      const testSiteName = 'OpenLearn E2E 智慧云端实验班';
      const testSiteSlogan = '下一代超前数字化教育教学中枢';

      const siteNameInput = page.getByPlaceholder(/例如：阳光实验小学智慧课堂|Sunshine Elementary/i).first();
      await expect(siteNameInput).toBeVisible({ timeout: 10_000 });
      await siteNameInput.fill(testSiteName);

      const siteSloganInput = page.getByPlaceholder(/例如：下一代智能数字化学习系统|Next-Generation/i).first();
      await siteSloganInput.fill(testSiteSlogan);

      const saveSettingsBtn = page.getByRole('button', { name: /保存站点信息|Save Site Settings/ }).first();
      await saveSettingsBtn.click();

      // 验证保存成功提示
      await expect(page.getByText(/站点信息已保存！|Site settings saved successfully!/i).first()).toBeVisible({
        timeout: 10_000,
      });

      // 9. 检验演示数据面板交互（点击刷新状态按钮）
      const refreshDemoBtn = page.getByRole('button', { name: /刷新状态/i }).first();
      await expect(refreshDemoBtn).toBeVisible({ timeout: 10_000 });
      await refreshDemoBtn.click();

      // 10. 真实渲染全幅截图存盘 (Generates Artifact: Screenshot)
      const SCREENSHOT_PATH = path.resolve(process.cwd(), 'artifacts/screenshots/admin_system_monitor.png');
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

      // 11. 恢复清空站点信息并重新保存，保持数据库洁净无残留
      await siteNameInput.fill('');
      await siteSloganInput.fill('');
      await saveSettingsBtn.click();
      await expect(page.getByText(/站点信息已保存！|Site settings saved successfully!/i).first()).toBeVisible({
        timeout: 10_000,
      });

      // 12. 写入测试证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'admin_system_monitor_evidence.log'),
        `[${new Date().toISOString()}] Admin System Monitor & Site Settings Verified:
- SQLite Health Telemetry Loaded & PRAGMA WAL Mode Verified
- Physical DB Integrity Self-Audit Triggered & Checked via Dialog
- Site Settings Updated: "${testSiteName}" / "${testSiteSlogan}"
- Site Settings Save Confirmation Banner Verified
- DemoDataPanel Mounted & Status Refreshed
- Site Settings Restored to Default
- Screenshot Saved: ${SCREENSHOT_PATH}
`,
      );
    } finally {
      resetSiteSettingsInDb();
    }
  });
});
