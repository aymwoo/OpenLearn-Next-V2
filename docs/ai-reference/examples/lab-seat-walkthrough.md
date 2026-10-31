# 真实插件解剖：`@aymwoo/plugin-lab-seat` 0.6.3

> 读者：要写一个**带数据库 + 带 UI + 带跨插件服务**的插件的 AI Agent。
> 本文不是教程，是**解剖报告**：每个设计点都给出源码坐标，并标注「可抄」或「别抄」。
> 坐标约定：无前缀的路径相对**本仓库** `openlearn-next` 根；`[P]` = 外部示例插件仓库 `openlearn-plugin-lab-seat`。

---

## 0. 为什么拿它当样本

| 维度 | 值 | 取证 |
| --- | --- | --- |
| 代码量 | 后端 1461 行 + 前端 1556 行 + 2 个纯函数模块（184 + 23 行） | `[P] src/index.ts`、`src/frontend.tsx`、`src/smart-assign.ts`、`src/csv.ts` |
| 执行模式 | `inline`（受信内置插件） | `[P] plugin.contract.json` → `executionMode` |
| UI 通道 | `inline-react` | 同上 → `uiChannel` |
| 槽位 | 4 个：`classroom.tool`、`student.view`、`teacher.dashboard.widget`、`teacher.tab` | 同上 → `slots[]`，实现见 `[P] src/frontend.tsx` L1518-1552 |
| 命令 | 27 个 `registerHandler` | `grep -c "commandBus.registerHandler" src/index.ts` → 27 |
| Action 描述符 | 27 条（8 条具名 + 19 条批量补齐） | `[P] src/index.ts` L397/476/778/873/960/983/1115/1149 + `MISSING_ACTIONS` L1419 |
| 自建表 | 5 张（全部经 `ctx.db.table()`，真实前缀 `plugin_<scopeId>_`，上传插件的 scopeId 是 UUID） | `[P] src/index.ts` L193-277 |
| 读写的平台表 | 1 张写（`computer_labs`，反例）+ 3 张只读 JOIN（`lessons` / `users` / `class_students`） | `[P] src/index.ts` L175、L347、L355 |

选它的理由：它同时踩过**「有 handler 无描述符 → 403」**、**「worker 下 `ctx.config` 不存在」**、
**「`provide` 只在主进程可用」**、**「React 必须运行期注入」**这四类真实坑，且每处都在注释里留了复盘。

---

## 1. 工程骨架与构建产物

```text
openlearn-plugin-lab-seat/
├── package.json              # scripts 转发到 openlearn-plugin-sdk
├── plugin.contract.json      # 交付侧 UI 通道声明（非平台 schema 字段）
├── src/
│   ├── index.ts              # 后端入口，default export { manifest, activate, deactivate }
│   ├── frontend.tsx          # 前端入口，default export { activate, deactivate }
│   ├── smart-assign.ts       # 纯函数：约束解析 / 排序 / 提示词
│   └── csv.ts                # 纯函数：RFC 4180 转义
├── test/                     # node:test 自建 harness（非 vitest）
├── test-harness/
│   ├── slot-registry.json    # 槽位白名单快照（静态检查用）
│   └── static-check.mjs      # 52KB，L0 静态检查实现
└── dist/
    ├── index.js              # 227 KB（esbuild 单文件，bundled）
    ├── frontend.js           # 222 KB
    └── openlearn-plugin-lab-seat.zip   # 452 KB，可直接上传安装
```

**产物三件套**：`dist/index.js` + `dist/frontend.js` + 由 SDK 打包的 `manifest.json`（内嵌于 ZIP）。
ZIP 内**不含** `src/`、`test/`、`storage/`、`migrations/`（`packages/*/sdk` 打包白名单逻辑，见
[ui-extension-guide.md](../development/ui-extension-guide.md) §4 与
[registration-and-loading.md](../plugin-system/registration-and-loading.md) §2）。

`package.json` 只有一个运行期依赖（`[P] package.json`）：

```json
"dependencies": { "@openlearn/plugin-sdk": "^3.5.2" }
```

`better-sqlite3` / `express` / `pino` / `uuid` 全在 `devDependencies` —— 它们的运行期实例由宿主注入，
插件包里**不重复打包**。这一点与 [getting-started.md](../development/getting-started.md) §3 的
「`uuid`/`zod` 必须显式装」并不冲突：那两个是**构建期**要 bundle 进产物的库，`better-sqlite3` 属原生模块不可 bundle。

---

## 2. manifest 逐项（`[P] src/index.ts` L96-161）

| 字段 | 真实值 | 说明 |
| --- | --- | --- |
| `id` | `@aymwoo/plugin-lab-seat` | 含 `/` 含 `@`，**不含 `:`**（`:` 被 zod refine 拦） |
| `version` | `0.6.3` | 与 `plugin.contract.json`、`package.json` 三处同步 |
| `main` | `index.js` | 相对 ZIP 根；必填 |
| `engines.openlearn` | `>= 0.1.0` | 宽松下限，宿主 0.7.8 满足 |
| `requires` | 4 条：`ICommandBusService` / `IActionRegistryService` / `IEventBusService` / `IDatabase` | 全是 `@^1.0.0`，全部 `@openlearn/core:` 命名空间 |
| `optional` | 1 条：`IPointsLedgerService@^1.0.0` | 缺失不阻塞激活 |
| `provides` | `@aymwoo/plugin-lab-seat:ILabSeatService` | 自己命名空间下的服务名 |
| `capabilitiesProposed` | `lesson:read` / `lesson:write` / `management:read` / `student:write` | 4 条，全部在 19 条真值内 |
| `configuration.properties` | 5 个 integer：`points_per_check_in`(5)、`late_threshold_minutes`(10)、`auto_mark_leave_after_minutes`(0)、`late_auto_promote_after_minutes`(0)、`auto_scan_interval_seconds`(60, min10 max3600) | 全部带 `default` |
| `updateSource` | `{ type: 'github-release', repo: 'aymwoo/OpenLearn-Next-V2' }` | 自行更新通道 |

**三个值得抄的点**

1. **`optional` 而不是 `requires` 声明积分服务**（L110-112）。配套写法是消费处 `try/catch` 静默跳过
   （L1279-1285）—— 声明 `requires` 会让「没装积分插件」直接变成激活失败。
2. **`configuration` 每项都给 `default`**。这让 `activate` 里可以安全降级：
   `ctx.config` 不存在时回落到 `manifest.configuration.properties[key].default`（L281-285）。
3. **`provides` 用自己命名空间**（`@aymwoo/...`），不冒充 `@openlearn/core:...`。
   服务名与 Token 标识符**逐字一致**：

```ts
// [P] src/index.ts L49
const ILabSeatServiceToken = new Token<ILabSeatService>('@aymwoo/plugin-lab-seat:ILabSeatService');
```

---

## 3. `activate` 的 14 段落地图

`activate` 从 L163 到 L1451，约 1290 行。它不是线性流程，而是「先建表 → 再注册」的瀑布。
下表按源码顺序给出职责与坐标，供改写时对照。

| # | 段落 | 行范围 | 做什么 | 可抄 |
| --- | --- | --- | --- | --- |
| 0 | 取服务 | L164-170 | `ctx.services.{commandBus,actionRegistry,eventBus}` + `ctx.resolve(IDatabaseToken)` 拿原生 sqlite 句柄 | ✅ |
| 1 | 平台表补列 | L175-191 | `CREATE TABLE IF NOT EXISTS computer_labs` + 3 条 `ALTER TABLE` 幂等补列 | ⚠️ 见 §4.3 |
| 2 | 迁移 v1 | L193-247 | 4 张表：`seat_assignments` / `attendance_records` / `check_in_sessions` / `seat_templates` | ✅ |
| 3 | 迁移 v2 | L248-277 | `lesson_room_map` + 6 个索引 | ✅ |
| 4 | 配置读取器 | L281-285 | `ctx.config` 缺失时回落 manifest 默认值（**取值方式有缺陷，见 §7**） | ⚠️ |
| 5 | 表名常量 | L287-292 | 1 张平台表字面量 + 5 个 `ctx.db.table()` | ✅ |
| 6 | 辅助函数 | L295-391 | `uid()`、`getResearchGroups()`、`getStudentsByLesson()`、`getLabLayout()`、`getStudentSeatForLesson()` | ✅ |
| 7 | 机房 CRUD + 排座 | L397-659 | 5 命令；排座支持 `sequential/random/grouped` 三策略 | ✅ |
| 8 | 多机房 + 座位调整 | L660-739 | `add/remove/move/unassign/list_lesson_labs` | ✅ |
| 9 | 签到会话 | L740-869 | open/close/check_in/manual/active | ✅ |
| 10 | 考勤查询与导出 | L873-1114 | 含 CSV 导出、按班出勤趋势 | ✅ |
| 11 | 模板与智能排座 | L1115-1246 | `shuffle_seats`、`smart_assign_seats`（AI 约束）、模板存取 | ✅ |
| 12 | 事件 → 积分 | L1272-1289 | 订阅自己发的 `student_checked_in`，加积分 | ⚠️ 见 §5.4 |
| 13 | `provide` 跨插件服务 | L1291-1337 | 4 个方法，`typeof ctx.provide === 'function'` 守卫 | ✅ |
| 14 | 定时扫描 + 批量补描述符 | L1339-1450 | `auto_mark_absent` + 19 条 `MISSING_ACTIONS` 注册 | ✅ 见 §5.2 |

---

## 4. 数据层：两种表、两个 API、两段迁移

### 4.1 自建表必须走 `ctx.db.table()`

```ts
// [P] src/index.ts L288-292
const T_ASSIGN   = ctx.db.table('seat_assignments');
const T_ATTEND   = ctx.db.table('attendance_records');
const T_SESSIONS = ctx.db.table('check_in_sessions');
const T_TEMPLATES = ctx.db.table('seat_templates');
const T_LESSON_ROOMS = ctx.db.table('lesson_room_map');
```

`ctx.db.table(suffix)` 返回**已限域表名**：`plugin_<scopeId>_<suffix>`，
其中 `scopeId` 是 `plugins` 表主键 —— 内置插件用规范化 id（如 `plugin__openlearn_plugin_vfs_`），
上传插件用安装生成的 UUID（`packages/core/plugin-host/plugin-tables.ts → pluginTablePrefix（L11）`）。
**不要假设前缀里出现 `manifest.id`**；也不要手拼，否则 SQL 守卫的 `ownPrefix` 比对与卸载清理都会失配。

> 注：`[P] test/plugin.test.mjs` 的 mock 把前缀写成 `plugin_lab_seat_`，那是测试里的简化，
> **真实安装下不成立** —— 这是「自建 mock 会漂移」的具体例证（见 §10）。
所有 DDL 与 DML 都用插值写：`CREATE TABLE IF NOT EXISTS ${ctx.db.table('seat_assignments')} (...)`。

**不要在 SQL 里手拼前缀** —— `ctx.db.table()` 同时承担 uninstall 的 `dropAllTables()` 回收清单登记。

### 4.2 迁移必须 `await`，且版本号单调

```ts
// [P] src/index.ts L193
await ctx.db.migrate(1, async (sqliteDb: any) => { ... });   // L248: await ctx.db.migrate(2, ...)
```

`sqliteDb` 是原生 `better-sqlite3` 句柄（同步 API），`ctx.db.xxx` 是异步封装。
本插件**两者混用**：DDL 走 `ctx.db.migrate`，DML 走 `ctx.resolve(IDatabaseToken)` 拿到的 `rawDb`。
混用是合法的，但必须清楚区别：

| 入口 | 同步/异步 | 事务边界 | 用途 |
| --- | --- | --- | --- |
| `ctx.db.migrate(v, fn)` | `await` | 整体一个事务，抛错回滚 | 建表/建索引，只增不改 |
| `ctx.db.table(name)` | 同步 | — | 取限域表名 |
| `rawDb.prepare().run/get/all` | 同步 | 每条语句自动提交 | 业务读写、跨表 JOIN |

详细签名见 [context-and-services.md](../plugin-system/context-and-services.md) §5。

### 4.3 「复用平台表」是反例，不要照抄

```ts
// [P] src/index.ts L175-191 —— 反例
rawDb.exec(`CREATE TABLE IF NOT EXISTS computer_labs (...)`)
try { rawDb.prepare("ALTER TABLE computer_labs ADD COLUMN name TEXT DEFAULT ''").run(); } catch {}
```

问题有三层：

1. **违反表归属，且只在 `inline` 下侥幸成立**。SQL 守卫 `assertPluginSqlAllowed` 的唯一调用方是
   `packages/core/worker-runtime/service-host.ts` L1216，也就是说它**只拦 `process` / `worker` 两种模式**。
   `lab-seat` 是 `inline` 受信插件，直接拿主进程 `better-sqlite3` 实例，守卫根本不介入。
   同一份代码改成非受信插件（强制 `process`），会因表前缀不匹配自身 `plugin_<scopeId>_` 而被拒。
   详见 [capabilities-and-security.md](../plugin-system/capabilities-and-security.md) §4 的作用面表。
2. **`try/catch {}` 吞掉一切**。列已存在、权限不足、库只读 —— 三种完全不同的失败被压成同一个静默分支。
3. **没有版本登记**。补列靠「试一下，失败就算了」，平台升级后列语义变化无人知晓。

正确做法：把机房布局落到自己的 `ctx.db.table('rooms')`，需要平台数据时**只读 JOIN**：

```ts
// [P] src/index.ts L355-361 —— 只读 JOIN 平台表，可抄
rawDb.prepare(`
  SELECT u.id, u.name FROM class_students cs
  JOIN users u ON u.id = cs.student_id
  WHERE cs.class_id IN (${placeholders}) AND u.role = 'student'
  GROUP BY u.id
`).all(...classIds);
```

---

## 5. 27 个命令与 27 条描述符：一次真实事故的完整复盘

### 5.1 配比真相

| 项 | 数量 | 证据 |
| --- | --- | --- |
| `commandBus.registerHandler(...)` 调用 | **27** | L415, 443, 454, 467, 495, 660, 681, 690, 700, 711, 721, 740, 762, 792, 841, 854, 887, 914, 973, 998, 1064, 1129, 1167, 1225, 1238, 1247, 1397 |
| `actionRegistry.register(...)` 调用点 | **9** | 8 处具名（L397, 476, 778, 873, 960, 983, 1115, 1149）+ 1 处循环（L1441） |
| 最终描述符条数 | **27** | 8 + `MISSING_ACTIONS.length`(19) |

「9 个调用点 ≠ 9 条描述符」，是因为最后一处是 `for (const a of MISSING_ACTIONS) register(...)`。

### 5.2 事故：19 个命令被 default-deny 挡死

源码注释直接写明了（`[P] src/index.ts` L1412-1418）：

> 内核对命令派发实行 default-deny：commandBus 的 interceptor 会查 `actionRegistry.getActionByCommandType()`，
> 查不到就抛 `COMMAND_NOT_REGISTERED`（HTTP 403，前端表现为「点了没反应」）。
> **此前只有 8 个命令登记了描述符，其余命令一律被拒** —— 这里按语义批量补齐。

内核侧对应实现：`packages/core/kernel/index.ts` L303-401 的 interceptor，`else` 分支
（L372-400）构造 `err.status = 403; err.code = 'COMMAND_NOT_REGISTERED'`。

**根因不是漏写，而是「handler 与描述符分两处维护、无任何一致性检查」**。早期版本没有 default-deny，
漏写描述符只意味着「AI 看不见这个命令」，功能照跑；内核改成 default-deny 后，同一份代码立刻全量 403。

**批量补齐的写法**（L1419-1448，可抄）：

```ts
const MISSING_ACTIONS: Array<{ commandType: string; description: string; capabilityRequired: string }> = [
  { commandType: 'lab_seat.update_layout', description: '更新机房的行列布局与座位编号', capabilityRequired: 'lesson:write' },
  // … 共 19 条
];
for (const a of MISSING_ACTIONS) {
  await actionRegistry.register({
    id: a.commandType.replace('lab_seat.', 'lab_seat-'),
    commandType: a.commandType,
    description: a.description,
    capabilityRequired: a.capabilityRequired,
    inputSchema: { type: 'OBJECT', properties: {} },   // 只做对象形状守卫
  });
}
```

**为什么 `inputSchema` 留空 properties**：payload 必填校验仍在各 handler 内部完成，
若在此写 `required`，schema 与 handler 一旦不同步会把**本来能跑**的命令也挡掉。
注意这里的 `'OBJECT'` 是**全大写**才有校验效果 —— 写成小写 `'object'` 等于完全不校验，
对照表见 [api-reference.md](../development/api-reference.md) §4.3。

### 5.3 自查命令（写插件时必须跑）

```bash
# 有 handler 无描述符的命令 → 上线即 403
diff <(grep -oP "registerHandler\('\K[^']+" src/index.ts | sort) \
     <(grep -oP "commandType: '\K[^']+" src/index.ts | sort)
```

平台侧另有审计脚本：`scripts/plugin-command-audit.mjs`（内核注释 L386 明确提到）。

### 5.4 命令实现的四个可抄范式

**① 身份从 `command.actorId` 取，不从 payload 取**

```ts
// [P] src/index.ts L793-796
async execute(command) {
  const p = command.payload as any;
  const studentId = command.actorId;      // ← 身份
  const lessonId = p.lessonId;            // ← 参数
```

payload 是调用方（含 AI Agent）可控的；`actorId` 由宿主 `server/middleware/auth.ts getActorId` 生成。
用 `p.studentId` 做签到归属，等于允许学生替别人签到。

**② 业务错误用 `labError(code, message)`，`never` 返回**

```ts
// [P] src/index.ts L75-86
export class LabSeatError extends Error {
  code: LabSeatErrorCode;
  constructor(code: LabSeatErrorCode, message: string) {
    super(`[lab_seat:${code}] ${message}`);   // 前缀 = 可 grep 的稳定锚点
    this.name = 'LabSeatError';
    this.code = code;
  }
}
export function labError(code: LabSeatErrorCode, message: string): never { throw new LabSeatError(code, message); }
```

11 个 code 全在类型联合里（L62-73），拼错即编译失败。message 用中文保持对最终用户可读。
范式细节见 [error-handling-and-cleanup.md](../plugin-system/error-handling-and-cleanup.md) §3。

**③ 幂等先查后写**

```ts
// [P] src/index.ts L806-811
const existing = rawDb.prepare(`SELECT * FROM ${T_ATTEND} WHERE lesson_id = ? AND student_id = ?`)
  .get(lessonId, studentId);
if (existing) return { message: '已签到', status: existing.status, checkedInAt: existing.checked_in_at };
```

**④ 写成功再发事件，事件带 `correlationId: command.id`**

```ts
// [P] src/index.ts L831-835
await eventBus.publish({
  id: uid(), type: 'lab_seat.student_checked_in', source: `plugin.${pluginId}`,
  payload: { lessonId, studentId, status, checkedInAt: now },
  timestamp: now, correlationId: command.id,
});
```

`PlatformEvent` 六个字段全部必填（`correlationId` 可选但强烈建议），
定义见 `packages/plugin-sdk/openlearn.d.ts` `interface PlatformEvent`。
`source` 用 `plugin.${ctx.pluginId}`（DB 行 UUID，不是 `manifest.id`）。

**本插件发布的 5 个事件**：`room_created`、`seats_assigned`（3 处）、`check_in_opened`、
`attendance_closed`、`student_checked_in`。

---

## 6. 跨插件能力：`provide` / `optional` / 只读跨表

### 6.1 `provide` 必须做函数存在性守卫

```ts
// [P] src/index.ts L1293-1296
// Worker runtime 不支持 provide，仅主进程生效
if (typeof (ctx as any).provide === 'function') {
  await (ctx as any).provide(ILabSeatServiceToken as any, { ...4 个方法 });
}
```

`provide` **在 `PluginContext` 类型声明里是必填方法**：

```ts
// packages/core/plugin-host/types.ts → PluginContext（L227）
provide<T>(token: Token<T>, instance: T): Promise<void>;
```

**结论已取证**：`process` / `worker` 下 `ctx.provide` **确实不存在** ——
`packages/core/worker-runtime/service-host.ts` 与 `service-proxy.ts` 两个文件里
没有任何 `provide` 的实现或 RPC 分支（`grep -n "provide"` 只命中注释里的 "provided"）。
代理层没暴露该方法，直接调用会 `TypeError` 并让激活失败。
所以 `typeof ctx.provide === 'function'` 守卫防的是**运行期缺方法**，不是类型缺失；
`as any` 只为兼容老版本 SDK 的打包类型。这条守卫必须写。

### 6.2 消费方如何取

```json
// 消费方 manifest
"requires": ["@aymwoo/plugin-lab-seat:ILabSeatService@^0.6.0"]
```

```ts
const svc = await ctx.resolve(ILabSeatServiceToken);   // 需自己复刻同名 Token
```

Token 标识符必须**逐字相同**，见 [context-and-services.md](../plugin-system/context-and-services.md) §7。

### 6.3 三级降级读跨插件数据

`getResearchGroups()`（L304-324）演示了不优雅但可靠的降级链：

```ts
// 1) 先试活动生态 Token（宿主未启用 provider 时此分支为空）
try { const registry = await ctx.resolve(IActivityRegistryToken as any);
      if (typeof registry?.listDescriptors === 'function') { /* 探测 */ } } catch { /* 走 SQL */ }
// 2) 再直查别的插件建的表，表不存在不崩
try { const rows = rawDb.prepare(`SELECT * FROM plugin_research_groups WHERE activity_id = ?`).all(activityId); … }
catch { /* 表不存在或权限不足 → 返回空数组 */ }
```

**判据**：跨插件读走「服务优先、SQL 兜底、两者都可空」，返回空数组而非抛错。
不要把它写成 `requires`，否则活动插件没装就激活失败。

---

## 7. 配置读取：本插件这里**是错的**，照抄会静默失效

```ts
// [P] src/index.ts L280-285
// Worker runtime 不提供 ctx.config，fallback 到 manifest 默认值
const getConfigValue = (key: string): any => {
  const cfg = (ctx as any).config;
  if (cfg && typeof cfg[key] !== 'undefined') return cfg[key];   // ← 恒为 undefined
  return (ctx.manifest as any)?.configuration?.properties?.[key]?.default;
};
```

**两个问题，第一个是硬缺陷：**

1. `ctx.config` 的类型是 `IConfigService`（`packages/core/plugin-host/types.ts` L280），
   **是服务对象不是字典**。`ConfigService` 只提供 `get` / `getAll` / `hasKey` / `getSchema` /
   `allowedScopes` / `set` / `onChange`（`packages/core/plugin-host/config-service.ts` L150 起），
   **没有按 key 生成属性**。所以 `cfg[key]` 恒为 `undefined`，
   这里每次都走到 `manifest` 默认值 —— 管理员在后台改的配置**永远不会生效，且不报错**。
2. `process` / `worker` 下 `ctx.config` **整个不存在**（`packages/core/worker-runtime/service-host.ts`
   全文件无 `config` 字样），注释里说的理由成立。

**正确写法**（可直接替换）：

```ts
const getConfigValue = (key: string): any => {
  const cfg: any = (ctx as any).config;
  if (cfg && typeof cfg.get === 'function') {
    const v = cfg.get(key);                       // ← 走 IConfigService.get()
    if (typeof v !== 'undefined') return v;
  }
  return (ctx.manifest as any)?.configuration?.properties?.[key]?.default;
};
```

`get()` 内部已实现「班级 > 学校 > 平台 > schema default」四级回落
（`config-service.ts` L210-228），所以**有 `ctx.config` 时根本不需要自己回落到 default**；
回落分支只为 `process` / `worker` 模式兜底。

**结论**：`ctx.config` 在 `process`/`worker` 下缺失、在 `inline` 下存在；
「每个 `configuration` 项都必须写 `default`」不是风格问题，而是可用性前提。
消费处还应像本插件 L1346-1348 那样再加一层 `Number(...) || 兜底值`，
防住「配置缺失 → `NaN`」。这条三层保险本身值得抄，只有中间的取值方式要改。

消费处全部用 `Number(getConfigValue(...)) || 兜底值`（L1346-1348、L1364），三重保险：
配置缺失 → 默认值 → `Number()` 得 `NaN` → `||` 兜底。

---

## 8. 前端：4 个槽位与「React 必须运行期注入」

### 8.1 四个槽位注册（`[P] src/frontend.tsx` L1518-1552）

```ts
async function activate(hostCtx: any) {
  ctx = hostCtx;
  if (window.HostSharedDeps?.ReactDOM) ReactDOM = window.HostSharedDeps.ReactDOM;

  hostCtx.ui.registerExtensionPoint('teacher.tab', {
    id: 'lab-seat-tab', label: '机房座位', icon: 'Monitor',
    component: TeacherLabPanel, position: 50, group: 'management',
  });
  hostCtx.ui.registerExtensionPoint('teacher.dashboard.widget', { id: 'lab-seat-attendance-card', … });
  hostCtx.ui.registerExtensionPoint('student.view',             { id: 'lab-seat-student-view', … });
  hostCtx.ui.registerExtensionPoint('classroom.tool',           { id: 'lab-seat-tool-panel', … });
}
function deactivate() {}
export default { activate, deactivate };
```

可抄点：

- `activate(hostCtx)` 先存到模块级 `ctx`，后续所有 `invokeCommand` 都通过它（L48、L53-56）。
- `component` 传的是**组件引用**，不是 JSX 元素。
- 同一插件在 4 个槽位注册 4 个不同组件、4 个不同 `id`。`id` 在槽位内唯一即可，不需全局唯一。
- `deactivate` 留空是**正确**的：React 组件卸载由宿主负责，插件只需断开 socket 与 timer。

### 8.2 为什么 `import React from 'react'` 会构建失败

```tsx
// [P] src/frontend.tsx L13-16（注释原文）
// React 不能写成裸 import：SDK 3.7.2+ 的 CLI 会对 frontend 产物做裸模块说明符
// 守卫（沙箱 iframe 用 Blob + 动态 import() 加载，没有 importmap，裸说明符无从解析），
// 命中即构建失败。本插件是 inline 受信插件，React 由宿主经 HostSharedDeps 注入，
// 改成运行期解析即可（当前 SDK 3.5.2 还没有该守卫，先修以免升级后构建中断）。
```

实现（L17-45）：

```tsx
import type * as ReactTypes from 'react';        // ← 只 import type，编译后被擦除

function resolveReact(): typeof ReactTypes {
  return (globalThis as any).React ||
    (typeof window !== 'undefined' &&
      (window.HostSharedDeps?.React?.default ?? window.HostSharedDeps?.React ??
       window.React ?? window.HostSharedDeps?.react));
}

const React: typeof ReactTypes = new Proxy({} as any, {
  get(_t, prop) {
    const r = resolveReact();
    if (!r) throw new Error('[LabSeat] React 尚未由宿主注入（HostSharedDeps.React 不存在）');
    return (r as any)[prop];
  },
});

// hooks 解构导入会在模块初始化时就要 React，改为运行期转发到同一个 Proxy
const useState = (...a: any[]) => (React as any).useState(...a);
const useEffect = (...a: any[]) => (React as any).useEffect(...a);
const useCallback = (...a: any[]) => (React as any).useCallback(...a);
```

**三条硬结论**：

1. 前端产物里**任何裸模块说明符都会被 SDK CLI 拦截**（`@openlearn/plugin-sdk` build 守卫），
   `import React from 'react'` 会直接构建失败。
2. `HostSharedDeps.React` 由宿主在挂载前写入 `window`，命名有 4 种形态（`HostSharedDeps.React.default` / `HostSharedDeps.React` / `window.React` / `HostSharedDeps.react`），**四种都要探**。
3. `const { useState } = React` 在模块初始化时求值 → 此时 `HostSharedDeps` 尚未就绪 → 必须包成转发函数。

这是一个**受信 inline 插件**才有的便利。非受信插件跑在 iframe 沙箱里，拿不到 `window.HostSharedDeps`，
必须走 `view` + bridge 通道，见 [ui-extension-guide.md](../development/ui-extension-guide.md) §3。

### 8.3 事件订阅：socket 优先 + 可见性感知 + 指数退避

```ts
// [P] src/frontend.tsx L66-136 —— subscribeToEvents(events, handler, {fastMs=3000, maxMs=30000})
- ctx.services.socketService 存在 → sock.on(ev) 事件驱动；同时保留低频轮询兜底事件丢失
- 不存在 → 纯轮询：5s→10s→20s→30s 封顶，收到真实事件回到 fastMs
- document.hidden 时 clearTimer() 暂停；visibilitychange 恢复时立即补一次
- inFlight 保护：handler 异步期间跳过下一次调度
```

这段代码解决的是「后端已经有了 `lab_seat.student_checked_in` 事件，前端如何在宿主版本差异下都能刷新」。
**如果只是简单刷新，不要抄这 70 行** —— 直接用 `socketService.on` 即可；它的价值在于跨宿主版本兼容。

### 8.4 前端错误呈现

`humanizeErr(e)`（L156）把后端 `[lab_seat:NO_ASSIGNMENT] 你尚未被分配…` 剥成中文可读消息。
这是后端错误前缀设计的直接收益：前端只需按 `[lab_seat:` 切分，无需枚举 code。

---

## 9. 停用清理：只清自己的，别清宿主的

```ts
// [P] src/index.ts L1453-1460
async deactivate() {
  if (autoScanTimer) { clearInterval(autoScanTimer); autoScanTimer = null; }
  // ctx.db.dropAllTables() 由 PluginHost 自动调用
}
```

模块级 timer（L92 `let autoScanTimer`）必须在 `deactivate` 里清 —— 否则热重载会叠加多个 interval，
表现为「同一学生被标记多次」。`deactivate` 里**不要**手动 drop 表：宿主在卸载时调用
`ctx.db.dropAllTables()`，你自己 drop 会与卸载流程竞争。

清理责任划分见 [lifecycle.md](../plugin-system/lifecycle.md) §6。

---

## 10. 测试现状（不理想，但诚实记录）

本插件**没有**用 `@openlearn/plugin-test-kit`，而是自建 harness：

| 文件 | 作用 |
| --- | --- |
| `test/build-test-bundle.mjs` | 用 esbuild 把 `src/index.ts` 打成 `tmp/plugin-test-bundle.mjs`，把 `pino`/`express`/`jszip`/`semver`/`uuid` 等 alias 到 `_mock-pino.mjs` 空桩 |
| `test/plugin.test.mjs` | 手写 `createMockContext(db, extraConfig)`：`commandHandlers` Map、`actionDescriptors` 数组、`publishedEvents` 数组、`providedServices` Map、`eventSubs` Map |
| `test/csv.test.mjs` / `smart-assign.test.mjs` | 纯函数单测（无需 mock） |
| `test-harness/static-check.mjs` | 52 KB L0 静态检查：槽位名对照 `slot-registry.json` 白名单、manifest 字段、裸说明符等 |

`test/plugin.test.mjs` 开头列了 5 个边界场景，全部是**迁移相关**：

```text
1) 全新 install（computer_labs 表不存在）
2) 升级 install（表已存在但缺 name/layout_json/updated_at 列）
3) 全部列已存在（幂等迁移）
4) 每个 command handler 注册成功
5) 关键 commands 调用不抛错
```

**为什么这篇文档不建议你照抄**：自建 mock 的 `commandHandlers.set(...)` 是「双写全限定名 + 短名」
（见 `[P] test/plugin.test.mjs` L41-48 注释「忠实模拟 worker proxy：注册自动加 manifestId 前缀」），
这种手写模拟与真实内核的偏差会随时间扩大。用 `createMockContext()` 能拿到平台同步维护的 mock，
差异对照见 [testing-guide.md](../development/testing-guide.md) §4。

**值得抄的一点**：`build-test-bundle.mjs` 的 alias 技巧 —— 插件若直接依赖 `pino`/`express` 等
宿主注入包，单测里必然因为缺少运行时配置而崩，alias 到空桩是最省事的解法。

---

## 11. 抄什么 / 别抄什么

### ✅ 直接抄

| 范式 | 坐标 |
| --- | --- |
| `labError(code, msg)` + `never` 返回 + code 联合类型 | `[P]` L62-86 |
| 配置回落 + `Number() \|\| 兜底` 三层保险 | `[P]` L280-285、L1346-1348（**取值改 `ctx.config.get(key)`**，见 §7） |
| `typeof ctx.provide === 'function'` 守卫 | `[P]` L1293-1296 |
| 批量 `MISSING_ACTIONS` 补描述符 | `[P]` L1419-1448 |
| `actorId` 取身份 / 幂等先查后写 / 事件带 `correlationId` | `[P]` L793-836 |
| 前端 `resolveReact()` + Proxy + hooks 转发 | `[P] frontend.tsx` L17-45 |
| `deactivate` 清模块级 timer | `[P]` L1453-1460 |
| 纯函数抽独立文件 + 独立单测 | `[P] csv.ts` / `smart-assign.ts` |

### ❌ 明确别抄

| 反模式 | 位置 | 为什么 |
| --- | --- | --- |
| 对平台表 `computer_labs` 做 `CREATE/ALTER` | L175-191 | 违反表归属；只因 `inline` 无 SQL 守卫才成立，改非受信模式即被拒 |
| `try { … } catch {}` 空捕获无日志 | L187-191、L312、L322 | 排障时无法区分「表不存在」与「权限不足」 |
| 直接读别的插件的表 `plugin_research_groups` | L316 | 应优先走 `IActivityRegistryToken`；SQL 仅作兜底且必须可空 |
| 前端 `subscribeToEvents` 70 行 | `frontend.tsx` L66-136 | 除非确实要做跨宿主版本兼容，否则过度设计 |
| 自建 mock 而非 `createMockContext()` | `test/plugin.test.mjs` | 与真实内核的偏差会累积 |
| `inputSchema: { type: 'OBJECT', properties: {} }` 当作「不校验」 | L1446 | 实际校验对象形状；必填项靠 handler 兜底是**主动选择**，不是「反正不校验」 |
| `ctx.config[key]` 取配置值 | L283 | `IConfigService` 无按 key 的属性，恒 `undefined` → 后台配置静默不生效；应 `ctx.config.get(key)` |

---

## 12. 复刻清单（照此顺序做，不会踩上面的坑）

```text
[ ] 1. sdk init --template full-stack  →  src/index.ts + src/frontend.tsx + manifest
[ ] 2. manifest.capabilitiesProposed 先列全（19 条真值内），process 模式下不可为空
[ ] 3. manifest.configuration 每项写 default（activate 要靠它降级）
[ ] 4. activate 第一件事：await ctx.db.migrate(1, fn) 建表；表名一律 ctx.db.table(...)
[ ] 5. 每个 registerHandler 之后**立刻**写对应 actionRegistry.register（同一段落内）
[ ] 6. 写完跑 diff 自查：handler 集合 == commandType 集合
[ ] 7. 业务错误统一 labError(code, msg)，code 进联合类型
[ ] 8. 需要跨插件 → manifest.provides + typeof ctx.provide 守卫；不需要 → 删掉整段
[ ] 9. 读配置走 ctx.config.get(key)（不是 ctx.config[key]），process/worker 下回落 manifest default
[ ] 10. 前端：import type React + resolveReact + Proxy；槽位名先在 120 槽位表里确认
[ ] 11. deactivate 清所有 setInterval / socket.on / addEventListener
[ ] 12. 跑 node test-harness/static-check.mjs 与命令自查 diff，再打包
```

---

## 13. 交叉引用

| 想知道 | 去哪 |
| --- | --- |
| `PluginContext` 全字段与 9 个服务签名 | [context-and-services.md](../plugin-system/context-and-services.md) |
| 19 条能力真值与 3 道 Barrier | [capabilities-and-security.md](../plugin-system/capabilities-and-security.md) |
| 120 槽位如何选、`layoutVariant` 怎么填 | [extension-points-and-slots.md](../plugin-system/extension-points-and-slots.md) |
| `COMMAND_NOT_REGISTERED` 的完整归因链 | [troubleshooting.md](../development/troubleshooting.md) §3 |
| 从零起一个更小的插件 | [minimal-plugin.md](minimal-plugin.md) |
