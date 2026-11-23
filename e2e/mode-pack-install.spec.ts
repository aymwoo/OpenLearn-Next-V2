/**
 * 第三方模式包浏览器 E2E（阶段 13.2）。
 *
 * 走真实浏览器 + 真实服务端：
 * 1. 通过 API 安装并激活示例包 `ext-mode-pack-lab`；
 * 2. 课程管理向导出现「探究学习」模式；
 * 3. 用该模式创建课时后，课程卡显示插件包徽标；
 * 4. 停用插件后徽标回落白板；
 * 5. 清理课时与插件安装物。
 *
 * 归属：教师端 / 课程管理 × 第三方模式包。
 */
import { expect, test, request as apiRequest, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000';
const PLUGIN_ID = 'ext-mode-pack-lab';
const PACK_ID = 'ext-mode-pack-lab:inquiry';
const LESSON_PREFIX = 'E2E 模式包安装验收';

/**
 * 专用管理员账号。
 *
 * 不依赖开发库里的 `admin/admin`（本地可能已被改密），用例自己造、自己删，
 * 避免为了跑 E2E 去重置开发者的管理员口令。
 */
const E2E_ADMIN_ID = 'usr-e2e-mode-pack-admin';
const E2E_ADMIN_USER = 'e2e_mode_pack_admin';
const E2E_ADMIN_PASS = 'E2eModePack!2026';

const DEV_DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DEV_DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function ensureE2eAdmin(): void {
  withDb((db) => {
    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?,?,?,?,?,?)',
    ).run(
      E2E_ADMIN_ID,
      E2E_ADMIN_USER,
      bcrypt.hashSync(E2E_ADMIN_PASS, 10),
      'administrator',
      'E2E 模式包管理员',
      Date.now(),
    );
  });
}

function removeE2eAdmin(): void {
  withDb((db) => {
    db.prepare('DELETE FROM client_sessions WHERE session_data LIKE ?').run(`%${E2E_ADMIN_ID}%`);
    db.prepare('DELETE FROM users WHERE id = ?').run(E2E_ADMIN_ID);
  });
}

/**
 * 在独立 Node 进程里构建 ZIP。
 *
 * 不在 Playwright 进程内 import 构建脚本：它依赖 jszip（CJS）与 esbuild，
 * 经 Playwright 的 TS loader 加载时会触发 Node 内部模块状态错误。
 */
function buildZip(): Buffer {
  const script = path.resolve(process.cwd(), 'scripts/build-mode-pack-lab.mjs');
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
  return fs.readFileSync(path.resolve(process.cwd(), 'dist/plugins/ext-mode-pack-lab-1.0.0.zip'));
}

async function login(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/auth/login', {
    data: { entrance: 'teacher', username: E2E_ADMIN_USER, password: E2E_ADMIN_PASS },
  });
  expect(res.ok(), `管理员登录应成功（HTTP ${res.status()}）`).toBeTruthy();
}

/** 清理本用例创建的课时与插件安装物；可在用例前后重复执行。 */
async function cleanup(): Promise<void> {
  const api = await apiRequest.newContext({ baseURL: BASE_URL });
  try {
    await login(api);

    const lessonsRes = await api.get('/api/lessons?pageSize=all');
    if (lessonsRes.ok()) {
      const body = (await lessonsRes.json()) as { data?: Array<{ id: string; title?: string }> };
      for (const lesson of body.data ?? []) {
        if (lesson.title?.startsWith(LESSON_PREFIX)) {
          await api.delete(`/api/lessons/${encodeURIComponent(lesson.id)}`).catch(() => {});
        }
      }
    }

    const pluginsRes = await api.get('/api/plugins');
    if (pluginsRes.ok()) {
      const plugins = (await pluginsRes.json()) as Array<{ id: string; manifest?: string | { id?: string } }>;
      for (const record of plugins) {
        let manifestId: string | undefined;
        try {
          const manifest = typeof record.manifest === 'string' ? JSON.parse(record.manifest) : record.manifest;
          manifestId = manifest?.id;
        } catch {
          manifestId = undefined;
        }
        if (manifestId !== PLUGIN_ID) continue;
        await api.post(`/api/plugins/${encodeURIComponent(record.id)}/toggle`).catch(() => {});
        await api.delete(`/api/plugins/${encodeURIComponent(record.id)}`).catch(() => {});
      }
    }
  } finally {
    await api.dispose();
  }
}

test.describe('第三方模式包：安装 → 向导 → 课时徽标 → 停用回落', () => {
  test.beforeAll(async () => {
    ensureE2eAdmin();
    await cleanup();
  });

  test.afterAll(async () => {
    try {
      await cleanup();
    } finally {
      removeE2eAdmin();
    }
  });

  test('示例包出现在课程向导，绑定后的课时展示包徽标，停用后回落白板', async ({ page, context }) => {
    const lessonTitle = `${LESSON_PREFIX}-${Date.now().toString(36)}`;

    await login(context.request);

    // 1. 安装并激活示例包
    const zip = buildZip();
    const upload = await context.request.post('/api/plugins/upload-zip-raw', {
      headers: {
        'content-type': 'application/zip',
        'x-filename': 'ext-mode-pack-lab-1.0.0.zip',
      },
      data: zip,
    });
    expect(upload.status()).toBe(200);
    const uploaded = (await upload.json()) as { pluginId: string; manifest?: { id?: string } };
    expect(uploaded.manifest?.id).toBe(PLUGIN_ID);
    expect(uploaded.pluginId).toBeTruthy();

    const activate = await context.request.post(`/api/plugins/${encodeURIComponent(uploaded.pluginId)}/toggle`);
    expect(activate.ok(), '激活示例包应成功').toBeTruthy();

    // 2. 目录已收录
    const packsRes = await context.request.get('/api/mode-packs');
    expect(packsRes.ok()).toBeTruthy();
    const packs = (await packsRes.json()) as { data: Array<{ id: string }> };
    expect(packs.data.some((pack) => pack.id === PACK_ID)).toBe(true);

    // 3. 课程向导出现第三方模式
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto('/');
    await page
      .getByRole('button', { name: /课程管理|Courses/ })
      .first()
      .click();
    await page.locator('#add-course-wizard-btn').click();
    const modeFieldset = page.getByTestId('course-delivery-mode');
    await expect(modeFieldset.getByRole('radio', { name: /探究学习/ })).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗' }).click();

    // 4. 创建绑定第三方包的课时，课程卡显示包徽标
    const createRes = await context.request.post('/api/lessons', {
      data: { title: lessonTitle, content: 'E2E 模式包安装验收', modePackId: PACK_ID },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.reload();
    await page
      .getByRole('button', { name: /课程管理|Courses/ })
      .first()
      .click();
    await expect(page.getByText(lessonTitle).first()).toBeVisible();
    await expect(page.getByText('探究学习').first()).toBeVisible();

    // 5. 停用插件后徽标回落白板
    const deactivate = await context.request.post(`/api/plugins/${encodeURIComponent(uploaded.pluginId)}/toggle`);
    expect(deactivate.ok()).toBeTruthy();

    await page.reload();
    await page
      .getByRole('button', { name: /课程管理|Courses/ })
      .first()
      .click();
    await expect(page.getByText(lessonTitle).first()).toBeVisible();
    await expect(page.getByText('探究学习')).toHaveCount(0);
  });
});
