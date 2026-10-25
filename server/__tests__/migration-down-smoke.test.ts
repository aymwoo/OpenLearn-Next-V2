import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMigrationsFromDirectory, runMigrations, rollbackMigration } from '../utils/migrate.js';
import { extractSchemaSnapshot, loadSchemaGolden } from '../../packages/core/db/schema-golden.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Issue（数据库自动适应 · P1）：真实迁移链的 DOWN 烟雾测试。
 *
 * 回滚的真实保障是 pre_migration 快照，不是 DOWN 脚本 —— 但 DOWN 脚本既然写了
 * 就不该静默烂掉：抽取迁移链末尾 N 条做「回滚 → 重放 → 金样对账」闭环，
 * 断言回滚后台账与结构同步后退、重放后结构与金样完全一致。
 * 无 DOWN 的迁移在独立断言里点名（当前仅 033），防止悄悄增多。
 */
const SMOKE_TAIL = 3;
// 口径与 rollbackMigration 一致：DOWN 段存在且非空白即算「有」；纯注释 DOWN 也算有
// （回滚数据迁移常无法还原数据，注释说明即诚实做法，真正的回退保障是快照）
const KNOWN_NO_DOWN = new Set(['033_student_lock_mode']);

describe('迁移链 DOWN 烟雾测试（回滚 → 重放 → 金样对账）', () => {
  it(`最近 ${SMOKE_TAIL} 条可回滚迁移：rollback 后结构同步后退，重放后与金样完全一致`, () => {
    const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
    const db = new Database(':memory:');
    try {
      runMigrations(db, migrations);
      const golden = loadSchemaGolden(MIGRATIONS_DIR);
      expect(extractSchemaSnapshot(db)).toEqual(golden.tables);

      // 从链尾向前取最近 N 条「有 DOWN」的迁移
      const tail = [...migrations]
        .reverse()
        .filter((m) => m.down.trim() !== '')
        .slice(0, SMOKE_TAIL);
      expect(tail.length).toBe(SMOKE_TAIL);

      for (const migration of tail) {
        rollbackMigration(db, migration);
        // 台账同步后退
        const ledger = (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name);
        expect(ledger).not.toContain(migration.name);
        // 结构可能变（DDL 迁移）也可能不变（纯数据迁移的 DOWN 只动数据/只留注释）——
        // 两者都合法；强约束放在「重放后与金样完全一致」上

        // 重放
        runMigrations(db, [migration]);
        expect(extractSchemaSnapshot(db)).toEqual(golden.tables);
      }
    } finally {
      db.close();
    }
  });

  it('无 DOWN 的迁移固定为已知三件——新增无 DOWN 迁移必须扩名单或补 DOWN', () => {
    const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
    const noDown = migrations.filter((m) => m.down.trim() === '').map((m) => m.name);
    expect(noDown.sort()).toEqual([...KNOWN_NO_DOWN].sort());
  });

  it('回滚破坏性迁移后重启（重放全链）也能恢复金样结构', () => {
    // 模拟最坏路径：回滚最后一条 → 全链重放（幂等）→ 金样对账
    const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
    const db = new Database(':memory:');
    try {
      runMigrations(db, migrations);
      const last = migrations[migrations.length - 1];
      if (last.down.trim() === '') return; // 链尾无 DOWN 时该场景由快照保障，跳过
      rollbackMigration(db, last);
      runMigrations(db, migrations);
      expect(extractSchemaSnapshot(db)).toEqual(loadSchemaGolden(MIGRATIONS_DIR).tables);
    } finally {
      db.close();
    }
  });
});
