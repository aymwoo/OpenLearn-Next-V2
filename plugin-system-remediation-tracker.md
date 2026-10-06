# 插件系统整改跟踪台账

> 状态：**未开始** ｜ 建立日期：2026-10-06 ｜ 最后更新：2026-10-06
> 关联审计报告：[`audit-plugin-system-2026-10-06.md`](./audit-plugin-system-2026-10-06.md) ｜ 关联计划：[`plugin-system-remediation-plan.md`](./plugin-system-remediation-plan.md)
>
> 本文件是插件系统专项审计（37 项发现）后续修复的**待办总入口**。
> **审计报告与本台账不一致时，以审计报告为准**（台账只追踪进度，不重新定义问题）。

---

## 维护规则

1. 本台账的发现编号（C-x / H-x / M-x / L-x）与审计报告**一一对应**，不得重排。审计报告新增发现时，先改报告再在此登记。
2. 每完成一项：勾选状态 → 更新「最后更新」日期 → 在「完成日志」追加一行（含 commit 号）。
3. 状态取值：`☐ 待办` / `◐ 进行中` / `☑ 已完成` / `⊘ 放弃（附决策号）` / `⇥ 推迟（附批次号）`
4. **未勾选即未完成**。禁止在代码已改但台账未勾的情况下宣称批次完成。
5. 每批次收尾必须跑验证矩阵（见计划 §5），结果记录在批次表格的「验证」行。
6. 涉及决策的点（D-1 ~ D-6）先在「决策日志」记录结论，再开始对应项。

---

## 当前状态

| 指标 | 数值 |
| --- | --- |
| 发现总数 | **37**（Critical 6 / High 11 / Medium 12 / Low 8） |
| 已完成 | 0 |
| 进行中 | 0 |
| 待办 | 37 |
| 当前批次 | — （Batch 0 待启动） |
| 已知红灯 | 1（`openlearn-dts-parity` 基线 33 vs 34，编号 H-5） |
| 工作树 | 脏（stage-guard WIP 12 改 + 3 新）→ **阻塞所有批次** |

### 批次进度

| 批次 | 主题 | 项数 | 完成 | 状态 |
| --- | --- | --- | --- | --- |
| Batch 0 | 基线与前置 | 3 | 0 | ☐ 待办 |
| Batch 1 | 安全门 | 12 | 0 | ☐ 待办 |
| Batch 2 | 生命周期正确性 | 10 | 0 | ☐ 待办 |
| Batch 3 | 契约与工具化 | 12 | 0 | ☐ 待办 |
| Batch 4 | 减法与文档校正 | 7 | 0 | ☐ 待办 |
| Batch 5 | 新扩展点 + 长期方案 | 6 | 0 | ☐ 待办 |
| **合计** | | **37**（含跨批次重复计数） | **0** | |

---

## 根因分组总览

37 项发现归为 9 个根因。**按根因而非按编号推进**，避免修 A 撞回 B。

| 根因 | 发现 | 涉及批次 |
| --- | --- | --- |
| **A** 静态防线只在一条安装路径生效 | C-1, C-6, M-6, L-4 | 1 |
| **B** capability 模型在 worker 路径是装饰性的 | C-2, H-9, H-10, H-11 | 1, 5 |
| **C** 状态机缺单一权威与互斥 | C-3, C-4, C-5, H-2, H-3, H-4 | 2 |
| **D** 资源回收只覆盖被 track 的一半 | M-1, M-2, M-3, M-4 | 2 |
| **E** 契约人手同步，测试只覆盖 5% 漂移 | H-5, H-6, H-7, L-8 | 3 |
| **F** 抽象与文档超前于实现 | M-9, M-10, M-12, L-5 | 4 |
| **G** 鉴权与策略判定不一致（缺省放行） | H-1, M-5, M-7, L-1, L-2 | 1, 4 |
| **H** 测试与运行时不隔离 / 数据模型缺约束 | H-8, L-3, L-6, L-7, M-11 | 0, 3 |
| **I** 新扩展点缺安全默认值 | M-8 | 5 |

---

## Batch 0 —— 基线与前置

| ID | 项 | 状态 |
| --- | --- | --- |
| B0-1 | **提交或 stash stage-guard WIP**（12 改 + 3 新：`openlearn.d.ts` / `di/interfaces.ts` / `plugin-sdk/index.ts` 是 Batch 3 必改文件） | ☐ |
| B0-2 | 跑 `pnpm test` 记录全量基线到本文件「完成日志」（当前已知：插件域 379 绿 / 1 红） | ☐ |
| B0-3 | 清理存量 `plugins/` 5026 个孤儿目录（75MB）：`find plugins -maxdepth 1 -type d -name '*-*-*-*-*' -exec rm -rf {} +` | ☐ |

**退出标准**：工作树干净；基线已记录；`ls plugins/ \| wc -l` ≤ 个位数。
**验证**：`_（无代码变更）_`

---

## Batch 1 —— 安全门

> 原则：只做**纯增量**的门，不改既有判定逻辑。回归风险最低，风险削减最大。

### A 组 —— 一道静态门

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A-1 | **C-1** | `install-utils.ts:65-94`、`worker-manager.ts:938` | 抽 `assertPluginCodeSafe(code)`：AST 级拒绝计算式 `import()`、`eval`、`new Function`、动态 `require`。放在 `bundlePlugin()` 出口 | 恶意样本 `await import('node:'+'child_process')` 被拒；合法插件（含 `@openlearn/*` 静态导入）不误伤 | ☐ |
| A-2 | **C-6** | `plugin-host/index.ts:1015-1023`、`builtin.ts:848-869` | `installPlugin()` 先经 `bundlePlugin()` + `assertPluginCodeSafe()`，与 `installPluginFromZip()` 共用同一道门 | 两条安装路径对同一恶意样本给出相同拒绝；`plugin.install` 路径不再出现「裸源码落盘」 | ☐ |
| A-3 | **M-6** | `install-utils.ts:79-80` | 拒绝绝对路径 import（`args.path.startsWith('/')` 不再放行）；`node-loader.ts:8-9` 失实注释改为准确描述 inline 无隔离 | 插件无法内联 `/etc/passwd`、`package.json` 等宿主文件；注释与实测一致 | ☐ |

### B 组 —— 让 capability 真正生效

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B-1 | **C-2** | `worker-runtime/service-host.ts:156`（注入但零调用） | `invoke` 路径接 `capabilityGuard.check(pluginActorId, ...)`。⚠️ 先验证 `grant`（`index.ts:1152-1156`）与 `check` 的 actorId 拼写一致 | worker actor 缺少 capability 时被拒；当前能跑的 worker 插件**不被误杀**（见 D-4） | ☐ |
| B-2 | **H-11** | `allowed-tokens.ts:106-110`、`worker-manager.ts:102` | 白名单判定由 `includes()` 子串改**精确匹配**（复用 `parseRequiresEntry`） | `requires: ['@x/x:IFakeISemesterGradeService']` 不再命中；正常声明仍命中 | ☐ |
| B-3 | **H-10** | `service-host.ts:644`（`!== 'get'`）vs `src/plugin-host/service-host.ts:247`（`!startsWith('get')`） | 两端统一为同一语义（建议 `startsWith`，因 Barrier 2 的意图是「只读」） | `getUserList` / `getAllActions` 在 server worker 与 browser worker 行为一致；加**共享测试向量** | ☐ |
| B-4 | **H-9**（a 部分） | `src/plugin-host/method-policy.ts` | 把策略抽为**两端共享的纯数据模块** + 共享测试向量；先不改后端行为 | 后端 `worker-runtime/` 引用同一策略常量；`grep` 不再出现两份独立白名单 | ☐ |

### G 组 —— default-deny

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| G-1 | **H-1**（a 部分） | `kernel/index.ts:261-313` | interceptor 补 `else` 分支：`action` 缺失即抛错（现无 `else`，等于 default-allow） | 未注册 action 的命令被拒；⚠️ 先完成 D-5 决策 | ☐ |
| G-2 | **H-1**（b、c 部分） | `plugins.ts:682, 699-710` | 删后缀模糊匹配 `key.endsWith(':'+type)`；路由提权到 `requireAuth('teacher')` | 学生角色调用 `execute-command` 被拒；请求不被重定向到其他插件的 handler key | ☐ |
| G-3 | **M-5** | `plugins.ts:530, 179` | 给 `/api/plugins/:id`、`/api/plugins/by-manifest/:id` 补 `requireAuth()`（同文件其余 15 个路由已有） | 匿名请求返回 401 | ☐ |

**批次退出标准**
- [ ] 新增恶意插件样本测试 9 个场景全绿
- [ ] `pnpm test` 0 红灯
- [ ] `pnpm lint` 0 error
- [ ] `ls plugins/` 不增长

**本批次风险（执行前必读）**
- G-1 可能误伤「只 `registerHandler` 不 `registerAction`」的现存命令 → **必须先跑 D-5 决策**
- B-1 可能把当前能跑的 worker 插件全部拦死 → **必须先验证 actorId 拼写**

---

## Batch 2 —— 生命周期正确性

> 根因 C 的收敛。**必须先补测试再改代码**——现状是 6 个并发/泄漏缺陷却没有一条针对性测试。

### 步骤 0：先写测试

| ID | 内容 | 状态 |
| --- | --- | --- |
| C-0a | 并发 activate/deactivate（inline） | ☐ |
| C-0b | 并发 activate/deactivate（worker） | ☐ |
| C-0c | reload 失败后旧实例资源是否存活 | ☐ |
| C-0d | inline↔worker 切换后 worker 线程数 | ☐ |
| C-0e | activate 超时后 `track()` 的资源是否泄漏 | ☐ |
| C-0f | worker 崩溃 + 立即卸载 → watchdog 是否复活 | ☐ |

### C 组 —— 单一状态权威与互斥

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| C-1 | **H-4** | `index.ts:1372` vs `1357`；`worker-manager.ts:1237` | 抽 `setPluginState(pluginId, state, {persistDb})`，内存与 DB 在同一函数内更新 | 激活失败会写 DB；worker 熔断会写内存；启动巡检无 DB/内存分歧 | ☐ |
| C-2 | **H-2** | `index.ts:202-203, 1510` | 合并 `inflightActivate`/`inflightDeactivate` 为单一 per-plugin 互斥；`reloadPlugin` 纳入串行化 | 并发 activate+deactivate 结果确定（不再静默 return）；`togglePlugin` 无 TOCTOU | ☐ |
| C-3 | **H-3** | `index.ts:1340-1347, 1562-1569` | 引入 `AbortSignal`；`ResourceTracker` 支持「已关闭 pluginId 的后续 `track()` 立即 dispose」 | 超时后插件继续注册的资源被立即回收，不进入新 list | ☐ |
| C-4 | **C-3** | `index.ts:2692` | reload 失败分支改用 `snapshot` 精确清理（对齐成功路径 `2718-2725`） | reload 失败后旧实例仍可服务命令；状态不谎报 ACTIVE | ☐ |
| C-5 | **C-4** | `index.ts:2382-2391, 1521, 540-549` | mode 作为显式参数贯穿停用链路，不再从 DB 二次读 | worker→inline 切换后 worker 线程数归零；无 "Worker already exists" | ☐ |
| C-6 | **C-5** | `worker-manager.ts:281-296, 330-383` | 定时器句柄存入 worker 注册项；`terminate()` 中 `clearTimeout` | 崩溃后立刻卸载，1–4s 后不复活；`workerRef` 同步清理 | ☐ |

### D 组 —— 回收覆盖面

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D-1 | **M-1** | `context-builder.ts:519-532, 411-423` | 把 `registerAIPersona` / `registerAIContextProvider` / `registerDimension` 纳入 `tracker.track` | 停用插件的 AI persona / context provider / points 维度不再出现 | ☐ |
| D-2 | **M-2** **M-3** | `index.ts:987/1907/2374` vs `1859`；`unified-extension-registry.ts:38-113` | `deactivatePlugin` 注销 contribution；`UnifiedExtensionRegistry` 补 `unregister` API | 停用插件的按钮/Tab/挂件立即消失；重复 id 语义统一 | ☐ |
| D-3 | **M-4** | `index.ts:1827-1843`, `setExpressApp:244-259` | `deploy.staticRoute` 在停用时即摘除（现仅 uninstall 摘） | 停用插件的静态资源返回 404 | ☐ |

**批次退出标准**
- [ ] C-0 的 6 个测试场景全绿（且修复后仍全绿）
- [ ] `pnpm test` 0 红灯
- [ ] 跑完全量测试后 `ls plugins/ | wc -l` **不增长**

**本批次风险**
- C-2 改变并发行为 → 可能暴露被「静默 return」掩盖的调用方；**M-2 的 UI 残留可能就依赖它**，改后 UI 行为会变，需与前端确认
- C-1 会暴露已有的 DB/内存分歧 → 可能有一批插件启动时状态翻转，需先做全量 DB 状态巡检
- D-2 修复后 UI 残留立即消失 → 需确认无 UI 依赖「停用后按钮还在」的脏逻辑

---

## Batch 3 —— 契约与工具化

> **前置：B0-1 已完成（stage-guard WIP 已提交）**

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| E-0 | **H-5**（a） | `plugin-sdk/__tests__/openlearn-dts-parity.test.ts:74` | 基线 33 → 34 | 红灯转绿 | ☐ |
| E-1 | **H-5**（b） | `di/interfaces.ts`、`kernel/index.ts`（未注册）、`openlearn.d.ts:947` | `IStageGuardServiceToken` 要么在 DI 注册、要么从 SDK 撤下 | `ctx.resolve(IStageGuardServiceToken)` 运行时不再抛错 | ☐ |
| E-2 | **H-6** **L-8** | 同上测试文件 | parity 测试升级为 **AST 成员级 diff**（`ts-morph` 解析两侧 interface 成员并 diff），覆盖 Token 名以外的签名/字段漂移 | 能主动检出「故意注入的类型漂移」；输出机器可读漂移清单 | ☐ |
| E-3 | **H-6** | `index.ts`（212 类型导出）vs `openlearn.d.ts`（91 声明） | 补齐 **130 幽灵类型 + 26 反向漂移**。顺序：`PluginState` → `capability/**` 8 → `service-registry/**` 11 → 其余。⚠️ 以 E-2 的机器清单为准，不手写 | 第三方插件按发布包 `import type` 全部可编译 | ☐ |
| E-4 | **H-7** | `scaffold/templates/*/src/index.ts` × 3 | 补 `main`；`Manifest` 加 `description` / `author` 并同步 zod schema | scaffold → install → activate 全链路通过 | ☐ |
| E-5 | **H-6**（长期） | `openlearn.d.ts` | 改为**从 core 生成**，不再手写 | 新增 Token / 类型无需手工同步 | ☐ |
| H-1 | **H-8** | `plugin-host.test.ts:304`、`hot-reload.test.ts:203/347/442` | 全部 `new PluginHost(...)` 补 `pluginsDir` 临时目录 + `afterEach` 清理；`vitest.setup.ts` 加全局守卫禁止写 `process.cwd()/plugins` | 跑完全量测试后 `plugins/` 目录数不增长 | ☐ |
| H-2 | **L-6** | `index.ts:811` vs `987/1907/2374` | `listContributions` 键匹配修正（registry 以 `manifest.id` 为键，查询用了 UUID） | 带 UUID 查询不再恒返回空 | ☐ |
| H-3 | **L-7** | `packages/core/db` schema | `plugins` 表补 `version` 列 + migration（**须带 `-- DOWN` 块**，沿用 M-10 历史教训） | 可做 SQL 级版本查询 | ☐ |
| H-4 | **L-3** | `index.ts:2017-2026` | 移除硬编码 `registry.npmmirror.com`；加 lockfile 完整性校验；**安装失败必须中止激活**而非 `console.error` 后继续 | 依赖安装失败时插件不进入 ACTIVE | ☐ |
| H-5 | **M-11** | `dependency-resolver.ts:169-179, 218-242`；`index.ts:2539` | 区分「缺依赖阻塞」与「循环依赖」；被阻塞的插件**不**进 `cycles` 且不强行激活 | 缺依赖插件不再被误报为循环依赖、不再被强行激活 | ☐ |

**批次退出标准**
- [ ] `pnpm test` 0 红灯
- [ ] parity 测试能主动检出注入的漂移
- [ ] scaffold 全链路通过
- [ ] `pnpm build` 通过

**本批次风险**
- **E-3 工作量最大且机械** → 必须先做 E-2 拿到机器清单，再分批补
- E-4 扩大会改变 manifest 面 → 需同步 zod schema（当前靠 passthrough 兜底）

---

## Batch 4 —— 减法与文档校正

> **建议在 Batch 1/2 落地并观察一周后执行**，以最终形态判断什么是真死代码。

| ID | 发现 | 位置 | 改动方案 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- |
| F-1 | **M-12** | `src/plugin-host/extension-points.ts` + 测试 | 删除（生产零引用，且与 `plugin-host-store` 重复注册语义相反：throw vs 覆盖） | `pnpm lint` + `pnpm test` 全绿 | ☐ |
| F-2 | **M-9** | `capability-governance/`（~530 行） | 处置：删除，或标注 `@experimental` 并移出 SDK 导出。⚠️ 需 D-2 决策 | 零消费者子系统不再以「正式 API」呈现 | ☐ |
| F-3 | **M-10** | `IPluginRuntimeCompositionToken` / `IUnifiedExtensionRegistryToken` / `IPluginCapabilityGatewayToken` | 处置：删除，或补真实消费者。⚠️ 需 D-2 + D-6 决策 | 三个 token 要么有消费者，要么不在 SDK 暴露 | ☐ |
| F-4 | **M-10** | `docs/{architecture,sdk,reference,api,governance}/**` 12+ 篇 | 校正「已投产能力」描述，与 F-3 决策一致 | `grep` 不再有「零消费者 facade 作为正式 API」的表述 | ☐ |
| F-5 | **L-5** | `capability/index.ts:16`、`capability-runtime-kernel.ts:10`、`classroom-runtime/session-manager.ts:8`、`src/features/whiteboard/canvas-model/index.ts:14` | 4 处 `.ts` 扩展名 import 改 `.js` | `grep "from '\./.*\.ts'"` 生产代码 0 命中 | ☐ |
| G-4a | **L-1** | `server.ts:196-197` | CSP `scriptSrcAttr: ["'unsafe-inline'"]` 收紧（先在报告模式实测） | 无 inline handler 依赖 | ☐ |
| G-4b | **L-2** | `index.ts:2071-2087` | 静态路由冲突检测归一化（`/foo` vs `/foo/`、`/Foo`） | 归一化后重复挂载被拒 | ☐ |
| G-4c | **M-7** | `url-safety.ts:117-118`、`community-registry.ts:374` | 解析 DNS 防 rebinding；重定向后复检 URL（审计标注为**待验证**项，需先确认重定向行为） | A 记录指向 `169.254.169.254` 的域名被拒 | ☐ |

**批次退出标准**
- [ ] `pnpm lint` + `pnpm test` 全绿
- [ ] 文档与实现表述一致

**本批次风险**
- **F-2 / F-3 是不可逆删除**。SDK 已导出 → 可能 breaking change。必须先检索实际使用情况，必要时走 deprecation 一版再删
- G-4a 可能打断依赖 inline handler 的现有前端
- G-4c 依赖审计中标注的「待验证」前置确认

---

## Batch 5 —— 新扩展点修正与长期方案

| ID | 发现 | 内容 | 备注 | 状态 |
| --- | --- | --- | --- | --- |
| I-1 | **M-8**（最重） | `StageGuardPipeline` **服务端强制**：当前 `checkAccess` 唯一调用点是客户端 `lessonEngineStore.ts:215`，客户端权威可绕过 | 需服务端集成测试证明绕过无效 | ☐ |
| I-2 | **M-8** | fail-open → **只对 deny 决策 fail-close**（`stage-guard-pipeline.ts:111, 124`） | ⚠️ 需 D-3 决策 | ☐ |
| I-3 | **M-8** | guard 按 `pluginId` 命名空间隔离；串行改并行；全局延迟上限 | | ☐ |
| B-5 | **H-9**（b 部分） | 后端 `worker-runtime/` 落地 `method-policy` 路径/方法级收窄 | 依赖 B-4 的共享模块 | ☐ |
| L-1 | **C-1**（长期） | Worker 真实隔离：Node Permission Model 或子进程 + container | ⚠️ 需 D-1 决策；架构级，**单独立项** | ☐ |
| L-2 | 长期重构 | 拆分 `PluginHost`（2652 行 / 49 方法）与 `generateBootstrapCode`（762 行） | **应在 L-1 之后**，否则返工 | ☐ |

**本批次风险**
- I 组与 stage-guard WIP **高度耦合** → 建议与 WIP 作者一起做，而非事后改
- L-2 若在 L-1 之前做，隔离方案落地时会大面积返工

---

## 决策日志

| ID | 决策 | 状态 | 结论 | 决策人 | 日期 |
| --- | --- | --- | --- | --- | --- |
| D-1 | worker 模式是否要真正隔离 | ☐ 待决 | | | |
| D-2 | 3 个零消费者 facade：删除还是补消费者 | ☐ 待决 | | | |
| D-3 | `StageGuardPipeline` 超时 fail-open / fail-close | ☐ 待决 | | | |
| D-4 | 是否维持「manifest 声明即授权」的 capability 语义 | ☐ 待决 | | | |
| D-5 | G-1 default-deny 后，无 action 的现存命令如何处置 | ☐ 待决 | | | |
| D-6 | Batch 4 删除是否可接受为 breaking change | ☐ 待决 | | | |

---

## 完成日志

| 日期 | 批次 | 项 | commit | 备注 |
| --- | --- | --- | --- | --- |
| 2026-10-06 | — | 审计完成 | — | 37 项发现，见审计报告。执行前发现 C-6（源码安装路径零静态检查），已并入报告 |

---

## 与文档漂移台账的关系

本台账是**代码域**的对应物，与 [`docs-drift-remediation-tracker.md`](./docs-drift-remediation-tracker.md)（文档域，状态：门禁全绿）独立。

若要长期维持，建议参照文档漂移的做法为以下两项加门禁脚本（输出到 `audit-tools/reports/`）：
1. 「禁止写 `process.cwd()/plugins`」—— 对应 H-1
2. 「SDK parity 漂移数」—— 对应 E-2