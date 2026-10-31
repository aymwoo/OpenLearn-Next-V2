# 待确认清单（`待确认` 结论登记处）

> **规则**：正文中任何标注 `待确认` 的结论，必须在此登记一行。
> 未登记却写 `待确认` ＝ 未完成；在此登记即表示「已知信息缺口，不得据此编码」。
> 字段固定五项：**缺口 / 影响 / 现有证据 / 如何确认 / 归属**。

状态定义：`OPEN` = 未解决，禁止据此编码；`PARTIAL` = 机制已验证、外层呈现未验证；`CLOSED` = 已确认并回写正文。

---

## 0. 汇总

| # | 缺口 | 状态 | 阻塞什么 |
| --- | --- | --- | --- |
| U-01 | `socketService` 在运行期是否会出现缺失 | `OPEN` | 前端事件订阅要不要写轮询兜底 |
| U-02 | `INetworkProxyServiceToken` 为何不可解析 | `CLOSED` | — （结论：沙箱专用，`inline` 下拿不到） |
| U-03 | 前端与服务端两套 `method-policy` 规则是否等价 | `OPEN` | 同一调用在两端判定不一致的风险 |
| U-04 | `exposeToAgent: false` 对 HTTP 路由可达性的影响 | `OPEN` | 隐藏命令能否仍被前端调用 |
| U-05 | 空 `capabilitiesProposed` 激活失败的外层状态码 | `PARTIAL` | 排障文案与前端提示 |
| U-06 | `view` 通道 `ui.resize` 是否受方法级门禁 | `OPEN` | 视口高度策略 |
| U-07 | 熔断后 `origin: 'manifest'` 数据是否真的保留 | `PARTIAL` | 崩溃插件的数据可见性 |
| U-08 | `plugin.contract.json` 是否有平台消费方 | `OPEN` | 它是不是「写了也没用」的文件 |
| U-09 | 生产反向代理下 504 的真实触发边界 | `OPEN` | 网关超时配置 |
| U-10 | SDK 裸说明符守卫的起始版本 | `PARTIAL` | 老插件升级是否会突然构建失败 |
| U-11 | `resource.*` 4 条命令缺描述符是否为有意设计 | `CLOSED` | — （结论：是遗漏，已补 4 条 descriptor） |

---

## U-01 `ctx.services.socketService` 在运行期是否会出现缺失

- **缺口**：`FrontendPluginContext.services` 的类型声明把 `socketService` 列为**必填**
  （`src/plugin-host/types.ts` L525-530），但示例插件 `lab-seat` 全程用 `ctx?.services?.socketService`
  可选链并实现了一整套轮询兜底（`[P] src/frontend.tsx` L66-136，注释称「不同 host 版本下差异较大，
  老版本没有 socketService」）。两者矛盾。
- **影响**：若确认会缺失，插件必须自带轮询；若确认不会缺失，那 70 行兜底即为死代码，且会让
  「事件驱动」这条主路径被低频轮询污染（每 30s 一次额外请求 × 每个挂载的组件）。
- **现有证据**：只有类型声明与插件注释，**没有**宿主侧构造 `services` 对象时给 `socketService` 赋
  `null`/`undefined` 的代码路径。
- **如何确认**：在 `src/plugin-host/plugin-host-context.tsx` 与 `plugin-host.ts` 里搜
  `services:` 的赋值处，确认 `socketService` 是否恒为同一实例；再在 dev 环境 console 打印
  `ctx.services.socketService`。
- **归属**：平台前端宿主。

## U-02 `INetworkProxyServiceToken` 为什么完全不可解析 —— **CLOSED**

- **结论**：它是**沙箱专用服务**，不在主进程 DI 注册表里。注册/拦截点在子进程 RPC 层：
  `packages/core/worker-runtime/service-host.ts` L769-770 以**字符串**匹配
  `msg.token === '@openlearn/core:INetworkProxyService'`，转给宿主侧网络代理；
  并列入 `packages/core/worker-runtime/worker-manager.ts → BASE_WORKER_SERVICE_TOKENS`（L77-87，9 个）。
- **为什么之前误判为「不可解析」**：`PLUGIN_RESOLVABLE_TOKENS`（`packages/core/di/interfaces.ts` L946）
  描述的是**主进程可解析集**，用它在主进程测自然拿不到；`inline` 插件也不走 RPC 拦截器，同样拿不到。
- **对编码的影响**：需要出站网络的逻辑应放在 `process` / `worker` 模式下，
  或改用 `ctx.http`（`IPluginHttpRouter`）由宿主代理发出。**`inline` 插件不要依赖此 Token。**
- **已回写**：[context-and-services.md](../plugin-system/context-and-services.md) §3「两个陷阱」。

## U-03 两套 `method-policy.ts` 规则是否等价

- **缺口**：存在两个同名文件 —— `packages/core/plugin-host/method-policy.ts`（服务端，主进程）
  与 `src/plugin-host/method-policy.ts`（前端宿主）。**两者签名不同**，注释互不引用。
- **影响**：同一个 `api.get('/x')` 调用会出现「前端判允许、服务端判拒绝」的双端不一致，
  表现为「点了没反应但日志无错」或「前端报错但服务端正常」。
- **现有证据**：仅确认两者都存在且签名不同；未逐条比对规则集。
- **如何确认**：各自导出规则表并做集合 diff，写入 [capabilities-and-security.md](../plugin-system/capabilities-and-security.md) §6。
- **归属**：平台（前端 + 服务端），改动需双端同步。

## U-04 `exposeToAgent: false` 对 HTTP 路由可达性的影响

- **缺口**：类型注释声明 `exposeToAgent: false` = 「仅程序化可达（HTTP 路由 / commandBus /
  `ctx.invokeCommand`），不出现在 agent 工具箱」（`packages/plugin-sdk/openlearn.d.ts`
  `interface ActionDescriptor`）。但未验证 HTTP 网关是否**读**这个字段。
- **影响**：如果网关也读它做拦截，那么把它设成 `false` 会同时切断前端调用 —— 这会是一个
  「为了不让 AI 看见，结果人也不能用」的陷阱。
- **现有证据**：只有 JDK 注释，未见消费代码。
- **如何确认**：`grep -rn "exposeToAgent" server/ packages/core/`，逐个调用点看是否影响路由注册。
- **归属**：平台内核 / 网关。

## U-05 空 `capabilitiesProposed` 激活失败的外层呈现

- **缺口**：机制层面已验证 —— `process` 模式下 `method-policy` 用
  `manifest.capabilitiesProposed` 作为允许集（`packages/core/plugin-host/method-policy.ts` L186），
  空数组 ⇒ `registerHandler` 等非 `get*` 方法被拒 ⇒ `activate()` 抛错 ⇒ 激活失败。
  但**外层 HTTP 状态码与错误码**（是否 500、`code` 是什么）未实际跑过。
- **影响**：只影响排障文案准确性，不影响编码结论。
- **现有证据**：`packages/core/plugin-host/lifecycle.ts` L191/L294/L555 `grantCapabilities(...)`。
- **如何确认**：造一个 `capabilitiesProposed: []` 的 `process` 插件，安装后调
  `/api/plugins/:id/activate`，记录响应体。
- **归属**：平台内核；确认后回写 [capabilities-and-security.md](../plugin-system/capabilities-and-security.md) 与
  [error-handling-and-cleanup.md](../plugin-system/error-handling-and-cleanup.md)。

## U-06 `ui.resize` 是否受方法级门禁

- **缺口**：`view` 通道的 `OpenLearnPluginBridge.resize(height)`（`server/utils/plugin-view-bridge.ts` L110-111）
  通过 `post({ type: 'resize' })` 走**独立通道**，不在 `bridge-ops.json` 的 8 个 `view_wire_ops` 里。
  它是否经过 method policy / 是否需要在 `manifest` 里声明，未知。
- **影响**：若受门禁，非受信插件设置高度会被拒，表现为 iframe 高度不跟随内容（常见「页面被裁切」）。
- **现有证据**：`server/utils/__tests__/plugin-view-bridge.test.ts` L26 断言 bridge JS 含 `resize:`，
  只证明方法存在，不证明门禁行为。
- **如何确认**：在 `serve` 侧搜 `type === 'resize'` 分支，看它是否先过 `checkMethodPolicy`。
- **归属**：平台前端宿主 / view bridge。

## U-07 熔断后 `origin: 'manifest'` 的数据是否真的保留

- **缺口**：文档结论是「`origin: 'manifest'`（数据贡献）在前端崩溃被熔断后仍保留，
  `origin: 'runtime'`（运行期注册）随健康度摘除」。该语义来自
  `src/plugin-host/extension-breaker.ts` + `extension-point-renderer.tsx` 的读码推断，
  未做「故意让组件抛 3 次错 → 观察另一组贡献是否还在」的端到端验证。
- **影响**：影响插件设计决策 —— 如果你的菜单项是运行期注册的，崩溃一次就会被摘掉。
- **现有证据**：`CRASH_BREAKER_THRESHOLD = 3`（L14）、`CRASH_BREAKER_WINDOW_MS = 5min`（L15）、
  判定 L30/L36。
- **如何确认**：写一个组件在 `render` 里按 props 抛错，连续触发 3 次后检查同插件其他槽位是否存活。
- **归属**：平台前端宿主。

## U-08 `plugin.contract.json` 是否有平台消费方

- **缺口**：`[P] plugin.contract.json` 声明了 `executionMode` / `uiChannel` / `slots` /
  `trustedInlineAllowlistEntry` / `studentVisible` / `whiteboardWidget`。
  这些字段**不在** `manifestSchema` 里（`packages/core/esm-loader/manifest-schema.ts`）。
  它是插件仓库自建的交付侧声明，平台是否读取未知。
- **影响**：若无人消费，它只是给人看的清单 + 给 `static-check.mjs` 用的白名单来源；
  不能当作「写上就生效」的配置。
- **现有证据**：本仓库内 `grep -rn "plugin.contract"` 未找到读取方（本轮未穷尽）。
- **如何确认**：全仓搜 `contract.json`；若仅出现在插件仓库，则判定为「文档性文件」。
- **归属**：插件仓库（若确认无消费方，应在 README 注明「非平台字段」）。

## U-09 生产反向代理下的 504 触发边界

- **缺口**：网关超时返回 504（`server/routes/plugin-api-gateway.ts` L560 附近），
  但 `TRUST_PROXY` 默认关闭（`AGENTS.md` 环境段落），反向代理后的真实超时归谁、
  SSE 连接是否被代理提前断开，均未验证。
- **影响**：只影响部署侧；不影响插件代码。
- **现有证据**：`deploy/` 下有 2 个 nginx conf，未逐条比对 `proxy_read_timeout` 与网关超时的关系。
- **如何确认**：起一个慢 handler（>网关超时），分别直连与过 nginx 打，记录两边的状态码与连接状态。
- **归属**：部署 / 平台。

## U-10 SDK 裸说明符守卫的起始版本

- **缺口**：`[P] src/frontend.tsx` L13-16 注释称「SDK 3.7.2+ 的 CLI 会对 frontend 产物做裸模块说明符守卫，
  当前 SDK 3.5.2 还没有该守卫」。本地 SDK 是 3.7.5，但守卫的**精确引入版本**未查 CHANGELOG。
- **影响**：老插件若不改 `import React from 'react'`，升级到某个版本后构建会突然失败。
- **现有证据**：插件注释（二手证据），非 SDK CHANGELOG。
- **如何确认**：`packages/plugin-sdk/CHANGELOG.md` 搜「bare specifier / 裸模块」。
- **归属**：SDK。

---

## U-11 `resource.*` 4 条命令缺 ActionDescriptor —— **CLOSED**

- **结论**：是**遗漏**，不是有意设计。已在 `server/routes/resources.ts` 的
  `registerResourcesRoutes()` 尾部补齐 4 条 descriptor（`resource.list` / `.get` / `.create` / `.delete`），
  位置紧挨 `RESOURCE_HANDLERS` 之上。
- **判为遗漏的依据**：handler 的注释自己写着 `plugin accessible`，说明设计意图是给插件用；
  若有意只走 REST，不会写出这套 handler + 注释。且该文件 HTTP 路由（5 个端点）与命令面
  是两条独立通路，命令面缺描述符属于「写了但没接线」，不是「刻意不接线」。
- **修复取舍**（三点，改这 4 条命令前必读）：
  1. 能力复用 `management:read` / `management:write`，不新造 `resource:*` 前缀 ——
     `CapabilityGuard` 的角色回退只认既有词汇表（`capability-guard.ts` L84-97），
     teacher 持 `management:*`、`agent-system-0` 持 `management:read+write`，新前缀会让两者双双被拒；
  2. `resource.delete` 标 `isHighRisk: true` —— 同时删 `system_resources` 行与
     `storage/courseware` 磁盘缓存且不可回滚，与 `lesson.delete` / `user.delete` 同档；
  3. 无参命令 `resource.list` 用 `{ type: 'OBJECT', properties: {} }`（同 `courseware.list`），
     因此**调用方必须传 `{}`**：`validateJsonSchema` 见到 `type: 'OBJECT'` 就要求 payload 是对象，
     省略会得到 `Expected object, got undefined`。
- **验证**：`node scripts/plugin-command-audit.mjs` → `registerHandler 84 / actionRegistry 84 /
  有 handler 无 action 0 / 有 action 无 handler 0`；
  回归测试 `server/__tests__/resource-commands.test.ts`（7 例）。
- **顺带修掉的工具缺陷**：`scripts/plugin-command-audit.mjs` 原先看不见两种注册写法
  （`for (const spec of SPECS) register({ commandType: spec.commandType })` 与
  `for (const [k, h] of Object.entries(MAP)) registerHandler(k, h)`），
  前者造成 5 条假阳性（`classroom.countdown.*`），后者正是本缺口长期隐身的原因。
  另把 `src/` 里两段模板字符串教学示例（`quiz.create` / `hello.greet`）从命令面统计中剔除。
- **归属**：平台服务端（资源库模块）。
- **已回写**：[commands-and-events.md](../api/commands-and-events.md) §4。

---

## 11. 撰写过程中做的主观取舍（非缺口，但需要知情）

这些不是「信息不足」，而是**在信息充足前提下选择了某一种表述**。列出以便复核。

| # | 取舍 | 理由 | 若你不同意 |
| --- | --- | --- | --- |
| A-01 | 所有计数（120 / 40 / 19 / 8 / 7 / 71 / 38 / 10 / 8 / 31）以 `docs/agent/contracts/*.json` 为准，不逐个数源码 | 契约文件是平台为 AI 准备的机器可读真源，且已与源码同步过一次；数源码成本高且易错 | 用 [source-index.md](source-index.md) §1 的 6 条命令复核，冲突则以源码为准并回改本目录 |
| A-02 | 把 `lab-seat` 的 `computer_labs` 建表定为「反例」而非「可用技巧」 | 它在 `inline` 模式下未被拦，只是守卫作用面没覆盖到，不是被允许 | 若你的插件确定永远 `inline` 且愿意承担平台加黑名单的风险，可自行采纳 |
| A-03 | `ctx.config[key]` 判定为「静默失效缺陷」，并在正文给出替代写法 | `ConfigService` 确无按 key 的属性（`config-service.ts` L150 起只有方法），`cfg[key]` 恒 `undefined` | 若平台后续加了属性 getter，回改 [context-and-services.md](../plugin-system/context-and-services.md) §5 |
| A-04 | `inputSchema` 一律按「大写类型名才校验」表述 | `validateJsonSchema` 的 `if/else if` 分支只匹配 `'OBJECT'/'ARRAY'/'STRING'/'NUMBER'/'BOOLEAN'` | 若平台改用标准 JSON Schema 库，此结论整段作废 |
| A-05 | 不收录旧文档 `docs/tutorials/plugin-development-tutorial.md` 的任何结论 | 1959 行叙述式教程、无检索锚点、部分版本已过期，逐条核验成本高于重写 | 需要时以源码为准重写，不要搬运 |
| A-06 | 「已对齐 7 个契约文件」仅指**计数与名称**对齐，未逐字段比对 | 逐字段比对 7 个 JSON 与全文档的收益低于成本 | 需要逐字段校验时，另起一轮专项 |

---

## 12. 维护约定

```text
新增 `待确认` 结论 → 必须在此登记（编号 U-xx 递增）
确认后            → 状态改 CLOSED，回写正文去掉模糊措辞，并在 [source-index.md](source-index.md) 补坐标
发现正文与源码冲突 → 先改正文，再改本表，最后改 source-index
```

`U-xx` 编号不复用、不重排，便于跨版本追溯。
