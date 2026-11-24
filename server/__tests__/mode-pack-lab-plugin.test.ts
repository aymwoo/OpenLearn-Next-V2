/**
 * 第三方模式包真实安装验收（阶段 12.2）。
 *
 * 与阶段 11.1 的纯函数 fixture 不同，这里走完整安装链路：
 * ZIP 结构 → `POST /api/plugins/upload-zip-raw` → 激活 → `GET /api/mode-packs`
 * → 创建课时落库 `mode_pack_id` → 停用后目录移除并回落内置白板。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { fileURLToPath } from 'node:url';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';
import { ensureTestSchema } from './helpers/test-schema.js';
import { registerPluginsRoutes } from '../routes/plugins.js';
import { registerLessonsRoutes } from '../routes/lessons.js';
import { registerModePackRoutes } from '../routes/mode-packs.js';
import { buildModePackLabZip } from '../../packages/mode-pack-lab/builder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_ID = 'ext-mode-pack-lab';
const PACK_ID = 'ext-mode-pack-lab:inquiry';
const ADMIN_ID = 'usr-mode-lab-admin';
const ADMIN_TOKEN = 'tok-mode-lab-admin';
const LESSON_TITLE = '模式包安装验收课';

describe('第三方模式包: ext-mode-pack-lab 真实安装与目录验收', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;
  let originalNodeEnv: string | undefined;
  let originalPluginsDir: string | undefined;
  let testPluginsDir: string;
  let installedPluginId: string | null = null;

  const authCookie = () => ({ Cookie: `edu_os_token=${ADMIN_TOKEN}` });

  beforeAll(async () => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    originalPluginsDir = (kernelContainer.pluginHost as any).pluginsDir;
    testPluginsDir = fs.mkdtempSync(path.resolve(__dirname, '.tmp-plugins-mode-lab-'));
    (kernelContainer.pluginHost as any).pluginsDir = testPluginsDir;

    ensureTestSchema();
    const db = kernelContainer.db;
    const now = Date.now();

    db.prepare(
      'INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ADMIN_ID, 'mode_lab_admin', 'hash_mode_lab', 'administrator', '模式包验收管理员', now);
    db.prepare(
      'INSERT OR REPLACE INTO client_sessions (id, session_data, updated_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(
      ADMIN_TOKEN,
      JSON.stringify({ userId: ADMIN_ID, role: 'administrator', username: 'mode_lab_admin', name: '模式包验收管理员' }),
      now,
      now + 86400000,
    );

    app = express();
    app.use(express.json());

    const ioMock = { to: () => ({ emit: () => {} }), emit: () => {} };
    kernelContainer.pluginHost.setExpressApp(app);
    registerPluginsRoutes({ app, io: ioMock } as any);
    registerLessonsRoutes({ app } as any);
    registerModePackRoutes({ app } as any);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (installedPluginId) {
      try {
        await kernelContainer.pluginHost.deactivatePlugin(installedPluginId);
      } catch {
        /* 已停用时忽略 */
      }
      try {
        await kernelContainer.pluginHost.uninstallPlugin(installedPluginId);
      } catch {
        /* 已卸载时忽略 */
      }
    }

    const db = kernelContainer.db;
    db.prepare('DELETE FROM lessons WHERE title = ?').run(LESSON_TITLE);
    db.prepare('DELETE FROM client_sessions WHERE id = ?').run(ADMIN_TOKEN);
    db.prepare('DELETE FROM users WHERE id = ?').run(ADMIN_ID);

    if (originalPluginsDir) (kernelContainer.pluginHost as any).pluginsDir = originalPluginsDir;
    if (testPluginsDir && fs.existsSync(testPluginsDir)) {
      fs.rmSync(testPluginsDir, { recursive: true, force: true });
    }

    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));

    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
  });

  it('打包物包含 manifest / index.js，且 mode.pack 通过 schema 校验', async () => {
    const zipBuf = await buildModePackLabZip();
    expect(zipBuf).toBeInstanceOf(Buffer);

    const zip = await JSZip.loadAsync(zipBuf);
    expect(zip.file('manifest.json')).not.toBeNull();
    expect(zip.file('index.js')).not.toBeNull();

    const rawManifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    const parsed = manifestSchema.parse(rawManifest);
    expect(parsed.id).toBe(PLUGIN_ID);

    const packs = parsed.contributes?.['mode.pack'] ?? [];
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: PACK_ID,
      label: '探究学习',
      segmentTypes: ['inquiry-lab'],
    });
  });

  it('上传 ZIP 后安装并激活', async () => {
    const zipBuf = await buildModePackLabZip();
    const res = await fetch(`${baseUrl}/api/plugins/upload-zip-raw`, {
      method: 'POST',
      headers: {
        ...authCookie(),
        'Content-Type': 'application/zip',
        'x-filename': 'ext-mode-pack-lab-1.0.0.zip',
      },
      body: zipBuf,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; pluginId: string; manifest: { id: string } };
    expect(body.success).toBe(true);
    expect(body.manifest.id).toBe(PLUGIN_ID);
    expect(body.pluginId).toBeTruthy();

    installedPluginId = body.pluginId;
    await kernelContainer.pluginHost.activatePlugin(installedPluginId);
    expect(kernelContainer.pluginHost.getPluginState(installedPluginId)).toBe('active');
  });

  it('激活后目录出现该模式包且无能力警告', async () => {
    const res = await fetch(`${baseUrl}/api/mode-packs`, { headers: authCookie() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; source: string; pluginId?: string; warnings?: string[] }>;
    };
    const pack = body.data.find((item) => item.id === PACK_ID);
    expect(pack).toBeDefined();
    expect(pack?.source).toBe('plugin');
    expect(pack?.pluginId).toBe(PLUGIN_ID);
    expect(pack?.warnings).toBeUndefined();
  });

  it('创建课时时把第三方包 id 落库', async () => {
    const res = await fetch(`${baseUrl}/api/lessons`, {
      method: 'POST',
      headers: { ...authCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: LESSON_TITLE, content: '模式包安装验收', modePackId: PACK_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; result: { modeBinding?: { fallback: boolean } } };
    expect(body.success).toBe(true);
    expect(body.result.modeBinding?.fallback).toBe(false);

    const row = kernelContainer.db.prepare('SELECT mode_pack_id FROM lessons WHERE title = ?').get(LESSON_TITLE) as
      { mode_pack_id: string | null } | undefined;
    expect(row?.mode_pack_id).toBe(PACK_ID);
  });

  it('停用后目录移除，新建课时回落内置白板', async () => {
    await kernelContainer.pluginHost.deactivatePlugin(installedPluginId!);

    const res = await fetch(`${baseUrl}/api/mode-packs`, { headers: authCookie() });
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.some((item) => item.id === PACK_ID)).toBe(false);

    const fallbackTitle = `${LESSON_TITLE}-回落`;
    const createRes = await fetch(`${baseUrl}/api/lessons`, {
      method: 'POST',
      headers: { ...authCookie(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: fallbackTitle, content: '模式包已停用', modePackId: PACK_ID }),
    });
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as { result: { modeBinding?: { fallback: boolean } } };
    expect(createBody.result.modeBinding?.fallback).toBe(true);

    const row = kernelContainer.db.prepare('SELECT mode_pack_id FROM lessons WHERE title = ?').get(fallbackTitle) as
      { mode_pack_id: string | null } | undefined;
    // 回落时 modeBinding.modePackId 为 null，命令 payload 不写该字段
    expect(row?.mode_pack_id).toBeNull();

    kernelContainer.db.prepare('DELETE FROM lessons WHERE title = ?').run(fallbackTitle);
  });
});
