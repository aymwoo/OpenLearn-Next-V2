/**
 * schema-golden.ts — 启动期 schema 金样校验（数据库自动适应更新的终检层）。
 *
 * 迁移台账追平（runMigrations 成功）只代表「该跑的迁移跑了」，不代表
 * 「库长得对」：手动改库、外部工具写入、从旧备份做部分恢复都可能造成
 * 结构漂移，而这类漂移今天只在某条 SQL 运行时 prepare 报错才暴露。
 *
 * 金样 = 空库顺序跑完全部迁移后的「表 → 列清单」快照（`schema-golden.json`，
 * 与迁移文件同目录、随包发布）。启动时做**子集校验**：实际库必须包含金样
 * 声明的每张表与每个列，缺一即 FATAL 并指明差在哪；实际库多出的表/列
 * （插件运行时自建表、expand-contract 过渡列）不视为错误。
 *
 * 再生成：改迁移后跑 `pnpm db:gen-golden`（scripts/gen-schema-golden.ts）。
 */
import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/** 金样文件名（放在迁移目录里，与 .sql 同址、随包发布） */
export const SCHEMA_GOLDEN_FILENAME = 'schema-golden.json';

export interface SchemaGolden {
  /** 表名 → 排序后的列名清单（只记名字：SQLite 类型亲和性变更极罕见，名字足够定位漂移） */
  tables: Record<string, string[]>;
  /** 生成时迁移目录里的 .sql 数量 —— 数不上时说明金样与链路版本不匹配 */
  migrationCount: number;
  generatedAt: string;
}

export interface SchemaGoldenDrift {
  table: string;
  missingColumns: string[];
  /** 整表缺失（此时 missingColumns 为该表全部列） */
  tableMissing: boolean;
}

/** 提取当前库的结构快照：所有非 sqlite 内部表 → 排序后的列名清单 */
export function extractSchemaSnapshot(db: Database.Database): Record<string, string[]> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  const snapshot: Record<string, string[]> = {};
  for (const { name } of tables) {
    const columns = (db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    snapshot[name] = columns.sort();
  }
  return snapshot;
}

/** 校验实际库是否覆盖金样声明的全部结构；返回缺失清单（空数组 = 通过） */
export function verifySchemaAgainstGolden(db: Database.Database, golden: SchemaGolden): SchemaGoldenDrift[] {
  const actual = extractSchemaSnapshot(db);
  const drifts: SchemaGoldenDrift[] = [];
  for (const [table, expectedColumns] of Object.entries(golden.tables)) {
    const actualColumns = actual[table];
    if (!actualColumns) {
      drifts.push({ table, missingColumns: expectedColumns, tableMissing: true });
      continue;
    }
    const actualSet = new Set(actualColumns);
    const missing = expectedColumns.filter((c) => !actualSet.has(c));
    if (missing.length > 0) {
      drifts.push({ table, missingColumns: missing, tableMissing: false });
    }
  }
  return drifts;
}

export function formatSchemaGoldenDrifts(drifts: SchemaGoldenDrift[]): string {
  return drifts
    .map((d) =>
      d.tableMissing
        ? `  - 表 ${d.table} 整表缺失（期望列：${d.missingColumns.join(', ')}）`
        : `  - 表 ${d.table} 缺列：${d.missingColumns.join(', ')}`,
    )
    .join('\n');
}

/**
 * 从迁移目录加载金样文件。
 *
 * 文件缺失直接抛错：金样与 .sql 同目录，缺了说明打包/克隆不完整
 * （与 #283「发布包漏 migrations」同一类故障），不能静默跳过终检。
 */
export function loadSchemaGolden(migrationsDir: string): SchemaGolden {
  const filePath = path.join(migrationsDir, SCHEMA_GOLDEN_FILENAME);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[SchemaGolden] FATAL: ${filePath} 不存在。金样与迁移文件同目录发布，缺失说明安装包不完整；` +
        `源码仓库里请运行 pnpm db:gen-golden 生成。`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SchemaGolden;
  } catch (err) {
    // cause 带上原始异常：解析失败时，根因（SyntaxError 的具体位置）不能丢。
    throw new Error(`[SchemaGolden] FATAL: 金样文件解析失败（${filePath}）：${String(err)}`, { cause: err });
  }
}

/**
 * 启动终检：迁移跑完立刻校验结构。任何缺失 → 抛错（由 server.ts 的启动
 * 门禁统一拒绝服务）。多出的表/列不报错（插件自建表 / expand-contract 过渡）。
 */
export function assertSchemaMatchesGolden(db: Database.Database, migrationsDir: string): void {
  const golden = loadSchemaGolden(migrationsDir);
  const drifts = verifySchemaAgainstGolden(db, golden);
  if (drifts.length > 0) {
    throw new Error(
      `[SchemaGolden] FATAL: 数据库结构低于代码期望（${drifts.length} 处缺失）——迁移台账虽已追平，` +
        `但库被外部修改过或从旧备份做了部分恢复。缺失明细：\n${formatSchemaGoldenDrifts(drifts)}\n` +
        `  恢复手段：用 backups/ 里最新的 pre_migration_*.db 快照恢复，或核对最近一次恢复操作的来源。`,
    );
  }
}
