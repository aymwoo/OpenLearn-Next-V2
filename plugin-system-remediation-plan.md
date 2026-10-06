# 插件系统整改计划

- **依据**：[`audit-plugin-system-2026-10-06.md`](./audit-plugin-system-2026-10-06.md)（37 项发现）
- **台账**：[`plugin-system-remediation-tracker.md`](./plugin-system-remediation-tracker.md)（逐项 TODO，机器可勾选）
- **制定日期**：2026-10-06
- **状态**：待执行（代码未改动）

---

## 1. 核心思路：37 项 ≠ 37 个补丁

审计发现的 37 项**不是 37 个独立缺陷**，而是 **9 个根因**的表象。逐项打补丁会反复触碰同一片代码，且修完 B 容易把 A 撞回来。

**这是本计划最重要的判断。** 下面按根因组织，批次只是执行顺序的投影。

| 根因 | 一句话 | 覆盖发现 | 性质 |
|---|---|---|---|
| **A** | 静态防线只存在于一条安装路径，且不覆盖计算式导入 | C-1, C-6, M-6 | 架构收敛 |
| **B** | capability 模型在 worker 路径上是装饰性的 | C-2, H-9, H-10, H-11 | 架构收敛 |
| **C** | 状态机缺少单一权威与互斥 | C-3, C-4, C-5, H-2, H-3, H-4 | 架构收敛 |
| **D** | 资源回收只覆盖了「被 track 的那一半」 | M-1, M-2, M-3, M-4 | 覆盖面补齐 |
| **E** | 契约靠人手同步，且防回归测试只覆盖 5% 漂移面 | H-5, H-6, H-7, L-8 | 工具化 |
| **F** | 抽象与文档超前于实现 | M-9, M-10, M-12, L-5 | 减法 |
| **G** | 路由鉴权与策略判定不一致 | H-1, M-5, M-7, L-1, L-2 | 收敛为 default-deny |
| **H** | 测试与运行时不隔离 / 数据模型缺约束 | H-8, L-3, L-4, L-6, L-7, M-11 | 工程卫生 |
| **I** | 新扩展点缺安全默认值 | M-8 | 设计修正 |

### 三个杠杆点（做完这三个，37 项里的 22 项自然消解）

1. **一道静态门（根因 A）** —— 把 `bundlePlugin()` + AST 检查抽成 `assertPluginCodeSafe(code)`，让 `installPlugin()` 和 `installPluginFromZip()` 都必须经过。它一次性消灭 C-1 / C-6 / M-6，并为 B、C 的改造提供统一入口。

2. **单一状态权威（根因 C）** —— 抽出 `setPluginState(pluginId, state, { persistDb })` 作为**唯一**状态写入点，`pluginStates` 与 DB 在同一函数内更新；再抽出 per-plugin 互斥锁。C-3 / C-4 / C-5 / H-2 / H-3 / H-4 六项全部是「多处各自写状态」的必然产物，收敛后这六项的**根因**消失，而不是逐个打补丁。

3. **default-deny（根因 B + G）** —— interceptor 缺 `else`、白名单用子串匹配、路由用 `requireAuth()` 兜底、策略只在前端 —— 这些本质是同一个错误：**判定缺失时默认放行**。统一改为「判定缺失时拒绝」需要 8 处改动，但只需确立 1 条规则。

---

## 2. 执行约束

| 约束 | 内容 |
|---|---|
| **不在工作区直接动** | 执行前需先提交或 stash 当前的 stage-guard WIP（12 改 + 3 新），其中 `openlearn.d.ts` / `di/interfaces.ts` / `plugin-sdk/index.ts` 是 E 组必改文件 |
| **测试必须先绿** | 每个批次开始前跑基线：`pnpm test` 全绿。已有 1 个已知红灯（E-1 parity 基线），**第一批修它** |
| **不与 WIP 抢文件** | M-8（stage guard）本身就是那批 WIP 的一部分。I 组要么与 WIP 一起改，要么推到 WIP 合并之后 |
| **每批次可独立发布** | 不做「必须等全部做完才有价值」的改动 |
| **不改运行时语义** | 本轮**不**修改 capability 语义、DB schema 结构、HTTP 契约的对外形状（除非作为独立决策点 D-x 显式批准） |
| **不追求一次到位** | C-1 的长期方案（子进程/container 隔离）是架构级变更，本轮只做「诚实标注 + 短期收敛」，长期方案单列 |

---

## 3. 批次计划

### Batch 0 —— 基线与前置（0.5 天）

**目标**：拿到可信基线，清除执行障碍。

| 项 | 内容 |
|---|---|
| P0-1 | 提交或 stash stage-guard WIP（见「约束」） |
| P0-2 | 跑 `pnpm test` 记录全量基线（当前已知：插件域 1 红灯 / 379 绿） |
| P0-3 | 清理存量 `plugins/` 5026 个孤儿目录（75MB），修 E-7 的根因（测试目录隔离） |

**退出标准**：工作树干净；全量测试结果被记录为可比对基线；`ls plugins/ | wc -l` 从 5026 降到个位数。

**依赖**：无。**阻塞**：所有批次。

---

### Batch 1 —— 安全门（2–3 天）

> 只做**纯增量**的门，不改任何既有判定逻辑。回归风险最低，风险削减最大。

| 项 | 根因 | 内容 |
|---|---|---|
| **A-1** | A | 抽 `assertPluginCodeSafe(code)`：AST 级拒绝计算式 `import()` / `eval` / `new Function` / 动态 `require` |
| **A-2** | A | `installPlugin()` 改为先经 `bundlePlugin()` + `assertPluginCodeSafe()`，与 ZIP 路径共用（**消灭 C-6**） |
| **A-3** | A | 拒绝绝对路径 import（**M-6**）；同步修正 `node-loader.ts:8-9` 失实注释（**L-4**） |
| **B-1** | B | `service-host.ts` 的 `invoke` 接入 `capabilityGuard.check()`（**C-2**）——注意 `activatePluginExclusive` 会自动 `grant(capabilitiesProposed)`（`index.ts:1152-1156`），所以「manifest 声明即授权」是**既有设计**，A-1/B-1 只是让它在 worker 侧真正生效，不是新增提权面 |
| **B-2** | B | 白名单判定改精确匹配：`hasSensitiveDep` / worker points token（**H-11**） |
| **B-3** | B | 统一 Barrier 2 语义（**H-10**） |
| **G-1** | G | interceptor 改 default-deny：`action` 缺失即抛错（**H-1**） |
| **G-2** | G | 删除 `plugins.ts:699-710` 后缀模糊匹配；路由提权到 `requireAuth('teacher')`（**H-1**） |
| **G-3** | G | 给 `/api/plugins/:id`、`/api/plugins/by-manifest/:id` 补 `requireAuth()`（**M-5**） |

**退出标准**：新增回归测试覆盖 9 项——恶意插件样本在两条安装路径均被拒；未注册 action 的命令被拒；学生角色调用 `execute-command` 被拒；`getUserList` 在两端行为一致；`requires: ['@x/x:IFakeISemesterGradeService']` 不再命中。

**风险**：
- G-1 可能**误伤**现有的「只 `registerHandler` 不 `registerAction`」的插件（`installPlugin` 的 source-code 路径、M-4 残留的静态路由等）。**必须**先跑一遍全量 `plugin.*` 命令清单，逐条确认哪些命令无 action 记录，再决定是补 action 还是列入 default-deny 白名单。
- B-1 若 `capabilityGuard.check` 对 worker actorId 的 capability 集为空，会把当前能跑的 worker 插件全部拦死。**必须**先验证 `grant` 的 actorId 与 `check` 的 actorId 拼写一致（同为 `plugin:<manifestId>`）。

**依赖**：A-1 → A-2。A-2 是本批次的核心交付。

---

### Batch 2 —— 生命周期正确性（3–4 天）

> 根因 C 的收敛。本批次**必须先补测试再改代码** —— 现状是 6 个并发/泄漏缺陷却没有一条针对性测试。

| 项 | 根因 | 内容 |
|---|---|---|
| **C-0** | C | **先写测试**：并发 activate/deactivate、reload 失败后的资源存活、模式切换后 worker 数、超时后资源泄漏、watchdog 复活。5 个场景 × 2 模式（inline/worker） |
| **C-1** | C | 抽 `setPluginState()` 单一权威（**H-4**） |
| **C-2** | C | 抽 per-plugin 互斥锁，合并 `inflightActivate`/`inflightDeactivate`（**H-2**）；`reloadPlugin` 纳入串行化 |
| **C-3** | C | activate/deactivate 超时引入 `AbortSignal`；`ResourceTracker` 支持「已关闭 pluginId 的后续 track 立即 dispose」（**H-3**） |
| **C-4** | C | `reloadPlugin` 失败分支改用快照精确清理（**C-3 僵尸插件**） |
| **C-5** | C | mode 作为显式参数贯穿停用链路，不再从 DB 二次读（**C-4 线程泄漏**） |
| **C-6** | C | `terminate()` 取消 watchdog 重启定时器（**C-5 僵尸复活**） |
| **D-1** | D | 把 `registerAIPersona` / `registerAIContextProvider` / `registerDimension` 纳入 `tracker.track`（**M-1**） |
| **D-2** | D | `deactivatePlugin` 注销 contribution（**M-2**）；`UnifiedExtensionRegistry` 补 `unregister`（**M-3**） |
| **D-3** | D | `deploy.staticRoute` 在停用时摘除（**M-4**） |

**退出标准**：C-0 的 10 个测试场景全绿；`ls plugins/` 在跑完全量测试后**不增长**（`vitest.setup.ts` 加守卫断言）。

**风险**：
- C-2 的互斥锁会改变现有并发行为，可能暴露此前被「静默 return」掩盖的调用方。`deactivatePluginExclusive:1510` 目前的静默 return 是**已在生产依赖的行为**（M-2 的 UI 残留可能就靠它），改动后 UI 行为会变化，需与前端确认。
- C-1 会暴露 DB 里已有的 DB/内存分歧（worker 熔断写 DB 不写内存），可能有一批插件在启动时状态翻转。需先跑一次全量 DB 状态巡检。
- D-2 补 `unregister` 后，M-2/M-3 的 UI 残留会**立即消失**。这是修好了，但要确认没有 UI 依赖「插件停用后按钮还在」的脏逻辑。

**依赖**：C-0 阻塞全部。Batch 1 的 A-1 与本批次无冲突。

---

### Batch 3 —— 契约与工具化（2–3 天）

> 根因 E。**前置：stage-guard WIP 必须已提交**。

| 项 | 根因 | 内容 |
|---|---|---|
| **E-0** | E | parity 基线 33 → 34，修红灯（**H-5** 的可复现部分） |
| **E-1** | E | `IStageGuardServiceToken` 要么在 DI 注册、要么从 SDK 撤下（**H-5** 的实质部分） |
| **E-2** | E | parity 测试升级为 **AST 成员级 diff**（用 `ts-morph` 解析两侧 interface 成员并 diff），覆盖 156 项漂移的绝大部分（**L-8 + H-6 的防回归**） |
| **E-3** | E | 补齐 130 个幽灵类型 + 26 个反向漂移（**H-6**）。优先顺序：`PluginState` → `capability/**` 8 项 → `service-registry/**` 11 项 → 其余 |
| **E-4** | E | 三个脚手架模板补 `main`，并给 `Manifest` 加 `description` / `author`（**H-7**） |
| **E-5** | E | 长期方向：`openlearn.d.ts` 改为**从 core 生成**，不再手写 |
| **H-1** | H | 所有 `new PluginHost(...)` 补 `pluginsDir` 临时目录 + `afterEach` 清理；`vitest.setup.ts` 加全局守卫禁止写 `process.cwd()/plugins`（**H-8**） |
| **H-2** | H | `listContributions` 键匹配修正（**L-6**）；`plugins` 表补 `version` 列（**L-7**）；依赖解析的 blocked/cycle 混淆修正（**M-11**） |
| **H-3** | H | `npm install` 移除硬编码镜像源 + 加 lockfile 校验；**安装失败必须中止激活**而非 `console.error` 后继续（**L-3**） |

**退出标准**：`pnpm test` 全绿（0 红灯）；parity 测试能主动检出「故意注入的类型漂移」；新建插件走完 scaffold → install → activate 全链路。

**风险**：
- **E-3 工作量最大且机械**（156 项）。建议 E-2 先落地、跑出**机器生成的完整漂移清单**后再逐批补，不要手写清单。
- E-4 若模板的 `description`/`author` 加进 `Manifest`，会扩大 manifest 面——需确认 zod schema 是否同步（当前靠 passthrough 兜底）。

**依赖**：E-0 阻塞全部（它是红灯）。E-2 阻塞 E-3 的效率。

---

### Batch 4 —— 减法与文档校正（1–2 天）

> 根因 F。**做减法**，不做加法。

| 项 | 根因 | 内容 |
|---|---|---|
| **F-1** | F | 删除 `src/plugin-host/extension-points.ts` + 其测试（生产死代码，且与 `plugin-host-store` 重复注册语义相反）（**M-12**） |
| **F-2** | F | 处置 `capability-governance`（~530 行，零生产消费者）：删除，或明确标注 `@experimental` 并移出 SDK 导出（**M-9**） |
| **F-3** | F | 处置 3 个零消费者 facade（`IPluginRuntimeCompositionToken` / `IUnifiedExtensionRegistryToken` / `IPluginCapabilityGatewayToken`）：删除，或补上真实消费者（**M-10**） |
| **F-4** | F | 校正 12+ 篇文档中对这些 facade 的「已投产能力」描述（**M-10**） |
| **F-5** | F | 4 处 `.ts` 扩展名 import 改 `.js`（**L-5**） |
| **G-4** | G | CSP `scriptSrcAttr` 收紧（**L-1**）；静态路由冲突检测归一化（**L-2**）；`url-safety` 解析 DNS 防 rebinding + 重定向后复检（**M-7**，含待验证项） |

**退出标准**：死代码删除后 `pnpm lint` + `pnpm test` 全绿；文档中不再有「零消费者 facade 作为正式 API」的表述。

**风险**：
- **F-2 / F-3 是不可逆删除**。若外部插件已依赖这些 Token（SDK 已导出），删除即 breaking change。**必须**先在 `plugin_storage` / 已安装插件中检索实际使用情况，必要时走 deprecation 而非删除。
- G-4 的 CSP 收紧可能打断依赖 inline handler 的现有前端。需先在报告模式下实测。

**依赖**：F-4 依赖 F-3 的决策结果。

---

### Batch 5 —— 新扩展点修正与长期方案（2–3 天，需决策）

| 项 | 内容 | 备注 |
|---|---|---|
| **I-1** | `StageGuardPipeline` 服务端强制（**M-8** 最重的一项）：门禁当前只在 `lessonEngineStore.ts:215` 客户端调用，客户端权威可绕过 |
| **I-2** | fail-open → **只对 deny 决策 fail-close**：超时/异常不得静默放行 | 需决策（见 D-3） |
| **I-3** | guard 按 `pluginId` 命名空间隔离 + 串行改并行 + 全局延迟上限 | |
| **L-1** | C-1 长期方案：Node Permission Model 或子进程 + container 隔离 | **架构级，单独立项** |
| **L-2** | 拆分 `PluginHost`（2652 行 / 49 方法）与 `generateBootstrapCode`（762 行） | 建议在 L-1 之后，避免返工 |

**退出标准**：`I-1` 有服务端集成测试证明绕过客户端无效。

**风险**：`I-1` 会改变 in-flight 的 stage-guard 设计，**与你正在开发的 WIP 高度耦合**。强烈建议与 WIP 作者一起做，而不是事后改。

---

## 4. 依赖图

```
Batch 0 (基线/前置)
   │
   ├─► Batch 1 (安全门) ─────────────┐
   │    A-1 ► A-2 ► A-3              │  两批次文件重叠面：
   │    B-1  B-2  B-3                │  · packages/core/plugin-host/index.ts
   │    G-1  G-2  G-3                 │  · packages/core/worker-runtime/
   │                                  │  · packages/core/kernel/index.ts
   ├─► Batch 2 (生命周期) ◄──────────┘
   │    C-0 (先写测试) ► C-1..C-6
   │    D-1  D-2  D-3
   │
   ├─► Batch 3 (契约)     ← 需要 stage-guard WIP 已提交
   │    E-0 ► E-2 ► E-3
   │    E-1  E-4  E-5
   │    H-1  H-2  H-3
   │
   └─► Batch 4 (减法)     ← 建议在 Batch 1/2 全部落地并观察一周后
        F-1 F-2 F-3 ► F-4  F-5
        G-4

Batch 5 (新扩展点 + 长期)  ← I 组与 stage-guard WIP 耦合，建议合并做
```

**批次可并行性**：Batch 1 与 Batch 2 可并行（不同文件为主，仅 `index.ts` 重叠，需约定谁先合）。Batch 3 与 1/2 可并行。Batch 4 应最后做（要基于 1/2 的最终形态判断什么是真死代码）。

---

## 5. 验证矩阵

| 阶段 | 命令 | 通过标准 |
|---|---|---|
| 每批次开始 | `pnpm test` | 记录基线，无新增红灯 |
| 每批次结束 | `pnpm test` | 0 红灯（当前已知 1 个，E-0 修掉） |
| 每批次结束 | `pnpm lint` | 0 error |
| 每批次结束 | `pnpm lint:eslint` | 无新增 warning |
| Batch 1 额外 | 新增恶意插件样本测试 | 9 个场景全绿（见 Batch 1 退出标准） |
| Batch 2 额外 | `ls plugins/ \| wc -l` | 跑完全量测试后**不增长** |
| Batch 3 额外 | parity 测试注入漂移 | 能主动检出 |
| 全量收尾 | `pnpm build` | 构建通过 |
| 全量收尾 | `pnpm test:e2e` | 无回归 |

**新增测试的存放位置**（沿用既有约定）：
- 插件域 → `packages/core/plugin-host/__tests__/`、`packages/core/worker-runtime/__tests__/`、`packages/core/esm-loader/__tests__/`
- SDK 契约 → `packages/plugin-sdk/__tests__/`
- 恶意插件样本 → 建议 `packages/core/esm-loader/__fixtures__/malicious/`

---

## 6. 需要人决策的点

| ID | 决策 | 建议 | 影响 |
|---|---|---|---|
| **D-1** | worker 模式是否要真正隔离？ | 若目标包含「允许第三方插件生态」，则 C-1 长期方案（子进程/container）**必须做**，不能只标注 | 决定 Batch 5 L-1 是否立项 |
| **D-2** | 3 个零消费者 facade：删除还是补消费者？ | 先查外部插件使用情况；无人用则走 deprecation 一版再删 | 决定 Batch 4 F-3 是删是留 |
| **D-3** | `StageGuardPipeline` 超时该 fail-open 还是 fail-close？ | 建议 fail-close（安全门禁的默认应是拒绝），但会让「插件 bug → 学生卡在环节上」 | 需与教学流程负责人确认；影响 I-2 |
| **D-4** | capability 语义是否维持「manifest 声明即授权」？ | 建议维持（否则所有 worker 插件都要人工授权，运维不可接受），但**必须在文档中显式声明这是信任模型而非安全模型** | 决定 B-1 的实现方式与文档口径 |
| **D-5** | G-1 default-deny 之后，那些「只 registerHandler 不 registerAction」的现存命令怎么办？ | 优先补 action 记录；确实无需暴露给 AI 的，列入显式豁免清单 | 决定 G-1 的实施细节 |
| **D-6** | Batch 4 的删除是否可接受为 breaking change？ | 若 SDK 已发布且有外部消费者，需 SemVer major | 决定 F-1/F-2/F-3 的执行方式 |

---

## 7. 本轮明确不做的事

写清楚边界，避免范围蔓延：

- ❌ 不做 Node Permission Model / 子进程隔离（C-1 长期方案）—— 需单独立项
- ❌ 不重构 `PluginHost` / `generateBootstrapCode` —— 应在 D-1 有结论后再动，避免返工
- ❌ 不改 capability 语义、不改 DB schema 结构、不改 HTTP 对外契约形状
- ❌ 不碰 MFE 子系统（`mfe-whiteboard` / `mfe-courseware` / `activity-ecosystem`）的插件化程度 —— 未审计
- ❌ 不删 `capability-governance` / 零消费者 facade —— 等 D-2/D-6 决策
- ❌ 不做运行时渗透测试 —— 审计局限 1 已列出，若要出 PoC 需单独立项

---

## 8. 与历史整改的关系

仓库已有 `docs-drift-remediation-tracker.md`（文档漂移，状态：门禁全绿）。本计划是**代码域**的对应物，两者独立：

- 文档漂移台账有 `audit-tools/run.sh` 提供机器可读输出与门禁。
- 本计划目前**只有人工台账**。若要长期维持，建议参照文档漂移的做法，为「禁止写 `process.cwd()/plugins`」（H-1）和「parity 漂移数」（E-2）加两个门禁脚本，输出到 `audit-tools/reports/`。