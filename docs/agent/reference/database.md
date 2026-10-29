# 数据库访问与迁移

> 覆盖 `ctx.db`（命名空间隔离）与 `ctx.resolve(IDatabaseToken)`（平台共享库）两条路径、
> 声明式与命令式两种迁移、以及 SQL 零信任守卫 `sql-guard` 的**完整拦截规则**。
>
> SQL 方言：SQLite（`better-sqlite3@^12.11.1`），**同步 API —— 没有 `await`**。无查询构造器，需手写原生 SQL。

---

## 1. 两条路径（务必分清）

插件有**两条**数据库访问路径。丰富的方法集（`query` / `select` / `insert` / `update` / `delete` /
`transaction` / `exec`）**不在插件 API 上，而在原始 `better-sqlite3` 实例上**。

| 项目     | 路径 A `ctx.db`                                               | 路径 B `ctx.resolve(IDatabaseToken)`                                                              |
| :------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| 命名空间 | 自动前缀 `plugin_<scopeId>_`                                  | 无，整个平台库                                                                                    |
| 方法数   | **只有 4 个**                                                 | better-sqlite3 全量（`prepare` / `exec` / `transaction`）                                         |
| 暴露位置 | `PluginContext.db`（`types.ts`）/ `buildContext()` 的 `dbApi` | `ServiceRegistry` 注册 `IDatabaseToken`（`kernel/index.ts`）                                      |
| 适用     | 插件私有表                                                    | 跨表查询 / 读写平台表 / 事务                                                                      |
| 类型     | `PluginDatabaseAPI`                                           | 自包含的 `SqliteDatabase`（Inline 运行时即 better-sqlite3 `Database`；Worker 下方法返回 Promise） |
| 守卫     | SEC 标识符校验（§3）                                          | `assertPluginSqlAllowed` 全量 SQL 守卫（§5）                                                      |

```{tip} 选择顺序
优先 `ctx.db.ensureTable()` + `ctx.db.table()` 管理私有表；
需要精细控制（联表、事务、读写平台表）才落到路径 B。
简单键值用 `ctx.services.storage`（§6），连表都不用建。
```

---

## 2. 路径 A：`PluginDatabaseAPI`

```typescript
interface PluginDatabaseAPI {
  ensureTable(tableName: string, schema: string): Promise<void>;
  table(tableName: string): string; // 同步
  dropAllTables(): Promise<void>;
  migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
}
```

| 方法            | 说明                                                                                                            |
| :-------------- | :-------------------------------------------------------------------------------------------------------------- |
| `ensureTable`   | `schema` 是**列定义片段**（不是完整 `CREATE TABLE`），执行 `CREATE TABLE IF NOT EXISTS <前缀><表名> (<schema>)` |
| `table`         | **同步**返回完整表名 `plugin_<scopeId>_<tableName>`                                                             |
| `dropAllTables` | 删匹配 `plugin_<scopeId>_%` 的所有表；卸载时宿主自动调用                                                        |
| `migrate`       | 声明式版本化迁移（§4.2）                                                                                        |

```typescript
// ✅ 正确
await ctx.db.ensureTable('notes', `id TEXT PRIMARY KEY, student_id TEXT NOT NULL, body TEXT`);
const t = ctx.db.table('notes');
const db = await ctx.resolve(IDatabaseToken);
db.prepare(`SELECT * FROM ${t} WHERE student_id = ?`).all(sid);

// ✗ 错误：ensureTable 的参数不是完整 DDL
await ctx.db.ensureTable('notes', 'CREATE TABLE notes (id TEXT)'); // 会拼成双重 CREATE TABLE
// ✗ 错误：硬编码表名
db.prepare('SELECT * FROM notes'); // 表根本不存在
```

### 表前缀命名规范（已统一）

`pluginTablePrefix(scopeId)` → `` `plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_` ``

1. 上传与社区安装的插件统一使用其**安装主键**（`plugins` 表行 UUID），
   在 Inline 与 Worker（子进程 / 独立进程）两种模式下**保持一致**，实现存储物理隔离与防冲突；
2. 内置核心插件使用其规范 scopeId：`@openlearn/plugin-vfs` → `plugin__openlearn_plugin_vfs_`；
3. 前缀中所有非 `[A-Za-z0-9_]` 字符一律替换为 `_`。

```{important} 前缀只取决于安装主键 scopeId，与执行模式无关
外部插件为 UUID（形如 `plugin_9f2c______`），内置插件为其规范 id。
**新建表不要再用 `plugin_{manifestId}_`** —— 历史上按 `manifestId` 建过表的插件，
其旧表只用于卸载清理与兼容放行（`listAllowedPluginTablePrefixes(..., includeLegacyManifest=true)`）。
```

---

## 3. `ensureTable` / `table()` 的 SEC 校验（高频报错来源）

插件通过 ZIP 上传，表名与 schema 属**不可信输入**，宿主拼接 DDL 前强制校验
（inline、worker_threads、process 三种模式**同等实现**）：

| 规则        | 约束                                                                                                                    | 违例报错                                                                              |
| :---------- | :---------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| 表名格式    | `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/` —— 字母/下划线开头，仅字母数字下划线，**最长 64 字符**；不允许连字符 `-`、点 `.`、`$` | `[SEC] Invalid SQL identifier for ensureTable(tableName): …`                          |
| schema 长度 | 非空字符串，**≤ 4000 字符**                                                                                             | `[SEC] createTable schema must be a non-empty string (max 4000 chars)`                |
| schema 内容 | **禁止包含分号 `;`**（阻断 `…); DROP TABLE events; --` 多语句注入）                                                     | `[SEC] createTable schema must not contain ";" (multiple statements are not allowed)` |

`dropAllTables()` 从 `sqlite_master` 取表名后**仍二次校验** `/^plugin_[A-Za-z0-9_]+$/` 才拼 DDL；
ZIP 安装侧另有 300MB 解压总大小上限与路径穿越（`..` / 前导 `/`）检查。

```{warning} 不要建带连字符的表名
`ctx.db.ensureTable('user-notes', ...)` 直接抛错。用 `user_notes`。
`ctx.db.table()` 同样受标识符校验 —— 动态拼的表名也要守规则。
```

---

## 4. 迁移

平台自 Issue #142 起正式支持**声明式 SQL 版本化迁移**，并对既有命令式 `ctx.db.migrate()`
提供完全向后兼容与事务原子性增强。

### 4.1 ⚠ ZIP 分发先看这段

官方 CLI 的 `build` **只打包** `index.js` + `manifest.json`（+ 可选 `frontend.js`），
**`migrations/` 目录不会进 ZIP**（见 `packages/plugin-sdk/cli.mjs` 的打包段）。

| 分发方式                            | `migrations/` 是否生效 | 推荐做法                                                                  |
| :---------------------------------- | :--------------------- | :------------------------------------------------------------------------ |
| 内置插件 / 源码目录直装             | ✅ 生效                | 按 §4.2 声明式迁移                                                        |
| **第三方 ZIP 插件（npm CLI 打包）** | ❌ **不会执行**        | 改用命令式 `ctx.db.ensureTable()` + `ctx.db.migrate(version, fn)`（§4.3） |

```{danger} 最常见的无效配置
写了一份永远不会被执行的 `migrations/` 是本文档历史上最常见的无效配置，故单独提示。
宿主侧执行逻辑见 `packages/core/plugin-host/lifecycle.ts` 的 `runPluginDeclarativeMigrations`
（仅在 `preloaded.migrationsDir` 存在时调用）。
```

### 4.2 声明式迁移（内置 / 源码直装）

```text
my-plugin/
├── manifest.json
├── index.js
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_add_student_notes.sql
    └── 003_create_indexes.sql
```

1. **命名与排序**：`NNN_name.sql`（`NNN` 为前导正整数序列号，`001_` / `02_` / `10_` 均可），
   宿主按数字版本号**自然序升序**执行。
2. **语法标记**：支持 `-- UP` 与 `-- DOWN` 分段注释；省略标记则整篇作为 `-- UP`（下例用 `text` 标注，
   因为 `{{prefix}}` 占位符不是合法 SQL，Pygments 会在 `{` 处报错）：

   ```text
   -- UP
   CREATE TABLE IF NOT EXISTS {{prefix}}homework (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );

   -- DOWN
   DROP TABLE IF EXISTS {{prefix}}homework;
   ```

3. **占位符自动展开**：`{{prefix}}` 或 `{{table_prefix}}` → 该插件的命名空间前缀 `plugin_<scopeId>_`。
4. **单步事务与失败回滚**：每步包裹在 `db.transaction()` 内原子执行。
   某步语法错误/异常 → 该步**完全回滚**，前序迁移保留，后续中止，插件进入 `ERROR`
   并抛 `PluginMigrationExecutionError`。
5. **拒绝版本降级（Downgrade Protection）**：激活前比对
   `maxAppliedVersion`（库中已应用最大版本）与 `maxDeclaredVersion`（包内声明最大版本）。
   `maxAppliedVersion > maxDeclaredVersion`（如已升到 v2 的库被装了 v1 旧插件包）
   → 抛 `PluginMigrationDowngradeError`，**强行拒绝激活**。
6. **元表与卸载策略协同（Issue #141）**：状态记在
   `plugin_declared_migrations(plugin_id, version, name, checksum, applied_at)`，含校验和防篡改。
   卸载选 `keep`（默认）→ 元表记录原样保留，重装同插件自动识别既有版本并增量续跑；
   选 `purge` → 随插件私有表一并清理。
7. **单测支持**：`@openlearn/plugin-test-kit` 导出 `runTestPluginMigrations(db, pluginId, migrationsDir, options)`。

宿主在插件**激活前**（inline / worker_threads / process 三种模式均适用）自动执行尚未应用的增量迁移，
并传 `tablePrefix: pluginTablePrefix(pluginId)`。

### 4.3 命令式 `ctx.db.migrate`（ZIP 插件的正规做法）

```typescript
export async function activate(ctx: PluginContext) {
  await ctx.db.ensureTable('my_table', 'id TEXT PRIMARY KEY, data TEXT'); // 幂等建表
  await ctx.db.migrate(2, async (sqliteDb) => {
    // 只在当前版本 < 2 时执行；内部一律用 prepare().run()
    sqliteDb.prepare(`ALTER TABLE ${ctx.db.table('my_table')} ADD COLUMN note TEXT`).run();
  });
}
```

- 版本记在 `plugin_migrations(plugin_id PRIMARY KEY, version)`；当前版本 < `targetVersion` 才执行。
- 底层已加 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 包裹，单步失败自动回滚、版本号不被错误提升。
- `migrate` 自己会先 `CREATE TABLE IF NOT EXISTS plugin_migrations ...`。

```{warning} 迁移脚本不会自动加表前缀
`upgradeFn(db)` 拿到的是**原始 db**，`ctx.db` 的前缀逻辑不在其中。
需要隔离请显式用 `${ctx.db.table('xxx')}` 拼接，或用 `{{prefix}}` 占位符（仅声明式路径）。
```

**范式约束**：迁移脚本内**只用 `prepare().run()`**，以兼容 Worker 模式；
不要依赖 `exec` 或 `transaction`。

---

## 5. SQL 零信任守卫（`sql-guard.ts`）

路径 B 的所有插件 SQL 都过 `assertPluginSqlAllowed({ sql, ownPrefix, allowedPrefixes?, researchAllowed? })`。

```{important} 现象速记
子进程沙箱插件（`process` 模式）若在自定义 handler 里
`rawDb.prepare("INSERT INTO whiteboard_elements ...")` 手动向白板落库
→ 被强行拦截报错。
前端弹窗显示「下发成功」（HTTP 200 接收成功），控制台抛 SQL-Guard 异常，白板画布空无一物。

**正确做法**：manifest 申请 `whiteboard:write`，handler 里
`ctx.services.commandBus.execute({ type: 'whiteboard.draw', payload })` 由内核安全代发。
```

### 5.1 拦截顺序

```
1. 空 SQL（非字符串或 trim 后为空）→ 直接放行
2. FORBIDDEN_OPERATIONS 逐条正则测原始 sql → 命中抛 Dangerous statement is forbidden: "…"
3. sanitizeSql(sql) 规范化（剔注释、剥字符串、规范化 [tbl] `tbl` "tbl"）
4. extractReferencedTables(clean) 深度提取表名（递归剥括号，占位子查询，深度上限 100）
5. Fail-Closed 兜底：clean 含 FROM|JOIN|INTO|UPDATE|TABLE 但一个表名都没解析出来
   → Worker plugin SQL rejected: unable to resolve target table in "…"
6. FORBIDDEN_CORE_TABLES 黑名单全词比对（命中且在 tables 中）→ 拒绝
7. 逐表：plugin_migrations 放行 → researchAllowed 时 plugin_research_* 放行
   → ownPrefix/allowedPrefixes 前缀匹配放行
   → sqlite_master/sqlite_schema/sqlite_temp_master 特殊处理
   → 其余拒绝
```

### 5.2 禁止的操作

```typescript
const FORBIDDEN_OPERATIONS = [
  /\bATTACH(?:\s+DATABASE)?\b/i,
  /\bDETACH(?:\s+DATABASE)?\b/i,
  /\bPRAGMA\b/i,
  /\bVACUUM\b/i,
  /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i,
  /\bDROP\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i,
];
```

```{danger} PRAGMA 被无条件禁掉
这意味着插件不能用 `PRAGMA table_info(...)` 探查列结构。
改判列是否存在请查 `sqlite_master`（见 §5.5 的精准前缀查询）或在 `migrate` 里容错。

```

### 5.3 核心表静态黑名单（`FORBIDDEN_CORE_TABLES`）

```

users client_sessions plugins plugin_storage
ai_providers processes pending_commands classes
students class_students lessons assignments
assignment_submissions attendance schedules class_grade_weights
exams exam_scores student_semester_reports student_rollcalls
student_seats student_read_notifications student_lesson_progress courseware
courseware_attempt system_resources events _migrations
site_settings agent_conversations classroom_sessions lesson_quiz_submissions
courseware_score_config demo_data_registry whiteboard_elements student_point_logs
lianyun_research_activities lianyun_research_groups lianyun_research_submissions lianyun_research_reviews

````

```{warning} 读也不行
黑名单分两种文案但**读写一律拒**：
- DDL（语句以 `DROP|CREATE|ALTER|TRUNCATE` 开头）→
  `Worker plugin is not permitted to perform DDL on table "<word>" (core security table is strictly forbidden)`
- 其他 → `Worker plugin is not permitted to access table "<word>" (core security table is strictly forbidden)`

要拿学生/课时/作业数据，走**命令总线**（`ctx.services.commandBus.execute`）或平台服务，
不要直查这些表。守卫做**全词比对**，注释混淆绕不过去。
````

### 5.4 命名空间判定

```typescript
const validPrefixes = [ownPrefix, ...allowedPrefixes].map(lowercase).filter(Boolean);
// ownPrefix = pluginTablePrefix(scopeId)
// allowedPrefixes = listAllowedPluginTablePrefixes(scopeId, manifestId)  // 含历史兼容前缀
```

不在允许前缀内 → `... only ${ownPrefix || '<none>'} namespace is allowed`。
例外：`plugin_migrations` **始终放行**（宿主已纳入 DDL 白名单，允许 Worker 透明调用
`ctx.db.migrate()` 初始化并更新版本控制表，杜绝 `WorkerCapabilityError`）。

`researchAllowed` 为真时 `plugin_research_*` 放行（授权的研究表生态）。

### 5.5 元数据表

```sql
-- 唯一放行的形态（大小写不敏感，且 SQL 需包含自己的前缀）
SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '<ownPrefix>%'
```

正则：`/^\s*SELECT\s+name\s+FROM\s+(?:sqlite_master|sqlite_schema)\s+WHERE\s+type\s*=\s*['"]table['"]\s+AND\s+name\s+LIKE\s+['"][A-Za-z0-9_%]+['"]\s*$/i`
并要求 `strippedComments` 含 `ownPrefixLower`。

任何其他形态 → `Direct access to sqlite metadata table "<table>" is forbidden`。
（判定前会先把 `--…` 与 `/*…*/` 替换成空格再匹配，注释绕过无效。）

---

## 6. 事务与 Worker / Process 支持

- `PluginDatabaseAPI` **没有** `transaction` / `beginTransaction` 方法。
- 事务仅在**路径 B、Inline 进程内的原始 better-sqlite3 实例**上可用，用 better-sqlite3 的
  **回调式** `db.transaction(fn)`（返回函数即执行）：

```typescript
const db = await ctx.resolve(IDatabaseToken);
const deleteTransaction = db.transaction(() => {
  db.prepare('DELETE FROM students WHERE id = ?').run(id); // ← 仍在黑名单里，仅示意
  db.prepare('DELETE FROM grades WHERE student_id = ?').run(id);
});
deleteTransaction(); // 执行
```

真实用例见 `packages/plugins/management.ts`、`packages/plugins/builtin.ts`（第一方内置插件不受 worker 守卫约束）。

### 6.1 Worker / Process 模式

| 能力                                                 | 状态                                                                                                                                                                    |
| :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exec` 跨线程 RPC 转发                               | ✅ 正式支持（`await db.exec(...)` 返回 Promise），全部经主侧 `assertDatabaseAccessAllowed`                                                                              |
| DDL 命名空间守卫                                     | ✅ 第三方必须用自身 `plugin_<scopeId>_` 前缀                                                                                                                            |
| `plugin_migrations`                                  | ✅ 放行（`ctx.db.migrate()` 可用）                                                                                                                                      |
| 核心数据表                                           | ❌ 黑名单硬拦                                                                                                                                                           |
| **异步 Migration 队列时序保护（`pendingPromises`）** | ✅ Worker 执行 `ctx.db.migrate(v, fn)` 时，沙箱代理自动捕获内部所有**未显式 `await`** 的异步 DB 操作并统一 `Promise.all`，确保全部迁移 SQL 写入后才原子化持久化新版本号 |
| **`db.transaction(fn)`**                             | ❌ 线程间 IPC 无法同步传递函数闭包并保证 SQLite 线程独占锁 → **不支持**。如需多步一致性，在单个 `exec` 中包含多条 SQL，或在主侧命令中封装                               |

```{danger} worker/process 插件不要依赖事务与 exec
最佳实践明确写着：Worker 隔离模式插件**避免依赖事务与 `exec`**。
需要原子性请设计成单语句操作，或经命令总线让主线程侧的内置逻辑完成。
```

---

## 7. KV 存储（非 SQL）

```typescript
ctx.services.storage.get(key): Promise<unknown>    // 不存在返回 null
ctx.services.storage.set(key, value): Promise<void>  // JSON.stringify 后 upsert
ctx.services.storage.delete(key): Promise<void>      // 不存在则 no-op
```

后端为 `plugin_storage(plugin_id, key, value, updated_at)` 表，SQL 硬带 `WHERE plugin_id = ?`，
**此处的 `plugin_id` 列写入的是 `manifest.id`**（不是 DB 行 UUID）。
`set` 用 `INSERT ... ON CONFLICT(plugin_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`。

适合简单键值、无需建表的场景。值经 `JSON.parse` / `JSON.stringify`，**支持任意可序列化结构**（不是字符串 KV）。
错误会被 `console.error('[Plugin:<manifestId>] Error getting storage key "<key>":', ...)` 记录后 **rethrow**。

```{note} config:<key> 兼容回落
`ctx.config` 在新表 `plugin_config` 缺行时会回退读 `plugin_storage` 的 `config:<key>`，
以保证「迁移未执行 / 手工恢复」的库也能读到旧配置。别把自己的 key 起成 `config:` 前缀。

```

---

## 8. 卸载与数据策略

| 事件 | 行为 |
| :--- | :--- |
| 卸载选 `keep`（默认） | 私有表与 `plugin_declared_migrations` 记录**保留**，重装可增量续跑 |
| 卸载选 `purge` | `dropAllTables()` + 元表一并清理 |
| `dropAllTables()` | 只删 `LIKE '<ownPrefix>%'` 的表，且逐个二次校验 `/^plugin_[A-Za-z0-9_]+$/` |

`plugin_storage` 与 `plugin_config` 的清理走 `orphan-data.ts` / `uninstall-data-policy` 路径。

---

## 9. 最佳实践清单

- [ ] 私有表一律 `ctx.db.ensureTable()` + `ctx.db.table()` 获取表名，**不硬编码拼接的表名**
- [ ] 表名守 `[A-Za-z_][A-Za-z0-9_]{0,63}`（不含 `-` `.` `$`）
- [ ] schema 片段无分号、≤4000 字符、不含 `CREATE TABLE`
- [ ] ZIP 插件用命令式 `ctx.db.migrate(v, fn)`，**不要**只写 `migrations/` 目录
- [ ] 迁移函数内只用 `prepare().run()`
- [ ] 需要事务 / 读写平台表 → 明确这是 Inline 才可行的路径，考虑改为命令总线
- [ ] 从不直查 `users` / `students` / `lessons` / `whiteboard_elements` / `events` 等核心表
- [ ] 从不写 `PRAGMA` / `ATTACH` / `CREATE TRIGGER|VIEW`
- [ ] 简单配置/小对象用 `ctx.services.storage` 或 `ctx.config`，不要建表

---

## 取证

| 论断 | 来源 |
| :--- | :--- |
| `PluginDatabaseAPI` 4 方法签名 | `packages/core/plugin-host/types.ts` |
| 表前缀规则、`ensureTable`/`migrate` 实现、`dropAllTables` 二次校验 | `packages/core/plugin-host/context-builder.ts`（`dbApi`）+ `plugin-tables.ts`（`pluginTablePrefix` / `listAllowedPluginTablePrefixes` / `isSafePluginTablePrefix`） |
| SEC 标识符与 schema 校验文案 | `context-builder.ts`（`SQL_IDENTIFIER_PATTERN` / `assertSafeSqlIdentifier` / `assertSafeCreateTableSchema`） |
| 两条路径对照、事务仅 Inline、Worker `exec`/`pendingPromises`/无事务 | `docs/reference/plugin-database-api.md` §1–§2、§4–§5 |
| 声明式迁移 7 项规范、ZIP 不打包 `migrations/` 的分工表 | 同上 §3 + `packages/plugin-sdk/cli.mjs` 打包段 + `plugin-host/lifecycle.ts`（`runPluginDeclarativeMigrations`）+ `plugin-host/declarative-migrator.ts` |
| `FORBIDDEN_CORE_TABLES`、`FORBIDDEN_OPERATIONS`、`assertPluginSqlAllowed` 全流程、元数据表精准放行 | `packages/core/plugin-host/sql-guard.ts` |
| `whiteboard_elements` 必须走 `whiteboard.draw` | `docs/tutorials/plugin-development-tutorial.md` §3.3 警示框 |
| `wrapStorage` 用 `manifest.id` 作 `plugin_id` | `context-builder.ts` + `docs/reference/plugin-database-api.md` §4 |
| 卸载 keep/purge 策略 | `packages/core/plugin-host/uninstall.ts`、`orphan-data.ts`、`__tests__/uninstall-data-policy.test.ts` |
```
