# Version Migration Guide 版本迁移指南

> **当前版本**：`package.json` 为 **`0.7.7`**，`@openlearn/plugin-sdk` 为 **`3.7.4`**。
>
> 本文覆盖两类迁移：
>
> 1. **平台数据库 schema 迁移**（`migrations/000`–`043`，以 `migrations/` 目录为准）—— 服务启动时自动执行。迁移失败进程会退出，不会带着半迁移的库继续服务。
> 2. **插件侧迁移**（`ctx.db.migrate`）—— 插件作者在自己插件的 `activate` 中调用
>
> 跨版本升级时：自动迁移之外的人工步骤见下文各节；班级口令在 0.4 由启动过程加密，`ENCRYPTION_KEY`（或 `storage/encryption-key`）必须和库一起带走。迁移清单以 `migrations/README.md` 为准；下文第 2 节的表只覆盖到 `014`，是历史说明。

---

## 0. 从 v0.6.1 升级（迁移 021 / 022 / 023）

先备份再启动。启动日志里应出现 `[Migration] Applied` 或启动复查完成，并且 `_migrations` 含 `021_class_owner_and_password_gate`、`022_plugin_public_routes` 与 `023_encrypt_class_passcodes`。迁移失败时进程以非 0 退出，日志以 `[Migration] FATAL` 或 `[DB SSOT] FATAL` 开头。

### 0.1 改密

存量库若 `admin` / `teacher` 的口令仍等于用户名，启动时会把 `users.must_change_password` 置 1，**不会改写哈希**。用原口令仍能登录，但除下列路径外的 `/api` 请求（**含 GET**）返回 403 `FORBIDDEN_DEFAULT_PASSWORD`：

- `POST /api/auth/change-password`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/auth/me`

```bash
# 登录后用返回的 Cookie
curl -sS -c /tmp/ol.cj -H 'Content-Type: application/json' \
  -d '{"entrance":"teacher","username":"admin","password":"admin"}' \
  http://127.0.0.1:9000/api/auth/login

curl -sS -b /tmp/ol.cj -H 'Content-Type: application/json' \
  -d '{"oldPassword":"admin","newPassword":"换成足够长的新口令"}' \
  http://127.0.0.1:9000/api/auth/change-password
```

新口令不能与用户名相同。容器首次空库不要依赖 `admin` / `admin`：设置 `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD`，或到数据目录的 `storage/bootstrap-credentials.txt` 读取随机口令。

### 0.2 回填班级归属

迁移 021 只加列，不猜老师。`owner_user_id` 为空的班只有管理员能看见，原任课教师会以为班丢了。

```bash
# 先看哪些班没有归属（停服或不停服都可以，脚本只做短查询）
node scripts/backfill-class-owners.mjs --list

# 把所有空归属班交给用户名为 teacher 的账号（写入的是 users.id，不是用户名）
node scripts/backfill-class-owners.mjs --assign teacher

# 只改一个班
node scripts/backfill-class-owners.mjs --class <班级 id> --assign teacher
```

容器里把命令换成 `docker compose exec app node scripts/backfill-class-owners.mjs --list`。

等价 SQL：`UPDATE classes SET owner_user_id = '<教师 users.id>' WHERE owner_user_id IS NULL;`。管理员也可以 `PUT /api/classes/:id`，body 带 `owner_user_id`（教师调这个字段会 403）。

### 0.3 重新批准插件公开路由

迁移 022 建空表 `plugin_public_routes`。升级前靠 manifest `auth: false` 匿名放行的路由，升级后一律 401，直到管理员批准：

```bash
curl -sS -b /tmp/ol.cj -H 'Content-Type: application/json' \
  -d '{"approvePublicRoutes":true}' \
  http://127.0.0.1:9000/api/plugins/<插件 id 或 manifest id>/public-routes
```

省略该字段或传 `false` 会清掉这个插件已批准的公开路由。安装新插件时在请求体加 `approvePublicRoutes: true`，或带头 `x-approve-public-routes: true`。

### 0.4 班级临时口令改为密文（迁移 023）

这一节记录的是 **v0.6.1 tag 之后那段窗口**的升级步骤（历史说明）；当前平台版本见文首，早已越过该窗口。

`migrations/023_encrypt_class_passcodes.sql` 是标记，不改写 `classes.class_passcode`。SQL 读不到 `ENCRYPTION_KEY`，只创建单行表 `_class_passcode_encryption`，表示这一列按密文约定存储，并在 `_migrations` 记下 `023_encrypt_class_passcodes`。

真正加密发生在数据库初始化：`packages/core/db/index.ts` 的 `initializeDatabase` 在跑完 SQL 之后调用 `applyStartupDataMigrations`，它再调用 `packages/core/db/class-passcode-crypto.ts` 里的 `encryptStoredClassPasscodes()`。

- 非空、且还不是合法 `olenc1:` 密文的行，用与 AI Provider API Key 相同的 AES-256-GCM 密封，前缀为 `olenc1:`。
- 已经是合法 `olenc1:` 密文的行跳过。重复启动不会再包一层。
- 空口令保持为空。
- 有行被加密时，日志是 `[Migration] 已加密 N 条班级临时口令（跳过已加密 M 条）`。没有明文行时不打这条日志。

钥匙：设置了 `ENCRYPTION_KEY` 就用环境变量；否则用数据目录里的 `storage/encryption-key`（与 `storage/bootstrap-credentials.txt` 同目录）。换钥匙或丢掉这个文件，已加密的班级口令和 API Key 都解不开。`scripts/site-backup.mjs` 打出来的数据库快照里是密文，文件包排除 `storage/encryption-key`，钥匙要单独离线备份。

谁看得到原文：

- 教师或管理员调用 `GET /api/classes/:id/passcode-setting`，响应里的 `class_passcode` 是解密后的原文。
- 教师或管理员调用 `GET /api/classes/:id/passcode`，响应里的 `classPasscode` 也是原文。口令为空或已过期时，这个接口会签发新口令再密封写回，不要拿它当只读抽查。
- 班级列表会去掉 `class_passcode`，不返回明文，也不返回密文。
- 访问日志和审计日志不保留口令字段；正文里的 `olenc1:` 密文片段会被抹掉。
- 学生登录先解密，再做常量时间比较。登录响应里没有口令，也没有密文。

`-- DOWN` 只删除标记表 `_class_passcode_encryption`，不能把密文还原成明文。回滚应用代码之前，恢复迁移前的数据库快照，并带上同一把钥匙。

升级后确认：

```bash
sqlite3 packages/core/db/educational_os.db \
  "SELECT name FROM _migrations WHERE name LIKE '023%';"
sqlite3 packages/core/db/educational_os.db \
  "SELECT id FROM classes WHERE class_passcode IS NOT NULL AND class_passcode != '' AND class_passcode NOT LIKE 'olenc1:%';"
```

第一句应返回 `023_encrypt_class_passcodes`。第二句应为空：非空口令都已经带 `olenc1:` 前缀。

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

迁移 SSOT 在 `packages/core/db/migrator.ts`（`server/utils/migrate.ts` 仅是兼容转发）；`server.ts` 启动复查之后还会接 `assertSchemaMatchesGolden`（`schema-golden.json` 金样终检，见 #294），以及 `runStartupMigrations`（`server/bootstrap-db.ts`：旧内置插件升级与过期会话清理，非版本化、独立于 `_migrations`）。

> ✅ 迁移失败**会阻止服务启动**——`server.ts` 打出 `[Migration] FATAL` 后 `throw`，进程退出，不在半迁移的库上提供服务（快照创建失败同样中止）。部署后确认启动日志出现 `[Migration] 启动复查完成：…（N 个文件）` 与 `[SchemaGolden] 启动终检通过`。

### 1.2 迁移运行器语义（`packages/core/db/migrator.ts`，SSOT）

| 行为       | 实现                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件排序   | `loadMigrationsFromDirectory` 用 `localeCompare(a, b, { numeric: true })`，**数字序而非字典序**                                                          |
| 幂等       | `_migrations` 表记录已应用的 `name`，已应用则 `continue` 跳过                                                                                            |
| 断点续跑   | 单条失败即 `throw`，中断整个循环；重启后从未应用的那条继续                                                                                               |
| 重复列容错 | `executeSqlStatements` 捕获 `duplicate column name` 并 `continue`（`warn` 不中断）                                                                       |
| 校验和     | `simpleChecksum`（djb2 变体，32 位）写入 `_migrations.checksum`，**每次启动与已应用记录比对**：漂移默认告警，`MIGRATION_CHECKSUM_STRICT=true` 时直接抛错 |
| 未知台账   | 台账条目在迁移目录中不存在时（库比代码新/迁移被改名），启动链路（`strictLedger`）FATAL 拒绝启动；`MIGRATION_ALLOW_UNKNOWN_LEDGER=true` 显式放行降级运维  |
| 迁移前快照 | 应用 pending 迁移前 `VACUUM INTO` 一致性快照到 `backups/pre_migration_*.db`（600 权限），失败即中止；保留份数 `PRE_MIGRATION_KEEP`（默认 5）             |
| 回滚       | `rollbackMigration` 需要迁移提供非空 `-- DOWN` 段，否则 `throw`                                                                                          |
| 影子表     | 个别迁移（如 `012`）在自己的 SQL 里建 `*__rollback` 临时表用于数据搬迁，搬完保留（勿当业务表读）                                                         |

`_migrations` 表结构：`name TEXT PRIMARY KEY` / `applied_at INTEGER NOT NULL` / `checksum TEXT NOT NULL`。

> ⚠️ **已执行迁移的 UP 脚本不可修改**。每次启动都会把已应用记录的 checksum 与当前文件比对：默认在日志告警漂移，`MIGRATION_CHECKSUM_STRICT=true`（升级回归 CI 即此模式）直接抛错拒绝启动。正确做法永远是新增一条迁移，不要改旧文件。

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

| 序号  | 文件                                | 建表                                                                                                                                                                              | 关键增量                                                                                                                                | 有 DOWN |
| ----- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | :-----: |
| `000` | `000_initial_schema.sql`            | 内核初始 schema（`events` / `users` / `client_sessions` / `plugins` / `vfs_nodes` / `processes` / `pending_commands` 等）                                                         | —                                                                                                                                       |   ✅    |
| `001` | `001_add_execution_mode.sql`        | —                                                                                                                                                                                 | `plugins.execution_mode`（`inline` / `worker`，默认 `inline`）                                                                          |   ✅    |
| `002` | `002_add_client_session_expiry.sql` | —                                                                                                                                                                                 | `client_sessions.expires_at`（会话绝对过期）                                                                                            |   ✅    |
| `003` | `003_classroom_runtime.sql`         | `student_rollcalls` / `site_settings` / `agent_conversations`                                                                                                                     | 随机点名、站点设置、AI 对话记忆                                                                                                         |   ✅    |
| `004` | `004_courseware_score_config.sql`   | `courseware_score_config`                                                                                                                                                         | 课件成绩归集策略；`courseware_id = '*'` 为全局默认                                                                                      |   ✅    |
| `005` | `005_assignment_hub.sql`            | `plugin_assignments` / `plugin_submission_versions` / `plugin_assignment_files` / `plugin_peer_review_tasks`                                                                      | 作业升为一等实体；重交留档不丢历史；`assignment_submissions` 等表加 `assignment_id` / `task_id` / `anonymous` / `status` / `updated_at` |   ✅    |
| `006` | `006_classroom_event_bus.sql`       | —                                                                                                                                                                                 | `events` 补课堂维度：加 `lesson_id` 列与 `(type,timestamp)` / correlationId / `(lesson_id,timestamp)` 索引                              |   ✅    |
| `007` | `007_interactive_classroom.sql`     | `lesson_quiz_submissions` / `classroom_sessions` / `classroom_quick_polls` / `classroom_poll_votes` / `classroom_buzzers` / `classroom_exit_tickets` / `classroom_pacing_signals` | 互动课堂与课节生命周期                                                                                                                  |   ✅    |
| `008` | `008_teaching_modes.sql`            | `teaching_modes`                                                                                                                                                                  | `classroom_sessions.teaching_mode_id`；内置模式定义在代码常量，**不 seed**                                                              |   ✅    |
| `009` | `009_classroom_peer_review.sql`     | `classroom_peer_review_tasks` / `classroom_peer_reviews` / `classroom_peer_badges` / `classroom_peer_nominations` / `classroom_danmaku` / `classroom_peer_rubric_dimensions`      | 课中全班大屏互评（**课堂为中心**，随 session 生命周期）                                                                                 |   ❌    |
| `010` | `010_class_groups.sql`              | `class_groups`                                                                                                                                                                    | 班级固定分组；`member_ids` / `leader_id` 用 JSON 存整组，`is_default` 标记上课默认方案                                                  |   ✅    |
| `011` | `011_classroom_feed.sql`            | `classroom_feed`                                                                                                                                                                  | 课堂动态流落库，教师重进课堂可按 lesson 回放（此前是纯前端内存态，上限 50 条）                                                          |   ❌    |
| `012` | `012_auto_record_score.sql`         | —                                                                                                                                                                                 | `courseware_score_config` 加 `auto_record_enabled`（默认 **0 关闭**）/ `auto_record_min_completion`                                     |   ✅    |
| `013` | `013_score_source_strategy.sql`     | —                                                                                                                                                                                 | `assignment_submissions.source`（`manual` / `auto`）+ `courseware_score_config.auto_record_strategy`（`latest` / `highest`）            |   ✅    |
| `014` | `014_performance_indexes.sql`       | —（**只建索引**）                                                                                                                                                                 | `vfs_nodes(parent_id)` / `plugin_submissions(lesson_id)` / `student_point_logs(student_id)` / `student_rollcalls(class_id, student_id)` |   ✅    |

**没有 DOWN 段的两条**：`009` 与 `011`。`rollbackMigration` 对它们会直接 `throw`。

---

## 3. 跨版本升级断点（v0.1.x → v0.5.0）

下面按**破坏性**程度排列需要注意的断点。所有涉及写操作的迁移都应先备份 `educational_os.db`。

### 3.1 会话从无过期变为有绝对过期（`002`）

`client_sessions` 新增 `expires_at`。升级后**已存在的会话行该列为 `NULL`**，服务端视为「不过期」，按 `updated_at` 的 24 小时空闲超时兜底。存量会话在空闲超时后自然失效，**不会造成全员掉线**。

### 3.2 插件执行模式从隐式到显式（`001`）

`plugins.execution_mode` 默认 `inline`。存量插件全部落在 `inline`——**即旧行为不变**。若要把第三方插件切到 worker 隔离模式，需管理员显式改值并重启。

> ℹ️ 两种模式的 `db.table()` 表前缀**是一致的**（均为 `plugin_<scopeId>_`，取决于安装主键而非执行模式）。历史版本曾按 `manifestId` 建表，那些旧表只在卸载清理时兼容识别。详见[插件数据库 API](../reference/plugin-database-api.md)。

### 3.3 随堂练习作答改用关系表（`007`）

`lesson_quiz_submissions` 成为**唯一权威数据源**。升级前把 `submissions` 写回 `whiteboard_elements.data` JSON 的历史数据**不会被自动搬迁**——那些数据仅作为存量展示兜底保留。

**升级后必须做**：若依赖历史随堂练习统计，需自行从 `whiteboard_elements.data.submissions` 抽取数据导入新表。表结构与唯一约束见[平台数据表参考](../reference/platform-data-tables.md)。

### 3.4 课堂事件进入内核总线（`006`）

`events` 表新增 `lesson_id` 列与三组索引。此迁移**不改变任何既有调用方**——`server/event-routing.ts` 的路由表本来就同时驱动总线与 Socket 投递。

**可见变化**：`events` 从「只有内核事件」变成「课堂事实日志」，可按时间窗口 / `correlationId` / `lessonId` 三种维度查询。数据量会显著增长，磁盘占用需纳入监控。

### 3.5 成绩录入从「逐条手动」升级为「规则自动」（`012` + `013`）

这是 v0.1.x 之后**对教学数据影响最大**的一组变更：

| 迁移  | 变更                                                                                                   | 兼容性                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `012` | `courseware_score_config` 加 `auto_record_enabled`（**默认 0 = 关闭**）与 `auto_record_min_completion` | ✅ 默认关闭，**升级后行为与旧版完全一致**；教师需显式开启                                    |
| `013` | `assignment_submissions` 加 `source` 列（`manual` / `auto`），并回填存量数据                           | ✅ 回填规则：自动路径写入的 `feedback` 以「由自动录入规则。」开头，据此判定；其余为 `manual` |

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

| 变更                                      | 现状                                                                                 | 源码位置                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 密码哈希升级为 bcrypt                     | `verifyPassword` 兼容旧 SHA-256，`needsUpgrade: true` 时自动重算                     | `packages/core/db/index.ts`                                          |
| 会话改为不透明 Cookie + 查表              | 令牌是 `client_sessions` 表主键，**不是 JWT**                                        | `server/middleware/auth.ts`                                          |
| 强制改密门控                              | 种子账号带 `mustChangePassword`，除改密、登出、会话查询外的 `/api`（含 GET）一律 403 | `enforcePasswordChanged`                                             |
| CSRF 门控                                 | 写请求按 `Sec-Fetch-Site` 判定，`cross-site` 走豁免清单                              | `server/middleware/csrf.ts`                                          |
| 前端 `setSocketBridge` 死代码被删除       | 白板事件**不再跨端转发**（从来就没生效过）                                           | `src/services/event-bus.ts`                                          |
| 课件 HTML 改用 `?ct=` 短时令牌鉴权        | 沙箱 iframe 不带 cookie 的替代方案                                                   | `server/utils/courseware-access.ts`                                  |
| 成绩榜对学生脱敏 `extra_json` / `comment` | 学生只拿榜单信息                                                                     | `server/routes/courseware.ts`                                        |
| 插件 Token 白名单（前后端）               | worker / inline 两条链路都按 manifest 计算允许访问的 Token                           | `packages/core/worker-runtime/`、`src/plugin-host/allowed-tokens.ts` |

> ⚠️ **升级前务必核对 `ENCRYPTION_KEY`**：从 v0.3.x 起 AI Provider API Key 一律 AES-256-GCM 加密。迁移 `023` 起，班级临时口令也用同一把钥匙加密（前缀 `olenc1:`）。未设置环境变量时，钥匙在 `storage/encryption-key`。密钥变更会导致 API Key 和班级口令都无法解密。`site-backup` 不包含该文件，要单独备份。

---

## 4. 插件侧迁移（`ctx.db.migrate`）

### 4.1 签名

```ts
migrate(targetVersion: number, upgradeFn: (db: any) => Promise<void> | void): Promise<void>;
```

定义于 `packages/core/plugin-host/types.ts` 的 `PluginDatabaseAPI` 接口，实现于 `packages/core/plugin-host/context-builder.ts`。**必须 `await`**——`upgradeFn` 可以是同步或异步，方法本身一定返回 Promise。

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
> ℹ️ **表名前缀与执行模式无关**：统一为 `plugin_<scopeId>_` —— 外部插件取 `plugins` 表行 UUID，内置插件取规范 id。切换执行模式**不会**让表名变化。历史上按 `manifestId` 建的表只用于卸载清理与兼容放行。详见[插件数据库 API](../reference/plugin-database-api.md)与[插件开发教程](../tutorials/plugin-development-tutorial.md)。

### 4.3 平台数据库 vs 插件私有数据

| 需求                     | 推荐做法                                                 | 反例                      |
| ------------------------ | -------------------------------------------------------- | ------------------------- |
| 插件自己的业务数据       | `ctx.db.migrate()` + `ctx.db.table('foo')`（自动加前缀） | 手工拼 `plugin_xxx_` 前缀 |
| 简单键值                 | `ctx.services.storage`（`plugin_storage` 表）            | 自建 KV 表                |
| 读平台核心表（只读查询） | `ctx.resolve(IDatabaseToken)`                            | ——                        |

⚠️ 平台核心表的完整清单与权限边界见[平台数据表参考](../reference/platform-data-tables.md)——那里明确标注了「插件能否访问 `IDatabaseToken`」在文档层尚有矛盾，依赖前请先确认。

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
# 期望：Applying/Applied 成对出现，覆盖尚未应用的迁移
# 从 v0.6.1 tag 窗口升级时，还要有 021、022、023，见第 0 节（历史说明）

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

| 路径                                           | 内容                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `migrations/*.sql`                             | 版本化 SQL。完整清单见 `migrations/README.md`；第 2 节表只列到 `014`                                 |
| `migrations/README.md`                         | 迁移约定（⚠️ 009 的表名与脚本实际内容不符）                                                          |
| `server/utils/migrate.ts`                      | `loadMigrationsFromDirectory` / `runMigrations` / `rollbackMigration` / `simpleChecksum`             |
| `server.ts`                                    | 启动时触发迁移（`startServer` 内）                                                                   |
| `packages/core/db/index.ts`                    | `initializeDatabase`（SQL 之后调用 `applyStartupDataMigrations`）/ `hashPassword` / `verifyPassword` |
| `packages/core/db/class-passcode-crypto.ts`    | 启动时把仍是明文的 `classes.class_passcode` 密封为 `olenc1:`                                         |
| `packages/core/plugin-host/types.ts`           | `PluginDatabaseAPI.migrate` 签名                                                                     |
| `packages/core/plugin-host/context-builder.ts` | `migrate` 实现、插件 DB 前缀注入                                                                     |
| `packages/core/di/interfaces.ts`               | `IPointsDimensionRegistryToken` / `IPointsLedgerServiceToken`                                        |
| `scripts/restore-db.ts`                        | 备份枚举与恢复                                                                                       |
| `docs/architecture/database-and-migrations.md` | 架构视角的迁移说明                                                                                   |
