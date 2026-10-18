#!/usr/bin/env tsx
/**
 * 升级回归校验（Issue #147）。
 *
 * 用法：
 *   pnpm exec tsx scripts/upgrade-regression/verify-upgrade.ts \
 *     --fixture .upgrade-fixtures/upgrade-fixture-v1.2.3.zip
 *
 * 断言（任一失败即非零退出）：
 * 1. fixture 自身完整：库里的迁移记录与 metadata 一致（防止 fixture 被手改过）
 * 2. 当前 main 能在旧库上启动：/health 可用（checksum 漂移会因 MIGRATION_CHECKSUM_STRICT 直接启动失败）
 * 3. 已装插件仍全部 ACTIVE
 * 4. 旧业务数据仍可读：班级、学生、班级成员
 * 5. 插件旧数据仍在：plugin_storage 标记可读回
 * 6. 已执行迁移的 checksum 未被改写，且所有当前迁移都已应用
 * 7. 重启一次不产生任何新迁移（幂等）
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  HttpSession,
  REPO_ROOT,
  VerificationError,
  assertReport,
  compareMigrations,
  createTempDir,
  fixtureIntegrityIssues,
  isPluginActive,
  listPlugins,
  loadCurrentMigrations,
  loginAsAdmin,
  openDb,
  pluginManifestId,
  readAppliedMigrations,
  readPluginStorageMarker,
  readTableNames,
  record,
  restoreFixture,
  rmDir,
  startServer,
  type VerificationReport,
} from './lib.js';

const PAGE_SIZE_QUERY = '?pageSize=200';

/** 失败时也要清掉临时数据目录。 */
let activeDataDir: string | undefined;

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string' },
      'server-cwd': { type: 'string' },
      port: { type: 'string' },
      keep: { type: 'boolean', default: false },
    },
  });
  if (!values.fixture) throw new Error('缺少 --fixture');

  const fixtureFile = path.resolve(values.fixture);
  if (!fs.existsSync(fixtureFile)) throw new Error(`fixture 不存在：${fixtureFile}`);
  const serverCwd = values['server-cwd'] ? path.resolve(values['server-cwd']) : REPO_ROOT;
  const dataDir = createTempDir('ol-upgrade-verify-');
  activeDataDir = dataDir;
  const report: VerificationReport = { checks: [] };

  console.log(`[verify-upgrade] fixture=${fixtureFile}`);
  console.log(`[verify-upgrade] serverCwd=${serverCwd}`);
  console.log(`[verify-upgrade] dataDir=${dataDir}`);

  const metadata = await restoreFixture(fixtureFile, dataDir);
  console.log(
    `[verify-upgrade] fixture label=${metadata.label} platform=${metadata.platformVersion} ` +
      `migrations=${metadata.migrations.length} tables=${metadata.tables.length} plugins=${metadata.plugins.length}`,
  );

  const dbPath = path.join(dataDir, 'educational_os.db');

  // ── 1. fixture 自身完整性 ────────────────────────────────────────────────
  {
    const db = openDb(dbPath);
    try {
      const issues = fixtureIntegrityIssues(metadata, readAppliedMigrations(db));
      record(report, 'fixture 迁移记录与 metadata 一致', issues.length === 0, issues.join('; ') || undefined);
    } finally {
      db.close();
    }
  }

  // ── 2-5. 用当前代码启动旧库并读数据 ──────────────────────────────────────
  let server = await startServer({
    serverCwd,
    dataDir,
    port: values.port ? Number(values.port) : undefined,
  });
  record(report, '/health 在旧库上可用', true);

  try {
    const session = new HttpSession(server.url);
    await loginAsAdmin(session);

    const plugins = await listPlugins(session);
    for (const expected of metadata.plugins) {
      const match = plugins.find((entry) => pluginManifestId(entry) === expected.manifestId);
      record(
        report,
        `插件 ${expected.manifestId} 仍已安装`,
        Boolean(match),
        match ? undefined : `当前插件列表：${plugins.map((p) => pluginManifestId(p) ?? p.id).join(', ')}`,
      );
      record(
        report,
        `插件 ${expected.manifestId} 仍为 active`,
        isPluginActive(match),
        match ? `state=${match.state ?? match.status ?? 'unknown'}` : '插件不存在',
      );
    }

    const classes = await session.json<{ data: Array<{ id: string; name: string }> }>(`/api/classes${PAGE_SIZE_QUERY}`);
    const classRow = classes.data?.find((row) => row.id === metadata.sample.classId);
    record(report, '旧班级数据仍可读', Boolean(classRow), classRow ? undefined : `缺少 ${metadata.sample.classId}`);

    const students = await session.json<{ data: Array<{ id: string }> }>(`/api/students${PAGE_SIZE_QUERY}`);
    const studentIds = new Set((students.data ?? []).map((row) => row.id));
    const missingStudents = metadata.sample.studentIds.filter((id) => !studentIds.has(id));
    record(report, '旧学生数据仍可读', missingStudents.length === 0, missingStudents.join(', ') || undefined);

    const members = await session.json<Array<{ id: string }>>(
      `/api/classes/${encodeURIComponent(metadata.sample.classId)}/students`,
    );
    const memberIds = new Set((Array.isArray(members) ? members : []).map((row) => row.id));
    const missingMembers = metadata.sample.studentIds.filter((id) => !memberIds.has(id));
    record(report, '旧班级成员关系仍在', missingMembers.length === 0, missingMembers.join(', ') || undefined);

    const readDb = openDb(dbPath);
    try {
      for (const plugin of metadata.plugins) {
        const marker = readPluginStorageMarker(readDb, plugin.dbId, metadata.markerKey);
        record(
          report,
          `插件 ${plugin.manifestId} 旧数据可读回`,
          marker === metadata.markerValue,
          marker === undefined ? '标记行不存在' : marker === metadata.markerValue ? undefined : `值=${marker}`,
        );
      }
    } finally {
      readDb.close();
    }
  } finally {
    await server.stop();
  }

  // ── 6. 迁移结果比对 ──────────────────────────────────────────────────────
  {
    const db = openDb(dbPath);
    try {
      const applied = readAppliedMigrations(db);
      const current = loadCurrentMigrations();
      const comparison = compareMigrations(applied, current);
      record(
        report,
        '已执行迁移的 checksum 未被改写',
        comparison.drift.length === 0,
        comparison.drift.map((row) => `${row.name}: ${row.recorded} → ${row.actual}`).join('; ') || undefined,
      );
      record(report, '当前迁移全部已应用', comparison.pending.length === 0, comparison.pending.join(', ') || undefined);
      if (comparison.unknown.length > 0) {
        console.log(`[verify-upgrade] 提示：旧库存在当前仓库没有的迁移记录：${comparison.unknown.join(', ')}`);
      }

      const tables = new Set(readTableNames(db));
      const missingTables = metadata.tables.filter((name) => !tables.has(name));
      record(report, '旧库所有表在升级后仍存在', missingTables.length === 0, missingTables.join(', ') || undefined);
      record(
        report,
        '升级后迁移条数 >= 旧库迁移条数',
        applied.length >= metadata.migrations.length,
        `${metadata.migrations.length} → ${applied.length}`,
      );
    } finally {
      db.close();
    }
  }

  // ── 7. 二次启动幂等 ──────────────────────────────────────────────────────
  const beforeRestart = (() => {
    const db = openDb(dbPath);
    try {
      return readAppliedMigrations(db);
    } finally {
      db.close();
    }
  })();

  server = await startServer({ serverCwd, dataDir });
  record(report, '重启后 /health 仍可用', true);
  await server.stop();

  const afterRestart = (() => {
    const db = openDb(dbPath);
    try {
      return readAppliedMigrations(db);
    } finally {
      db.close();
    }
  })();
  record(
    report,
    '重启不产生新迁移（幂等）',
    afterRestart.length === beforeRestart.length,
    `${beforeRestart.length} → ${afterRestart.length}`,
  );

  for (const check of report.checks) {
    console.log(`[verify-upgrade] ${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }

  try {
    assertReport(report);
  } finally {
    if (values.keep) {
      console.log(`[verify-upgrade] --keep 保留数据目录：${dataDir}`);
    } else {
      rmDir(dataDir);
    }
    activeDataDir = undefined;
  }

  console.log(`[verify-upgrade] PASS（${report.checks.length} 项检查）`);
}

main().catch((error) => {
  if (activeDataDir) {
    rmDir(activeDataDir);
    console.error(`[verify-upgrade] 已清理临时数据目录 ${activeDataDir}`);
  }
  if (error instanceof VerificationError) {
    console.error(error.message);
  } else {
    console.error('[verify-upgrade] 失败：', error);
  }
  process.exit(1);
});
