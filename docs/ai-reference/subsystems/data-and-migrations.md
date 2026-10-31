# 子系统：数据层与迁移

> 覆盖 `packages/core/db/`、`migrations/`、`packages/core/plugin-host/plugin-tables.ts`、
> `plugin-host/declarative-migrator.ts`、`plugin-host/orphan-data.ts`。

---

## 1. 一个数据库，两个连接面

`packages/core/db/index.ts`（608 行）暴露两套读写入口：

| 导出                                | 类型                                          | 用途                         |
| ----------------------------------- | --------------------------------------------- | ---------------------------- |
| `db`                                | 单例 `better-sqlite3` Database（L394）        | **所有写与事务**             |
| `readPool`                          | `ReadConnectionPool` 实例（L491）             | 只读查询池，WAL 下并发读     |
| `getReadDb()`                       | 取一个只读连接（L497）                        | 长只读任务                   |
| `queryRead<T>(sql, ...params)`      | 返回行数组（L504）                            | 推荐给普通只读               |
| `queryReadOne<T>(sql, ...params)`   | 返回单行（L512）                              | 推荐给单行查询               |
| `checkpoint(mode)`                  | `PASSIVE`/`FULL`/`RESTART`/`TRUNCATE`（L529） | 手动 WAL checkpoint          |
| `applyPragmas` / `applyReadPragmas` | L155 / L170                                   | 写库与读库的 PRAGMA 分开设置 |
| `initializeDatabase(instance)`      | L233                                          | 建表/校验                    |
| `createDatabase(customPath?)`       | L364                                          | 测试用独立库                 |

**选型判据**：**写操作一律用 `db`**；只读列表/统计优先 `queryRead`。
混用会导致「刚写完读不到」（读连接看到的是 WAL 快照）。

数据库路径：`OPENLEARN_DB_PATH` 优先，默认 `packages/core/db/educational_os.db`（`getDbPath()` L182）。

---

## 2. 表：86 张，三类归属

`migrations/*.sql` 共 **45 个**文件，累计 `CREATE TABLE` 出 **86 张表**。按归属分三类：

### 2.1 内核业务表（插件**不可写**，40 张在黑名单）

```text
users  client_sessions  plugins  plugin_storage  ai_providers  processes
pending_commands  classes  students  class_students  lessons  assignments
assignment_submissions  attendance  schedules  class_grade_weights  exams
exam_scores  student_semester_reports  student_rollcalls  student_seats
student_read_notifications  student_lesson_progress  courseware  courseware_attempt
system_resources  events  _migrations  site_settings  agent_conversations
classroom_sessions  lesson_quiz_submissions  courseware_score_config  demo_data_registry
whiteboard_elements  student_point_logs  lianyun_research_activities
lianyun_research_groups  lianyun_research_submissions  lianyun_research_reviews
```

逐字比对源：`packages/core/plugin-host/sql-guard.ts → FORBIDDEN_CORE_TABLES`（L13-54）。

### 2.2 平台扩展表（不在黑名单，但同样不建议插件直写）

课堂生态大量表属于此类：`classroom_*`（buzzers / danmaku / exit_tickets / feed / pacing_signals /
peer_badges / peer_nominations / peer_review_tasks / peer_reviews / peer_rubric_dimensions /
poll_votes / quick_polls / sessions）、`icebreaker_checkins`、`lesson_checkins`、`lesson_preset_polls`、
`segment_gate_overrides`、`segment_visits`、`teaching_modes`、`computer_labs`、`class_groups`、
`vfs_nodes`、`mfe_remotes`、`question_bank_items`、`assessment_*`、`exams` 等。

**这些表由平台服务写入**。插件直写等于绕过事务与一致性约束 —— 示例插件 `lab-seat` 就踩了这个坑，
见 [../examples/lab-seat-walkthrough.md](../examples/lab-seat-walkthrough.md) §4.3。

### 2.3 插件私有表（`plugin_<scopeId>_*`）

前缀规则：`packages/core/plugin-host/plugin-tables.ts → pluginTablePrefix(scopeId)`（L11）

```ts
return `plugin_${scopeId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;
```

- `scopeId` = `plugins` 表主键。内置插件用规范化 id（`@openlearn/plugin-vfs` → `plugin__openlearn_plugin_vfs_`），
  上传插件用安装生成的 **UUID**。
- `listAllowedPluginTablePrefixes(scopeId, manifestId, includeLegacyManifest)`（L19）返回合法前缀集合，
  给 SQL 守卫和卸载清理共用。
- `isSafePluginTablePrefix(prefix)`（L38）正则 `/^plugin_[A-Za-z0-9_]+_$/`，是最后一道防注入。

平台级的插件元数据表（跨插件共享、不属于任何单个插件）：

| 表                         | 作用                                                    |
| -------------------------- | ------------------------------------------------------- |
| `plugin_migrations`        | 每个插件的迁移版本记录（按 plugin_id 一行）             |
| `plugin_config`            | 插件配置值（`ConfigService.TABLE`，key 前缀 `config:`） |
| `plugin_storage`           | 插件 KV 存储（`ctx.services.storage`）                  |
| `plugin_capability_grants` | 能力授予记录                                            |
| `plugin_network_grants`    | 出站网络授权                                            |
| `plugin_public_routes`     | 公开路由声明                                            |
| `plugin_orphan_data`       | 卸载时的孤儿数据快照                                    |

---

## 3. 迁移：SQL 文件与插件迁移是两套

### 3.1 平台迁移（`migrations/*.sql`）

`packages/core/db/migrator.ts`：

| 函数                                     | 行   | 说明                              |
| ---------------------------------------- | ---- | --------------------------------- |
| `loadMigrationsFromDirectory(dir)`       | L59  | 读 `NNN_name.sql`                 |
| `parseMigrationSql(name, content)`       | L42  | 解析 up / down 段                 |
| `runMigrations(db, migrations, options)` | L116 | 按序执行，记录 `_migrations` 账本 |
| `rollbackMigration(db, migration)`       | L250 | 回滚单条                          |
| `simpleChecksum(text)`                   | L93  | 校验和防篡改                      |

三个相关环境变量（缺一不可理解）：

| 变量                             | 作用                               |
| -------------------------------- | ---------------------------------- |
| `MIGRATION_ALLOW_UNKNOWN_LEDGER` | 允许账本里存在源码中没有的迁移记录 |
| `MIGRATION_CHECKSUM_STRICT`      | 校验和不符时直接失败（否则只告警） |
| `FORCE_MIGRATION_SNAPSHOT`       | 迁移前强制快照                     |

**改已有迁移文件会被校验和拦下**。正确做法是新加一个 `0NN_xxx.sql`。

### 3.2 插件迁移（`ctx.db.migrate(version, fn)`）

```ts
await ctx.db.migrate(1, async (sqliteDb) => { ... });   // 版本号单调递增
await ctx.db.migrate(2, async (sqliteDb) => { ... });
```

- 整体一个事务，抛错回滚。
- 版本记录写 `plugin_migrations`。
- **官方 CLI 不打包 `migrations/` 目录**，所以「声明式 SQL 迁移」在 ZIP 插件上不执行；
  必须写成 `ctx.db.migrate()` 回调（`cli.mjs` L379-387 是打包白名单）。

---

## 4. 保留策略：默认会删数据

`packages/core/db/retention-policy.ts → DEFAULT_RETENTION_DAYS`（L22）：

| 类别              | 默认天数 | 环境变量                                                   | 清理函数                            |
| ----------------- | -------- | ---------------------------------------------------------- | ----------------------------------- |
| `events`          | 90       | `OPENLEARN_EVENT_RETENTION_DAYS` / `RETENTION_EVENTS_DAYS` | `purgeExpiredEvents`（L114）        |
| `attendance`      | 365      | `OPENLEARN_ATTENDANCE_RETENTION_DAYS`                      | `purgeExpiredAttendance`（L150）    |
| `notifications`   | 30       | `OPENLEARN_NOTIFICATIONS_RETENTION_DAYS`                   | `purgeExpiredNotifications`（L188） |
| `rollcalls`       | 180      | `OPENLEARN_ROLLCALLS_RETENTION_DAYS`                       | `purgeExpiredRollcalls`（L243）     |
| `sessions`        | 30       | `OPENLEARN_SESSIONS_RETENTION_DAYS`                        | `purgeExpiredSessions`（L281）      |
| `pendingCommands` | 14       | `OPENLEARN_PENDING_COMMANDS_RETENTION_DAYS`                | —                                   |

`resolveRetentionDecision`（L71）支持「设为 0 或负数即禁用该类别」。
**写依赖 `events` / `attendance` 长期留存的逻辑前，先确认保留天数够不够**。

---

## 5. 备份

| 组件            | 位置                                 | 说明                                                                                 |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `BackupManager` | `packages/core/db/backup-manager.ts` | `validateBackup`（L80）、`listBackups`（L136）、备份/恢复                            |
| 定时调度        | `server/backup-scheduler.ts`         | `BACKUP_SCHEDULE`、`BACKUP_DAILY_AT`、`BACKUP_KEEP`、`BACKUP_CHECKPOINT_INTERVAL_MS` |
| 目录            | `BACKUP_DIR` 或默认 `backups/`       | 仓库根已有 `backups/` 目录                                                           |
| 迁移前快照      | `PRE_MIGRATION_KEEP`                 | 控制保留份数                                                                         |

---

## 6. 插件侧数据库 API（`ctx.db`）

```ts
ctx.db.table(suffix): string;                       // 同步，返回限域表名
ctx.db.ensureTable(name, ddl): Promise<void>;       // 异步
ctx.db.migrate(version, fn): Promise<void>;         // 异步
ctx.db.dropAllTables(): Promise<void>;              // 卸载时由宿主调用，插件不要手动调
```

两个易错点：

1. **`ctx.db.table()` 是同步的**，`ensureTable` / `migrate` 是异步的，必须 `await`。
2. **表名不要手拼**。手拼的前缀不会被 `listAllowedPluginTablePrefixes` 认可，
   `process` / `worker` 模式下会被 SQL 守卫拒绝，卸载时也不会被清理。

细节见 [../plugin-system/context-and-services.md](../plugin-system/context-and-services.md) §5。
