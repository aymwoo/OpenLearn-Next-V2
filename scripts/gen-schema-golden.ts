/**
 * gen-schema-golden.ts — 生成 schema 金样文件（pnpm db:gen-golden）。
 *
 * 空库顺序跑完 migrations/ 全部迁移，提取「表 → 列」快照写入
 * migrations/schema-golden.json。改迁移后必须重新生成，否则
 * schema-golden.test.ts 会红（提示运行本脚本）。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDefaultMigrationsDir, loadMigrationsFromDirectory, runMigrations } from '../packages/core/db/migrator.js';
import { extractSchemaSnapshot, SCHEMA_GOLDEN_FILENAME } from '../packages/core/db/schema-golden.js';

// 生产库不该被金样生成过程碰到：一律用内存库
process.env.VITEST = '1';

const migrationsDir =
  process.argv[2] && fs.existsSync(process.argv[2])
    ? path.resolve(process.argv[2])
    : getDefaultMigrationsDir();
const migrations = loadMigrationsFromDirectory(migrationsDir);
if (migrations.length === 0) {
  console.error(`[gen-schema-golden] FATAL: ${migrationsDir} 没有迁移文件。`);
  process.exit(1);
}

const db = new Database(':memory:');
try {
  runMigrations(db, migrations);
  const tables = extractSchemaSnapshot(db);
  const golden = {
    _comment:
      '数据库结构金样（自动生成，勿手改）：空库跑完 migrations/ 全部迁移后的表→列快照。' +
      '启动时 assertSchemaMatchesGolden 以子集校验（实际库缺金样结构即拒绝启动；多出的表/列不报错）。' +
      '改迁移后请运行 pnpm db:gen-golden 再生成。',
    migrationCount: migrations.length,
    generatedAt: new Date().toISOString(),
    tables,
  };
  const outPath = path.join(migrationsDir, SCHEMA_GOLDEN_FILENAME);
  fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + '\n');
  console.log(`[gen-schema-golden] OK: ${Object.keys(tables).length} 张表 → ${outPath}（${migrations.length} 个迁移）`);
} finally {
  db.close();
}
