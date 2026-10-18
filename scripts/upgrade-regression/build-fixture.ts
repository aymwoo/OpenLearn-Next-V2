#!/usr/bin/env tsx
/**
 * 生成升级回归 fixture（Issue #147）。
 *
 * 用法：
 *   pnpm exec tsx scripts/upgrade-regression/build-fixture.ts \
 *     --plugins-dir .plugin-compatibility-fixtures \
 *     --out .upgrade-fixtures/upgrade-fixture-v1.2.3.zip \
 *     --label v1.2.3
 *
 * 语义：用**当前 checkout 的服务端代码**建一个「刚发布完、装好插件、已有数据」的数据目录，
 * 打包成 fixture。之后每次 PR 都用它验证「旧库 + 旧插件数据 → 当前 main」。
 *
 * 关键点：全程走真实 HTTP API（安装插件、建班、建学生），不做任何 schema 手拼，
 * 否则 fixture 无法证明真实安装/迁移链路可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  HttpSession,
  REPO_ROOT,
  createTempDir,
  installPluginZip,
  isPluginActive,
  listPlugins,
  loginAsAdmin,
  openDb,
  pluginManifestId,
  readAppliedMigrations,
  readPlatformVersion,
  readTableNames,
  rmDir,
  snapshotFixture,
  startServer,
  writePluginStorageMarker,
  type FixtureMetadata,
  type FixturePlugin,
} from './lib.js';

const FIXTURE_MARKER_KEY = 'upgrade_regression_marker';
const FIXTURE_MARKER_VALUE = 'seeded-by-build-fixture-v1';

/** 失败时也要清掉临时数据目录，避免 CI runner 上堆积几 GB 的孤儿库。 */
let activeDataDir: string | undefined;
let activeServerLogs: (() => string) | undefined;

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'plugins-dir': { type: 'string' },
      label: { type: 'string' },
      'server-cwd': { type: 'string' },
      port: { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  });

  if (!values.out) throw new Error('缺少 --out');
  if (!values['plugins-dir']) throw new Error('缺少 --plugins-dir');

  const pluginsDir = path.resolve(values['plugins-dir']);
  const outFile = path.resolve(values.out);
  const serverCwd = values['server-cwd'] ? path.resolve(values['server-cwd']) : REPO_ROOT;
  const label = values.label || readPlatformVersion(serverCwd);
  const zipFiles = fs
    .readdirSync(pluginsDir)
    .filter((name) => name.endsWith('.zip'))
    .sort()
    .map((name) => path.join(pluginsDir, name));
  if (zipFiles.length === 0) {
    throw new Error(`插件目录里没有 ZIP：${pluginsDir}（先跑 stage-plugin-compat-fixture.mjs）`);
  }

  const dataDir = process.env.OPENLEARN_FIXTURE_DATA_DIR
    ? path.resolve(process.env.OPENLEARN_FIXTURE_DATA_DIR)
    : createTempDir('ol-upgrade-fixture-');
  activeDataDir = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  console.log(`[build-fixture] label=${label} serverCwd=${serverCwd} dataDir=${dataDir}`);

  let server = await startServer({
    serverCwd,
    dataDir,
    port: values.port ? Number(values.port) : undefined,
  });
  activeServerLogs = server.logs;
  const session = new HttpSession(server.url);
  await loginAsAdmin(session);
  console.log('[build-fixture] 管理员登录成功');

  const installed: FixturePlugin[] = [];
  for (const zipFile of zipFiles) {
    const result = await installPluginZip(session, zipFile);
    const manifestId = result.manifest?.id;
    if (!manifestId) throw new Error(`安装 ${zipFile} 后未返回 manifest.id`);
    installed.push({
      manifestId,
      dbId: result.pluginId,
      version: result.manifest.version ?? '0.0.0',
    });
    console.log(`[build-fixture] 已安装 ${manifestId}@${result.manifest.version ?? '?'} (${path.basename(zipFile)})`);
  }

  const plugins = await listPlugins(session);
  for (const plugin of installed) {
    let match = plugins.find((entry) => pluginManifestId(entry) === plugin.manifestId);
    if (!match) throw new Error(`安装后插件列表里找不到 ${plugin.manifestId}`);
    if (!isPluginActive(match)) {
      // 安装只落库不激活（state=installed）；fixture 需要的是「已装且正在跑」的真实现场。
      await session.json(`/api/plugins/${encodeURIComponent(plugin.dbId)}/toggle`, { method: 'POST' });
      const afterToggle = await listPlugins(session);
      match = afterToggle.find((entry) => pluginManifestId(entry) === plugin.manifestId);
    }
    if (!isPluginActive(match)) {
      throw new Error(
        `插件 ${plugin.manifestId} 安装后状态为 ${match?.state ?? match?.status ?? 'unknown'}，fixture 要求全部 active`,
      );
    }
  }

  const className = `升级回归样例班-${Date.now()}`;
  const classResponse = await session.json<{ success: boolean; id: string }>('/api/classes', {
    method: 'POST',
    body: { name: className, description: 'upgrade regression fixture' },
  });
  const classId = classResponse.id;
  const studentIds: string[] = [];
  const studentNumbers: string[] = [];
  for (const name of ['升级样例学生A', '升级样例学生B']) {
    const created = await session.json<{ success: boolean; id: string; student_number: string }>('/api/students', {
      method: 'POST',
      body: { name },
    });
    studentIds.push(created.id);
    studentNumbers.push(created.student_number);
    await session.json(`/api/classes/${encodeURIComponent(classId)}/students`, {
      method: 'POST',
      body: { studentId: created.id },
    });
  }
  console.log(`[build-fixture] 样例数据：class=${classId} students=${studentIds.join(',')}`);

  // 先停服再动库：安装链路会写 WAL，运行中直接 VACUUM 得到的不是稳定快照。
  const exitCode = await server.stop();
  console.log(`[build-fixture] 服务已停止（exit=${exitCode}）`);

  const dbPath = path.join(dataDir, 'educational_os.db');
  const db = openDb(dbPath, false);
  let metadata: FixtureMetadata;
  try {
    for (const plugin of installed) {
      // 直接写 plugin_storage：插件配置 schema 会过滤未知键，标记键要保证一定落库。
      writePluginStorageMarker(db, plugin.dbId, FIXTURE_MARKER_KEY, FIXTURE_MARKER_VALUE);
    }
    metadata = {
      label,
      platformVersion: readPlatformVersion(serverCwd),
      createdAt: new Date().toISOString(),
      migrations: readAppliedMigrations(db),
      tables: readTableNames(db),
      plugins: installed,
      sample: { classId, className, studentIds, studentNumbers },
      markerKey: FIXTURE_MARKER_KEY,
      markerValue: FIXTURE_MARKER_VALUE,
    };
  } finally {
    db.close();
  }

  await snapshotFixture({ dataDir, outFile, metadata });
  const sizeMb = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
  console.log(
    `[build-fixture] 已写出 ${outFile}（${sizeMb} MB，${metadata.migrations.length} 条迁移，${metadata.tables.length} 张表）`,
  );

  if (values.keep) {
    console.log(`[build-fixture] --keep 保留数据目录：${dataDir}`);
  } else {
    rmDir(dataDir);
  }
}

main().catch((error) => {
  if (activeServerLogs) {
    console.error('--- server logs (tail) ---');
    console.error(activeServerLogs().split('\n').slice(-60).join('\n'));
  }
  if (activeDataDir && !process.env.OPENLEARN_FIXTURE_DATA_DIR) {
    rmDir(activeDataDir);
    console.error(`[build-fixture] 已清理临时数据目录 ${activeDataDir}`);
  }
  console.error('[build-fixture] 失败：', error);
  process.exit(1);
});
