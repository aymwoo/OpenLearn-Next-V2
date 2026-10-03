# Version Migration Guide 版本迁移指南

> **当前版本**：`package.json` 为 **`0.5.0`**，`@openlearn/plugin-sdk` 为 **`3.7.0`**。
>
> 本文覆盖两类迁移：
> 1. **平台数据库 schema 迁移**（`migrations/000`–`014`）—— 服务启动时自动执行，管理员通常无需手动干预
> 2. **插件侧迁移**（`ctx.db.migrate`）—— 插件作者在自己插件的 `activate` 中调用

---

## 1. 平台数据库迁移机制

### 1.1 执行时机与位置

`server.ts` 的 `startServer` 在内核构建完成后、等待 `kernelContainer.ready` **之前**执行：

```ts
const migrationsDir = path.join(process.cwd(), 'migrations');
const migrations = loadMigrationsFromDirectory(migrationsDir);
if (migrations.length > 0) {
  runMigrations(kernelContainer.db, migrations);
}
```

随后还有一步 `runStartupMigrations(kernelContainer.db)`（`packages/core/db/index.ts` 的 `ensureColumn` 系列，负责 `plugins` 等表的增量加列）。

> ⚠️ 迁移失败**不会阻止服务启动**——`server.ts` 用 try/catch 包住并只打 `console.error`。**部署后务必看启动日志确认 `[Migration] Applied: xxx` 全部出现。**

### 1.2 迁移运行器语义（`server/utils/migrate.ts`）

| 行为              | 实现                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| 文件排序          | `loadMigrationsFromDirectory` 用 `localeCompare(a, b, { numeric: true })`，**数字序而非字典序** |
| 幂等              | `_migrations` 表记录已应用的 `name`，已应用则 `continue` 跳过                          |
| 断点续跑          | 单条失败即 `throw`，中断整个循环；重启后从未应用的那条继续                              |
| 重复列容错        | `executeSqlStatements` 捕获 `duplicate column name` 并 `continue`（`warn` 不中断）      |
| 校验和            | `simpleChecksum`（djb2 变体，32 位）写入 `_migrations.checksum`——**仅记录，不校验**     |
| 回滚              | `rollbackMigration` 需要迁移提供非空 `-- DOWN` 段，否则 `throw`                          |
| 影子表            | 部分迁移在 `migrate.ts` 中建 `*__rollback` 临时表用于数据搬迁，搬完保留（勿当业务表读） |

`_migrations` 表结构：`name TEXT PRIMARY KEY` / `applied_at INTEGER NOT NULL` / `checksum TEXT NOT NULL`。

> ⚠️ **没有迁移框架的「已改过就报错」保护**。`simpleChecksum` 算出来了但从不比对，因此**修改已发布的迁移文件是安全的（对已应用库无害）但对未应用库会产生分叉**。正确做法是新增一条迁移，不要改旧文件。

### 1.3 文件格式约定

```sql
-- UP
-- 说明与背景（可多行）
CREATE TABLE IF NOT EXISTS foo (...);
ALTER TABLE bar ADD COLUMN baz TEXT;

-- DOWN
-- 回滚脚本
DROP TABLE IF EXISTS foo;
```

- 文件名 `NNN_description.sql`，`NNN` 三位序号
- 无 `-- UP` 标记时，整份文件（除 `-- DOWN` 之后）都当 UP 处理
- 语句按 `;` 切分，**仅注释的片段会被过滤**

---

## 2. 迁移清单（000 → 014，共 15 条）

> ⚠️ `migrations/README.md` 中 009 条目的表名（`classroom_peer_review_groups` / `classroom_peer_review_submissions`）**与脚本实际内容不符**——以脚本为准。

| 序号    | 文件                                  | 建表                                                                                            | 关键增量                                                                                                  | 有 DOWN |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | :-----: |
| `000`   | `000_initial_schema.sql`              | 内核初始 schema（`events` / `users` / `client_sessions` / `plugins` / `vfs_nodes` / `processes` / `pending_commands` 等） | —                                                                                       |  ✅ |
| `001`   | `001_add_execution_mode.sql`          | —                                                                                                | `plugins.execution_mode`（`inline` / `worker`，默认 `inline`）                                            |  ✅ |
| `002`   | `002_add_client_session_expiry.sql`   | —                                                                                                | `client_sessions.expires_at`（会话绝对过期）                                                              |  ✅ |
| `003`   | `003_classroom_runtime.sql`            | `student_rollcalls` / `site_settings` / `agent_conversations`                                     | 随机点名、站点设置、AI 对话记忆                                                                          |  ✅ |
| `004`   | `004_courseware_score_config.sql`     | `courseware_score_config`                                                                        | 课件成绩归集策略；`courseware_id = '*'` 为全局默认                                                        |  ✅ |
| `005`   | `005_assignment_hub.sql`               | `plugin_assignments` / `plugin_submission_versions` / `plugin_assignment_files` / `plugin_peer_review_tasks` | 作业升为一等实体；重交留档不丢历史；`assignment_submissions` 等表加 `assignment_id` / `task_id` / `anonymous` / `status` / `updated_at` |  ✅ |
| `006`   | `006_classroom_event_bus.sql`          | —                                                                                                | `events` 补课堂维度：加 `lesson_id` 列与 `(type,timestamp)` / correlationId / `(lesson_id,timestamp)` 索引 |  ✅ |
| `007`   | `007_interactive_classroom.sql`        | `lesson_quiz_submissions` / `classroom_sessions` / `classroom_quick_polls` / `classroom_poll_votes` / `classroom_buzzers` / `classroom_exit_tickets` / `classroom_pacing_signals` | 互动课堂与课节生命周期                                                                 |  ✅ |
| `008`   | `008_teaching_modes.sql`              | `teaching_modes`                                                                                 | `classroom_sessions.teaching_mode_id`；内置模式定义在代码常量，**不 seed**                              |  ✅ |
| `009`   | `009_classroom_peer_review.sql`        | `classroom_peer_review_tasks` / `classroom_peer_reviews` / `classroom_peer_badges` / `classroom_peer_nominations` / `classroom_danmaku` / `classroom_peer_rubric_dimensions` | 课中全班大屏互评（**课堂为中心**，随 session 生命周期）                                                  |  ❌ |
| `010`   | `010_class_groups.sql`                | `class_groups`                                                                                   | 班级固定分组；`member_ids` / `leader_id` 用 JSON 存整组，`is_default` 标记上课默认方案                  |  ✅ |
| `011`   | `011_classroom_feed.sql`              | `classroom_feed`                                                                                 | 课堂动态流落库，教师重进课堂可按 lesson 回放（此前是纯前端内存态，上限 50 条）                          |  ❌ |
| `012`   | `012_auto_record_score.sql`           | —                                                                                                | `courseware_score_config` 加 `auto_record_enabled`（默认 **0 关闭**）/ `auto_record_min_completion`       |  ✅ |
| `013`   | `013_score_source_strategy.sql`       | —                                                                                                | `assignment_submissions.source`（`manual` / `auto`）+ `courseware_score_config.auto_record_strategy`（`latest` / `highest`） |  ✅ |
| `014`   | `014_performance_indexes.sql`         | —（**只建索引**）                                                                                | `vfs_nodes(parent_id)` / `plugin_submissions(lesson_id)` / `student_point_logs(student_id)` / `student_rollcalls(class_id, student_id)` |  ✅ |

**没有 DOWN 段的两条**：`009` 与 `011`。`rollbackMigration` 对它们会直接 `throw`。

---

## 3. 跨版本升级断点（v0.1.x → v0.5.0）

下面按**破坏性**程度排列需要注意的断点。所有涉及写操作的迁移都应先备份 `educational_os.db`。

### 3.1 会话从无过期变为有绝对过期（`002`）

`client_sessions` 新增 `expires_at`。升级后**已存在的会话行该列为 `NULL`**，服务端视为「不过期」，按 `updated_at` 的 24 小时空闲超时兜底。存量会话在空闲超时后自然失效，**不会造成全员掉线**。

### 3.2 插件执行模式从隐式到显式（`001`）

`plugins.execution_mode` 默认 `inline`。存量插件全部落在 `inline`——**即旧行为不变**。若要把第三方插件切到 worker 隔离模式，需管理员显式改值并重启。

> ⚠️ 两种模式的 `db.table()` 表前缀语义**相反**（inline 用 DB UUID，worker 用 manifestId）。切换模式会让插件私有表「找不到」。详见[插件数据库 API](../reference/plugin-database-api)。

### 3.3 随堂练习作答改用关系表（`007`）

`lesson_quiz_submissions` 成为**唯一权威数据源**。升级前把 `submissions` 写回 `whiteboard_elements.data` JSON 的历史数据**不会被自动搬迁**——那些数据仅作为存量展示兜底保留。

**升级后必须做**：若依赖历史随堂练习统计，需自行从 `whiteboard_elements.data.submissions` 抽取数据导入新表。表结构与唯一约束见[平台数据表参考](../reference/platform-data-tables)。

### 3.4 课堂事件进入内核总线（`006`）

`events` 表新增 `lesson_id` 列与三组索引。此迁移**不改变任何既有调用方**——`server/event-routing.ts` 的路由表本来就同时驱动总线与 Socket 投递。

**可见变化**：`events` 从「只有内核事件」变成「课堂事实日志」，可按时间窗口 / `correlationId` / `lessonId` 三种维度查询。数据量会显著增长，磁盘占用需纳入监控。

### 3.5 成绩录入从「逐条手动」升级为「规则自动」（`012` + `013`）

这是 v0.1.x 之后**对教学数据影响最大**的一组变更：

| 迁移   | 变更                                                                                     | 兼容性 |
| ------ | ---------------------------------------------------------------------------------------- | ------ |
| `012`  | `courseware_score_config` 加 `auto_record_enabled`（**默认 0 = 关闭**）与 `auto_record_min_completion` | ✅ 默认关闭，**升级后行为与旧版完全一致**；教师需显式开启 |
| `013`  | `assignment_submissions` 加 `source` 列（`manual` / `auto`），并回填存量数据            | ✅ 回填规则：自动路径写入的 `feedback` 以「由自动录入规则。」开头，据此判定；其余为 `manual` |

> ⚠️ **`013` 之后教师手动改的分数受保护**。自动路径遇 `source='manual'` 的行会跳过（`manual-protected`），教师标记的缺考行（`status='absent'`）同样受保护（`absent-protected`）。若你的运维脚本直接 `UPDATE assignment_submissions` 改分，**不会**被自动规则冲掉——这正是 `013` 要修的缺陷。
>
> ⚠️ 另一处行为变更：自动录入**只处理已完成的 attempt**（`completed` / `submitted` / `finished`），且「**没有分数就不录**」——`submission_result.score` 为 `NULL` 时拒绝录入（`missing-score`），不再兜底成 100 分。

### 3.6 课件成绩归集策略（`004`）

`courseware_score_config` 是三级继承配置（课件专属 → 全局 `'*'` → 内置默认）。**无配置时保持历史行为**（取最后一次分数）。教师一旦配置 `MAX` / `AVERAGE` / `FIRST`，`submission_result.score` 的写入逻辑即改变——升级后如果发现历史分数被重算，说明该课件已有显式配置。

配套命令：`courseware.get_score_config` / `courseware.save_score_config` / `courseware.regrade_attempts`（按当前策略回填既有成绩）。

### 3.7 作业中枢（`005`）

四张新表 + 对 `plugin_submissions` / `plugin_grades` / `plugin_peer_reviews` 的 `ALTER`。**旧接口不删**——插件侧的 `plugin_submissions` / `plugin_peer_reviews` / `plugin_grades` 三张表继续存在，新链路走 `plugin_assignments` 系列。两套并存，迁移脚本里有明确的 `*__rollback` 数据搬迁影子表。

### 3.8 认证与安全的变更（非 schema）

这些不走 `migrations/`，但跨版本升级时行为有变：

| 变更                                     | 现状                                                                 | 源码位置                              |
| ---------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| 密码哈希升级为 bcrypt                    | `verifyPassword` 兼容旧 SHA-256，`needsUpgrade: true` 时自动重算    | `packages/core/db/index.ts`           |
| 会话改为不透明 Cookie + 查表              | 令牌是 `client_sessions` 表主键，**不是 JWT**                        | `server/middleware/auth.ts`           |
| 强制改密门控                             | 种子账号带 `mustChangePassword`，非 GET 且非豁免路径一律 403         | `enforcePasswordChanged`              |
| CSRF 门控                                | 写请求按 `Sec-Fetch-Site` 判定，`cross-site` 走豁免清单             | `server/middleware/csrf.ts`           |
| 前端 `setSocketBridge` 死代码被删除       | 白板事件**不再跨端转发**（从来就没生效过）                          | `src/services/event-bus.ts`           |
| 课件 HTML 改用 `?ct=` 短时令牌鉴权        | 沙箱 iframe 不带 cookie 的替代方案                                  | `server/utils/courseware-access.ts`   |
| 成绩榜对学生脱敏 `extra_json` / `comment` | 学生只拿榜单信息                                                     | `server/routes/courseware.ts`         |
| 插件 Token 白名单（前后端）               | worker / inline 两条链路都按 manifest 计算允许访问的 Token           | `packages/core/worker-runtime/`、`src/plugin-host/allowed-tokens.ts` |

> ⚠️ **升级前务必核对 `ENCRYPTION_KEY`**：它不在任何迁移里，但从 v0.3.x 起 AI Provider API Key 一律 AES-256-GCM 加密。密钥变更会导致全部 Key 无法解密。

---

## 4. 插件侧迁移（`ctx.db.migrate`）

### 4.1 签名

```ts
migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
```

定义于 `packages/core/plugin-host/types.ts` 的 `PluginDatabase` 接口，实现于 `packages/core/plugin-host/context-builder.ts`。**必须 `await`**——`upgradeFn` 可以是同步或异步，方法本身一定返回 Promise。

### 4.2 用法

版本号记录在 `plugin_migrations` 表（`plugin_id` + `version`），插件**重启后不重复执行**已应用的版本。

```ts
export default {
  manifest: { id: 'ext-my-plugin', name: 'My Plugin', version: '1.2.0', main: 'index.js' },
  async activate(ctx) {
    await ctx.db.migrate(2, async (db) => {
      // v1 → v2：新增列
      await db.exec(`ALTER TABLE my_tasks ADD COLUMN priority INTEGER DEFAULT 0`);
    });

    await ctx.db.migrate(3, (db) => {
      // v2 → v3：回填
      db.prepare(`UPDATE my_tasks SET priority = 1 WHERE priority IS NULL`).run();
    });
  },
};
```

> ⚠️ **worker 模式下 `db` 是 RPC 代理，不是 better-sqlite3 实例**。它支持 `prepare().run/get/all` 与 `exec`，但**没有 `transaction()`**。需要事务时用 `db.transaction(fn)()` 的形式调用（保留 `this` 绑定），并在 `typeof db.transaction === 'function'` 时才使用——平台自身的代码就是这么做的（如 `server/utils/auto-record-score.ts` 的 `promoteAttemptToGrade`）。
>
> ⚠️ **表名前缀在两种执行模式下相反**：inline 用 `plugin_{pluginId}_`（`pluginId` = DB 行 UUID），worker 用 `plugin_{manifestId}_`。同一插件换模式会「找不到表」。详见[插件数据库 API](../reference/plugin-database-api)与[插件开发教程](../tutorials/plugin-development-tutorial)。

### 4.3 平台数据库 vs 插件私有数据

| 需求                     | 推荐做法                                              | 反例                                   |
| ------------------------ | ----------------------------------------------------- | -------------------------------------- |
| 插件自己的业务数据       | `ctx.db.migrate()` + `ctx.db.table('foo')`（自动加前缀） | 手工拼 `plugin_xxx_` 前缀             |
| 简单键值                 | `ctx.services.storage`（`plugin_storage` 表）           | 自建 KV 表                            |
| 读平台核心表（只读查询） | `ctx.resolve(IDatabaseToken)`                          | ——                                     |

⚠️ 平台核心表的完整清单与权限边界见[平台数据表参考](../reference/platform-data-tables)——那里明确标注了「插件能否访问 `IDatabaseToken`」在文档层尚有矛盾，依赖前请先确认。

---

## 5. 升级检查清单

```bash
# 1. 停服并备份
docker compose stop app            # 或 pm2 stop openlearnv2
cp packages/core/db/educational_os.db educational_os-$(date +%F).db.bak

# 2. 拉取新版本
git pull && pnpm install --frozen-lockfile

# 3. 确认 ENCRYPTION_KEY 未变
grep ENCRYPTION_KEY .env

# 4. 启动，观察迁移日志
pnpm start 2>&1 | tee /tmp/openlearn-migrate.log
grep '\[Migration\]' /tmp/openlearn-migrate.log
# 期望：Applying/Applied 成对出现，覆盖 000..014 中尚未应用的那些

# 5. 校验
curl -fsS http://127.0.0.1:9000/health
sqlite3 packages/core/db/educational_os.db \
  "SELECT name FROM _migrations ORDER BY name;"
sqlite3 packages/core/db/educational_os.db "PRAGMA integrity_check;"

# 6. 抽查：登录、建课节、跑一次互动课件提交并手动录入成绩
```

**回滚**：把备份的 db 文件放回 `packages/core/db/` 即可（`_migrations` 表随之回退，迁移会在下次启动时重新尝试）。`009` 与 `011` 无 DOWN 段，只能靠整库备份回滚。

---

## 6. 相关源文件

| 路径                                | 内容                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `migrations/*.sql`                  | 15 条迁移（`000`–`014`）                             |
| `migrations/README.md`              | 迁移约定（⚠️ 009 的表名与脚本实际内容不符）           |
| `server/utils/migrate.ts`           | `loadMigrationsFromDirectory` / `runMigrations` / `rollbackMigration` / `simpleChecksum` |
| `server.ts`                         | 启动时触发迁移（`startServer` 内）                     |
| `packages/core/db/index.ts`         | `runStartupMigrations` / `ensureColumn` / `hashPassword` / `verifyPassword` |
| `packages/core/plugin-host/types.ts` | `PluginDatabase.migrate` 签名                         |
| `packages/core/plugin-host/context-builder.ts` | `migrate` 实现、插件 DB 前缀注入         |
| `packages/core/di/interfaces.ts`    | `IPointsDimensionRegistryToken` / `IPointsLedgerServiceToken` |
| `scripts/restore-db.ts`             | 备份枚举与恢复                                         |
| `docs/architecture/database-and-migrations.md` | 架构视角的迁移说明                     |
