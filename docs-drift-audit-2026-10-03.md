# OpenLearnV2 文档 vs 代码 逐篇漂移审计报告

> **✅ 修复状态（2026-10-03 同日）**：本报告的第 1、2 批与全部 4 项决策已落地，详见文末
> [§6 修复执行记录](#6-修复执行记录)。未修项与新发现隐患已在 §6.7 列明。
> 本报告保留原始审计结论，用于对照修复前后差异。

- 审计日期：2026-10-03
- 审计基线：`a11b99b`（工作区干净）
- 审计范围：`docs/` 全部 **129 个 .md** + `CHANGELOG.md` + `docs/index.md` toctree 结构
- 方法：四路并行逐篇取证 + 自动化路径/链接校验 + 主会话抽样复核

---

## 0. 一个必须先说的事：本次审计推翻了我自己上一轮的部分结论

派发审计任务时，我把上一轮代码审计的结论当作"已确认事实"写进了简报。**结果有 3 条已经过期**——因为在我审计期间，你提交了 `ea4c4a5` / `e731239` / `a11b99b` 三个 commit 修掉了 P0-1~P0-4：

| 我写进简报的"事实" | 实际现状 |
|---|---|
| Dockerfile `npm ci` 必然构建失败、无 migrations/、无 USER/HEALTHCHECK | **已修复**：`Dockerfile:13-18` 改 pnpm、`:40` COPY migrations、`:45` USER node、`:53` HEALTHCHECK |
| `deploy.sh` 把 ENCRYPTION_KEY sed 进 git 跟踪的 `ecosystem.config.cjs` | **已修复**：`ecosystem.config.cjs:1-5` 改 `dotenv.config()` 运行时读取 |
| worker 沙箱 allowlist 从未实现，插件可解析任意 Token | **后端已修复**：`worker-runtime/service-host.ts:152,166,632` 有 `allowedServiceTokens` 门控，`worker-manager.ts:1299` `computeAllowedWorkerTokens` 注入 |

**四路探查中有两路独立识破了这一点并拒绝沿用**（这是正确的行为，也是我坚持逐条复核子结论的原因）。同时我**剔除了一处子代理的错误指控**：某路报告称 `packages/core/bootstrap/pipeline/stages/standard-stages.ts:6` 的 import 无法解析、会导致构建中断——**这是错的**，我实测 `../../types/index.js` 从 `stages/` 出发解析到 `packages/core/bootstrap/types/index.ts`（存在且 `PlatformStage` 就在 `:40`），`tsc` 0 error 正确。

---

## 1. 总体结论

**文档质量比预期好，但"权威文档"的可信度分层严重失衡。**

| 指标 | 数值 |
|---|---|
| 文档总数 | 129 篇（+ CHANGELOG.md） |
| 准确 / 可原样保留 | **约 55 篇** |
| 轻微漂移（行号偏移、数字过期） | **约 35 篇** |
| 严重漂移（会产出错误代码） | **约 33 篇** |
| 失效 / 失实 | **约 6 篇** |
| 文档内反引号仓库路径有效率 | **418 / 431 = 97%**（这批文档写得相当扎实） |
| 文档间内部链接有效率 | **84 / 84 = 100%** |
| 逐篇覆盖 | 129 / 129（无遗漏） |

**关键判断：路径级准确性很高（97%），语义级准确性很差。** 文档基本都能找对文件，但大量**类型定义、API 签名、枚举值、字段语义、数字统计是错的**——而这些恰恰是开发者照着写代码的部分。

---

## 2. 我亲自复核确认的最高危发现

以下 5 条我逐行验证过，证据确凿。

### 🔴 1. 教程把 Inline/Worker 的 `db.table()` 前缀语义**完全写反**

`docs/tutorials/plugin-development-tutorial.md:1736,1741` 声称「Inline = manifest ID 前缀，Worker = UUID 前缀」——**恰好相反**：

```ts
// packages/core/plugin-host/context-builder.ts:643（inline 路径）
const tablePrefix = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, '_')}_`;   // pluginId = DB row UUID
```
```js
// packages/core/worker-runtime/worker-manager.ts:948（worker 路径）
// 表前缀必须用 manifestId（与命令命名空间 L525 及 ServiceHost 的 DDL 守卫一致）
var tablePrefix = 'plugin_' + (workerData.manifestId || workerData.pluginId).replace(...)  // manifestId
```

**数据库实证**：库中现存 14 张 UUID 前缀表，如 `plugin_019fa0d4_2e31_76d9_8322_ca08f60012a8_attendance_records` —— 证明 inline 确实用 UUID。

**影响**：插件作者按文档写 `db.table()` 拼接，inline 与 worker 行为相反，跨模式迁移必炸。

### 🔴 2. 分析引擎 Schema 文档会让人写出无法编译的类型

`docs/analytics/learning-analytics-engine.md:28-32` 贴出 `HighLevelIndicators` 三字段：`engagementRate` / `collaborationIndex` / `masteryScore`。

实际 `packages/core/analytics-engine/types.ts:43-52` 是 **8 个字段 + timestamp**，**只有 `collaborationIndex` 一个命中**，`engagementRate` 和 `masteryScore` 根本不存在。

### 🔴 3. DI 文档的示例代码**运行即抛异常**

`docs/architecture/dependency-injection.md:20` 与 `docs/core/dependency-injection.md:8`：

```ts
export const IMyServiceToken = new Token<IMyService>('IMyService', '1.0.0');
```

而 `packages/core/di/token.ts:52-54` 强制正则，校验失败直接 `throw new TokenError`。`'IMyService'` 无 `domain:Name` 结构 → **构造即抛**。这是可复制粘贴的示例，写进教程就会误导。

### 🔴 4. 认证机制被描述成 JWT（实际是无签名会话表）

`docs/architecture/security-permissions.md:11`：「登录成功后发放 HttpOnly **JWT** Cookie」。

实际 `server/middleware/auth.ts:28` 直接查表，`package.json` **无 jsonwebtoken/jose 依赖**，cookie 是 `edu_os_token` 不透明会话 ID。
**影响**：安全评审会误判令牌可离线验证、可伪造过期时间。

### 🔴 5. 前端插件运行时缺少后端已加的 Token 白名单（**新发现，非文档问题**）

后端修复了 P0-1，但**前端是另一套实现，没同步**：

```ts
// 后端 packages/core/worker-runtime/service-host.ts:152,166,632
private readonly allowedServiceTokens?: ReadonlySet<string>;
this.allowedServiceTokens = new Set(allowedTokens);
if (this.allowedServiceTokens && !this.allowedServiceTokens.has(msg.token)) { ... }

// 前端 src/plugin-host/service-host.ts:210 —— 只有这一行粗粒度门控
if (this.manifestCapabilities.length === 0 && !msg.method.startsWith('get')) {
```

前端 `resolveService`（`:280`）按名解析任意 Token，无 allowlist 字段。**建议单独开 issue**，这是代码问题不是文档问题。

---

## 3. 逐篇判定总表（129 篇）

图例：✅ 准确 ｜ ⚠️ 轻微 ｜ ❌ 严重 ｜ 💀 失效/失实 ｜ 📜 合理的历史快照/计划书

### 3.1 docs/architecture/（27 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| system-overview.md | ⚠️ | 「Workspace Shell/Teacher/Student」仍挂在 App.tsx 名下，App.tsx 现为 130 行委派壳 |
| platform-kernel.md | ❌ | `export const kernel = new Kernel()` **不存在**；`kernelContainer = kernel.serviceRegistry` 错误（实为 Kernel 的懒加载 Proxy，`kernel/index.ts:506`） |
| composition-root.md | ❌ | `server.ts` 322 行 vs 实际 672；`kernelContainer` 描述错误；`run()` 实为 `bootstrap()` |
| bootstrap-pipeline.md | ❌ | **5 阶段职责全是虚构叙事**——`standard-stages.ts:13-54` 每个 `execute()` 只有一行 `setStage()`，无 DB 连接/无 Token 注册/无迁移/无 Worker 池 |
| layer-topology.md | ⚠️ | Kernel 属性表漏 6 项；`HotReloadController` 非公开属性（仅 dev 局部变量） |
| capability-gateway.md | ❌ | 6 个枚举全部与代码不符：`CapabilityRole` 无 Admin、`ApprovalTier` 实际是 `Official/Community/Experimental/Internal`、`LifecycleStatus` 实际是 `Draft/…/Archived`；调用示例 `invoke()` 不存在 |
| command-event-bus.md | ❌ | `register`/`dispatch` 都不存在（实际 `registerHandler`/`execute`）；handler 必须是 `{execute}` 对象；`PlatformCommand` 漏必填 `actorId` |
| configuration.md | ❌ | `packages/core/configuration/` 目录不存在；manifest 键名错（实为 `configuration.properties`）；`onChange` 签名错（无 per-key 重载） |
| database-and-migrations.md | ⚠️ | 迁移序列到 003 为止，实际已有 000–014（15 个） |
| dependency-injection.md | ❌ | Token 示例**运行即抛**（见 §2.3）；`register/resolve` 实为 async；Token 表列 15 个实际 32 个 |
| service-registry.md | 💀 | `inspectAllServices()`/`validateDependencies()` 都不存在；且**该子系统无生产消费者**；**完全没提插件实际在用的 `di/service-registry.ts`** |
| lesson-runtime.md | ❌ | 生命周期 6 态与代码零重叠（无 `Preparing`、无 `Archived`）；`Stage` 用 `durationMinutes` 实际是 `estimatedDurationSeconds` |
| presence-collaboration.md | ❌ | `CollaborationMode` 三个值全不存在；`ObjectLock.acquiredAt` 实为 `lockedAt` |
| classroom-runtime.md | ⚠️ | 总行数 343→401；`CLASSROOM_EVENT_BUS_TOKEN` 不存在（其余 9 阶段/9 事件/7 文件行数逐字命中） |
| interaction-runtime.md | ✅ | 4 文件行数 21/42/121/7=191 **逐字命中**，9 个 dispatch helper 签名全对 |
| resource-runtime.md | ✅ | 13 ResourceType / 7 Action / 4 文件行数 40+89+24+7=160 **逐字命中** |
| theming-system.md | ✅ | 4 主题 ID 与 `index.css` 4 组 `[data-theme]` 一一对应 |
| whiteboard-runtime.md | ⚠️ | `rendererRegistry` 有双份（canvas-model 与 rendering-engine），指错；frame-limiter 路径错 |
| workspace-runtime.md | ⚠️ | `TeacherTabConfig` 片段字段错（无 `title`/`component`，实为 `{id,label,icon?,position?}`） |
| security-permissions.md | ❌ | 见 §2.4；`encryptApiKey` 路径错（不在 `server/utils/crypto.ts`） |
| remediation-and-optimization-roadmap.md | 📜 | 计划书，有日期+甘特图 |
| interactive-classroom-and-editor-optimization-plan.md | 📜 | 计划书，标注适用版本 v0.3.x~v0.4.x |
| architecture-synchronization-report.md | 📜 | 有 ⚠️ 显式快照声明 |
| navigation-audit-report.md | 📜 | 有 ⚠️ 显式"已过时"声明 |
| platform-foundation-audit-report.md | 📜 | 有 ⚠️ 且主动声明行号失效 |
| code-quality-audit-report.md | 📜 | 锚定 @0.3.21 审计体裁，**建议补 ⚠️ 横幅** |
| security-remediation-report.md | 📜 | 锚定 @0.3.21 修复日志体裁，**建议补 ⚠️ 横幅** |

### 3.2 docs/core/（5 篇）—— 与 architecture/ 全部重复

| 文档 | 判定 | 裁定 |
|---|---|---|
| platform-kernel.md | ❌ | 2026-07-24 旧版，逐字复制 architecture 版的同样错误 |
| bootstrap-pipeline.md | ❌ | 旧版且描述比 architecture 版更绝对 |
| dependency-injection.md | ❌ | 用同步写法，掩盖 async 语义 |
| service-registry.md | ❌ | 生命周期枚举同样错 |
| command-event-bus.md | ✅ | 6 行摘要，路径正确，无冲突 |

**冲突实证**：两版对 `service-registry` 生命周期的描述**互相矛盾**——`core/:3` 写 `Registered→Resolving→Active→Disposed`，`architecture/:17` 写 `Registered→Initializing→Active→Disposed`，**两者都与代码** `Registered|Initialized|Started|Ready|Stopped|Disposed` **不符**。
**建议**：删 `docs/core/` 5 篇，architecture 版加重定向桩。

### 3.3 docs/api/（5 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| di-tokens.md | ⚠️ | **33 个 Token 名称与标识串 33/33 全部正确**，但 17 处 `interfaces.ts:行号` 系统性偏移 3–50 行（`:306` 偏移 +42）；8 处把代码的 `T \| Promise<T>` 窄化为 `Promise<T>`；`:64` 引用 `token.ts:32-62` 而**该文件仅 59 行** |
| typescript-interfaces.md | ⚠️ | 结构与服务表全对；`PluginContext.reportProgress` 不在任何类型中（仅 worker 引导期运行时注入，inline 模式会类型报错）；`IAIService` 漏 3 个可选方法 |
| courseware-attempts-contract.md | ❌ | 端点表 11 行中 2 行方法/路径错（`GET /list` 实为 `GET /api/courseware`；`POST /:id` 删除实为 `DELETE`）；**漏 7 个端点**；`GET /attempts` 响应已从裸数组改为分页信封 `{data,total,page,pageSize}`，文档仍写数组；**未提及学生角色会剥除 `extra_json`/`comment` 这一安全行为** |
| whiteboard-event-slot-contract.md | ❌ | 依赖的 `SOCKET_FORWARD_PREFIXES` 常量**在代码中根本不存在**（v0.3.x 已删）→ §7 整节转发链路论证失去依据；quiz 广播来源文件行号全错（实际 `classroom.ts:2219`）；publish 点称 28 个实测 34 个 |
| api-coverage-report.md | 💀 | 称「19 个 Token / Coverage 100% Verified」，实际 33 个，数量差 14；"100% Verified" 无任何可复现步骤 |

### 3.4 docs/reference/（8 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| platform-data-tables.md | ❌ | 称「平台**实际存在的全部数据表**」，实际收录 38 张、库中 **96 张，漏 58 张**（`classroom_*` 全系 13 张、`exam_scores`、`class_groups` 等）；`plugins` 表漏 4 列（含 in-place update 依赖的 `zip_package`）；`:242` 称"40 张表"、迁移"000-009" |
| plugin-ui-extension-slots.md | ❌ | 槽位数 55→**64**（漏 9 个，且这 9 个恰恰全部已渲染）；`palette.item` **不是合法槽位名**（真名 `editor.palette_item`）且 `LessonPalette.tsx` **零 `ExtensionPointRenderer`**；仅列 ~30 个已挂载槽位，实际 `grep slot="..."` 有 51 个 |
| plugin-capability-matrix.md | ❌ | 抽样 12 条行号引用**全部失效**；`PERMISSION_DENIED` 指向错误文件 |
| plugin-database-api.md | ❌ | **页内自相矛盾**：`:46` 说 UUID 前缀（对），`:137` 说 `pluginId = manifest.id`（错）；`:104` 交叉引用指 tutorial:1460-1477，实为 esbuild 排错内容，`ctx.db.migrate` 真示例在 1813-1838 |
| plugin-host-shared-deps.md | ⚠️ | cli.mjs 三处行号全错 |
| plugin-update-distribution.md | ✅ | 5 个 API 签名 + 命令类型逐一命中 |
| capability-provider-framework.md | ✅ | 5 个 kernel 成员 + `getRuntimeKernel()` + 目录全对 |
| activity-ecosystem.md | ✅ | Token 名、字符串、`defineActivityProvider` 均存在 |

### 3.5 docs/plugin/（8 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| plugin-architecture.md | ⚠️ | 声称资源"**逆序**"释放，实际为正序追加序（`resource-tracker.ts:34,48-52` 注释明写"按原始追加顺序迭代"） |
| plugin-lifecycle.md | ⚠️ | `ctx.reportProgress` 被当作 PluginContext 成员，实为 worker 引导期专有，inline 不可用 |
| plugin-manifest-spec.md | ✅ | manifest 字段与 zod schema 一致；`provides` 声明校验已落地 |
| plugin-documentation-report.md | ❌ | **自相矛盾**：页首"服务 7→9" vs 表内"7 大内核服务"（实际 9 个） |
| plugin-registry.md | ⚠️ | 称 DDL 在 `plugin-host/index.ts`，实为 `db/index.ts:104` + 5 条 ALTER；漏 `zip_package`/`updated_at` |
| extension-registry.md | ⚠️ | 称"20 种槽位类型"，实际联合类型 22 个成员 |
| anchor-slots.md | ⚠️ | 7 个锚点全对，但漏了已渲染的 `anchor:classroom-attribution:awards` |
| community-plugin-registry.md | ✅ | 6 个常量逐值命中，6 个路径全存在 |

### 3.6 docs/sdk/（3 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| plugin-sdk.md | ❌ | 「7 个内核服务」应为 **9**（漏 pointsDimension/pointsLedger）；`PluginApiActor` **不是具名类型**（全库 0 命中，照文档 `import type` 会报错）；`migrate` 签名漏 Promise。**正面**：`:124`「33 个 Token」正确 |
| scaffold-cli.md | ⚠️ | 仅 307 字节，漏 `--name`/`--watch`/`--template` 与 3 套模板 |
| plugin-test-kit.md | ✅ | 8 个 Mock + 7 个选项 + `http.handle` 全部命中，**零漂移** |

### 3.7 docs/tutorials/（1 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| plugin-development-tutorial.md | ❌ | **2304 行，最大文档**：① `db.table()` 前缀语义写反（见 §2.1）② 激活超时两处错（称 10s，实际 inline 5s / worker 60s）③ `:172` 自称"完整接口"却**漏 `http`**（教程自己 `:1145` 还开了 5.15 节讲 `ctx.http`）④ 引用 `packages/core/worker-manager/index.ts`（实际 `worker-runtime/worker-manager.ts`） |

### 3.8 docs/ai/（4 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| ai-documentation-report.md | 💀 | 声称 `Status: Fully Synchronized`，但同目录 3 篇共 11 行 |
| ai-capability.md | ⚠️ | **仅 3 行**，无任何路径/Token/API 细节 |
| ai-teacher-workspace.md | ⚠️ | 仅 3 行；3 个 Plugin 常量名正确，但 `ai-persona-registry`/`ai-context-registry` 完全未覆盖 |
| ai-runtime.md | ✅ | 11 行但 5 项断言 5/5 核实通过 |

### 3.9 docs/lesson / workspace / whiteboard / examples（7 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| lesson/lesson-lifecycle.md | 💀 | 6 态链与代码零重叠 |
| lesson/lesson-runtime.md | ✅ | 四层结构命中 |
| workspace/layout-manager.md | ✅ | 全屏模式 + teacherTab 面板命中 |
| workspace/workspace-runtime.md | ⚠️ | 「三视口」的 Group Workspace 在 `src/features/` 无对应实现 |
| whiteboard/canvas-object-model.md | ❌ | 8 字段接口当完整定义展示，**实际 20 字段**；漏 `layerId`（渲染必需）/`createdBy`（权限必需）；泛型默认 `any` vs `Record<string,unknown>` |
| whiteboard/whiteboard-runtime.md | ✅ | **17 个引用路径 100% 存在**，4 个扩展点符号全命中 |
| examples/verifiable-examples.md | ✅ | 准确但仅 21 行 |
| examples/existing-plugins-guide.md | ⚠️ | 称"7 个范例插件"实为 9 个文件，仅详述 5 个 |

### 3.10 docs/deployment / getting-started / configuration / migration / troubleshooting / admin / developer / contributing / governance / index（16 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| **index.md** | ❌ | **24 个 toctree 块全部带 `:hidden:` → 渲染站点完全没有导航侧栏**；2 篇审计报告游离站外；`:315` 页脚"最后更新 v0.3.22"实际 0.5.0 |
| installation-guide.md | ❌ | 4 处错误：`pm2 logs openlearn`（实际 `openlearnv2`）；`docker run -v ./data:/app/data`（实际需挂 `/app/packages/core/db`，照文档做**容器重启即丢全部数据**）；deploy.sh 声称装依赖（实际无 install）；pnpm/npm 混用自相矛盾 |
| courseware…（见 3.3） | — | — |
| courseware-attempts… | — | — |
| system-configuration.md | ⚠️ | 14 个环境变量全对，但自称"**全部**"漏 9 个，含 docker-compose 与 pm2 都显式设置的 `LOG_LEVEL` |
| version-migration.md | 💀 | 整篇停留在 v0.1.12（实际 0.5.0），只覆盖 1 个断点 |
| broken-reference-report.md | 💀 | 称"0 Broken Links / 0 Broken Cross-References"，但站点结构性无导航、2 篇完全游离——"无断裂"没有意义 |
| docker-nginx.md | 💀 | 标题含"Docker"却**零 Docker 内容**（全文 12 行）；nginx 片段缺 `proxy_read_timeout 86400s`（白板同步必需） |
| admin-manual.md | 💀 | **全文 3 行纯占位**，却被 index.md 收录为正式页面 |
| sync-report.md | 💀 | 31 页分类树、SDK 3.5.0、目录结构全过时（**但第 3 行已自我声明"请勿引用"**） |
| troubleshooting-faq.md | ⚠️ | §2/§4/§5 全对；`ctx.reportProgress` 归属问题同 plugin-lifecycle |
| production-guide.md | ✅ | CLI 子命令/flag 全对；`CORE_PLUGINS=7` 与 cli-doctor 精确吻合 |
| overview.md | ✅ | 四层、5 阶段、SDK 3.7.0 全部核实无误 |
| quickstart.md | ✅ | 克隆地址、pnpm、端口、默认账户全部无误 |
| developer-guide.md | ✅ | 7 条 npm script 无一捏造 |
| testing-strategy.md | ✅ | `fileParallelism`、`VITEST_POOL_ID`、`ensureTestSchema()` 乃至"7 个测试文件各自补迁移"的 flaky 史与代码注释逐字对应 |
| docs-drift-audit.md | ⚠️ | 描述的 audit-tools 与 CI job 全部存在，但"期望输出"是易过期快照；其 `:20` 建议"用符号名而非行号"被 `di-tokens.md` 全面违反 |
| contributing.md | ⚠️ | 约定全部准确；引用的 `v2_plugins/<id>/CHANGELOG.md` 在干净克隆中不存在（被 gitignore） |
| architecture-governance.md | ⚠️ | 6 条沙箱机制逐条核实为真（含 `PLUGIN_SHARED_MODULES` 7 项逐字一致）；仅"v2_plugins 作为 submodule"与本仓库不符（无 .gitmodules） |

### 3.11 docs/roadmap/（3 篇）

| 文档 | 判定 | 核心问题 |
|---|---|---|
| documentation-roadmap.md | ❌ | 头部 `Current Milestone: 0.2.7`（实际 0.5.0，落后 12 版本）；Phase 2 TypeDoc 标"排入 v0.3.0 B4"**至今未实现**；Phase 3 i18n 至今未启动；承诺的 `architecture/_archive/` 归档机制不存在 |
| v0.3.0-roadmap.md | 📜 | 首行已有规范 ⚠️ 过期 banner（三篇里标注最规范）；8 项问题中 3 项现状已变 |
| v0.4.0-roadmap.md | ⚠️ | 标注质量高（附 7 个 commit hash，实测 7/7 有效）；但 `:28-29` 写「App.tsx 增至 2211 行（恶化）」——**已完全反转，现 130 行** |

### 3.12 docs/release-notes/（37 篇）

发布说明本质是历史记录，**不因代码演进而判漂移**。仅当路径/版本在发布当时就不存在、或声称的功能从未实现，才判失实。

| 判定 | 篇数 | 说明 |
|---|---|---|
| ✅ 准确 | 29 | 路径断言 9/9、测试文件、配置项逐条命中 |
| ⚠️ 轻微 | 5 | v0.3.13（链接目标错）、v0.3.15、v0.3.18（"彻底移除 @google/genai"但依赖仍在）、v0.3.23（4 个文件 kebab/Pascal 命名漂移）、v0.2.6 |
| 💀 失实 | 3 | **v0.2.3**「SDK 保持 `^3.4.3`」——v0.2.0 已升 3.5.0、v0.2.4 又写 3.5.0，**组内自相矛盾**；**v0.3.15** 声称交付 `@openlearn/plugin-lti-provider`——`packages/` 下无此目录，测试已知失败；**v0.3.14**「把 xlsx 移入 dependencies」——`xlsx` 现已完全不存在（被 exceljs 取代） |

---

## 4. 系统性问题（比单篇错误更值得修）

### 4.1 🔴 站内导航被 `:hidden:` 全量关闭

`docs/index.md` 的 **24 个 toctree 块每一个都带 `:hidden:`**。Sphinx 渲染后不生成侧栏，129 篇文档只能靠 URL 直达。**这是投入产出比最高的单点修复：删掉 24 个 `:hidden:` 即可。**

（正面：toctree 收录 126/129、**0 条断链**，组织结构本身是完整的。2 篇游离的是 `classroom-time-flow-audit.md` 与 `whiteboard-realtime-sync-audit.md`。）

### 4.2 🔴 CI 的「文档漂移审计」形同虚设

我实跑了 `bash audit-tools/run.sh`：输出 `drift_count=3`。

但该工具的 `DOC_SUBSYSTEM_BY_FILE` 是**硬编码的 24 个文件名白名单**，最终只比对出 **3 个 canonical key**。它对 129 篇文档、431 条路径引用、全部类型/枚举/签名**零覆盖**。

**这解释了为什么 33 篇严重漂移能长期存在：门禁是空的。** 本次审计发现的路径级漂移，用一个"抽取反引号路径 + 检查存在性"的 30 行脚本就能覆盖 97%。

### 4.3 ⚠️ 行号引用全面失效

`di-tokens.md` 17 处偏移 3–50 行、`plugin-capability-matrix.md` 抽样 12 条**全错**、两份审计报告 4–5 处偏移 27–150 行。

**讽刺的是** `docs/developer-guide/docs-drift-audit.md:20` 早就写明「引用代码事实请用符号名而非行号」——而 `di-tokens.md` 恰恰违反了自己的规范。

### 4.4 ⚠️ 发布记录三载体互不覆盖

`git tag` / `CHANGELOG.md` / `docs/release-notes/` 三份载体存在**双向缺口**：

- 只有 CHANGELOG：0.1.13/14/15/16、0.3.9
- 只有 release-notes：0.2.9、0.3.4、**0.3.23**（描述 13 个已落地文件却无 tag 无 CHANGELOG，发布流程在此断链）
- 三者皆无：0.3.19、0.3.20（推断从未发布）

且 `CHANGELOG.md:1888` 日期格式为 `2025`（全文件唯一非 `YYYY-MM-DD`），`:5` 括号未闭合 + `plugin-test-kit` 缺版本号。

### 4.5 ⚠️ 审计快照体裁缺少过期标注

4 篇审计报告里 2 篇有 ⚠️ 横幅（好），2 篇没有（`code-quality-audit-report`、`security-remediation-report`）。**建议统一**：凡锚定版本的报告一律加顶部横幅。

---

## 5. 修复优先级（原始建议，执行情况见 §6）

### 第 1 批（会直接产出错误代码，建议本周）

1. `plugin-development-tutorial.md:1736,1741` — db.table() 语义对调 + 补 `ctx.http` + 修两处超时数值
2. `reference/plugin-database-api.md:137` — 统一 pluginId 语义 + 交叉引用改指 1813-1838
3. `analytics/learning-analytics-engine.md:28-32` — 重写 `HighLevelIndicators`（唯一会导致编译失败的文档错误）
4. `architecture/dependency-injection.md:20` + `core/dependency-injection.md:8` — Token 示例加 `@scope/domain:` 前缀
5. `architecture/security-permissions.md:11` — JWT → 不透明会话表

### 第 2 批（可信度修复，成本极低）

6. `docs/index.md` — 删 24 个 `:hidden:`；补 2 篇游离文档的 toctree；页脚改自动版本
7. 删 `docs/core/` 5 篇重复文档，architecture 版加重定向
8. `whiteboard-realtime-sync-audit.md:198-230` — §4 P2 章节**整段重复**（一份"建议修"一份"已实施"）；`:257` 复核命令未排除注释与测试，现会误报

### 第 3 批（机制修复，防止复发）

9. **重写 `audit-tools/extractors.py` 的硬编码白名单为通配** + 增加"反引号路径存在性校验"（本次证明可覆盖 97%），并让 coverage/threshold 真正阻断
10. 行号引用逐步替换为符号名（`docs-drift-audit.md:20` 已有此规范，只是没执行）
11. 统一三份发布记录载体，或明确指定唯一真源

### 另需单独开 issue（代码问题，非文档）

12. `src/plugin-host/service-host.ts:210,280` — 前端插件运行时缺 Token 白名单（后端已在 `e731239` 修复，前端未同步）

---

## 6. 修复执行记录

### 6.1 已修复（第 1 批：会直接产出错误代码）

| 项 | 文件 | 修复内容 |
|---|---|---|
| §2.1 | `tutorials/plugin-development-tutorial.md` | `db.table()` 前缀语义对调（inline=UUID、worker=manifestId）并补原因；`ctx.pluginId` 同样反向错误一并修正；补漏掉的 `ctx.http`；激活超时 10s → inline 5s / worker 60s；错误路径 `core/worker-manager/index.ts` → `core/worker-runtime/worker-manager.ts`；顺带修 §5.9 前缀示例与 worker 下 `exec()` 必崩问题 |
| §2.2 | `analytics/learning-analytics-engine.md` | `HighLevelIndicators` 由 3 字段重写为真实 9 字段 + timestamp |
| §2.3 | `architecture/dependency-injection.md`、`core/dependency-injection.md` | Token 示例加 `@scope/domain:` 前缀（原版构造即抛 `TokenError`）；`register`/`resolve` 补 async 语义 |
| §2.4 | `architecture/security-permissions.md` | JWT → 不透明会话 ID + `client_sessions` 查表；`server/utils/crypto.ts` → `packages/core/di/api-key-crypto.ts` |
| §3.4 | `reference/plugin-database-api.md` | 统一 `pluginId` 语义（消除页内自相矛盾）；交叉引用改指真实 `ctx.db.migrate` 示例并去掉裸行号；迁移示例 `exec()` → `prepare().run()`（worker 下原写法必崩） |
| §3.7 | 同上（教程 `:172`） | 完整接口清单补 `http` |

附带修正代码注释：`packages/core/plugin-host/types.ts` 的 `pluginId` JSDoc 原文写「manifest.id」，与实际（DB UUID）矛盾，已改正并加指向文档的说明。

### 6.2 已修复（第 2 批：导航与重复文档）

- **`docs/index.md` 删除全部 24 个 `:hidden:`** —— 侧栏从 0 条恢复为 **720 条链接 / 24 个分组**；页脚版本 v0.3.22 → v0.5.0
- **补收 2 篇游离文档**（`classroom-time-flow-audit`、`whiteboard-realtime-sync-audit`）进 toctree
- **删除 `docs/core/` 5 篇重复文档**（经核实 architecture 版为严格超集，无独有内容），architecture 版加"唯一真源"提示；`getting-started/overview.md` 中 3 条指向 `core/` 的链接已改指 `architecture/`
- **消除 3 组跨目录重复**：
  - `lesson-runtime` / `workspace-runtime`：权威版从 `architecture/` **搬移**到对应分类组（非删除，避免内容损失）
  - `whiteboard-runtime`：拆分为三份职责清晰的文档 —— `whiteboard/canvas-object-model.md`（对象模型唯一真源，接口由 8 字段纠正为真实 20 字段）、`architecture/whiteboard-subsystems.md`（子系统机制）、`whiteboard/whiteboard-runtime.md`（运行时架构）
- **`whiteboard-realtime-sync-audit.md`**：删除 §4 重复的 P2 章节、修复 §6 复核命令（原命令因匹配注释与测试断言产生 5 条误报）

### 6.3 已修复（第 3 批：审计工具机制）

新增 `audit-tools/refchecks.py`，并重写 `extractors.py` / `aligner.py` / `run.sh`：

| 检查 | 覆盖 | 结果 |
|---|---|---|
| `path-existence` | 122 篇文档 / 466 条路径引用 | MISSING 4、PLANNED 5、PLACEHOLDER 5 |
| `doc-link` | 91 条文档间链接 | 失效 0 |
| `duplicate-docs` | 按 H1 标题 + 文件名 stem | 分组 0 |

**关键改进：拆除了 `DOC_SUBSYSTEM_BY_FILE` 硬编码白名单的门控作用**。此前它会**静默跳过**未登记的文档（129 篇里只有少数参与比对）；现在改为「表优先，未登记时回退到文件名推导的 canonical key，且仅当能对上真实代码目录才纳入」。文档事实数从 126 → 139，`MISSING_IN_CODE` 保持 2 不变——既消除了盲区，又没有制造噪声。

工具还发现一条比"路径不存在"更深的洞察：`migrations/006_add_foreign_keys.sql` 与 `007_add_indexes.sql` 的**编号早已被其他迁移占用**（`006_classroom_event_bus.sql`、`007_interactive_classroom.sql`），roadmap 里这两条计划已不可能再落地。

### 6.4 回归验证结果

| 检查 | 修复前 | 修复后 |
|---|---|---|
| `tsc --noEmit` | 0 error | **0 error** |
| 单测 | 2496 通过 / **4 失败** | **2527 通过 / 0 失败** |
| 文档内链 | 84 有效 | **91 有效 / 0 失效** |
| Sphinx 构建 | — | **0 warning / 124 页** |
| 站点侧栏 | **0 条**（全站无导航） | **720 条 / 24 组** |
| 重复文档组 | 3 | **0** |
| audit-tools 覆盖 | 134 事实 / 24 文件白名单 | **122 篇 / 466 条路径** |

### 6.5 第二轮：按用户决策执行的 4 项

| 决策 | 执行结果 |
|---|---|
| **1. 前端 Token 白名单（修）** | `src/plugin-host/service-host.ts` 新增 Security Barrier 1（`allowedServiceTokens`，插在 `handleInvoke` 最前，解析前拦截）；新增 `src/plugin-host/allowed-tokens.ts` 实现前端版 `computeAllowedWorkerTokens`（含与后端逐项对照表）；`browser-worker-manager.ts` 注入白名单并随 activate 消息下发；新增 9 项测试。**已确认该路径真实可达** —— `FrontendPluginHost.activateRemotePlugin`（`plugin-host.ts:178`）会拉取并以 Blob-URL ESM 执行用户上传 ZIP 插件的 `frontend.js` |
| **2a. roadmap 迁移计划（标注）** | `v0.4.0-roadmap.md` 两处就地标注编号冲突：006 被 `006_classroom_event_bus.sql` 占用；索引项**实际已落地为 `014_performance_indexes.sql`** |
| **2b. 工具规则（降级）** | `refchecks.py` 新增 R9：`docs/release-notes/**` 归为 `HISTORICAL`，不计入 drift 但报告仍可见；新增 R5B：文档已就地承认迁移编号冲突时归为 `PLANNED`。**路径 MISSING 4 → 0** |
| **3a. 重写 4 篇高引用文档** | `platform-kernel.md`(107→197)、`plugin-ui-extension-slots.md`(563→634)、`capability-gateway.md`(65→261)、`plugin-capability-matrix.md`(213→285)。**0 处裸行号、103 条路径引用全部存在、264 个符号名全部命中源码** |
| **3b. 过期横幅（24 篇）** | 逐条 grep 核实后写入具体偏差，并产出 **18 条审计报告未记录的新问题**（含 `frontendEventBus` socket 转发能力已被删除、`platform.ready` 事件全仓零命中、`PipelineResult` 字段名错、`plugins` 目录 9 个模块而非 7 等） |
| **4. 行号迁移** | `api/di-tokens.md` 29 处、`reference/plugin-host-shared-deps.md` 3 处 → 全部改为「文件路径 + 符号名」；顺带修正 `IActivityRegistryToken` 的实现位置（实为 `packages/core/lesson-engine/activity-registry.ts`） |

**审计工具自身修复的 3 个真 bug**（都是让门禁失真的根因）：

1. `DOC_SUBSYSTEM_BY_FILE` 里 `"capability-gateway"` 键**重复写了 3 次**，Python 字典只保留最后一个 → `capability` / `capability-runtime` 被静默覆盖
2. `"command-event-bus"` / `"presence-collaboration"` 各重复 2 次 → 一篇文档描述两个代码目录时，另一侧被静默丢弃。已改为支持映射值为目标列表
3. `capability-runtime` 归一方向不一致（`capability-system` 自身还会再归一）→ 已归一到最终 canonical

文档事实数 126 → 148，误报 3 → 0，真实剩余 2 条。

### 6.6 最终回归验证

| 检查 | 第一轮后 | 本轮后 |
|---|---|---|
| `tsc --noEmit` | 0 error | **0 error** |
| 单测 | 2527 通过 | **2536 通过 / 0 失败**（新增 9 项白名单测试） |
| 文档内链 | 91 有效 | **93 有效 / 0 失效** |
| Sphinx | 0 warning / 124 页 | **0 warning / 124 页 / 724 侧栏链接** |
| 路径 MISSING | 4 | **0** |
| 重复文档组 | 0 | **0** |
| `drift_count` | 7 | **2**（均为真实问题） |
| 工具覆盖 | 466 条路径 | **658 条路径 / 259 去重** |

### 6.7 明确未修（需决策，不宜由文档侧单方面改）

1. **剩余 2 条 canonical drift（均为真实问题，非误报）**
   - `configuration` MISSING_IN_CODE —— `docs/architecture/configuration.md` 引用 `packages/core/configuration/`，该目录确实不存在。已加横幅，但内容需重写。
   - `observability` MISSING_IN_DOCS —— `packages/core/observability/` 没有任何文档描述它。
2. **发布记录三载体缺口**（0.3.19/0.3.20 缺 release-notes、0.2.9 与 0.3.23 缺 tag）、**v0.2.3 SDK 版本自相矛盾**、**v0.3.15 声称交付不存在的插件** —— 按决策留待办。
3. **审计快照与 roadmap 中约 56 处裸行号未迁移** —— 这些是有日期的历史记录，行号在其中是合理的历史定位（`security-remediation-report` 14、`v0.4.0-roadmap` 16、`whiteboard-realtime-sync-audit` 15、`code-quality-audit-report` 6、`v0.3.0-roadmap` 4 等），按决策不做迁移。
4. **新发现的工程隐患（非本次引入）**：`tsconfig.json` 无 `exclude: ["plugins"]`，而 `tsc` 默认 include 为 `**/*`，会扫进 gitignore 的 `plugins/` 运行时目录。金丝雀测试在此建删临时插件目录时，并发执行 `tsc` 会报 `TS6053: File ... not found`。CI 的 typecheck 与 test 是分开的 job 故未暴露；本地并发跑两者时会偶发。**建议加一行 exclude**，但本轮未改（改 tsconfig 影响面较大，需你确认）。
5. **`activateWorkerPlugin`（`plugin-host.ts:335-339`）合成 manifest 时只带 `id`/`name`/`version`**，从不传递真实的 `capabilitiesProposed` —— 导致 Barrier 2 目前把所有 worker 插件都限制为只能调 `get*` 方法。修这个会**放宽**现有门禁，属独立变更，建议单独评审。
6. **24 篇横幅需在内容修复后统一摘除**，否则会与"已修正"内容冲突。建议由单一 owner 维护。

---

## 7. 本次审计的局限

- **未验证文档中代码示例的编译兼容性**。`plugin-development-tutorial.md` 2304 行只重点核对了 7 个章节，§9–§13 及大量示例未逐行验证。建议后续复用 `packages/plugin-test-kit` 搭 harness 做全量编译。
- **release-notes 的抽样验证有比例**。29 篇判"准确"的结论基于路径与配置断言抽样，不是逐句语义核验。
- **活动流历史数据未参与**。`docs/activity-ecosystem.md` 仅核对了前 70 行，剩余 135 行未取证（判为准确基于核心概念层）。
- **CHANGELOG 的"N/N 测试通过"类数字未运行时验证**。本次未跑测试套件，故所有历史数字按快照处理。
- **"准确"判定不等于零缺陷**。标 ✅ 的文档表示我核对的断言全部通过，不代表全文无瑕疵。
