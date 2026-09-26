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
  let testLabId: string | null = null;
  let testClassId: string | null = null;
  const testStudentIds: string[] = [];

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

    // 5. 准备机房座位图种子数据（附录 B）
    const labRes = await request.post('/api/labs', {
      data: { room_number: '机房A-101', rows: 2, cols: 3 },
    });
    expect(labRes.ok()).toBeTruthy();
    const labData = await labRes.json();
    testLabId = labData.id;

    const classRes = await request.post('/api/classes', {
      data: { name: '金丝雀排座班', description: 'canary test class' },
    });
    expect(classRes.ok()).toBeTruthy();
    const classData = await classRes.json();
    testClassId = classData.id;

    for (let i = 1; i <= 3; i++) {
      const studentRes = await request.post('/api/students', {
        data: { name: `探针生0${i}`, student_number: `CANARY_${Date.now()}_${i}` },
      });
      expect(studentRes.ok()).toBeTruthy();
      const sData = await studentRes.json();
      testStudentIds.push(sData.id);
      await request.post(`/api/classes/${testClassId}/students`, {
        data: { studentId: sData.id, student_id: sData.id },
      });
    }

    // 排座
    const seatRes = await request.post(`/api/classes/${testClassId}/seats`, {
      data: {
        lab_id: testLabId,
        seats: [
          { student_id: testStudentIds[0], row_idx: 0, col_idx: 0 },
          { student_id: testStudentIds[1], row_idx: 0, col_idx: 1 },
          { student_id: testStudentIds[2], row_idx: 1, col_idx: 0 },
        ],
      },
    });
    expect(seatRes.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    // 清理种子数据
    if (testClassId) {
      await request.delete(`/api/classes/${testClassId}`).catch(() => {});
    }
    if (testLabId) {
      await request.delete(`/api/labs/${testLabId}`).catch(() => {});
    }
    for (const sid of testStudentIds) {
      await request.delete(`/api/students/${sid}`).catch(() => {});
    }

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
    await ensureLoggedIn(page);

    const canaryTabButton = page.locator('button[title="金丝雀"], button:has-text("金丝雀")').first();
    await expect(canaryTabButton).toBeVisible({ timeout: 15000 });
    await canaryTabButton.click();

    const canaryPanel = page.locator('[data-testid="canary-teacher-tab-panel"]');
    await expect(canaryPanel).toBeVisible({ timeout: 10000 });

    const lessonIdEl = page.locator('[data-testid="canary-prop-lesson-id"]');
    const classIdEl = page.locator('[data-testid="canary-prop-class-id"]');
    await expect(lessonIdEl).toBeVisible();
    await expect(classIdEl).toBeVisible();

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

    const pingBtn = page.locator('[data-testid="canary-ping-button"]');
    await expect(pingBtn).toBeVisible({ timeout: 10000 });
    await pingBtn.click({ force: true });

    const outputEl = page.locator('[data-testid="canary-ping-output"]');
    await expect(outputEl).not.toHaveText('等待调用', { timeout: 10000 });
    const outputText = await outputEl.textContent();
    expect(outputText).toContain('pong');
  });

  test('7.5 机房座位图 4 大扩展槽位（toolbar/legend/summary/seat_badge）渲染与截图 (Generates Artifact: Screenshot)', async ({ page }) => {
    await ensureLoggedIn(page);

    // 1. 导航到「互动课堂」
    const liveClassTab = page.locator('button:has-text("互动课堂")').first();
    await expect(liveClassTab).toBeVisible({ timeout: 10000 });
    await liveClassTab.click();

    // 2. 选择种子班级卡片
    const classCard = page.locator(`button:has-text("金丝雀排座班")`).first();
    await expect(classCard).toBeVisible({ timeout: 10000 });
    await classCard.click();

    // 3. 验证 7.5.a 工具栏按钮 (classroom.seating.toolbar)
    const toolbarExt = page.locator('[data-testid="canary-seating-toolbar"]');
    await expect(toolbarExt).toBeVisible({ timeout: 10000 });
    await expect(toolbarExt).toContainText('机房A-101');

    // 4. 验证 7.5.b 图例项 (classroom.seating.legend)
    const legendExt = page.locator('[data-testid="canary-seating-legend"]');
    await expect(legendExt).toBeVisible({ timeout: 10000 });
    await expect(legendExt).toContainText('探针就绪');

    // 5. 验证 7.5.c 底部汇总指标 (classroom.seating.summary)
    const summaryExt = page.locator('[data-testid="canary-seating-summary"]');
    await expect(summaryExt).toBeVisible({ timeout: 10000 });
    const summaryTotal = page.locator('[data-testid="canary-summary-total"]');
    await expect(summaryTotal).toContainText('已排座: 3');

    // 6. 验证 7.5.d 座位徽章 (classroom.seating.seat_badge)
    const seatBadges = page.locator('[data-testid="canary-seat-badge"]');
    await expect(seatBadges).toHaveCount(3);

    // 7. 捕获真实渲染截图存盘 (Generates Artifact: Screenshot)
    const SEATING_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/canary_seating_map.png');
    await page.screenshot({ path: SEATING_SCREENSHOT, fullPage: true });
    expect(fs.existsSync(SEATING_SCREENSHOT)).toBe(true);

    // 8. 记录测试证据
    const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LOG_DIR, 'canary_stage7_deep_slots_evidence.log'),
      `[${new Date().toISOString()}] Stage 7 Deep Seating Slots Verified:
- Seating Toolbar Rendered: true (Room: 机房A-101)
- Seating Legend Rendered: true
- Seating Summary Rendered: true (Assigned: 3)
- Seating Seat Badges Count: 3
- Seating Screenshot: ${SEATING_SCREENSHOT}
`
    );
  });

  test('7.4 & 7.9 白板工具栏锚点与自动保存槽位状态展示 (Generates Artifact: Screenshot)', async ({ page }) => {
    await ensureLoggedIn(page);

    // 1. 导航到「课程管理」
    const coursesTab = page.locator('button:has-text("课程管理")').first();
    await expect(coursesTab).toBeVisible({ timeout: 10000 });
    await coursesTab.click();

    // 2. 点击首个课程进入备课编辑器 (LessonEditorView)
    const viewCourseBtn = page.locator('button[title*="查看与编辑"], button[title*="查看只读"], button:has-text("查看教案")').first();
    await expect(viewCourseBtn).toBeVisible({ timeout: 10000 });
    await viewCourseBtn.click();

    // 3. 验证 7.9.a 白板自动保存状态扩展槽位 (whiteboard.autosave.status)
    const autosaveStatus = page.locator('[data-testid="canary-autosave-status"]');
    await expect(autosaveStatus).toBeVisible({ timeout: 10000 });
    await expect(autosaveStatus).toContainText('云端镜像');

    // 4. 验证 7.9.b 白板自动保存动作扩展槽位 (whiteboard.autosave.action)
    const autosaveAction = page.locator('[data-testid="canary-autosave-action-btn"]');
    await expect(autosaveAction).toBeVisible({ timeout: 10000 });
    await expect(autosaveAction).toContainText('立即固化');

    // 5. 验证 7.4 白板工具栏锚点按钮 (anchor:whiteboard-toolbar:rollcall before)
    const anchorBtn = page.locator('[data-testid="canary-anchor-rollcall-btn"]');
    await expect(anchorBtn).toBeVisible({ timeout: 10000 });

    // 6. 捕获真实渲染截图存盘 (Generates Artifact: Screenshot)
    const WHITEBOARD_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/canary_whiteboard_editor.png');
    await page.screenshot({ path: WHITEBOARD_SCREENSHOT, fullPage: true });
    expect(fs.existsSync(WHITEBOARD_SCREENSHOT)).toBe(true);

    // 7. 写入补充日志证据
    const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
    fs.appendFileSync(
      path.join(LOG_DIR, 'canary_stage7_deep_slots_evidence.log'),
      `[${new Date().toISOString()}] Stage 7 Whiteboard & Anchor Slots Verified:
- Whiteboard Autosave Status Rendered: true
- Whiteboard Autosave Action Rendered: true
- Whiteboard Anchor Button Rendered: true
- Whiteboard Screenshot: ${WHITEBOARD_SCREENSHOT}
`
    );
  });
});
