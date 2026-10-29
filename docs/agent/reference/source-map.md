# 源码索引与回源核验

本页是**工具页**：给定一个结论，怎么找到证明它的那一行。
本站每页末尾的「取证」表都用 `文件路径 + repomix 行号` 的形式书写，
本页解释这套坐标怎么读、怎么用。

```{important}
### 坐标体系说明

本站取证坐标是 **`repomix-output.xml` 自身的行号**（不是原仓库文件的行号）。
`repomix-output.xml` 是把整个仓库拼接成的单一大文件（**423,944 行、18MB、1,988 个文件**），
每个文件以一行 `<file path="...">` 开头、以一行 `</file>` 结束。
因此给定「起始行号」就能定位，不需要在多个文件间跳转。
```

---

## 1. 目录拓扑

| 顶层                           | 文件数 | 是什么                                                                                                                                                                                      |
| :----------------------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/`                         | 783    | 前端 SPA（React + zustand）。其中 `features/` 504、`components/` 104、`plugin-host/` 40、`store/` 37、`hooks/` 41、`services/` 28                                                           |
| `packages/core/`               | 512    | 微内核全部：`plugin-host/` `worker-runtime/` `esm-loader/` `di/` `bootstrap/` `command-bus/` `event-bus/` `capability/` `assessment/` `analytics-engine/` `ai/` `db/` `registry/` `kernel/` |
| `server/`                      | 257    | HTTP 入口层：`__tests__/` 141、`services/` 41、`routes/` 24、`utils/` 23、`security/` 8、`middleware/` 6                                                                                    |
| `docs/`                        | 155    | 官方文档（**与代码同源，但会漂移**，见 §5）                                                                                                                                                 |
| `scripts/`                     | 65     | 运维与门禁脚本（`sweep/`、`upgrade-regression/`、`plugin-command-audit.mjs`、`coverage-ratchet.mjs`）                                                                                       |
| `migrations/`                  | 46     | 平台声明式 SQL（`000_initial_schema.sql` L42036 起）                                                                                                                                        |
| `e2e/`                         | 32     | Playwright 规格                                                                                                                                                                             |
| `packages/plugin-sdk/`         | 33     | SDK + 脚手架模板（`scaffold/templates/`）+ `cli.mjs` + `build.mjs` + `generate-dts.mjs`                                                                                                     |
| `packages/plugins/`            | 19     | **内置插件**（受信目录，可用 inline/worker）                                                                                                                                                |
| `audit-tools/`                 | 13     | 文档-代码漂移门禁（Python）                                                                                                                                                                 |
| `packages/activity-ecosystem/` | 8      | 活动生态（`RuntimePermission` 那一套，与 `capabilityRequired` 正交）                                                                                                                        |
| `packages/plugin-test-kit/`    | 4      | 测试工具包（实质只有 `index.ts`）                                                                                                                                                           |
| `packages/bridge-sdk/`         | 3      | 课件 iframe Bridge                                                                                                                                                                          |
| 根单文件                       | —      | `server.ts` L422579（组合根）、`vitest.config.ts` L423551、`vitest.setup.ts` L423648、`playwright.config.ts` L421294                                                                        |

---

## 2. 按主题 → 权威源文件

**「权威」的判据**：本页与全站所有结论，冲突时以这张表里的 `*.ts` 源码为准，
`docs/` 与 `.d.ts` 快照都是次级材料。

### 2.1 声明层

| 主题                | 权威文件                                                  | repomix 区间    | 看什么                                                                                                                                  |
| :------------------ | :-------------------------------------------------------- | :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| manifest 全字段 zod | `packages/core/esm-loader/manifest-schema.ts`             | L81517–L82411   | `requiresItemSchema` L82293、`contributesSchema` `.passthrough()` L82236、`network` 子对象 strip L82398、`baseRoute` 注释 L82266–L82275 |
| 条目解析            | `packages/core/esm-loader/manifest-utils.ts`              | L82412–L82476   | `parseRequiresEntry`：`indexOf('@', indexOf('/'))`                                                                                      |
| 贡献点注册到前端    | `packages/core/plugin-host/contribution-registry.ts`      | L103691–L104928 | 120 个 `ExtensionSlot` 字面量、`anchor:*`                                                                                               |
| 统一扩展点注册表    | `packages/core/plugin-host/unified-extension-registry.ts` | L114095–L114284 | 领域扩展点（题型/阶段门禁/互动提供者）                                                                                                  |
| 内置插件长什么样    | `packages/plugins/builtin.ts`                             | L146787–L148963 | 真实 `ActionDescriptor`、`contributes`、`classroomTools` 用例                                                                           |

对应参考页：[manifest 规范](manifest.md)、[槽位与贡献](contributes-slots.md)。

### 2.2 服务端运行时

| 主题                      | 权威文件                                                                                  | repomix 区间                                      | 看什么                                                                                 |
| :------------------------ | :---------------------------------------------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------- |
| `PluginContext` 权威形状  | `packages/core/plugin-host/types.ts`                                                      | L113656–L114094                                   | 12 个成员、9 个 `T \| null` 服务（E-4）、`PLUGIN_SHARED_MODULES` L113731               |
| 上下文构建与全部 SEC 守卫 | `packages/core/plugin-host/context-builder.ts`                                            | L102462–L103690                                   | D-04/D-05/D-06/D-12、`sharedModules` L102561、表名/能力守卫、`wrapPointsLedgerService` |
| Token 类与全部 Token 声明 | `packages/core/di/token.ts`、`packages/core/di/interfaces.ts`                             | L78711–L78772、L76986–L77992                      | `PLUGIN_RESOLVABLE_TOKENS` / `_NAMES`（E-2）L77900–L77995                              |
| 服务接口全文              | `packages/core/di/interfaces.ts`                                                          | L76986–L77992                                     | `IProcessService`（B-5 ownerHint）、`IStageGuardService`（I-3）                        |
| DI 容器                   | `packages/core/di/container/PlatformContainer.ts`、`packages/core/di/service-registry.ts` | L75776–L76035、L78329–L78660                      | `ServiceRegistry`、`Token<T>` 解析                                                     |
| CommandBus 与拦截器       | `packages/core/command-bus/index.ts`、`packages/core/command-bus/plugin-command.ts`       | L67715–L67873、L67874–L67900                      | `No handler registered for command: <type>` L67838                                     |
| 命令命名空间              | `packages/core/plugin-host/plugin-namespace.ts`                                           | L111941–L112020                                   | `resolvePluginCommandType` L112003、UUID v7 短路 L112002                               |
| EventBus                  | `packages/core/event-bus/index.ts`                                                        | L82790–L83408                                     | 异步派发（与 Mock 的 `await` 语义不同）                                                |
| 内核组合与高危拦截        | `packages/core/kernel/index.ts`                                                           | L83924–L84674                                     | default-deny L84200–L84340、`validateJsonSchema` L84613                                |
| Action 注册表             | `packages/core/registry/index.ts`                                                         | L116031–L116107                                   | `ActionDescriptor` 字段、遮蔽行为                                                      |
| HTTP 路由                 | `packages/core/plugin-host/http-router.ts`、`packages/core/plugin-host/http.ts`           | L107666–L108003、L108004–L108204                  | `PluginHttpRouter.handle` 返回形状                                                     |
| 插件主机对外 API          | `packages/core/plugin-host/core.ts`、`install.ts`、`lifecycle.ts`                         | L104929–L106066、L108274–L109203、L109204–L110121 | 安装/审批/激活状态机                                                                   |
| 错误类与文案              | `packages/core/plugin-host/errors.ts`                                                     | L107011–L107294                                   | 18 个错误类、`[PluginHost] ` 前缀规则                                                  |
| 声明式迁移                | `packages/core/plugin-host/declarative-migrator.ts`                                       | L106067–L106319                                   | 校验和比对（Mock 不做）                                                                |
| 卸载与孤儿数据            | `packages/core/plugin-host/uninstall.ts`、`orphan-data.ts`                                | L114285–L114651、L110549–L111092                  | 表与文件的清理责任边界                                                                 |
| 依赖安装                  | `packages/core/plugin-host/dependency-install.ts`、`dependency-resolver.ts`               | L106320–L106649、L106650–L107010                  | ZIP 内依赖是否被安装（答案：不装运行时依赖到 `plugins/`）                              |

对应参考页：[PluginContext 契约](plugin-context.md)、[命令与事件](command-and-event.md)、
[AI Actions](ai-actions.md)、[数据库](database.md)、[HTTP API](http-api.md)、
[平台服务](platform-services.md)、[Token 总表](token-reference.md)。

### 2.3 隔离与安全

| 主题             | 权威文件                                                                                                 | repomix 区间                                      | 看什么                                                                                                               |
| :--------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| 档位裁定         | `packages/core/plugin-host/execution-policy.ts`                                                          | L107295–L107434                                   | `resolvePluginExecutionMode`、`:37` 的 `VITEST` 分支                                                                 |
| 方法级 Barrier 3 | `packages/core/plugin-host/method-policy.ts`                                                             | L110122–L110455                                   | 8 个能力串、`exposeToAgent` 降级                                                                                     |
| 能力网关         | `packages/core/plugin-host/plugin-capability-gateway.ts`                                                 | L111093–L111189                                   | `hasCapability` 与通配语义                                                                                           |
| 域名授权         | `packages/core/plugin-host/plugin-grants.ts`                                                             | L111539–L111856                                   | `plugin_network_grants`、`classifyNetHostProposals`、SSRF 名单                                                       |
| SQL 守卫         | `packages/core/plugin-host/sql-guard.ts`                                                                 | L113087–L113405                                   | `assertPluginSqlAllowed`、40 张核心表、6 条禁操正则、fail-closed                                                     |
| 学生数据隐私     | `packages/core/plugin-host/student-data-privacy.ts`                                                      | L113447–L113655                                   | `student-data:*` 硬拒（Issue #225）                                                                                  |
| 权限旗标         | `packages/core/worker-runtime/plugin-permission.ts`                                                      | L128430–L128591                                   | `rw`/`ro`/`off` 生成的 `--allow-*` 列表                                                                              |
| 配额             | `packages/core/worker-runtime/plugin-limits.ts`、`plugin-quota.ts`、`../plugin-host/resource-tracker.ts` | L127896–L128020、L128592–L128701、L112940–L113086 | 128MB / 512MB / 8000ms per 10000ms、`/proc` 采样、SIGKILL                                                            |
| 子进程拉起       | `packages/core/worker-runtime/child-spawn.ts`、`child-isolate.ts`                                        | L126832–L127205、L126741–L126831                  | `ENV_ALLOWLIST` L126879、`buildMinimalEnv` L126919、`--max-old-space-size`                                           |
| 出站封锁         | `packages/core/worker-runtime/plugin-net-preload.cjs`、`plugin-net-proxy.ts`                             | L128021–L128286、L128287–L128429                  | `OPENLEARN_PLUGIN_NET_ALLOW` 拍完即删、`ERR_ACCESS_DENIED`                                                           |
| worker 管理      | `packages/core/worker-runtime/worker-manager.ts`                                                         | L131042–L132252                                   | `BASE_WORKER_SERVICE_TOKENS`（9）L131118–L131135、`computeAllowedWorkerTokens`                                       |
| 沙箱 bootstrap   | `packages/core/worker-runtime/bootstrap/sections/*.ts`                                                   | L125395–L126740                                   | `message-handler`（`reportProgress` 注入点 L125547 起）、`rpc-proxy`、`net-guard`、`process-masking`、`runtime-shim` |
| 服务代理         | `packages/core/worker-runtime/service-proxy.ts`、`service-host.ts`                                       | L129946–L130382、L128702–L129945                  | RPC 四道门                                                                                                           |
| 插件表 DDL       | `packages/core/plugin-host/plugin-tables.ts`                                                             | L112234–L112276                                   | grants / pending / storage 表结构                                                                                    |

对应参考页：[隔离与安全](isolation-and-security.md)、[能力与授权](capabilities.md)。

### 2.4 前端

| 主题                               | 权威文件                                                                   | repomix 区间                     | 看什么                                                                 |
| :--------------------------------- | :------------------------------------------------------------------------- | :------------------------------- | :--------------------------------------------------------------------- |
| 隐藏逻辑帧                         | `src/plugin-host/sandbox-frame.ts`                                         | L397461–L397491                  | 加载器契约、`missing activate function`、`Activation timeout (5000ms)` |
| 前端类型（另一套 `PluginContext`） | `src/plugin-host/types.ts`                                                 | L397902–L398853                  | 前端 ctx 与后端 ctx 的成员差异                                         |
| 扩展点渲染                         | `src/plugin-host/extension-point-renderer.tsx`                             | L393800–L394864                  | `__isLazyFactory`、未知 slot → `null`                                  |
| 熔断                               | `src/plugin-host/extension-breaker.ts`                                     | L393743–L393799                  | 3 次 / 5 分钟                                                          |
| 宿主动作分发                       | `src/plugin-host/host-action-dispatcher.ts`                                | L394865–L395284                  | 模块级单例、last-wins、不自动清理                                      |
| 状态存储                           | `src/plugin-host/plugin-host-store.ts`                                     | L395684–L395963                  | zustand、`position ?? 100`                                             |
| slot props 读取                    | `src/plugin-host/read-slot-props.ts`                                       | L397413–L397460                  | 每个槽实际透传的字段                                                   |
| 前端 token 白名单                  | `src/plugin-host/allowed-tokens.ts`                                        | L393059–L393208                  | 与后端不对称（Issue #224）                                             |
| 前端方法策略                       | `src/plugin-host/method-policy.ts`                                         | L395542–L395615                  | 浏览器侧能力集                                                         |
| 前端 worker                        | `src/plugin-host/browser-worker-manager.ts`、`browser-worker-transport.ts` | L393209–L393650、L393651–L393663 | 32 workers、10000/3000ms                                               |
| 插件主机                           | `src/plugin-host/plugin-host.ts`                                           | L395964–L397412                  | `invokeCommand` 前缀、`defaultHostActionDispatcher`                    |
| view 桥接（服务端）                | `server/utils/plugin-view-bridge.ts`                                       | L237721–L237868                  | op 集合、CSP、`sec-fetch-dest`                                         |
| 沙箱页组件                         | `src/components/PluginSandboxIframeView.tsx`                               | L266332–L266647                  | `FLOATING_VIEW_SLOTS`、316px                                           |
| 插件中心 UI                        | `src/components/PluginCenter.tsx` + `src/components/plugin-center/*`       | L264196–L264763、L248852–L251291 | 审批、网络授权、日志、开发面板                                         |
| 安装向导                           | `src/components/PluginInstallWizard.tsx`                                   | L264905–L266331                  | `approveCapabilities` / `approvePublicRoutes` 的 UI 入口               |

对应参考页：[前端沙箱](frontend-sandbox.md)、[Agent 工作手册](../playbook/agent-playbook.md)。

### 2.5 SDK 与脚手架

| 主题                                     | 权威文件                                                                         | repomix 区间                     | 看什么                                                              |
| :--------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------- | :------------------------------------------------------------------ |
| SDK 入口（导出面）                       | `packages/plugin-sdk/index.ts`                                                   | L139156–L139651                  | 导出块、`export type` 历史坑（TS1362）                              |
| SDK 类型快照（插件作者实际 import 到的） | `packages/plugin-sdk/openlearn.d.ts`                                             | L139652–L141123                  | `PluginContext` L140107–L140132、`services` 仅 2 键带 `\| null`     |
| `.d.ts` 生成                             | `packages/plugin-sdk/generate-dts.mjs`                                           | L135522–L139155                  | 快照如何产出（**漂移源头**）                                        |
| CLI                                      | `packages/plugin-sdk/cli.mjs`                                                    | L134816–L135521                  | `init` / `build` / `sign` 实际行为                                  |
| 打包                                     | `packages/plugin-sdk/build.mjs`                                                  | L134450–L134550                  | 裸说明符 exit 1 等构建期检查                                        |
| ZIP 组装与签名                           | `packages/plugin-sdk/cli.mjs` 的 `build` / `signZip`                             | L135347–L135351、L135030–L135077 | 只写 `index.js`/`manifest.json`/`frontend.js`；签名覆盖整包 SHA-256 |
| 三个模板                                 | `packages/plugin-sdk/scaffold/templates/{server-only,full-stack,frontend-only}/` | L133885–L134449                  | `src/index.ts` / `src/frontend.tsx` 契约                            |
| SDK 变更史                               | `packages/plugin-sdk/CHANGELOG.md`                                               | L134551–L134815                  | **有声称但源码不存在的能力**，见 §5                                 |
| 测试工具包                               | `packages/plugin-test-kit/index.ts`                                              | L141322–L141969                  | 全部 14 个导出                                                      |

对应参考页：[快速开始](agent-quickstart.md)、[测试与自检](testing.md)。

### 2.6 HTTP 入口与运维

| 主题           | 权威文件                                                       | repomix 区间                                | 看什么                                          |
| :------------- | :------------------------------------------------------------- | :------------------------------------------ | :---------------------------------------------- |
| 组合根         | `server.ts`                                                    | L422579–L423334                             | Token 注册总表、启动顺序、`VITEST` 守卫         |
| 插件 REST 路由 | `server/routes/plugins.ts`                                     | L209844–L211870                             | 安装/审批/启停/网络授权端点与状态码             |
| 插件 API 网关  | `server/routes/plugin-api-gateway.ts`                          | L209275–L209843                             | `/api/plugins/:id(*)/...`、confused-deputy 防护 |
| 数据库与迁移   | `packages/core/db/index.ts`、`migrator.ts`、`schema-golden.ts` | L71639–L72249、L72250–L72606、L73042–L73162 | `VITEST` 分支、迁移账本、schema 金标准          |
| 平台数据表     | `docs/reference/platform-data-tables.md`                       | L21845–L22410                               | 40 张核心表的清单来源                           |
| CI 门禁        | `.github/workflows/ci.yml`                                     | L2661–L3340                                 | 哪些 audit 会挡 PR                              |

---

## 3. `docs/` 文档层：能信到什么程度

文档与代码同源同仓，但**会漂**。按可信度分三档使用：

| 档                                                 | 文档                                                                                                                                                                                                                                                              | 用法         |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| **A 高**（逐字对齐代码，或本身是被测试钉住的规格） | `docs/reference/plugin-capability-matrix.md` L22411、`docs/plugin/plugin-manifest-spec.md` L20871、`docs/reference/plugin-database-api.md` L22734、`docs/reference/plugin-trust-boundary.md` L23112、`docs/plugin/frontend-sandbox-capability-boundary.md` L20219 | 可直接引用   |
| **B 中**（口径正确但有历史残留）                   | `docs/sdk/plugin-sdk.md` L28217、`docs/sdk/plugin-test-kit.md` L28577、`docs/sdk/scaffold-cli.md` L28824、`docs/tutorials/plugin-development-tutorial.md` L30079、`docs/tutorials/plugin-frontend-guide.md` L32282、`docs/plugin/plugin-lifecycle.md` L20688      | 用前抽查源码 |
| **C 低**（含已知错误/已过期声称）                  | `packages/plugin-sdk/CHANGELOG.md` L134551、`docs/reference/plugin-ui-extension-slots.md` L23277（曾漏 20 个槽位）、`docs/reference/activity-ecosystem.md` L21494（`RuntimePermission` 易与 `capabilityRequired` 混）                                             | 只当线索     |

`plugin-system-remediation-plan.md` 与 `plugin-system-remediation-tracker.md`
是**审计结论原件**（H-1 / E-2 / E-4 / B-2 / B-5 / C-3 / I-3 / P1 / Issue #147/#194/#224/#225/#232/#289 等编号都出自这里），
全站引用这些编号时可以回这两份文件核对。

---

## 4. 回源核验的四条命令

```bash
# ① 给一个文件路径 → 拿它在 dump 里的起始行号
grep -n '^<file path="packages/core/plugin-host/sql-guard.ts">' repomix-output.xml
# → 113087

# ② 给一个起点 → 找这个文件块的结束行（下一个 <file 的前一行）
awk 'NR>113087 && /^<file path=/{print NR; exit}' repomix-output.xml

# ③ 读某一段（务必控制宽度，别把整份 dump 读进上下文）
sed -n '113087,113200p' repomix-output.xml

# ④ 全文找某个符号/文案，并顺带看它落在哪个文件块里
grep -n 'assertPluginSqlAllowed' repomix-output.xml
```

**实用尺度**：单次读取控制在 **250 行以内**；
需要跨多文件找某个概念时，先 `grep -n '^<file path='` 收窄候选，再定点 `sed`。

---

## 5. 已知文档漂移与陈旧快照（汇总）

这一节是本站**特意保留**的：以下说法在官方材料里存在，但源码不支持。
若你的模型先验里带着它们，请以源码为准。

| 出现处                                                  | 声称                                                                            | 源码实际                                                                                                                                                                                   |
| :------------------------------------------------------ | :------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ``docs/sdk/plugin-test-kit.md`（L230）                  | 「前端 `ctx.commands.execute()` 也走同一条规则」                                | 全仓库 `ctx.commands` **只出现在这一行**；前端真实入口是 op `command.invoke` / `ctx.invokeCommand`                                                                                         |
| `plugin-capability-matrix.md` §6                        | 统计口径写 20 个 `capabilityRequired`                                           | §1.1 表列 19 个；第 20 个是 `segment:gate_eval`，属另一套登记                                                                                                                              |
| `plugin-capability-matrix.md` §5.3                      | `student-data:*` 处于「warn-and-allow 迁移宽限期」，带 `migrationWarning: true` | `context-builder.ts` 直接抛 `PluginCapabilityDeniedError`（Issue #225），且**没有 `migrationWarning` 这个字段**                                                                            |
| `packages/plugin-sdk/CHANGELOG.md`                      | 隐藏帧用 `location.replace` 复位、有 heartbeat 机制                             | 两者在 `sandbox-frame.ts` / 宿主实现中**均不存在**                                                                                                                                         |
| `plugin-sdk` `.d.ts` 快照                               | 7 个服务类型为非空                                                              | `types.ts` 里 **9 个全是 `T \| null`**（E-4，D-12 会置 null）                                                                                                                              |
| `parseRequiresEntry` 文档                               | 接受 `@>=1.0.0 <2.0.0`                                                          | `requiresItemSchema` 只接受 `^`/`~`/裸三段数字 + 可选 `-pre`，范围写法会被拒                                                                                                               |
| `manifest.api.baseRoute`                                | 字段存在                                                                        | 存在但**无路由作用**；安装时告警一次，字段被保留                                                                                                                                           |
| 教程里常见的 `ctx.reportProgress(...)`                  | 可直接调用                                                                      | 不是 `PluginContext` 成员；仅 worker/process 由 bootstrap 注入，inline 下是 `undefined`                                                                                                    |
| `full-stack` 模板 L134244 的 `db.prepare(...).run(...)` | 看起来是同步写入                                                                | `process` 档该行返回 **Promise**（RPC 垫片），不 `await` 即 fire-and-forget；第三方 ZIP 恒为 `process`                                                                                     |
| 脚手架 `frontend.tsx` 头注释                            | 「iframe 内没有 DOM」；「`component` 传进去直接 DataCloneError」                | 帧有自己的 `document`（只是 `display: none`）；manifest 里的 `component` 在 `parse()` 阶段就被 zod strip，**到不了 postMessage**，`DataCloneError` 只发生在运行期 `registerExtensionPoint` |
| 「ZIP 里的文件都会被装到插件目录」                      | 直觉预期                                                                        | 安装端只落盘 4 件套 + `storage/**` + `manifest.deploy.script`；其余条目随临时目录删除，`view` 的 HTML 必须走 `storage/` 且需自行加进 ZIP（SDK 不写）                                       |

**核验方式**：上表每一条都可以用 §4 的命令 ③ 打开对应区间自行复核。
本站任何页面与本页冲突时，**以带源码行号的那条为准**。

---

## 6. 取证

| 本表内容                                             | 生成方式                                                           |
| :--------------------------------------------------- | :----------------------------------------------------------------- |
| 423,944 行、1,988 个文件                             | `wc -l repomix-output.xml`、`grep -c '^<file path=' `              |
| 各顶层目录文件数                                     | `grep -oP '^<file path="\K[^/]+' \| sort \| uniq -c \| sort -rn`   |
| 全部区间起止                                         | 遍历 `<file path=` 行，取「下一个 `<file path=` 的行号 − 1」为块末 |
| `requiresItemSchema` 正则与消息                      | `manifest-schema.ts` L82293–L82296                                 |
| `manifestSchemaV3` 更严的正则                        | 同文件 L82373–L82376                                               |
| `contributesSchema` / 顶层 `.passthrough()`          | 同文件 L82236、L82358、L82404                                      |
| `network` 子对象为默认 strip                         | 同文件 L82398–L82403                                               |
| `baseRoute` 无作用与安装期一次告警                   | 同文件 L82266–L82275                                               |
| `parseRequiresEntry` 的 `indexOf('@', indexOf('/'))` | `manifest-utils.ts` L82445–L82470                                  |
| `No handler registered for command:`                 | ``packages/core/command-bus/index.ts`→`handler`（L123）            |
| worker 侧 `... in worker`                            | `worker-runtime/bootstrap/sections/message-handler.ts` L125652     |
| `validateJsonSchema` 只认 5 个大写类型               | ``packages/core/kernel/index.ts`→`validateJsonSchema`（L689–L751） |
| `PLUGIN_SHARED_MODULES` 7 项                         | `plugin-host/types.ts` L113731                                     |
| 9 个服务全为 `T \| null`（E-4）                      | 同文件 L113883–L113905                                             |
| `resolvePluginCommandType` 与 UUID v7 短路           | `plugin-host/plugin-namespace.ts` L112002–L112019                  |
| bootstrap 内联副本曾漂移                             | `worker-runtime/__tests__/namespace-parity.test.ts` L121053 起     |
| `ctx.reportProgress` 注入点与 inline 为 undefined    | ``docs/plugin/plugin-lifecycle.md`（L87–L89）                      |
| net 预载读环境变量后即删                             | `plugin-net-preload.cjs` L128021–L128060                           |
| `BASE_WORKER_SERVICE_TOKENS` 9 项                    | `worker-runtime/worker-manager.ts` L131118–L131135                 |
| Vitest per-worker 临时库与 env 清理                  | `vitest.setup.ts` L423648 起                                       |
| 覆盖率阈值与 include/exclude                         | `vitest.config.ts` L423551–L423647                                 |
| 审计编号（H-1/E-2/E-4/B-2/B-5/C-3/I-3/P1/#224/#225） | `plugin-system-remediation-tracker.md` L14844、L14894–L14914       |
