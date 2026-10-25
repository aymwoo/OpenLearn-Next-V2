import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';
import {
  extractSchemaSnapshot,
  verifySchemaAgainstGolden,
  loadSchemaGolden,
  assertSchemaMatchesGolden,
  SCHEMA_GOLDEN_FILENAME,
} from '../../packages/core/db/schema-golden.js';

/** 仓库根的 migrations/ 目录（本文件位于 server/__tests__/） */
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * 数据库自动适应更新的终检层（金样校验）：
 * - 金样 = 空库跑完全部迁移后的表→列快照，提交在仓、随包发布
 * - 任何迁移改动后忘记再生成金样，本文件第一个测试立刻红
 * - 实际库缺金样结构 → assertSchemaMatchesGolden 拒绝启动并指明差在哪
 */
describe('Schema Golden（启动期结构终检）', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThan(0);
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('空库跑完全部迁移后的结构必须与提交在仓的金样完全一致', () => {
    const golden = loadSchemaGolden(MIGRATIONS_DIR);
    const actual = extractSchemaSnapshot(db);

    // 表集合一致（金样过期 = 某条迁移改了却没跑 pnpm db:gen-golden）
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden.tables).sort());
    // 每张表的列清单一致
    for (const [table, columns] of Object.entries(golden.tables)) {
      expect(actual[table]?.sort(), `表 ${table} 的列清单与金样不一致（改迁移后请跑 pnpm db:gen-golden）`).toEqual(
        [...columns].sort(),
      );
    }
    // 金样里记录的迁移数与目录现状一致（防迁移文件增删后金样计数滞留）
    const sqlCount = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;
    expect(golden.migrationCount).toBe(sqlCount);
  });

  it('完整迁移后的库通过终检（assertSchemaMatchesGolden 不抛）', () => {
    expect(() => assertSchemaMatchesGolden(db, MIGRATIONS_DIR)).not.toThrow();
  });

  it('整表缺失被识别为 tableMissing 并拒绝启动', () => {
    db.exec('DROP TABLE lessons;');
    const drifts = verifySchemaAgainstGolden(db, loadSchemaGolden(MIGRATIONS_DIR));
    const lessonDrift = drifts.find((d) => d.table === 'lessons');
    expect(lessonDrift).toBeDefined();
    expect(lessonDrift?.tableMissing).toBe(true);
    expect(lessonDrift?.missingColumns).toContain('creator_id');

    expect(() => assertSchemaMatchesGolden(db, MIGRATIONS_DIR)).toThrow(/lessons/);
  });

  it('列缺失被识别（外部工具改库/旧备份部分恢复的典型漂移）', () => {
    // SQLite ≥3.35 支持 DROP COLUMN；better-sqlite3 自带的 SQLite 远新于此
    db.exec('ALTER TABLE lessons DROP COLUMN progress_mode;');
    const drifts = verifySchemaAgainstGolden(db, loadSchemaGolden(MIGRATIONS_DIR));
    expect(drifts).toContainEqual(
      expect.objectContaining({ table: 'lessons', missingColumns: ['progress_mode'], tableMissing: false }),
    );
  });

  it('实际库多出的表/列不报错（插件自建表与 expand-contract 过渡列合法）', () => {
    db.exec('CREATE TABLE plugin_dynamic_xyz (id TEXT PRIMARY KEY);');
    db.exec('ALTER TABLE lessons ADD COLUMN expand_contract_tmp TEXT;');
    expect(verifySchemaAgainstGolden(db, loadSchemaGolden(MIGRATIONS_DIR))).toEqual([]);
    expect(() => assertSchemaMatchesGolden(db, MIGRATIONS_DIR)).not.toThrow();
  });

  it('金样文件缺失时报 packaging 级 FATAL（不静默跳过终检）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-golden-missing-'));
    try {
      expect(() => loadSchemaGolden(dir)).toThrow(/schema-golden\.json 不存在/);
      expect(fs.existsSync(path.join(dir, SCHEMA_GOLDEN_FILENAME))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
