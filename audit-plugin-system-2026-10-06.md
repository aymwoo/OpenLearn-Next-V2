# OpenLearnV2 插件系统专项审计报告

- **日期**：2026-10-06
- **范围**：`packages/core/plugin-host/`、`packages/core/worker-runtime/`、`packages/core/esm-loader/`、`packages/plugin-sdk/`、`packages/plugins/`、`src/plugin-host/`、`server/routes/plugins.ts`、`server/services/community-registry.ts`、相关 DI 与文档
- **方法**：CodeGraph 符号级探索 + 源码逐行核对 + 实测（`vitest run` 45 个插件相关测试文件、SQLite 状态查询、磁盘清单）
- **规模**：插件相关源码 ~20,000 行；发现 **37 项**（Critical 6 / High 11 / Medium 12 / Low 8）
- **注**：本报告所有 Critical 与大部分 High 条目均已由审计者**独立复核源码确认**，非二手结论。文末「局限」列出仍待验证项。

---

## 0. 结论摘要

| 维度 | 评分(0-5) | 说明 |
|---|---|---|
| 架构分层 | 3.0 | 生命周期模型本身设计清晰，但外面套了 5 层 facade，其中 3 层零消费者 |
| 安全边界 | **2.0** | 纵深防御做了 15+ 项，但最外层 Worker 隔离只是「崩溃隔离」而非「安全沙箱」；capability 模型在 worker 路径上零调用；两条安装路径防线强度完全不对称 |
| 生命周期正确性 | **2.0** | 超时不取消、reload 失败摧毁在跑资源、模式切换泄漏线程、watchdog 复活 |
| SDK 契约 | **2.0** | 有防回归测试（好），但测试只覆盖 5% 的漂移面；130 个幽灵类型 + 26 个反向漂移 |
| 测试与工程卫生 | 2.5 | 380 个插件测试覆盖不错；但测试自身污染工作树（5026 孤儿目录 / 75MB，仍在日增） |

**一句话**：插件系统的**功能性骨架是扎实的**（依赖解析、命名空间强制、Storage 隔离、Zip Slip 拦截、能力授予、人工审批闸门都已到位），但**安全边界是"防误伤"而非"防恶意"**——安装一个第三方插件等价于授予宿主 RCE，这一点在架构上从未被真正解决；同时生命周期有 4 处会导致「僵尸插件 / 僵尸线程」的确凿缺陷。

### 最高 ROI 的三件事

1. **承认并标注 inline/worker 都不是安全沙箱**，把高危插件审批闸门（已存在）提升为唯一的信任边界，并在 UI 与 manifest 文档中显式声明。成本极低，收益是消除最大的认知误导。
2. **修 4 处生命周期泄漏**（超时取消、reload 失败路径、模式切换、watchdog 取消）——全部是局部改动，无架构调整。
3. **SDK parity 测试升级为 AST 成员级比对**，并给 `openlearn.d.ts` 补齐幽灵类型。当前 380 个绿测试给出的安全感与实际契约健康度严重不匹配。

---

## 1. 对历史审计结论的复核（含 1 条证伪）

| 历史结论 | 来源 | 本次复核 |
|---|---|---|
| 「Worker 插件沙箱的服务 allowlist 从未在生产代码中实现」 | `audit-2026-10-03.md` P0-1 | ❌ **该结论不成立，予以证伪**。allowlist 生产链路完整：计算 `worker-manager.ts:1309` → 注入 `workerData.serviceTokens:1320` → 建表 `service-host.ts:165` → 强制 `service-host.ts:632-638`（不在白名单即抛 `WorkerCapabilityError`）。BASE 8 个 token 不含 `IPluginHost`。回归测试存在。**但 allowlist 约束的是 RPC 消息面，不是进程权限面**——见 C-1。 |
| 「`plugin-sdk/index.ts` 重导出 core 运行时类，SDK 无法独立发包」 | `audit-2026-09-25.md` M-3 | ✅ 仍然成立且更严重。`index.ts` 有 **38 个值导出**（全部来自 `../core/*`），`build.mjs:19-27` 把 core 源码内联进产物。 |
| 「`openlearn.d.ts` 完全纯净 ✅」 | `audit-2026-09-25.md` L-3 | ⚠️ **Token 层面仍纯净，但整体不再纯净**：存在 130 个「有导出无声明」的幽灵类型与 26 个反向漂移（见 H-6）。 |
| 「`generateBootstrapCode` 单函数 753 行」 | `audit-2026-09-25.md` M-7 | ✅ 仍在，当前 **762 行**（`worker-manager.ts:425-1186`）。 |
| 「CSP 与 HSTS 完全关闭」 | `audit-2026-09-25.md` C-1 | ✅ 已修复。生产 `scriptSrc` 已去 `unsafe-inline`/`unsafe-eval`，`connectSrc` 收紧至 `'self'`。仅 `scriptSrcAttr` 残留（见 L-1）。 |
| 「4 个测试红灯」 | `audit-2026-10-03.md` P0-4 | ⚠️ 当前插件域为 **1 个红灯**（H-5），其余已转绿。 |

---

## 2. Critical（5 项）

### C-1 | Worker 模式无 OS 级沙箱，计算式动态 `import()` 可绕过唯一防线 → 宿主 RCE

**位置**：`packages/core/worker-runtime/worker-manager.ts:431, 938`、`packages/core/esm-loader/install-utils.ts:65-94`

```ts
// worker-manager.ts:431 —— bootstrap 代码直接给插件 createRequire
const requireFn = createRequire('${requirePath}');

// install-utils.ts:64 —— 唯一的导入防线
build.onResolve({ filter: /.*/ }, (args) => { ... })
```

`onResolve` 只能拦截 **esbuild 可静态解析的字面量 specifier**。计算式动态导入（`await import('node:' + 'child_process')`）esbuild 无法解析，只产生 warning 并**原样保留为运行时 `import()`**，因此完全绕过该插件。

**利用路径**：管理员（`isHighRisk` 审批后）安装 ZIP → `index.js` 内 `await import('node:'+'child_process').then(m=>m.execSync(...))`。

**影响**：Worker 与主进程共享同一地址空间。`BASE_WORKER_SERVICE_TOKENS` 只约束 RPC 消息面，Node 全局对象（`fs` / `child_process` / `net` / `process.env`）完全可达。**当前隔离的作用是防崩溃与 DoS，不是防恶意代码。**

**建议**：(1) esbuild 之后增加 AST 级扫描，拒绝计算式 `import()` / `new Function` / `eval`；(2) 长期方案：Worker 内启用 Node Permission Model（`--permission --allow-fs-read=...`），或把插件移入子进程 + seccomp/container。

---

### C-6 | `plugin.install`（源码安装）路径**零静态检查**，完全绕过 token enforcer

**位置**：`packages/core/plugin-host/index.ts:1015-1023`（`installPlugin`）、`packages/plugins/builtin.ts:848-869`（`plugin.install` 命令）、`packages/core/worker-runtime/worker-manager.ts:938`（激活时 `import()`）

```ts
// index.ts:1021 —— 原始源码直接落盘，全程无 bundlePlugin()、无 openlearn-token-enforcer
fs.writeFileSync(filePath, sourceCode, 'utf-8');
```

**事实**：两条安装路径的防线强度**完全不对称**：

| 命令 | 实现 | 静态检查 |
|---|---|---|
| `plugin.install`（传 sourceCode） | `installPlugin()` → `fs.writeFileSync` | ❌ **无** esbuild、无 enforcer、无 zod manifest 校验之外的任何代码检查 |
| `plugin.install_zip` | `installPluginFromZip()` → `validateAndBundleZip()` → `bundlePlugin()` | ✅ enforcer + zod + Zip Slip + ZIP bomb |

激活阶段两者都走 `index.ts:1232-1246` 读文件后 `NodeEsmLoader.load()` → 裸 `import()`。

**影响**：`openlearn-token-enforcer`（C-1 中唯一的静态防线）**只覆盖 ZIP 路径**。管理员经审批后用 `plugin.install` 安装的插件，可以直接 `import fs from 'node:fs'`、可以 `import child_process`，enforcer 根本不会执行。C-1 描述的「绕过 token enforcer」在源码安装路径上不是「绕过」，而是**该防线从未存在**。

**缓解事实**：`plugin.install` 标记 `isHighRisk: true` + `capabilityRequired: 'plugin:write'`（`builtin.ts:854-855`），受人工审批闸门保护，非 admin 无法触发。

**建议**：把 `installPlugin()` 也路由经过 `bundlePlugin()` + 相同 AST 检查（见 C-1），实现「一道静态门、两条安装路径」的统一。

---

### C-2 | `capabilityGuard` 在 Worker RPC 路径注入但**零调用** → capability 模型在 worker 模式完全不生效

**位置**：`packages/core/worker-runtime/service-host.ts:57, 117, 156`（注入）vs 全文件无调用点

```ts
// service-host.ts:156 —— 构造函数接收并保存
private readonly capabilityGuard: CapabilityGuard,
// 但 grep 'capabilityGuard' 在该文件内只有 import/注释/字段声明，0 个调用点
```

worker 模式下唯一的门是「Token 白名单（哪些服务可达）+ Barrier 2（`manifestCapabilities.length === 0` 时只准 `get`）」。**Barrier 2 只判数组是否非空**：插件在 manifest 写 `capabilitiesProposed: ['x']` 即解锁 8 个 base token 上的**所有**非 `get` 方法，无审批、无「能力↔具体方法」绑定、无角色检查。`service-host.ts:181 setManifestCapabilities` 注释称 "after admin approval"，但初始值就是插件自声明值。

**影响**：`capability-guard.ts:75-125` 中精心设计的 role→capability 表，在 worker 插件路径上**一行都不会执行**。文档（`docs/plugin/plugin-lifecycle.md` 等）宣称的 capability 模型对 worker 插件是失效的。

**建议**：`invoke` 路径接 `capabilityGuard.check(pluginActorId, \`${service}:${method}\`)`，或要求 worker 侧按 `capability:<service>:<method>` 精确匹配。

---

### C-3 | `reloadPlugin` 失败路径用 `disposeAll` 摧毁**仍在运行的旧实例**资源，但状态保持 ACTIVE → 僵尸插件

**位置**：`packages/core/plugin-host/index.ts:2692`（失败分支）vs `2718-2725`（成功分支）

```ts
// 失败分支 —— index.ts:2692
} catch (err) {
  this.resourceTracker.disposeAll(pluginId);   // ← 摧毁该插件【全部】资源
  throw new HotReloadActivationError(...);
}

// 成功分支 —— index.ts:2718-2725
for (const d of oldDisposables) { d.dispose(); }   // ← 只清理快照中的旧资源
this.resourceTracker.reap(pluginId, oldDisposables);
```

`disposeAll` 会连同**旧版本仍在正常运行的** command handler / event 订阅 / interval / http 路由一起销毁，而 `pluginStates` 仍是 `ACTIVE`、`pluginInstances` 仍指向旧实例、DB 仍 `'active'`。

**用户可见后果**：插件中心显示"已启用"，但其全部命令返回 `No handler registered`。**无自愈路径**（后续 activate 因状态已是 ACTIVE 而被 `validateTransition` 拒绝）。

**建议**：失败分支同样使用快照精确清理。

---

### C-4 | worker ↔ inline 执行模式切换泄漏 Worker 线程

**位置**：`packages/core/plugin-host/index.ts:2382-2391`（先写 DB）→ `1521` / `540-549`（再读 DB 决定分支）

`updatePluginFromZip` **先**把新 `execution_mode` 写入 DB（2382-2386），**再**决定停用分支（2391）；而 `deactivatePluginExclusive:1521` 用 `getExecutionMode()` **读 DB**。

worker→inline 时：外层按 `oldMode === 'worker'` 选了 `deactivateWorker`，但实际进入的是 `deactivatePlugin`，其内部读到 `'inline'` → 走 inline 分支 → **Worker 线程从不 `terminate`**，其 `serviceHost` 注册的命令与事件转发（仅 `terminateWorker:1545` 才 dispose）全部残留。随后若以 worker 模式再激活，会被 `createWorker:1294` 的 "Worker already exists" 拒绝。

**建议**：把 mode 作为显式参数贯穿停用链路，不从 DB 二次读取。

---

### C-5 | Watchdog 崩溃重启的 `setTimeout` 不被 `terminate()` 取消 → 僵尸复活

**位置**：`packages/core/worker-runtime/worker-manager.ts:281-296`（重启定时器）vs `330-383`（`terminate()`）

```ts
// :281 崩溃后排队重启
setTimeout(async () => { await this.recreateWorkerCallback(pluginId, ...); }, delay);

// terminate() 内只做 crashStats.delete(pluginId)，没有保存/清除该定时器句柄
```

**触发**：插件 worker 崩溃 → 立刻在同一秒内停用或卸载该插件 → 1–4 秒后回调重建 Worker。给已停用/已卸载的插件重新拉起 Worker。且 `pluginInstances.workerRef` 不更新，`dispatchHttpRequest`（`index.ts:356-358`）与命令派发仍指向已死 transport。

**建议**：把重启定时器句柄存入 worker 注册项，`terminate()` 中 `clearTimeout`。

---

## 3. High（11 项）

### H-1 | `/api/plugins/execute-command` 任意登录角色可调用 + 鉴权 default-allow + 后缀模糊匹配

**位置**：`server/routes/plugins.ts:682, 699-710`、`packages/core/kernel/index.ts:261-288`

```ts
app.post('/api/plugins/execute-command', requireAuth(), ...)   // 任意角色，含 student
```

CommandBus 自身零鉴权。唯一防线是 kernel interceptor，而它**以 actionRegistry 命中为前提**：

```ts
const action = this.actionRegistry.getActionByCommandType(command.type);
if (action) { /* 校验 schema + capability + highRisk */ }   // 无 else 分支！
```

插件若只 `commandBus.registerHandler` 而未 `actionRegistry.register`，该命令对**任何登录用户（含学生）无任何授权检查**。

**加重项**：`plugins.ts:699-710` 的后缀模糊匹配 `key.endsWith(':' + resolvedType)` 会把请求重定向到**其他插件**的 handler key，扩大可派发面。

**缓解事实**：`plugin.install_zip` 标记 `isHighRisk: true`（`builtin.ts:879`），非 admin 被拦入 `pending_commands` 待审批，故教师无法借此提权安装恶意插件。

**建议**：interceptor 改为 default-deny（`action` 缺失即抛错）；删除模糊后缀匹配；该路由显式 `requireAuth('teacher')`。

---

### H-2 | `inflightActivate` / `inflightDeactivate` 是两个独立 Map，二者无互斥

**位置**：`packages/core/plugin-host/index.ts:202-203, 1510`

```ts
private inflightActivate   = new Map<string, Promise<void>>();
private inflightDeactivate = new Map<string, Promise<void>>();   // 二者之间无互斥
```

- **activate 先起、deactivate 后到**：`deactivatePluginExclusive:1510` 判 `currentState !== PluginState.ACTIVE` → **静默 `return`**。用户点"停用"，插件最终仍 ACTIVE。
- **deactivate 先起、activate 后到**：`VALID_TRANSITIONS[DEACTIVATING] = [INACTIVE]`（`index.ts:83`）→ 抛 `IllegalStateTransitionError`，"启用"直接失败。
- `togglePlugin`（1680-1729）虽先 await 两个 inflight（1689-1704），但**决策与执行之间无锁**（TOCTOU），且结尾无条件 `UPDATE status=newStatus`（1727）与 deactivate 写的 `'inactive'`（1590）用词不一致。
- **`reloadPlugin` 完全不经过 inflight**（2596-2817），也不检查 ACTIVATING/DEACTIVATING；`updatePluginFromZip` 的 deactivate→activate（2394-2399）同样裸奔。

**建议**：合并为单一 `inflight: Map<string, Promise>` 按插件串行，或引入 per-plugin 互斥锁。

---

### H-3 | activate 的 5s 超时**不取消** `activate(ctx)`，超时后插件仍可继续注册资源 → 永久泄漏

**位置**：`packages/core/plugin-host/index.ts:1340-1347`（超时）、`1373`（清理）

```ts
await Promise.race([ activate(ctx), new Promise((_, reject) => setTimeout(() => reject(new EsmLoadTimeoutError(...)), 5000)) ]);
```

超时 reject 后进入 catch，`this.resourceTracker.disposeAll(pluginId)` 会 `resources.delete(pluginId)`（`resource-tracker.ts:59`）。此后仍在后台运行的 `activate(ctx)` 调用的 `track()` 会进入**新 list**，永远无人回收。deactivate 超时（1562-1569）同构。

**建议**：引入 `AbortSignal` 传入 `activate(ctx)`，超时后 `signal.abort()`，并在 `ResourceTracker` 中支持"已关闭 pluginId 的后续 track 立即 dispose"。

---

### H-4 | DB 状态与内存状态双写不一致，两个方向都会出现

**位置**：`packages/core/plugin-host/index.ts:1372` vs `1357`；`packages/core/worker-runtime/worker-manager.ts:1237`

- 激活失败**只写内存** `ERROR`（1372），**不写 DB**（只有成功路径 1357 才写 `status='active'`）→ 重启后 `restoreActivePlugins` 会重试一个已知失败的插件。
- 反向：worker 熔断直接 `UPDATE plugins SET status='error'`（worker-manager:1237），**不动 `PluginHost.pluginStates`** → DB=error、内存=ACTIVE。

**建议**：抽出单一 `setPluginState(pluginId, state)` 负责两侧原子更新。

---

### H-5 | SDK parity 测试红灯（33 vs 34）+ 第 34 个 Token 已对外暴露但**未在 DI 注册**

**实测**：`pnpm vitest run packages/plugin-sdk` → **1 failed / 4 passed**

```
FAIL openlearn-dts-parity.test.ts > Token 总数应达到当前的 33 个
AssertionError: expected 34 to be 33
```

**背景**：工作区有一批未提交的 in-flight 变更（教学环节门禁 `StageGuardPipeline`），新增了第 34 个 Token `IStageGuardServiceToken`，已同步 `openlearn.d.ts` / `index.ts` / `docs/api/di-tokens.md`，但**漏了硬编码基线**（`packages/plugin-sdk/__tests__/openlearn-dts-parity.test.ts:74`）。

**更严重的问题**：`IStageGuardServiceToken` 已导出到 SDK（`openlearn.d.ts:947, 1157`），插件可以 `ctx.resolve(IStageGuardServiceToken)`，但 **`packages/core/kernel/index.ts` 从未 `serviceRegistry.register(IStageGuardServiceToken, ...)`** —— 幽灵 API，运行时必然解析失败。

**建议**：合并前把基线改 34；更根本的是把 parity 测试第 5 项从硬编码数字改为"新增 Token 时必须同步 docs"的显式清单。

---

### H-6 | SDK 契约双向漂移 156 项（130 幽灵类型 + 26 反向漂移）

**实测**（脚本静态比对 `index.ts` 与 `openlearn.d.ts`）：

| 方向 | 数量 | 后果 |
|---|---|---|
| `index.ts` 导出、d.ts 未声明 | **130** | 发布包类型入口 = `openlearn.d.ts`（`build.mjs:41` 原样复制为 `dist/index.d.ts`），第三方插件 `import type { X } from '@openlearn/plugin-sdk'` **发布后必然 TS2305** |
| d.ts 声明、`index.ts` 未导出 | **26** | monorepo 内走 workspace 解析到 `index.ts`，`import type { PluginHost }` **本地就失败**——本地红、线上红的反模式 |

幽灵类型样例：`PluginState`、`IPluginRuntime`、`IUnifiedPluginContext`、`PluginLifecycleManager`、`CapabilityResult`、`InvocationRequest`、`GovernanceSpecification`、`IChatCapability`、`SyncMessage`……

**特别严重**：`packages/core/capability/**` 与 `service-registry/**` 缺失最严重（各 8 / 11 项），而 d.ts 却把 `IPluginCapabilityGateway`（`:690-698`）暴露给插件——插件拿到网关却无法引用其 `CapabilityDescriptor` / `CapabilityResult`。

**建议**：以 `openlearn.d.ts` 为唯一真源，用脚本从 core 生成而非手写；短期内先补齐 `PluginState`（最基础、几乎必然被 import）。

---

### H-7 | 脚手架 3/3 模板的 manifest 缺 `main`，而 zod schema 必填 → 生成即失败

**位置**：`packages/plugin-sdk/scaffold/templates/{server-only,full-stack,frontend-only}/src/index.ts` vs `packages/core/esm-loader/manifest-schema.ts:134, 204`

```ts
main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),   // 必填
```

三个模板的 `manifest: { id, name, version, description, author, requires, capabilitiesProposed, engines }` —— **均无 `main` 字段**（`grep -rn "main:" templates/` 为空）。

**后果**：新插件作者第一条命令 `pnpm openlearn-plugin new` + 安装 → manifest 校验直接失败。**SDK 唯一的新手路径 100% 不可用。**

**附带**：模板声明了 `description` / `author`，而 d.ts 的 `Manifest` 接口（`openlearn.d.ts:40-70`）无此字段，仅靠 `[key: string]: unknown` 兜底。

---

### H-8 | 插件测试污染工作树：5026 个 `plugins/<uuid>/` 孤儿目录（75MB），仍在日增

**实测**：

```
plugins/ 下 UUID 目录：5026   总占用：75M
DB 中 plugin 记录：7 条（全部 status=active, execution_mode=inline）
磁盘上有 manifest 但 DB 无的插件 id：38 个
其中含 ext-test-worker-rpc / ext-test-watchdog / ext-test-state-inherit 等【测试夹具】
按日分布：09-26:467  09-27:595  ...  10-04:462  10-06:28（即本次跑测试当天）
```

**根因**：`packages/core/plugin-host/__tests__/plugin-host.test.ts:304` 与 `hot-reload.test.ts:203,347,442` 调用 `new PluginHost(sr, loader, db)` **未传第 4 个参数 `pluginsDir`**，回退到 `path.resolve(process.cwd(), 'plugins')`（`index.ts:234`）——即写入真实仓库目录。对照组：`plugin-hardening.test.ts:162` 与 `e2e-lifecycle.test.ts:191` 正确传了 `tempDir`。

**三重影响**：(1) 开发者工作树被数百份可执行插件代码淹没；(2) 测试用 `/tmp` 隔离 DB，DB 行消失但目录留下 → 永久孤儿；(3) 该目录在 `.gitignore:4`，但仍会被 eslint / codegraph / vite 扫描，拖慢工具链。

**修复**：`new PluginHost(sr, loader, db, mkdtempSync(...))` + `afterEach` 清理；并在 `vitest.setup.ts` 加全局守卫，禁止 `process.cwd()/plugins` 被写入。清理存量：`find plugins -maxdepth 1 -type d -name '*-*-*-*-*' -exec rm -rf {} +`。

---

### H-9 | `method-policy.ts`（高危路径 / 能力策略）仅存在于前端，后端零等价物 → 安全策略单边

**位置**：`src/plugin-host/method-policy.ts:58-76`（定义 `HIGH_RISK_PATH_PREFIXES` 含 `/api/plugins`、`/api/users`、`/api/auth`、`/api/site-settings` 等；`IRREVERSIBLE_PATH_SUFFIXES`；`api:write`/`api:admin`/`grades:write`）vs `packages/core/worker-runtime/`（**无任何等价文件**，`grep` 结果为空）

**影响**：该文件头声称"真正的权限边界在服务端"，但对 **server worker 插件**而言，边界是 `BASE_WORKER_SERVICE_TOKENS` 中的 `ICommandBusService`——`ctx.services.commandBus.execute()` 可派发**任意**命令类型，路径/方法级收窄为零。这条纵深防御只保护了浏览器侧插件。

`allowed-tokens.ts:4-16` 已自认"两端必须同步"，但**无共享测试向量**：前端 `src/plugin-host/__tests__/method-policy.test.ts` 是唯一测试，后端零对应测试。

---

### H-10 | 同一道 Barrier 2 在前后端有两种语义

**位置**：
- `packages/core/worker-runtime/service-host.ts:644`：`msg.method !== 'get'`
- `src/plugin-host/service-host.ts:247`：`!msg.method.startsWith('get')`

**后果**：`getUserList`、`getAllActions` 这类非 `get` 前缀的方法，在 **server worker 插件里被拒绝、在浏览器 worker 插件里放行**。两处注释都称之为 "Barrier 2"，维护者极易只改一端。

---

### H-11 | 白名单判定用**子串匹配**，可用伪造 `requires` 绕过

**位置**：`src/plugin-host/allowed-tokens.ts:106-110`、`packages/core/worker-runtime/worker-manager.ts:102`

```ts
// 前端
SENSITIVE_FRONTEND_SERVICE_TOKENS.some((token) => dep.includes(token.slice(token.indexOf(':') + 1)))
// 后端 —— 同构硬编码
(dep.includes('IPointsLedgerService') || dep.includes('IPointsDimensionRegistry'))
```

manifest 里写 `requires: ['@evil/x:MyISemesterGradeServiceThing']` 即可命中 `ISemesterGradeService`，拿到成绩写入白名单；`requires: ['@x/x:IAmPointsLedgerServiceButFake']` 即可拿到积分账本写入权。**两端同源缺陷。**

**建议**：改为精确匹配 token 字符串（`dep === token` 或 `parseRequiresEntry(dep).domain + ':' + name` 精确比较）。

---

## 4. Medium（12 项）

### M-1 | 停用后残留：AI persona / AI context provider / points 维度未纳入 ResourceTracker

**位置**：`packages/core/plugin-host/context-builder.ts:519-532`（AI provider / persona）、`411-423`（points 维度，注释称"单例无需清理"）

`tracker.track` 在 context-builder 中只出现 8 处（200/260/306/323/359/723/755），**均不覆盖** `registerAIContextProvider`、`registerAIPersona`、`registerDimension`。这些注册进入模块级单例 `AIService` / points registry，跨插件存活 → **停用的插件继续向 AI 请求注入上下文与角色模板，学生档案雷达永久出现已停用插件的维度**。

### M-2 | 声明式 UI contribution 停用不清 → 按钮可见但命令 404

**位置**：`index.ts:987 / 1907 / 2374`（注册，键为 `manifest.id`）vs `1859`（**仅 uninstall 注销**）

`deactivatePlugin` 从不 `contributionRegistry.unregister`。用户停用插件后，其工具栏按钮 / 教师 Tab / Dashboard 挂件**仍然可见**，点击即报错。

### M-3 | `UnifiedExtensionRegistry` 无 `unregister` API

**位置**：`packages/core/plugin-host/unified-extension-registry.ts:38-113`

`syncContributionRegistry` 单向只增，重复 id 直接跳过。卸载或改配置后陈旧条目永久留存。

### M-4 | `deploy.staticRoute` 停用不清 → 停用插件静态资源仍可下载

**位置**：`index.ts:1827-1843`（仅 uninstall 摘除）vs `setExpressApp:244-259`（对**所有已安装**插件挂载，含 disabled/error）

### M-5 | `/api/plugins/:id` 详情端点无鉴权 → 匿名枚举

**位置**：`server/routes/plugins.ts:530`、`:179`

`app.get('/api/plugins/:id(*)')` 与 `/api/plugins/by-manifest/:manifestId(*)` **均无 `requireAuth()`**——同文件其余 15 个插件路由全部有。匿名可枚举全部插件 id / manifestId / version / executionMode。

### M-6 | esbuild 放行绝对路径 import → 可把宿主任意文件内联进插件产物

**位置**：`packages/core/esm-loader/install-utils.ts:79-80`

```ts
if (args.path.startsWith('.') || args.path.startsWith('/')) return undefined;  // 绝对路径直接放行
```

**待验证**：需确认 esbuild 对二进制 / 未知扩展名的行为以确定实际泄露范围（文本文件可确定泄露）。

### M-7 | SSRF 防护不解析 DNS，可被 DNS rebinding 绕过

**位置**：`server/utils/url-safety.ts:117-118`（代码自述："本函数只做字面量校验，不解析 DNS"）

字面量判定已相当完整（IPv6 展开、`::ffff` 映射、inet_aton 十进制/八进制/十六进制混淆全覆盖），但攻击者控制的域名可将 A 记录指向 `169.254.169.254`。**待验证**：`community-registry.ts:374` 的 fetch 是否在重定向后复检。

### M-8 | `StageGuardPipeline`（in-flight）纯前端执行 + fail-open + guard 无插件归属

**位置**：`packages/core/lesson-engine/stage-guard-pipeline.ts`（未提交的新增文件）

这是本次审计中唯一的新增插件扩展点，问题较集中：
- **仅前端强制**：`checkAccess` 的唯一调用点是 `src/features/lesson-engine/lessonEngineStore.ts:215`；服务端 `LessonRuntime`（`lesson-runtime.ts:44`）虽持有 `stageGuard`，但**无任何服务端调用** → 门禁是客户端权威的，改一行 JS 即可绕过。
- **Fail-open**：`stage-guard-pipeline.ts:111`（超时）与 `:124`（抛错）均 `return { allowed: true }` → 插件的 bug / 慢响应静默放行。
- **guard 无插件归属**：`registerGuard` 按裸 `guard.id` 存 `Map`，无 pluginId 命名空间 → 插件 B 可用同名 id 覆盖插件 A 的守卫（last-write-wins）。
- **N 倍延迟**：串行 `for` 循环 + 每守卫 1500ms 超时，无整体上限；装 5 个慢守卫 = 每次环节切换最多等 7.5 秒。
- 叠加 H-5：`IStageGuardServiceToken` 已在 SDK 暴露但未在 DI 注册。

### M-9 | capability 体系 4 套并行

| 目录 | 行数 | 状态 |
|---|---|---|
| `capability/` | 709 | ✅ 生效（`CapabilityGuard` 在 kernel + worker 注入） |
| `capability-governance/` | ~530 | ⚠️ 仅 kernel 构造 + 1 个测试 + SDK 暴露，**零生产消费者** |
| `capability-system/` | 9 | `@deprecated` 兼容壳，3 处测试仍在引用 |
| `ai-capability/` | — | ✅ 生效（`CapabilityRegistry`） |

`capability-governance` 的 policy-engine / lifecycle-engine / namespace-manager / health-monitor / manifest-exporter 共约 530 行，实际是空转。

### M-10 | 5 层插件 facade，其中 3 层零生产消费者，但被文档与 SDK 广泛暴露

| Token | 生产消费者 |
|---|---|
| `IPluginHostToken` | ✅ builtin.ts:68 |
| `IPluginLifecycleManagerToken` | 仅 `packages/plugins/builtin.ts:70`（即 builtin 插件自己） |
| `IPluginDistributionManagerToken` | 仅 `packages/plugins/builtin.ts:71` |
| `IPluginRuntimeCompositionToken` | **0** |
| `IUnifiedExtensionRegistryToken` | **0** |
| `IPluginCapabilityGatewayToken` | **0**（`resolveCapability` 仅被自身调用） |

这些 facade 在 `kernel/index.ts:219-225` 注册、在 `openlearn.d.ts` 暴露、并在 `docs/{architecture,sdk,reference,api,governance}/**` 共 12+ 篇文档中作为正式 API 描述。文档把不存在的消费者描述成了已投产的能力。

### M-11 | 依赖解析把「缺依赖阻塞」误判为「循环依赖」，并仍强行激活

**位置**：`packages/core/plugin-host/dependency-resolver.ts:169-179, 218-242` + `index.ts:2539`

`topologicalSort` 中 blocked 节点不入队 → 其下游 `inDegree` 永不递减 → 被 218-242 全部归入 `cycles`。而 `restoreActivePlugins:2539` 又 `for (const cycle of cycles) orderedIds.push(...)` **照样激活**。缺依赖的插件被强行尝试，日志误报为"循环依赖"。

（另：`checkCrossPluginServices` 只校验 provider 的 `manifest.provides` 声明，不校验 provider 是否 ACTIVE → provider 已停用时 consumer 仍能激活，运行时才失败。）

### M-12 | `extension-points.ts` 是生产死代码，且与真实实现语义相反

`ExtensionPointRegistry` 除自身测试外**无任何生产引用**；真实链路是 `usePluginHostStore.registerExtensionPoint`。且重复 id 处理**语义相反**：

- `extension-points.ts:35-38`：重复 → **throw**
- `plugin-host-store.ts:120-131`：重复 → **静默覆盖**（注释说明为容忍服务端重启 / HMR 换 UUID）

测试覆盖的是永不运行的实现。

---

## 5. Low（8 项）

| # | 问题 | 位置 |
|---|---|---|
| L-1 | CSP 保留 `scriptSrcAttr: ["'unsafe-inline'"]`，生产未收紧（配合 `blob:` 脚本源，插件前端可构造 XSS） | `server.ts:196-197` |
| L-2 | 静态路由冲突检测仅全等：`/foo` vs `/foo/`、`/Foo` 可重复挂载；黑名单仅 6 个前缀 | `index.ts:2071-2087` |
| L-3 | `npm install --registry=https://registry.npmmirror.com` 硬编码镜像源，无 lockfile 完整性校验；**安装失败仅 `console.error` 后继续激活插件** | `index.ts:2017-2026` |
| L-4 | `node-loader.ts:8-9` 注释失实——声称「data: URL 模块在 Node.js 中无法访问 require/fs」，实测可正常 `import fs from 'node:fs'` | `packages/core/esm-loader/node-loader.ts:8-9` |
| L-5 | 4 处 import 用了 `.ts` 扩展名（其余全部 `.js`），一旦改用 tsc 编译 ESM 即断 | `capability/index.ts:16`、`capability-runtime-kernel.ts:10`、`classroom-runtime/session-manager.ts:8`、`src/features/whiteboard/canvas-model/index.ts:14` |
| L-6 | `listContributions` 用 `resolvePluginUuid`（返回 DB 主键 = UUID）查询，而 registry 以 `manifest.id` 为键 → 带 UUID 查询恒返回空 | `index.ts:811` vs `987/1907/2374` |
| L-7 | `plugins` 表无 `version` 列（版本只在 manifest JSON 里），无法做 SQL 级版本查询 | `packages/core/db` |
| L-8 | parity 测试 4 个用例全部只比对 `*Token` **名字集合**，对 156 项签名/类型漂移一律无感 → 持续的虚假安全感 | `packages/plugin-sdk/__tests__/openlearn-dts-parity.test.ts:53-71` |

### 巨型函数（高风险区）

| 位置 | 行数 |
|---|---|
| `generateBootstrapCode` — `worker-runtime/worker-manager.ts:425-1186` | **762** |
| `activatePluginExclusive` — `plugin-host/index.ts:1095-1459` | **365** |
| `updatePluginFromZip` — `plugin-host/index.ts:2194-2457` | 264 |
| `installPluginFromZip` — `plugin-host/index.ts:1883-2143` | 261 |
| `createWorker` — `worker-runtime/worker-manager.ts:1284-1533` | 250 |
| `PluginHost` 类整体 — `plugin-host/index.ts:166-2818` | 2652（34 个 public + 15 个 private = 49 个方法） |

`activatePluginExclusive` 同时负责 preloaded / inline / worker 三条路径 + 依赖检查 + 能力授予 + 中间件 + 超时 + 回滚，是 C-3 / H-2 / H-3 / H-4 的**共同根因**。

---

## 6. 已验证防护到位的点（勿重复审计）

这些是本插件系统确实做得好的地方，也是它比一般插件平台成熟的部分：

**边界与隔离**
- Worker service allowlist 生产链路完整（`worker-manager:1309` → `1320` → `service-host:165` → `632-638`），BASE 8 token **不含 `IPluginHost`**；回归测试 `sandbox-confinement.test.ts:87`、`service-host-allowlist.test.ts` 存在
- `assertDatabaseAccessAllowed`（`service-host.ts:897-995`）：禁 ATTACH / PRAGMA / VACUUM / TRIGGER，核心表全禁，DDL 限 `plugin_<自己id>_*` 命名空间
- `IStorageService` RPC 走 `plugin_storage` 表 + manifestId 强隔离（`service-host.ts:657-684`），跨插件读写已阻断
- 插件命令命名空间**强制** manifestId 前缀（`context-builder:160-165`）+ 跨 UUID 命名空间劫持拒绝（`:171-181`）
- `setInterceptor` 双向封禁（`context-builder:230`、`worker-manager:899`）
- `ensureUniqueManifestId`（`index.ts:1893`）阻止 ZIP 插件冒用内核 manifest.id；`isSystemPluginRecord` 覆盖 update/uninstall

**安装链路**
- ZIP 路径穿越拦截（`install-utils:147-151`）、ZIP bomb 总量上限（`:130-144`）、zod manifest 校验（`:163`）
- deploy script 的 Zip Slip 拦截（`index.ts:1946-1950`）+ **默认禁用**，需显式 `ALLOW_UNSAFE_PLUGIN_SCRIPTS=true`
- `npm install --ignore-scripts`（`index.ts:2017`）
- `isHighRisk` 人工审批闸门（`kernel/index.ts:290-309`）有效阻止非 admin 执行 `plugin.install_zip`
- 插件静态路由禁占 `/api`、`/socket.io`、`/runtime`、`/docs`、`/admin`、`/health` 及 `/`

**插件 REST 网关**（`plugin-api-gateway.ts`）
- 默认要求登录（`auth !== false`，`:259-263`）、manifest `roles` 白名单 + administrator 豁免（`:266-276`）
- 路径穿越双检（`:209-217`）、默认 120 req/min（`:282`）、请求头白名单（`:295-301`）
- SSE 并发配额（`:330`）、payload 体积上限（`:230`）

**全局**
- CSRF 三层判定（Sec-Fetch-Site → Origin → Referer）+ SameSite=Lax 兜底
- 生产 CSP `scriptSrc` 已去 `unsafe-inline` / `unsafe-eval`（`server.ts:196`），`connectSrc` 已收紧至 `'self'`
- Worker 上限 32（`worker-manager:123`）+ 128MB 堆限制（`:1324-1327`）
- 插件装卸 / toggle / config 等写操作全部 `requireAuth('administrator')`

**工程质量**
- `openlearn-dts-parity.test.ts` 的**存在本身**是加分项（历史曾出现 d.ts 缺 14/33 Token），只是断言面太窄（H-6 / L-8）
- 380 个插件相关测试 11 秒跑完，44/45 文件通过
- `ResourceTracker` 的 `snapshot` / `reap` 设计正确（用于热重载精确清理）——只是 `reloadPlugin` 失败路径没用它（C-3）

---

## 7. 建议执行顺序

**第 1 批（安全，本周）**
1. C-1 + C-6：把 `bundlePlugin` + 静态 AST 检查收敛成「一道静态门」，`installPlugin` 与 `installPluginFromZip` 两条安装路径共用
2. C-2：`service-host.ts` 的 `invoke` 接入 `capabilityGuard.check()`
3. H-1：interceptor 改 default-deny + 删除后缀模糊匹配 + 路由提权到 teacher
4. M-5：给 `/api/plugins/:id` 补 `requireAuth()`
5. H-11：`hasSensitiveDep` / worker points token 改精确匹配

**第 2 批（生命周期，本周）**
6. C-3：reload 失败分支改用快照精确清理
7. C-5：`terminate()` 取消 watchdog 定时器
8. C-4：mode 作为参数贯穿停用链路，不从 DB 二次读
9. H-2：合并 inflight Map 或加 per-plugin 锁
10. H-3：activate/deactivate 超时引入 AbortSignal
11. M-1 / M-2：把 `registerAIPersona` / `registerAIContextProvider` / `registerDimension` 纳入 `tracker.track`；deactivate 时注销 contribution

**第 3 批（契约与卫生，下周）**
12. H-7：三个脚手架模板补 `main`（同时修 `description`/`author` 类型）
13. H-5：基线改 34；`IStageGuardServiceToken` 要么在 DI 注册要么从 SDK 撤下
14. H-6 + L-8：parity 测试升级为 AST 成员级 diff，补齐 130 幽灵类型 + 26 反向漂移
15. H-8：所有 `new PluginHost(...)` 补 `pluginsDir` 临时目录 + `afterEach` 清理；清理存量 5026 目录
16. M-8：`StageGuardPipeline` 必须服务端强制 + fail-close（至少对 deny 决策）+ guard 加 pluginId 命名空间
17. M-10 / M-9：删除或标注 3 个零消费者 facade + `capability-governance` 空转子系统，同步修正 12+ 篇文档

**长期**
18. C-1 长期方案：Node Permission Model 或子进程 + container 隔离
19. 拆分 `PluginHost`（2652 行 / 34 方法）与 `generateBootstrapCode`（762 行）
20. H-9：把 `method-policy.ts` 策略搬到后端或抽成两端共享的纯数据模块 + 共享测试向量

---

## 8. 本次审计的局限

1. **未做运行时渗透测试**。C-1 / C-2 / H-1 的结论基于静态代码路径推导，建议在隔离环境构造 PoC 实测确认。
2. **M-6（绝对路径 import）的泄露范围未完全确定**：需确认 esbuild 对二进制 / 未知扩展名的 loader 行为；文本文件泄露可确定。
3. **M-7（SSRF / DNS rebinding）未验证重定向后是否复检** `community-registry.ts:374` 的 fetch。
4. **前端 5 组重复实现的语义漂移仅抽样核对了 Barrier 2**；`allowed-tokens.ts` 与 `worker-manager.ts:65-120` 的完整规则差异未逐条比对。
5. **`capability-governance`（~530 行）的"零消费者"结论基于 grep 生产代码**；不排除通过反射 / DI 自动装配间接使用，但这与"零显式消费者"在维护成本上等价。
6. **工作区存在未提交变更**（教学环节门禁 `StageGuardPipeline` 等 12 个文件 + 3 个新文件）。H-5 / M-8 是针对这批 in-flight 代码的评估，合并方式可能改变结论。
7. **未审计 MFE 子系统**（`packages/mfe-whiteboard`、`packages/mfe-courseware`、`packages/activity-ecosystem`）的插件化程度。