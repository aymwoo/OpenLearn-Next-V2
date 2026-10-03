# 可观测性架构（Observability）

本文以代码为唯一真源，描述 OpenLearn V2 的日志与可观测性体系。核对范围：`packages/core/observability/`、`server/utils/logger.ts`、`packages/core/ai-capability/logging/`、`packages/core/kernel/index.ts`、`Dockerfile`、`docker-compose.yml`、`package.json`。

---

## 0. 首要结论：这里只有「一个 logger 模块」和「三套互不相干的可观测性机制」

必须先纠正一个常见误解。仓库里**确实有两个同名 logger 文件**——`packages/core/observability/logger.ts` 与 `server/utils/logger.ts`——但**它们不是两套独立实现**。后者是对前者的**纯 re-export**（见 §2）。真正的「多套」不在这一层，而在别处：平台实际存在**三套互不共享代码、互不共享存储**的可观测性机制。

| # | 机制                              | 实现位置                                        | 载体            | 落盘 | 结构化 |
| - | --------------------------------- | ----------------------------------------------- | --------------- | ---- | ------ |
| 1 | **平台结构化日志（pino）**        | `packages/core/observability/logger.ts`          | 文本行          | ✅   | ✅     |
| 2 | **事件审计日志（EventBus → SQLite）** | `packages/core/kernel/index.ts` 的 `initAuditLog()` | `events` 表   | ✅   | ✅     |
| 3 | **AI 能力调用遥测（内存）**       | `packages/core/ai-capability/logging/capability-logger.ts` | 进程内存数组 | ❌   | ❌     |

三者之间**没有任何聚合**：没有 correlationId 打通日志与事件表，没有把 `CapabilityLogger` 的数据接入 pino，也没有 metrics 采集、没有 tracing、没有健康检查以外的探针（`/health` 由 Dockerfile 的 `HEALTHCHECK` 以 wget 轮询实现，不在本模块内）。

本文以机制 1 为主体（`packages/core/observability/` 的全部内容），并在 §5 简要说明机制 2、3。

---

## 1. 模块清单

`packages/core/observability/` 目录下**只有一个文件**：`logger.ts`（1578 字节）。**没有 `index.ts` barrel**，因此只能按文件路径深导入，不存在 `import ... from '@openlearn/plugin-sdk'` 式的包级再导出。

该文件的**全部**导出只有两个符号：

| 导出            | 类型            | 说明                                                                 |
| --------------- | --------------- | -------------------------------------------------------------------- |
| `logger`        | `pino.Logger`   | 模块级单例，模块被 import 时即创建                                    |
| `createLogger`  | `(component: string) => pino.Logger` | 工厂函数，实现为 `logger.child({ component })` |

**明确不存在的能力**（逐一 grep 确认无命中）：

- ❌ **没有** log level 枚举或级别常量——级别只有一处环境变量兜底逻辑
- ❌ **没有** transport 抽象/注册表——stream 数组在模块顶层硬编码构造
- ❌ **没有** 自定义 `serializers`、采样（sampling）

**已具备的能力**（2026-10-03 加固，标准库实现，零新增 npm 依赖）：

- ✅ **字段级脱敏**：`packages/core/observability/redaction.ts`。覆盖 `apiKey` / `api_key` /
  `password` / `passwordHash` / `authorization` / `cookie` / `sessionToken` / `passcode` /
  `class_passcode` / `requestPayload` / `responsePayload` / `secret`，替换为 `***REDACTED***`。
  脱敏配置挂在 logger 上、在 multistream 分流**之前**生效，故 stdout / pino-pretty / 文件三路一致。
  可用 `LOG_REDACT=false` 关闭（生产不建议）。详见 §3.4。
- ✅ **按大小轮转**：`packages/core/observability/rotating-file-stream.ts`。默认
  `LOG_MAX_SIZE_MB=10` / `LOG_MAX_FILES=5`（约 50 MB 上限），可用 `LOG_DIR` 改写目录。详见 §3.3。

> ⚠️ **一个容易踩的坑**：本仓库所用 pino 版本的 fast-redact **不支持 `**` 递归通配符** ——
> `paths: ['**.api_key']` 会**静默匹配不到任何内容**，既不报错也不告警，看起来配好了实则零保护。
> 因此实现改为按 `*` 逐层枚举 1–10 层深度（共 165 条 path），并在
> `__tests__/redaction.test.ts` 中有一条反回归测试专门锁死这个行为。

---

## 2. 与 `server/utils/logger.ts` 的关系

`server/utils/logger.ts` 全文只有一行有实际语义的代码：

```typescript
export { logger, createLogger } from '../../packages/core/observability/logger.js';
```

它是 2026-09-30 分层整改留下的**兼容垫片**，不是第二套实现。整改背景写在两个文件的注释里：此前 `packages/core/worker-runtime/worker-manager.ts` 与 `packages/core/plugin-host/context-builder.ts` 反向 import 应用层的 `server/utils/logger.ts`（ESM 导入时写作 `.js` 后缀），违反「应用 → 内核，绝不反向」的分层规则，2026-09-25 审计 H-7 立项、拖了逾一版才修。

**当前状态（实测）**：

- `packages/core/observability/logger.ts` 的生产消费方**只有 2 个**：`plugin-host/context-builder.ts` 与 `worker-runtime/worker-manager.ts`
- `server/utils/logger.ts` 的生产消费方**为 0**——全仓（排除 `node_modules`/`.git`/`docs/`）对其的引用只出现在 `CHANGELOG.md` 的整改记录与 `graphify-out/` 的图谱快照里，没有任何 `.ts`/`.tsx`/`.mjs` 文件 import 它

因此它是一个**当前无人使用的兼容垫片**。文件自身注释也写明「server 侧新代码请直接 import core 的 observability/logger」。删掉它不会破坏任何生产编译，但本文件按职责边界不在本次改动范围内，此处仅如实记录。

**分层守卫**：`packages/core/__tests__/layering.test.ts` 用正则扫描 `packages/core` 全部生产源码（排除 `__tests__/`），断言**不含任何指向 `server/**` 的 import**，防止依赖方向被再次击穿。`server/utils/logger.ts` 的存在不违反该守卫（方向是 server → core，合法）。

---

## 3. 日志落地机制

### 3.1 级别

唯一的级别决策点在模块顶层：

```
process.env.LOG_LEVEL  ||  (NODE_ENV === 'production' ? 'info' : 'debug')
```

`LOG_LEVEL` 是本模块唯一读取的环境变量。`docker-compose.yml` 与 `ecosystem.config.cjs` 都显式将其设为 `info`。级别不随运行时变更，**改后须重启**。

### 3.2 双路输出

模块用 `pino.multistream` 把同一条记录同时送往两个 stream：

| 分支                       | stream                                    | 条件                      |
| -------------------------- | ----------------------------------------- | ------------------------- |
| 人类可读 / 机器可读（第一路） | 非生产：`pino.transport({ target: 'pino-pretty' })`，开启 `colorize`，`translateTime: 'SYS:HH:mm:ss.l'`，`ignore: 'pid,hostname'`；生产：直接 `process.stdout`（原始 JSON 行） | 恒有一条 |
| 纯文件（第二路）            | `fs.createWriteStream('<cwd>/logs/openlearn.log', { flags: 'a' })` | 恒有一条（**包括生产**） |

日志目录 `path.resolve(process.cwd(), 'logs')` 在模块被 import 时若不存在则以 `mkdirSync(..., { recursive: true })` 创建。

两点值得注意：

1. **两路的 level 相同**（都取自同一个 `level` 变量），不存在"文件记全、控制台记简"的分级策略。
2. **pino-pretty 是 devDependency**（`package.json` 中 `pino: ^10.3.1` 在 `dependencies`，`pino-pretty: ^13.1.3` 在 `devDependencies`），而 Dockerfile 在构建阶段执行 `pnpm prune --prod`。镜像内 `ENV NODE_ENV=production`，因此走 `process.stdout` 分支，不会触碰缺失的 `pino-pretty`。
   > ⚠️ 风险：若在**已 prune 的生产依赖环境**中把 `NODE_ENV` 改成非生产值，pino 会尝试解析已不存在的 `pino-pretty` transport 目标。默认配置下不会触发。

### 3.3 日志轮转

`rotating-file-stream.ts` 用**同步 `fs.writeSync`** 实现按大小轮转，**零新增 npm 依赖**
（未引入 `pino-roll` / `rotatelogs`）。

- **默认值**：`LOG_MAX_SIZE_MB=10`、`LOG_MAX_FILES=5`（约 50 MB 上限）；非法值回退到默认并告警。
- **为何用同步写**：异步轮转在 `end()` 与重新打开之间存在丢写窗口，且进程退出时序不可控；
  同步写让「写入 + 计数 + 轮转」成为不可分割的一段。
- **跨平台**：每次 rename 前先 `unlink` 目标（Windows 不允许 rename 覆盖已存在文件），移位按从旧到新。
- **句柄释放**：首次写入才懒打开，`dispose()` 于 `_final` 调用，另有单个模块级
  `process.on('exit')` 钩子；钩子挂在模块级 Set 上，避免测试大量构造时触发 `MaxListenersExceededWarning`。

> **部署注意**：现有 `logs/openlearn.log` 已达 11.3 MB，超过 10 MB 默认阈值，
> 部署后首次写入即会轮转为 `openlearn.log.1`。

**容器内**：`docker-compose.yml` 现已挂载 `logs_data` → `/app/logs`（此前未挂载，容器重建即丢全部日志）。

### 3.4 脱敏

`redaction.ts` 在 logger 构造时通过 pino 的 `redact` 选项生效，覆盖 12 个敏感字段名，
每个字段按 `*` 逐层展开 1–10 层深度（fast-redact 不支持 `**`，见上文）。

**刻意不脱敏的字段**（避免摧毁日志价值）：`token`（全仓 406 处，但绝大多数是 **DI Token** 概念
——`IAIServiceToken`、`{token, instance}`，脱敏会抹掉 plugin-host 诊断信息；真实凭据由
`cookie` / `sessionToken` 覆盖）、`id` / `name` / `studentId` / `lessonId` / `content`（408 处）/
`messages`（119 处）。

**残余风险（诚实说明）**：

1. **字符串内的秘密无法用字段路径脱敏**。``logger.info(`failed with key ${apiKey}`)``、
   `error: err.message` 里带 token 的 URL、整串 `console.error` 都挡不住。
2. **203 处裸 `console.*`** 绕过 pino，完全不经过脱敏。
3. **非 pino 载体不受影响**：`CapabilityLogger` 的内存数组与 EventBus 的 SQLite `events` 表。
4. 嵌套深度超过 10 层、或不在字段名单内的键，均不脱敏。

---

## 4. 插件如何获得日志能力

### 4.1 机制：context 属性注入，**不是 DI Token**

日志能力**不通过 DI 容器分发**。`packages/core/di/token.ts` 中没有任何日志相关 Token，插件也无法 `resolve` 出一个 logger。

实际机制是属性注入：`packages/core/plugin-host/context-builder.ts` 的 `buildContext()` 内部先 `createLogger(\`Plugin:${manifest.id || pluginId}\`)` 得到一个 pino 子 logger，再包装成 `IPluginLogger` 形状的对象，作为 `log` 字段挂到返回的 `PluginContext` 上（`PluginContext.log` 的类型声明在 `packages/core/plugin-host/types.ts`）。

### 4.2 接口

`IPluginLogger` 是 4 个方法的窄接口，**只有消息与可选 meta，没有 logger 实例外泄**：

```typescript
export interface IPluginLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

实现是一个字面量对象，四个方法各自把 `(message, meta)` 转发为 pino 的 `logger.<level>({ meta }, message)`——即 `meta` 落在 JSON 输出的 `meta` 字段下，`message` 落在 `msg` 字段。

> 注：`types.ts` 中 `IPluginLogger` 的注释称其「自动注入 pluginId 和 timestamp」。**pluginId 确实以 `component: "Plugin:<id>"` 的形式注入**（pino child 绑定字段）；timestamp 由 pino 自身的 `time` 字段提供，**不是平台额外注入的**。实现中没有额外的字段注入逻辑。

### 4.3 Worker 模式下的 stdout/stderr 接管

`buildContext()` 位于 `packages/core/plugin-host/context-builder.ts`，**Worker 引导脚本内并未调用它**（`packages/core/worker-runtime/worker-manager.ts` 内嵌的 worker bootstrap 代码中无 `buildContext` 引用），即两条执行路径的插件上下文并非由同一处构造。

> 待确认：Worker 模式下 `ctx.log` 具体如何跨线程投递（是否经 `parentPort` RPC 代理），本次未在 `packages/core/worker-runtime/` 中定位到实现，故不对该机制下断言。

Worker 路径上**已验证**的是另一条独立通道——原始输出接管。Worker 以 `stdout: true, stderr: true` 构造，宿主侧在 `worker-manager.ts` 中用 `createLogger(\`Plugin:${manifest.id || pluginId}\`)` 接收两个流：`worker.stdout` 的每个 chunk 以 `info` 级别、`worker.stderr` 的每个 chunk 以 `error` 级别转发进 pino。

这条通道的实际意义：**Worker 插件里的任何 `console.log` / `console.error`（以及任何未被 `ctx.log` 捕获的原生 stdout/stderr 输出）都会自动进入结构化日志与日志文件**，且都带上 `component` 标签。inline 插件没有这条兜底，其 `console.log` 直接打到进程 stdout，不进 `logs/openlearn.log`。

### 4.4 采用度（实测）

结构化 logger 的覆盖面很窄。`packages/core` 非测试 TS 文件共 **250** 个，其中含 `console.*` 调用的有 **45** 个、调用点合计 **203** 处。也就是说**绝大多数内核日志仍走裸 `console.*`，完全绕过 pino，不进 `logs/openlearn.log`**。排查线上问题时不能假定日志文件是完整的内核日志来源。

---

## 5. 另两套可观测性机制

### 5.1 事件审计日志（EventBus → `events` 表）

`Kernel#initAuditLog()` 订阅 `EventBus` 的通配符 `*`，把**每一个**事件写入 SQLite `events` 表（列：`id`、`type`、`source`、`payload`（JSON 字符串）、`timestamp`、`correlationId`、`lesson_id`）。

几点实现细节：

- 惰性 `prepare` + 缓存：首次写入时用 `PRAGMA table_info(events)` 探测 `lesson_id` 列是否存在，据此在两个 INSERT 语句（`INSERT_EVENT_WITH_LESSON` / `INSERT_EVENT_LEGACY`）间二选一，探测只做一次。老库由 `migrations/006_classroom_event_bus.sql`（`ALTER TABLE events ADD COLUMN lesson_id TEXT`）补列。
- `kernelContainer` 是一个 `Proxy`，在首次属性访问时惰性构造 `Kernel` 并调用 `initAuditLog()`（`packages/core/kernel/index.ts` 底部的 `Proxy` get/set trap）。

这与 §3 的文件日志是**两套独立存储**：事件表可查询、可重放（`lesson_id` 专为「按课节重放整堂课」设计），但没有把事件同时写进 pino 日志。

### 5.2 AI 能力调用遥测（`CapabilityLogger`）

`packages/core/ai-capability/logging/capability-logger.ts` 的 `CapabilityLogger` 是一个**纯内存**实现，与 pino 无关：

- `log(entry)` 把 `CapabilityLogEntry` 推入数组，`Object.freeze` 冻结条目
- `getLogs(capabilityId?)` 返回冻结的副本数组，可按 `capabilityId` 过滤
- `clear()` 清空

`CapabilityLogEntry` 字段：`capabilityId`、`requestPayload`、`responsePayload`、`latencyMs`、`providerId`、`tokenCount?`、`error?`、`timestamp`。

需要明确的局限：数组**无上限、无 TTL、无持久化**，只能被同进程内持有该实例的代码读取。全仓非测试代码中 `new CapabilityLogger()` 只出现 **2 处**——`packages/core/ai-capability/ai-capability-kernel.ts` 构造一个实例，`packages/core/bootstrap/composition/whiteboard-composition-module.ts` 在注册 `WhiteboardCapability` 时另建一个。其余 8 个引用该符号的文件只是 import 类型/类，不持有实例。进程重启即全部丢失，也不会出现在 `logs/openlearn.log` 中。

> ⚠️ 安全提示：`requestPayload` / `responsePayload` 是**未经脱敏的原始载荷**。该结构恰好覆盖 AI 请求与响应全文，若其内容包含用户隐私数据或提示词中的敏感信息，内存中的遥测数组就是一条无脱敏、无访问控制、随进程存活的副本。

---

## 6. 速查与已知缺口

| 问题                                     | 答案                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| 有几套 logger 实现？                      | **1 套**。`server/utils/logger.ts` 是纯 re-export，且当前无任何生产消费者                  |
| 日志有级别控制吗？                        | 有。`LOG_LEVEL` 兜底 `info`（生产）/ `debug`（非生产），不可运行时变更                      |
| 有日志脱敏吗？                            | **有**（2026-10-03 加固）。12 个敏感字段名替换为 `***REDACTED***`；`LOG_REDACT=false` 可关。字符串内秘密与裸 `console.*` 仍挡不住 |
| 有日志轮转吗？                            | **有**（2026-10-03 加固）。默认 10 MB × 5 个文件，同步写零新增依赖；`LOG_DIR` / `LOG_MAX_SIZE_MB` / `LOG_MAX_FILES` 可调 |
| 容器里日志会丢吗？                        | 会。`docker-compose.yml` 未为 `/app/logs` 挂卷，日志在容器可写层，重建即失                 |
| 插件通过 DI Token 拿日志吗？               | **不是**。由 `buildContext()` 作为 `PluginContext.log` 属性注入（inline 路径），`packages/core/di/token.ts` 无日志 Token |
| Worker 插件的 `console.log` 会进日志文件吗？ | 会。`worker-manager.ts` 接管 `stdout`/`stderr` 转发进 pino。inline 插件不会                |
| 内核日志都进日志文件吗？                  | 不是。`packages/core` 有 203 处 `console.*`（分布在 45/250 个文件）完全绕过 pino           |
| 有 metrics / tracing 吗？                 | 没有。仅上述三套机制，无任何指标采集或链路追踪                                            |
