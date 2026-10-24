/**
 * 归属：插件 / 金丝雀 —— 金丝雀插件的安装、激活与界面回归
 *
 * Issue #230：CI 改为跑 e2e/ 下**全部**用例（pnpm test:e2e），
 * 本注释用于标明该用例覆盖的能力域 —— 新增用例时按同一口径挂靠。
 */
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

import Database from 'better-sqlite3';
import { enterEntryPortal } from './fixtures/classroom-entry';

function purgeCanaryDirectFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    // 1. 查找并删除金丝雀插件目录及记录
    const canaryPlugins = db
      .prepare('SELECT id FROM plugins WHERE name LIKE ? OR id LIKE ?')
      .all('%金丝雀%', '%canary%') as { id: string }[];
    for (const p of canaryPlugins) {
      const pDir = path.resolve(process.cwd(), 'plugins', p.id);
      if (fs.existsSync(pDir)) {
        fs.rmSync(pDir, { recursive: true, force: true });
      }
      db.prepare('DELETE FROM plugins WHERE id = ?').run(p.id);
    }

    // 2. 删除测试班级与关联排座
    const canaryClasses = db.prepare('SELECT id FROM classes WHERE name LIKE ?').all('%金丝雀%') as { id: string }[];
    for (const c of canaryClasses) {
      db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
    }

    // 3. 删除测试机房
    const canaryLabs = db
      .prepare('SELECT id FROM computer_labs WHERE room_number LIKE ? OR room_number = ?')
      .all('%金丝雀%', '机房A-101') as { id: string }[];
    for (const l of canaryLabs) {
      db.prepare('DELETE FROM computer_labs WHERE id = ?').run(l.id);
      db.prepare('DELETE FROM student_seats WHERE lab_id = ?').run(l.id);
    }

    // 4. 删除测试学生
    const canaryStudents = db
      .prepare('SELECT id FROM students WHERE name LIKE ? OR student_number LIKE ?')
      .all('%探针%', '%CANARY%') as { id: string }[];
    for (const s of canaryStudents) {
      db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
      db.prepare('DELETE FROM student_seats WHERE student_id = ?').run(s.id);
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(s.id);
    }

    // 5. 删除测试金丝雀课程
    const canaryLessons = db.prepare('SELECT id FROM lessons WHERE title LIKE ?').all('%金丝雀%') as { id: string }[];
    for (const l of canaryLessons) {
      db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    }
  } finally {
    db.close();
  }
}

async function cleanupAllCanaryData(request: any) {
  // 保证具备管理员权限进行 API 级正常卸载
  await request
    .post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    })
    .catch(() => {});

  // 1. 深度卸载与删除所有金丝雀探针插件
  try {
    const listRes = await request.get('/api/plugins');
    if (listRes.ok()) {
      const plugins = await listRes.json();
      const arr = Array.isArray(plugins) ? plugins : plugins.plugins || [];
      for (const p of arr) {
        if (p.name?.includes('金丝雀') || p.id?.includes('canary') || p.manifest?.id?.includes('canary')) {
          await request.delete(`/api/plugins/${encodeURIComponent(p.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  // 2. 清理所有金丝雀测试班级
  try {
    const cRes = await request.get('/api/classes');
    if (cRes.ok()) {
      const classes = await cRes.json();
      const arr = Array.isArray(classes) ? classes : [];
      for (const c of arr) {
        if (c.name?.includes('金丝雀') || c.name?.includes('canary')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  // 3. 清理所有测试机房
  try {
    const lRes = await request.get('/api/labs');
    if (lRes.ok()) {
      const labs = await lRes.json();
      const arr = Array.isArray(labs) ? labs : [];
      for (const l of arr) {
        if (l.room_number?.includes('金丝雀') || l.room_number === '机房A-101') {
          await request.delete(`/api/labs/${encodeURIComponent(l.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  // 4. 清理所有探针测试学生
  try {
    const sRes = await request.get('/api/students');
    if (sRes.ok()) {
      const students = await sRes.json();
      const arr = Array.isArray(students) ? students : [];
      for (const s of arr) {
        if (s.name?.includes('探针') || s.student_number?.includes('CANARY')) {
          await request.delete(`/api/students/${encodeURIComponent(s.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  // 4.5 清理所有金丝雀测试课程
  try {
    const lesRes = await request.get('/api/lessons');
    if (lesRes.ok()) {
      const lessons = await lesRes.json();
      const arr = Array.isArray(lessons) ? lessons : [];
      for (const l of arr) {
        if (l.title?.includes('金丝雀') || l.title?.includes('canary')) {
          await request.delete(`/api/lessons/${encodeURIComponent(l.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  // 5. DB 级绝对彻底兜底清除
  purgeCanaryDirectFromDb();
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

    // 2a. 前置幂等清扫：彻底清除任何金丝雀残留数据
    await cleanupAllCanaryData(request);

    // 3. 上传安装金丝雀插件 (inline 模式)
    // 金丝雀 fixture 是本仓库本地自建的测试包（无 Ed25519 签名），
    // 且清单声明了能力与公开路由 —— 按 B2 安全基线，管理员必须显式声明
    // x-allow-unsigned / x-approve-capabilities / x-approve-public-routes，
    // 否则插件不会 ACTIVATE。与 scripts/upgrade-regression/lib.ts 的口径一致。
    const uploadRes = await request.post('/api/plugins/upload-zip-raw', {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': 'ext-canary.zip',
        'X-Execution-Mode': 'inline',
        'X-Install-Mode': 'install',
        'X-Allow-Unsigned': 'true',
        'X-Approve-Capabilities': 'true',
        'X-Approve-Public-Routes': 'true',
      },
      data: zipBuffer,
    });
    if (!uploadRes.ok()) {
      throw new Error(`金丝雀插件上传失败：HTTP ${uploadRes.status()} ${await uploadRes.text()}`);
    }

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
    // 后置无条件深度清理：确保日常环境中绝对零金丝雀残留
    await cleanupAllCanaryData(request);
  });

  test('7.1 & 7.6 第三方插件安装激活、命令互通与 manifest 贡献声明 (Generates Artifact: Screenshot)', async ({
    page,
  }) => {
    await ensureLoggedIn(page);

    // 7.1.a：插件在服务端安装并激活（宿主侧激活链路打通）。
    const pluginsRes = await page.request.get('/api/plugins');
    expect(pluginsRes.ok()).toBeTruthy();
    const pluginsJson = await pluginsRes.json();
    const pluginList: { id: string; status?: string; manifest?: string }[] = Array.isArray(pluginsJson)
      ? pluginsJson
      : (pluginsJson?.plugins ?? []);
    const installed = pluginList.find((p) => p.id === installedPluginId);
    expect(installed, '金丝雀插件应已安装').toBeTruthy();
    expect(installed!.status).toBe('active');

    // 7.1.b：manifest 声明式贡献被如实登记（contributes.teacher.tab / classroom.tool ...）。
    const manifest = JSON.parse(installed!.manifest || '{}');
    expect(manifest.id).toBe('ext-canary');
    expect(manifest.contributes?.['teacher.tab']).toBeTruthy();

    // 7.6.a：插件命令经宿主 CommandBus 打通（与插件前端 invokeCommand 同一条通路）。
    // 必须用 page.request —— 顶层 `request` fixture 不与浏览器上下文共享 cookie。
    const pingRes = await page.request.post('/api/plugins/execute-command', {
      data: { type: 'ext-canary.canary.ping', payload: { from: 'e2e' } },
    });
    expect(pingRes.ok()).toBeTruthy();
    const pingJson = await pingRes.json();
    expect(pingJson.success).toBe(true);
    expect(pingJson.result).toMatchObject({ pong: true });

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    expect(fs.existsSync(SCREENSHOT_PATH)).toBe(true);

    // 7.1.c：插件前端在**宿主页面**渲染 Tab / React 面板 —— PL-02 信任边界整改后不可达：
    // 远程插件前端一律进 sandbox="allow-scripts" 的不透明源 iframe 执行，
    // 1) React 组件函数无法穿过 postMessage 桥（src/plugin-host/sandbox-frame.ts、
    //    docs/plugin/plugin-security-migration.md「前端沙箱」一节），且 iframe 自身 display:none；
    // 2) frontend.js 里 `import React from 'react'` 会被改写成读取 `window.HostSharedDeps`，
    //    而该对象只存在于父页面 —— 依赖 React 的远程插件前端在沙箱内无法激活，
    //    宿主会记 activate-error 并触发熔断，进而把 manifest 声明式贡献一并撤销
    //    （ExtensionPointRenderer 的 handleBreakerTrip → unregisterPluginExtensionPoints）。
    //    所以「Tab 是否出现」在当前架构下是时序相关的，不能作为稳定断言。
    //    沙箱依赖注入（让 iframe 拿到 HostSharedDeps）属于独立待办项。
    test.skip(
      true,
      'PL-02 沙箱整改后远程插件前端无法在宿主页面渲染 React 面板；依赖 React 的 frontend.js 在不透明源沙箱内无法激活（window.HostSharedDeps 不可达），Tab 挂载断言时序相关不可稳定断言',
    );
  });

  test('7.5 机房座位图 4 大扩展槽位的数据契约与截图 (Generates Artifact: Screenshot)', async ({ page }) => {
    await ensureLoggedIn(page);

    // 7.5.0 座位数据契约：4 大扩展槽位（toolbar/legend/summary/seat_badge）消费的就是
    // 这份座位图数据。宿主侧必须如实提供「3 个座位 + 正确绑定学生 + 机房行列」。
    const seatsRes = await page.request.get(`/api/classes/${encodeURIComponent(testClassId!)}/seats`);
    expect(seatsRes.ok()).toBeTruthy();
    const seatsJson = await seatsRes.json();
    const seatList: { row_idx: number; col_idx: number; student_id?: string }[] = Array.isArray(seatsJson)
      ? seatsJson
      : (seatsJson?.seats ?? []);
    expect(seatList).toHaveLength(3);
    expect(seatList.map((s) => `${s.row_idx}_${s.col_idx}`).sort()).toEqual(['0_0', '0_1', '1_0']);
    expect(seatList.every((s) => !!s.student_id)).toBe(true);

    // 7.5.1 导航到「互动课堂」，确认课堂侧能读到这份座位图
    const liveClassTab = page.locator('button:has-text("互动课堂")').first();
    await expect(liveClassTab).toBeVisible({ timeout: 10000 });
    await liveClassTab.click();

    // Issue #91：首屏是「进行中的课堂会话」列表 —— 回到起始门户，
    // 让机房座位图所在班级的门户卡片真实渲染一遍。
    await enterEntryPortal(page);
    await expect(page.getByText('选择授课课程')).toBeVisible({ timeout: 15000 });

    // 7.5.2 捕获真实渲染截图存盘 (Generates Artifact: Screenshot)
    const SEATING_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/canary_seating_map.png');
    await page.screenshot({ path: SEATING_SCREENSHOT, fullPage: true });
    expect(fs.existsSync(SEATING_SCREENSHOT)).toBeTruthy();

    // 7.5.3 记录测试证据（动态提取实际数据，杜绝硬编码假证据）
    const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(LOG_DIR, 'canary_stage7_deep_slots_evidence.log'),
      `[${new Date().toISOString()}] Stage 7 Deep Seating Slots Verified:
- Seating Seats Count: ${seatList.length}
- Seating Seat Cells: ${seatList.map((s) => `${s.row_idx}_${s.col_idx}`).join(', ')}
- Seating Lab: ${testLabId}
- Seating Screenshot: ${fs.existsSync(SEATING_SCREENSHOT) ? SEATING_SCREENSHOT : 'FAILED'}
`,
    );

    // 7.5.4 4 大扩展槽位的 React 渲染断言 —— PL-02 信任边界整改后已被移除：
    // 远程插件前端一律进 sandbox="allow-scripts" 的不透明源 iframe 执行，
    // React 组件函数无法穿过 postMessage 桥（见 src/plugin-host/sandbox-frame.ts
    // 与 docs/plugin/plugin-security-migration.md「前端沙箱」一节），
    // 且 iframe 自身 display:none。故此处显式跳过并登记原因。
    test.skip(
      true,
      'PL-02 沙箱整改后远程插件 React 面板不再渲染于宿主页面（iframe 为不透明源且隐藏），槽位渲染断言已不可达',
    );
  });

  test('7.4 & 7.9 白板工具栏锚点与自动保存槽位状态展示 (Generates Artifact: Screenshot)', async ({ page }) => {
    await ensureLoggedIn(page);

    // 确保存在金丝雀测试课程供测试点击 (自建独立 fixture，不依赖现有数据库数据)
    // 注意：必须用 page.request —— 顶层 `request` fixture 是**独立**的 APIRequestContext，
    // 与浏览器上下文不共享 cookie，未登录的调用会被 /api/lessons 判 401，
    // 课程根本没建出来，后续「课程卡片按钮」自然找不到。
    await page.request
      .post('/api/lessons', {
        data: {
          title: '金丝雀白板测试课',
          content: '# 金丝雀备课教案',
        },
      })
      .catch(() => {});

    // 1. 导航到「课程管理」
    const coursesTab = page.locator('button:has-text("课程管理")').first();
    await expect(coursesTab).toBeVisible({ timeout: 10000 });
    await coursesTab.click();

    // 2. 定位并点击金丝雀课程或首个课程进入备课编辑器 (LessonEditorView)
    const canaryCard = page.locator('div:has-text("金丝雀白板测试课")').first();
    const canaryBtn = canaryCard
      .locator('button[title*="查看与编辑"], button[title*="查看只读"], button:has-text("查看教案")')
      .first();
    const fallbackBtn = page
      .locator('button[title*="查看与编辑"], button[title*="查看只读"], button:has-text("查看教案")')
      .first();

    if (await canaryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await canaryBtn.click();
    } else {
      await expect(fallbackBtn).toBeVisible({ timeout: 10000 });
      await fallbackBtn.click();
    }

    // 3. 白板自动保存状态/动作扩展槽位与工具栏锚点按钮的 React 渲染断言 ——
    // PL-02 信任边界整改后已被移除：远程插件前端一律进 sandbox="allow-scripts"
    // 的不透明源 iframe 执行，React 组件函数无法穿过 postMessage 桥
    // （见 src/plugin-host/sandbox-frame.ts 与
    // docs/plugin/plugin-security-migration.md「前端沙箱」一节），且 iframe 自身 display:none。
    // 故此处显式跳过并登记原因。
    test.skip(
      true,
      'PL-02 沙箱整改后远程插件 React 面板不再渲染于宿主页面（iframe 为不透明源且隐藏），槽位渲染断言已不可达',
    );
  });
});
