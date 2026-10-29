# 调试与日志

> **适用范围**：`@openlearn/plugin-sdk@3.7.5` / OpenLearnV2 v0.7.7
> 解决一个问题：**插件跑起来之后，怎么看到它到底干了什么？**

---

## 0. 先纠正四个先验

```{danger} ⚠ 与 LLM 先验冲突 1：日志接口叫 `ctx.log`，不是 `ctx.logger`
`PluginContext` 上**没有** `logger` 这个成员，**有** `log`：

```typescript
ctx.log.debug(message, meta?)   // 四个级别，全部同步返回 void
ctx.log.info(message, meta?)
ctx.log.warn(message, meta?)
ctx.log.error(message, meta?)
```

签名是 `IPluginLogger`（`packages/core/plugin-host/types.ts`）：

```typescript
export interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

写 `ctx.logger.info(...)` → `TypeError: Cannot read properties of undefined`。
这是手册 {doc}`../playbook/pitfalls` P-09 专门列的反例。
```

```{danger} ⚠ 与 LLM 先验冲突 2：日志不是 `console.log`
`ctx.log` 底层是 **pino**（结构化日志），每条带 `Plugin:<manifest.id>` 的命名空间，
并经过**脱敏兜底**与**按大小轮转**。

→ 用 `ctx.log.info('msg', { key: value })` 而不是
`console.log('msg', key, value)`：前者结构化、可按插件过滤、字段脱敏；
后者混在宿主输出里、无法归因、**且可能把敏感值直接打进日志文件**。
```

```{warning} ⚠ 与 LLM 先验冲突 3：插件日志不落 `plugin_logs` 表
平台**没有**插件日志表。`ctx.log` 的去向是：

- **stdout**（生产）；开发环境下是 **pino-pretty** 彩色输出；
- 同时写入 `LOG_DIR` 指定的**轮转文件**（若 `LOG_DIR` 可写）。

要按插件维度看日志，用**日志目录 + `Plugin:<id>` 命名空间过滤**，
不要指望有张表可以 `SELECT`。
```

```{warning} ⚠ 与 LLM 先验冲突 4：命令没被执行，不会有「命令日志」
命令总线**默认静默** —— 成功与失败都不打日志。只有开了
`DEBUG_COMMAND_BUS=true` 或 `DEBUG` 含 `commandbus` 才输出。

→ 「命令没反应」的第一诊断步骤就是开这个开关，不是加日志。
```

---

## 1. `ctx.log` 四个级别

```typescript
export async function activate(ctx: PluginContext): Promise<void> {
  ctx.log.debug('初始化开始', { pluginId: ctx.pluginId });
  ctx.log.info('已注册 3 个命令', { commands: ['a', 'b', 'c'] });
  ctx.log.warn('可选依赖缺失，降级为只读', { service: 'ai' });
  ctx.log.error('写入失败', { error: String(err) });
}
```

**级别怎么选**

| 级别 | 用途 | 会不会被脱敏后仍保留 |
| :--- | :--- | :--- |
| `debug` | 排查用的细节，正常跑时不该刷屏 | 会（与所有级别一样） |
| `info` | 关键生命周期事件（激活、注册、迁移完成） | 会 |
| `warn` | 降级、兜底、边界情况 | 会 |
| `error` | 真的失败了 | 会 |

**`meta` 是第二参数**，不要拼进 message 字符串 ——
`ctx.log.info('加载了 ' + n + ' 条')` 无法按字段检索，
`ctx.log.info('已加载', { count: n })` 可以。

> 宿主会做**脱敏**（`packages/core/observability/redaction.ts` / `sanitize.ts`）。
> 密码、令牌这类字段即使显式传进 `meta` 也会被替换掉。
> 不要依赖「我把 token 放进 meta，它会原样出现」。

---

## 2. 日志在哪里看

```bash
# 1. 开发环境：进程 stdout（pino-pretty 彩色）
npm run dev 2>&1 | grep 'Plugin:@openlearn-ext/my-plugin'

# 2. 落盘：LOG_DIR 指定的轮转目录
export LOG_DIR=/var/log/openlearn
ls -lh "$LOG_DIR"
grep 'Plugin:@openlearn-ext/my-plugin' "$LOG_DIR"/*.log
```

**日志命名空间**是 `Plugin:${manifest.id || pluginId}`。
按这个前缀过滤就能摘出单个插件的全部输出。

**轮转**：`packages/core/observability/rotating-file-stream.ts` 按大小轮转，
避免单文件无限增长。

---

## 3. 命令总线调试

```bash
# 打开命令总线日志
DEBUG_COMMAND_BUS=true npm run dev

# 或用 DEBUG 包含 commandbus
DEBUG=commandbus npm run dev
```

打开后能看到每次命令执行的**类型**、**是否命中 handler**、**结果**。

**「命令没反应」的排查顺序**

1. 开 `DEBUG_COMMAND_BUS` —— 确认命令**有没有被派发**；
2. 没派发 → 是调用方没发（检查 `ctx.services.commandBus.execute` 的 type 拼写、
   以及是否被命名空间前缀规则影响）；
3. 派发了但没命中 handler → 抛 `No handler registered for command: <type>`；
4. 命中了但报 `COMMAND_CAPABILITY_DENIED` → 能力没声明或没被批准，
   见 {doc}`capabilities`；
5. 命中了但报 `COMMAND_NOT_REGISTERED` → 只注册了 handler，没注册 descriptor。

> 命令类型带命名空间：宿主会给插件的命令类型补 `manifest.id` 前缀。
> 所以注册时写的 type 和调用时写的 type 可能不一样 —— **两端都用同一份常量**。

---

## 4. 后台进程与长任务

`ctx.services.processManager` 起的任务，状态与日志都存在 **`processes` 表**：

```sql
SELECT id, name, status, task_type, plugin_id, created_at, updated_at
FROM processes
WHERE plugin_id = 'my-plugin-id'
ORDER BY created_at DESC;
```

`logs` 列存任务日志。任务要能看见自己的进度，就得**往 `logs` 里写**。

**长任务的三条纪律**

1. 任务体必须能在宿主重启后**恢复或安全丢弃** —— 宿主不保证进程内存态存活；
2. 长时间无输出的任务会被判为卡死 —— **定期写 `logs`**；
3. 任务里不要做长事务 —— 会阻塞 SQLite 写锁。

---

## 5. 插件指标

平台为插件收集**命令级指标**（不需要插件配合）：

| 指标 | 采集点 |
| :--- | :--- |
| 命令执行次数 / 成功率 / 耗时 | `recordPluginCommand(pluginId, ok, durationMs)` |
| 事件发布次数 | `recordPluginEvent(source)` |

指标条目上限 **200**（`MAX_PLUGIN_METRIC_ENTRIES`），超出用 `__overflow__` 桶聚合。
`pluginId` 从 actor id 或命令类型里反解
（`pluginIdFromActor` / `pluginIdFromCommandType`）。

→ 想知道「我的插件被调用了多少次」，看指标；
想知道「某次调用为什么失败」，看 `ctx.log`。

---

## 6. 安全审计

```typescript
import { recordSecurityAudit } from '@openlearn/plugin-sdk';
```

平台在**权限授予、能力校验、危险操作**等节点写安全审计记录。
插件自己触发的敏感操作也应当记一笔，便于事后追责。

**注意**：审计记录与普通日志是**两条链路**，不要指望在日志里能查到审计事件，
反之亦然。

---

## 7. 开发环境开关

| 环境变量 | 作用 |
| :--- | :--- |
| `DEBUG_COMMAND_BUS=true` | 打印命令总线执行日志 |
| `DEBUG=commandbus` | 同上（`DEBUG` 含 `commandbus` 即可） |
| `NODE_ENV=development` | 启用**热重载**；日志走 pino-pretty 彩色输出 |
| `LOG_DIR=<dir>` | 日志落盘目录 |

**热重载**只在 `NODE_ENV=development` 下启用（`packages/core/plugin-host/hot-reload.ts`）。
生产环境设成 `development` 会**意外开启热重载** —— 别这么干。

---

## 8. 排障速查

| 现象 | 根因 | 修法 |
| :--- | :--- | :--- |
| `TypeError: Cannot read properties of undefined (reading 'info')` | 写了 `ctx.logger` | 改 `ctx.log`；见 P-09 |
| `ctx.log is not a function` | 用了旧版 SDK 的接口 | 升 SDK ≥ 3.7.5 |
| 日志全在，筛不出单个插件 | 没用命名空间过滤 | 按 `Plugin:<manifest.id>` 前缀过滤 |
| 日志文件不增长 | `LOG_DIR` 不可写 | 宿主会降级为只写 stdout；检查目录权限 |
| 命令执行了但控制台毫无反应 | 命令总线默认静默 | 开 `DEBUG_COMMAND_BUS=true` |
| `No handler registered for command: X` | 没注册 handler | 检查注册时机（是否在 `activate` 里注册） |
| `COMMAND_CAPABILITY_DENIED` | 能力没声明 / 没批准 | 见 {doc}`capabilities` §4 |
| `COMMAND_NOT_REGISTERED` | 只注册了 handler，没注册 descriptor | 补 `ctx.services.actionRegistry.register(...)` |
| 任务被判定为卡死 | 长时间没写 `logs` | 定期往 `logs` 写进度 |
| `database is locked` | 长事务占着写锁 | 缩短事务；见 {doc}`database` |
| 敏感字段在日志里变成 `***` | 宿主脱敏 | 正常行为，不要依赖敏感值原样出现 |
| 生产环境日志没有颜色 | 非 development | 正常；pino-pretty 只在开发用 |
| 改了代码没生效 | 热重载只在 development 开 | 设 `NODE_ENV=development`，或手动重启 |
| 生产环境意外热重载 | 误设 `NODE_ENV=development` | 改回 `production` |

---

## 9. 自检清单

- [ ] 全仓库搜不到 `ctx.logger`：`! grep -rn "ctx\.logger" src/`
- [ ] 关键生命周期事件有 `ctx.log.info`
- [ ] 失败路径有 `ctx.log.error` 且带 `meta`（不是拼进 message）
- [ ] `meta` 里没有密码、令牌这类敏感值（即使会被脱敏，也别传）
- [ ] `ctx.log` 的第二参数是对象，不是字符串拼接
- [ ] 需要诊断命令问题时，`DEBUG_COMMAND_BUS=true` 在本地验证过
- [ ] 长任务定期写 `logs`
- [ ] 敏感操作调用了 `recordSecurityAudit`
- [ ] 生产环境 `NODE_ENV` 不是 `development`
- [ ] `LOG_DIR` 在生产已配且可写

---

## 取证

| 结论 | 位置 |
| :--- | :--- |
| `IPluginLogger` 的四个方法与签名 | `packages/core/plugin-host/types.ts` → `IPluginLogger`（L91–L96） |
| `ctx.log` 的实现（pino，命名空间 `Plugin:<id>`） | `packages/core/plugin-host/context-builder.ts`（L1029–L1034、L1142） |
| `ctx.log` 与 `ctx.logger` 的区分 | `packages/core/plugin-host/types.ts` → `PluginContext`（L227–L300） |
| 日志输出通道（stdout / pino-pretty / 轮转文件） | `packages/core/observability/logger.ts`（L28–L55） |
| 轮转实现 | `packages/core/observability/rotating-file-stream.ts` |
| 脱敏兜底 | `packages/core/observability/redaction.ts`、`sanitize.ts` |
| 命令总线调试开关与静默默认 | `packages/core/command-bus/index.ts`（L29、L128） |
| `No handler registered for command` 抛出处 | `packages/core/command-bus/index.ts`（L123） |
| 进程表与 `logs` 列 | `packages/core/process-manager/index.ts`（L79、L171） |
| 插件指标与 200 条上限 | `packages/core/observability/plugin-metrics.ts`（L24–L25、L161、L175） |
| 安全审计入口 | `packages/core/observability/audit-log.ts` → `recordSecurityAudit`（L58） |
| 热重载仅在 development 启用 | `packages/core/plugin-host/hot-reload.ts`（L144–L147） |
