/**
 * 数据库迁移运行器 (Core Migrator)
 *
 * 提供版本化迁移管理，保证数据库 Schema 的单一真实来源 (SSOT)。
 */
import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pruneMigratorSnapshots } from './backup-manager.js';
import { ensureSecureDir, hardenFile } from './secure-files.js';

export interface Migration {
  name: string;
  up: string;
  down: string;
}

export interface ChecksumDrift {
  name: string;
  stored: string;
  actual: string;
}

/**
 * 分割 SQL 脚本为多条可执行语句
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => {
      // 过滤空串或仅含注释的片段
      const content = s.replace(/--.*$/gm, '').trim();
      return content.length > 0;
    });
}

/**
 * 解析带有 -- UP 和 -- DOWN 标记的 SQL 内容
 */
export function parseMigrationSql(name: string, content: string): Migration {
  const upMatch = content.match(/--\s*UP([\s\S]*?)(?=--\s*DOWN|$)/i);
  const downMatch = content.match(/--\s*DOWN([\s\S]*)$/i);

  // 2026-10-04 修正：原实现在「有 -- DOWN 但缺 -- UP」时回退到 `content`（整篇），
  // 于是 DOWN 段被当作 UP 一起执行 —— 建完表立刻被自己 DROP 掉，且**不报错**。
  // 该陷阱曾真实发生：009/011 长期缺少 -- UP 标记，补 DOWN 后表反而消失。
  // 现在有 DOWN 就按 DOWN 切分，缺 UP 标记也不再吞掉回滚脚本。
  const up = upMatch ? upMatch[1].trim() : downMatch ? content.slice(0, downMatch.index).trim() : content.trim();
  const down = downMatch ? downMatch[1].trim() : '';

  return { name, up, down };
}

/**
 * 从指定目录加载并按文件名升序解析所有 .sql 迁移文件
 */
export function loadMigrationsFromDirectory(dirPath: string): Migration[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return files.map((file) => {
    const fullPath = path.join(dirPath, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const name = path.basename(file, '.sql');
    return parseMigrationSql(name, content);
  });
}

/**
 * 执行单段 SQL 脚本，容错处理 duplicate column
 */
export function executeSqlStatements(db: Database.Database, sql: string): void {
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    try {
      db.exec(stmt);
    } catch (err: any) {
      if (err?.message && err.message.includes('duplicate column name')) {
        continue;
      }
      throw err;
    }
  }
}

export function simpleChecksum(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(16);
}

/**
 * 执行全量未应用的迁移
 */
export interface RunMigrationsOptions {
  /**
   * 启动链路口径（server.ts / kernel initializeDatabase 传 true）：
   * 台账条目在迁移列表中不存在 → FATAL（代码降级或已应用迁移被改名）。
   * 默认 false：仅 console.warn —— runMigrations 作为库函数，「迁移子集」
   * 是合法用法（升级演练测试先跑 000–035 再单跑 036），不该被拦。
   */
  strictLedger?: boolean;
}

export function runMigrations(
  db: Database.Database,
  migrations: Migration[],
  options: RunMigrationsOptions = {},
): ChecksumDrift[] {
  // 确保 _migrations 元表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT name, checksum FROM _migrations').all() as {
    name: string;
    checksum: string;
  }[];
  const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

  const byName = new Map(migrations.map((m) => [m.name, m]));

  // 台账里有、迁移目录里没有的条目 = 数据库比代码「新」。
  //
  // 两种成因，都危险：用未来版本的备份恢复了旧代码环境（代码对着自己不认识的
  // schema 运行，运行时 prepare 报错才暴露），或已应用的迁移文件被改名/删除
  // （台账与链路分叉）。此前这里是 `continue` 静默跳过 —— 现在默认拒绝，
  // 只允许运维用显式环境变量说明「我知道我在降级」后放行。
  const unknown = [...applied.keys()].filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    const detail = unknown.map((n) => `  - ${n}`).join('\n');
    const msg =
      `[Migration] 台账里有 ${unknown.length} 个本次迁移列表未包含的条目：\n${detail}\n` +
      (options.strictLedger
        ? `  启动链路判定为 FATAL：\n` +
          `  成因一：用更新版本的备份恢复了旧代码（代码降级）——请先升级代码再启动；\n` +
          `  成因二：已应用的迁移文件被改名或删除——迁移一旦应用不可改名，请恢复文件或补一条新迁移。\n` +
          `  确属有意的降级运维：设置 MIGRATION_ALLOW_UNKNOWN_LEDGER=true 放行（不推荐）。`
        : `  （非严格口径：迁移子集调用属合法用法，仅提示）`);
    if (process.env.MIGRATION_ALLOW_UNKNOWN_LEDGER === 'true') {
      console.warn('[Migration] WARNING: 未知台账条目已按 MIGRATION_ALLOW_UNKNOWN_LEDGER 放行：\n' + msg);
    } else if (options.strictLedger) {
      throw new Error(msg);
    } else {
      console.warn('[Migration] ' + msg);
    }
  }

  // 校验已执行迁移的 checksum 是否被改动
  const drift: ChecksumDrift[] = [];
  for (const [name, stored] of applied) {
    const migration = byName.get(name);
    if (!migration) continue;
    const actual = simpleChecksum(migration.up);
    if (actual !== stored) {
      drift.push({ name, stored, actual });
    }
  }

  if (drift.length > 0) {
    const detail = drift.map((d) => `  - ${d.name}: 记录 ${d.stored} → 当前文件 ${d.actual}`).join('\n');
    const msg =
      `[Migration] 已执行迁移的 UP 脚本在应用后被修改过：\n${detail}\n` +
      '  这不会自动修复数据库 —— 已执行的部分无法回退。请确认是有意修改，或补一条新的迁移来修正。';
    if (process.env.MIGRATION_CHECKSUM_STRICT === 'true') {
      throw new Error(msg);
    }
    console.error(msg);
  }

  const pending = migrations.filter((m) => !applied.has(m.name));
  if (
    pending.length > 0 &&
    db.name &&
    db.name !== ':memory:' &&
    (process.env.FORCE_MIGRATION_SNAPSHOT === 'true' || !process.env.VITEST)
  ) {
    try {
      const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(db.name), 'backups');
      // 快照目录装着全量学生数据副本：创建即 0700，不依赖 umask（审计 P1-2）
      ensureSecureDir(backupDir);
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const backupFile = path.join(backupDir, `pre_migration_${timestamp}.db`);
      // 复制主库文件会漏掉尚未 checkpoint 的 WAL。VACUUM INTO 生成一致性快照。
      const escaped = backupFile.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}'`);
      // 快照是未加密的学生数据副本：创建时即收紧权限，不依赖 umask（Issue #234）
      hardenFile(backupFile);
      // 同步修剪历史快照（PRE_MIGRATION_KEEP，默认 5）——只增不减会无界增长
      try {
        const pruned = pruneMigratorSnapshots(backupDir);
        if (pruned > 0) console.log(`[Migration] Pruned ${pruned} old pre-migration snapshot(s)`);
      } catch (pErr: unknown) {
        console.warn('[Migration] Warning: failed to prune old pre-migration snapshots:', pErr);
      }
      console.log(`[Migration] Safety snapshot created before applying ${pending.length} migration(s): ${backupFile}`);
    } catch (bErr: unknown) {
      const message = bErr instanceof Error ? bErr.message : String(bErr);
      // Vitest 里快照目录经常不可写。只在测试进程吞掉失败，正式进程必须先有快照再改库。
      if (!process.env.VITEST) {
        throw new Error(`[Migration] 迁移前快照失败，已中止且未应用任何待执行 SQL: ${message}`, { cause: bErr });
      }
      console.warn('[Migration] Warning: Could not create pre-migration snapshot:', message);
    }
  }

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    const applyOne = db.transaction(() => {
      executeSqlStatements(db, migration.up);
      db.prepare('INSERT INTO _migrations (name, applied_at, checksum) VALUES (?, ?, ?)').run(
        migration.name,
        Date.now(),
        simpleChecksum(migration.up),
      );
    });

    try {
      applyOne();
    } catch (err) {
      console.error(`[Migration] FAILED: ${migration.name}`, err);
      throw err;
    }
  }

  return drift;
}

/**
 * 回滚指定的单项迁移
 */
export function rollbackMigration(db: Database.Database, migration: Migration): void {
  if (!migration.down || migration.down.trim() === '') {
    throw new Error(`Migration ${migration.name} does not provide a DOWN rollback script.`);
  }

  executeSqlStatements(db, migration.down);
  db.prepare('DELETE FROM _migrations WHERE name = ?').run(migration.name);
}

/** 将字符串 SQL 转换为 Migration 对象 */
export function sqlMigration(name: string, up: string, down = ''): Migration {
  return { name, up, down };
}

/**
 * 解析并定位项目根目录下的 migrations 目录
 */
/**
 * 定位 `migrations/` 目录。
 *
 * ## 为什么不能只写死相对层级
 *
 * 曾经这里是 `path.resolve(__dirname, '../../../migrations')` —— 它**只在源码布局里成立**
 * （`packages/core/db/` 上溯三级 = 仓库根）。但 `dist/server.cjs` 里同一个 `__dirname`
 * 是 `<pkg>/dist`，上溯三级已经跑到包外；而 `migrations/` 此前又不在 `files` 清单里。
 * 两者叠加的结果是：**发布包（`npx openlearn-next`）里 cwd 下没有 migrations/ 就直接
 * FATAL 拒绝启动**。Docker 之所以没暴露，是因为 Dockerfile 显式 `COPY migrations` 且
 * `WORKDIR=/app`，让最后那条 cwd 兜底恰好命中。
 *
 * ## 解析顺序
 *
 * 1. `OPENLEARN_MIGRATIONS_DIR`（显式覆盖，部署方可指向只读挂载的迁移目录）；
 * 2. 从**本模块所在位置**逐级上溯，找「package.json 的 name 是 openlearn-next 且同级
 *    存在 migrations/*.sql」的包根 —— 这一条同时覆盖源码布局与 `dist/` 布局；
 * 3. `process.cwd()/migrations`（Docker / 传统部署的兜底，保持既有行为）。
 *
 * 上溯时**不**接受 `packages/core/package.json`（name 为 `@openlearn/core`），
 * 否则 monorepo 里会在错误的层级停住。
 */
export interface MigrationsDirOptions {
  /** 环境变量读取源（测试注入）。 */
  env?: NodeJS.ProcessEnv;
  /**
   * 上溯起点（默认取本模块所在位置）。
   *
   * 之所以可注入：这条路径的关键分支是「打包后 `__dirname` 变成 `<pkg>/dist`」，
   * 而那在单进程测试里无法自然复现。注入起点让「发布包布局」可被真实断言，
   * 而不是靠读代码相信它成立 —— 这个 P0 正是读代码时被漏掉的。
   */
  startDirs?: string[];
  /** cwd 兜底用的目录（测试注入，避免 chdir 影响同进程其它用例）。 */
  cwd?: string;
}

export function getDefaultMigrationsDir(options: MigrationsDirOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  /** 目录里是否真的有用得上的 .sql（空目录等于没找到）。 */
  const hasSql = (dir: string): boolean => {
    try {
      return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql'));
    } catch {
      return false;
    }
  };

  // 1. 显式覆盖
  const override = env.OPENLEARN_MIGRATIONS_DIR;
  if (override && hasSql(override)) return path.resolve(override);

  // 2. 从模块位置向上找「openlearn-next 包根/migrations」
  const starts: string[] = options.startDirs ? [...options.startDirs] : [];
  if (!options.startDirs && typeof __dirname !== 'undefined') starts.push(__dirname);
  try {
    if (!options.startDirs && typeof import.meta !== 'undefined' && import.meta.url) {
      starts.push(path.dirname(fileURLToPath(import.meta.url)));
    }
  } catch {
    // CJS 产物中 import.meta 不可用
  }

  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { name?: string };
          if (pkg.name === 'openlearn-next') {
            const candidate = path.join(dir, 'migrations');
            if (hasSql(candidate)) return candidate;
          }
        } catch {
          /* 坏掉的 package.json 不该阻断解析，继续上溯 */
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // 3. 传统部署兜底（Docker 的 WORKDIR=/app + COPY migrations 走这里）
  return path.resolve(cwd, 'migrations');
}
