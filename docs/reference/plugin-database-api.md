# 插件数据库 API 与 Migration 规范

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0` / 平台 `v0.3.15+`
> 本页说明插件可用的两条数据库路径、事务支持、以及插件版本升级时的表结构迁移范式。

---

## 1. 两条数据库路径（务必分清）

插件有**两条**数据库访问路径，丰富的方法集（`query` / `select` / `insert` / `update` / `delete` / `transaction` / `exec`）**不在**插件 API 上，而在原始 `better-sqlite3` 实例上。

### 路径 A — `ctx.db`：`PluginDatabaseAPI`（命名空间隔离，推荐）

仅 4 个方法，所有表自动加前缀 `plugin_{pluginId}_`，互不干扰。

> ℹ️ **表前缀命名规范（已统一）**：
>
> 平台已统一收敛表前缀生成规则为 `plugin_<scopeId>_`（`pluginTablePrefix(scopeId)`）：
> 1. 上传与社区安装的插件统一使用其安装主键（`plugins` 表的行 UUID），在 Inline 与 Worker（子进程/独立进程）两种模式下均保持一致，实现存储物理隔离与防冲突；
> 2. 内置核心插件使用其规范 scopeId（如 `@openlearn/plugin-vfs` → `plugin__openlearn_plugin_vfs_`）；
> 3. 前缀中所有非 `[A-Za-z0-9_]` 字符一律替换为 `_`。卸载插件时，宿主依据统一安装主键精准识别并级联清理私有表。

```typescript
// packages/core/plugin-host/types.ts
interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string;
  dropAllTables(): Promise<void>;
  migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
}
```

| 方法            | 签名                                          | 说明                                                                                                  |
| --------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ensureTable`   | `(tableName, schema) => Promise<void>`        | `schema` 是**列定义片段**（非完整 `CREATE TABLE`），表名自动加前缀；执行 `CREATE TABLE IF NOT EXISTS` |
| `table`         | `(tableName) => string`                       | **同步**。返回完整表名 `plugin_{pluginId}_{tableName}`                                                |
| `dropAllTables` | `() => Promise<void>`                         | 删除匹配 `plugin_{pluginId}_%` 的所有表；卸载时由 PluginHost 自动调用                                 |
| `migrate`       | `(targetVersion, upgradeFn) => Promise<void>` | 声明式版本化迁移（见 §3）                                                                             |

**SQL 方言**：SQLite（better-sqlite3 `^12.11.1`）。**无查询构造器**，插件需手写原生 SQL。

#### ⚠️ `ensureTable` / `table()` 的 SEC 校验规则（高频报错来源）

插件通过 ZIP 上传，表名与 schema 属**不可信输入**，宿主在拼接 DDL 前强制校验（inline 与 Worker 双模式同等实现）：

| 规则        | 约束                                                                                                                                      | 违例报错                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 表名格式    | 正则 `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/` —— 字母/下划线开头，仅字母数字下划线，**最长 64 字符**（不允许连字符 `-`、点 `.`、`$`）            | `[SEC] Invalid SQL identifier for ensureTable(tableName): …`           |
| schema 长度 | 非空字符串，**≤ 4000 字符**                                                                                                               | `[SEC] createTable schema must be a non-empty string (max 4000 chars)` |
| schema 内容 | **禁止包含分号 `;`**（阻断多语句注入，如 `…); DROP TABLE events; --`）                                                                    | `[SEC] createTable schema must not contain ";" …`                      |
| 表名前缀    | 实际表名为 `plugin_<pluginId>_` + tableName；pluginId 中非 `[A-Za-z0-9_]` 字符会被替换为 `_`（Inline 模式下为 UUID 型 id，前缀形如 `plugin_9f2c______`；Worker 模式下为 manifestId） | —                                                                      |

另有两个配套防护：`dropAllTables()` 只清理本插件前缀的表、对 `sqlite_master` 返回的表名二次校验后才拼 DDL；ZIP 安装时有 300MB 解压总大小上限与路径穿越（`..` / 前导 `/`）检查。

### 路径 B — `ctx.resolve(IDatabaseToken)`：平台共享数据库（非命名空间）

```typescript
const db = await ctx.resolve(IDatabaseToken); // 类型: SqliteDatabase (Inline) / 异步 RPC Proxy (Worker)
```

- 注册于 `packages/core/kernel/index.ts`，是**整个平台共享数据库**，可读写平台基础表（如 `vfs_nodes`、`students`、`users` 等）。
- **无命名空间隔离**。所有内置核心插件的数据操作实际走此路径。
- 这是唯一能直接执行平台级 `SELECT` / `INSERT` / `UPDATE` / `DELETE` 的路径。
- **类型提示**：从 `@openlearn/plugin-sdk` 导入时 `resolve` 结果的类型为自包含的 `SqliteDatabase`（运行时即 better-sqlite3 `Database`），Inline 模式下可直接使用 `prepare()` / `exec()`；在 Worker 模式下其方法返回 Promise。

---

## 2. 事务与 Worker 线程支持

- `PluginDatabaseAPI` **没有** `transaction` / `beginTransaction` 方法。
- 事务仅在**路径 B Inline 进程内的原始 `better-sqlite3` 实例**上可用，使用 better-sqlite3 的**回调式** `db.transaction(fn)` API（调用返回函数即执行）：
  ```typescript
  const db = await ctx.resolve(IDatabaseToken);
  const deleteTransaction = db.transaction(() => {
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    db.prepare('DELETE FROM grades WHERE student_id = ?').run(id);
  });
  deleteTransaction(); // 执行
  ```
  真实用例：`packages/plugins/management.ts`、`packages/plugins/builtin.ts`。
- **Worker（隔离）模式支持与安全守卫**：
  - **`exec` 异步转发与 DDL 守卫**：Worker 模式的 DB 代理正式支持 `exec` 跨线程 RPC 转发（如 `await db.exec(...)`），返回 Promise。所有操作均经过主侧 `assertDatabaseAccessAllowed` 安全守卫：
    - **DDL 命名空间守卫**：第三方 Worker 插件建表 / 改表必须使用自身前缀 `plugin_{manifestId}_`（守卫同时放行 `plugin_{pluginId}_` 即 UUID 前缀，以兼容既有表）；
    - **系统迁移表放行**：宿主已将 `plugin_migrations` 表纳入 DDL 白名单，允许 Worker 线程透明调用 `ctx.db.migrate()` 初始化并更新版本控制表，杜绝 `WorkerCapabilityError` 权限报错；
    - **核心数据表黑名单过滤**：严格禁止第三方插件对 `users`、`client_sessions` 等高危系统表执行越权 DDL。
  - **异步 Migration 队列时序保护 (`pendingPromises`)**：Worker 线程在执行 `ctx.db.migrate(v, fn)` 时，沙箱代理自动捕获内部所有未显式 `await` 的异步 DB 操作并统一 `Promise.all`，确保全部迁移 SQL 成功写入 SQLite 后再原子化持久化新版本号。
  - **事务限制**：由于线程间 IPC 无法同步传递函数闭包并保证 SQLite 线程独占锁，Worker 隔离插件暂不支持本地同步式的 `db.transaction(fn)` 回调。如需多步一致性，建议在单个 `exec` 中包含多条 SQL 语句或在主侧命令中封装。

---

## 3. Migration / 版本升级范式

平台自 Issue #142 起正式支持**声明式 SQL 版本化迁移**，并对既有命令式 `ctx.db.migrate()` 提供完全向后兼容与事务原子性增强。

### 3.1 声明式版本化迁移（推荐，Issue #142）

插件包根目录下可提供 `migrations/` 目录，宿主在插件激活（无论是 Inline 还是 Worker 隔离模式）前自动执行尚未应用的增量迁移：

```text
my-plugin/
├── manifest.json
├── index.js
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_add_student_notes.sql
    └── 003_create_indexes.sql
```

#### 规范与特性

1. **命名与排序**：
   - 文件名约定：`NNN_name.sql`（`NNN` 为前导正整数序列号，如 `001_`、`02_`、`10_`）。宿主按数字版本号自然序升序排列执行。
2. **语法标记**：
   - 与平台核心迁移对齐，支持 `-- UP` 与 `-- DOWN` 分段注释。若省略标记，整篇文件默认作为 `-- UP` 执行：
     ```sql
     -- UP
     CREATE TABLE IF NOT EXISTS {{prefix}}homework (
       id TEXT PRIMARY KEY,
       title TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );

     -- DOWN
     DROP TABLE IF EXISTS {{prefix}}homework;
     ```
3. **占位符自动展开**：
   - 支持在 SQL 中使用 `{{prefix}}` 或 `{{table_prefix}}`，宿主在执行时自动替换为该插件规范的命名空间前缀 `plugin_<scopeId>_`（对齐安装主键 UUID 或内置插件 scopeId）。
4. **单步事务与失败回滚**：
   - 每一步迁移均包裹在 SQLite `db.transaction()` 内原子执行。若某步发生语法错误或执行异常，该步事务**自动完全回滚**，已执行的前序迁移保留，后续迁移中止，插件进入 `ERROR` 状态并抛出 `PluginMigrationExecutionError`。
5. **拒绝版本降级保护（Downgrade Protection）**：
   - 宿主在激活前检查数据库元表记录的最大已应用版本 `maxAppliedVersion` 与当前插件包内的最大声明版本 `maxDeclaredVersion`。
   - 若 `maxAppliedVersion > maxDeclaredVersion`（例如已升级至 v2 的数据库被意外安装了 v1 旧版插件包），宿主抛出 `PluginMigrationDowngradeError` 并强行拒绝激活，杜绝旧版代码破坏新版表结构或读写异常。
6. **元表与数据生命周期**：
   - 迁移状态记录在 `plugin_declared_migrations (plugin_id, version, name, checksum, applied_at)` 元表中，包含 SHA/简单校验和防篡改校验。
   - 卸载策略协同（Issue #141）：当卸载插件且选择保留数据（`keep`，默认）时，迁移元表记录原样保留；重新安装同插件时自动识别既有版本并增量续跑；选择彻底清除（`purge`）时随插件私有表一并清理。
7. **单元测试支持**：
   - `@openlearn/plugin-test-kit` 导出 `runTestPluginMigrations(db, pluginId, migrationsDir)` 辅助函数，方便插件开发者在单测中测试多版本数据升级与演进。

---

### 3.2 命令式 `ctx.db.migrate`（向后兼容）

既有使用 `ctx.db.migrate()` 的插件无需修改代码即可平滑运行：

```typescript
async migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void)
```

- **行为**：在 `plugin_migrations` 表记录版本（`plugin_id` 主键）。若当前版本小于 `targetVersion`，则调用 `upgradeFn(db)` 并更新版本号。
- **事务增强**：底层已增加 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 事务包裹，单步失败时自动回滚，版本号不被错误提升。
- **范式示例**：
  ```typescript
  export async function activate(ctx: PluginContext) {
    await ctx.db.migrate(1, async (sqliteDb) => {
      sqliteDb.prepare(`CREATE TABLE IF NOT EXISTS my_table (id TEXT PRIMARY KEY, data TEXT)`).run();
    });
  }
  ```

---

## 4. 命名空间与获取方式

| 项目     | 路径 A `ctx.db`                                                    | 路径 B `ctx.resolve(IDatabaseToken)` |
| -------- | ------------------------------------------------------------------ | ------------------------------------ |
| 命名空间 | 自动前缀 `plugin_<scopeId>_`（统一为安装行 UUID 或内置插件 scopeId，见 §1 说明） | 无，整个平台库                       |
| 暴露位置 | `PluginContext.db`（`packages/core/plugin-host/types.ts`）/ `buildContext()` 构造的 `dbApi`（`packages/core/plugin-host/context-builder.ts`） | `ServiceRegistry` 注册 `IDatabaseToken`（`packages/core/kernel/index.ts` 的服务注册段） |
| 适用     | 插件私有表                                                         | 跨表查询 / 读写平台表 / 事务         |

**KV 存储（非 SQL）**：`ctx.services.storage`（`IStorageService` 的 `get` / `set` / `delete`）后端为 `plugin_storage` 表，**按 `plugin_id` 自动命名空间隔离**。注意此处 `plugin_id` 列写入的是 **`manifest.id`**（`buildContext()` 中 `wrapStorage()` 的实现，见 `packages/core/plugin-host/context-builder.ts`）。适合简单键值，无需建表。

---

## 5. 最佳实践

- 优先用 `ctx.db.ensureTable()` + `ctx.db.table()` 管理插件私有表；精细控制（联表、事务、读写平台表）再落到 `ctx.resolve(IDatabaseToken)` 的原始实例。
- 升级表结构一律走 `ctx.db.migrate(targetVersion, fn)`，保证幂等与版本可追溯；迁移脚本内只用 `prepare().run()`，以兼容 Worker 模式。
- 迁移脚本中不要依赖 `upgradeFn` 自动加表前缀，需要隔离请用 `ctx.db.ensureTable()` / `ctx.db.table()`。
- 统一通过 `ctx.db.table('xxx')` 获取表名，切勿把手动拼接的表名硬编码进 SQL 字符串中。
- Worker 隔离模式插件避免依赖事务与 `exec`。

> 最后更新：2026-10-03
