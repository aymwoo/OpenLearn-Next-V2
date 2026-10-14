# OpenLearn V2 插件系统专项审计

> **审计日期**：2026-10-14
> **审计对象**：`openlearn-next@0.6.1`（仓库 `OpenLearn-Next-V2`，对照 `main` @ `6ebfc84`）
> **依据**：`docs/AUDIT_REPORT.md`（2026-10-13 全系统审计）里与插件相关的结论，本次只复核插件子系统，并补上那份报告没有展开的信任边界。
> **方法**：读当前树的安装、策略、worker、网关和前端宿主；能用 Vitest 或 Node 权限模型探针复现的都复现了。PL-01 到 PL-08 已在本分支修复，对应 PoC 改为回归断言。
> **环境**：Node.js v22.14.0，pnpm 10.33.4，Linux。权限模型探针用的就是这个 Node，不是文档里写的 v24。
> **PoC**：`packages/core/plugin-host/__tests__/plugin-audit-poc.test.ts`。PL-01 到 PL-08 断言漏洞已被阻断。PL-09、PL-10、PL-12、PL-15 的用例仍锁定未修复行为。
> **迁移**：`docs/plugin/plugin-security-migration.md`。

## 修复状态（2026-10-14）

| 编号 | 状态 |
| --- | --- |
| PL-01 | 已修复。进程内身份只看 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 或内置目录；预加载内置插件单独放行。 |
| PL-02 | 已修复。远程前端进入 `sandbox="allow-scripts"` 的不透明源 iframe，经 postMessage 桥调用宿主；`/plugins` 需要有效会话。 |
| PL-03 | 已修复。插件命令的 actor 由宿主写成 `plugin:<id>`，`metadata.approved` 被丢掉；空 actor 在命令总线被拒绝。 |
| PL-04 | 已修复。第三方能力要管理员写入批准表；`*`、`*:*`、`*:*:*` 不能授予；插件不能调用 `grant` / `revokeAll`。 |
| PL-05 | 已修复。SQL 只允许插件自己的表前缀、`plugin_migrations`，以及显式授权的研究表。 |
| PL-06 | 已修复。建表和删表都用安装主键；卸载同时清掉旧的 manifest id 前缀。 |
| PL-07 | 已修复。社区安装默认关闭；安装和更新要求完整性哈希与 Ed25519 签名；注册表的 `verified` 字段不再点亮「已认证」。 |
| PL-08 | 已修复。子进程默认拒绝原始 socket 和 DNS；HTTP 只经宿主代理访问已批准域名；另有 RSS 与 CPU 窗口上限。 |
| PL-09 至 PL-15 | 未在本次修复。公开路由批准、符号链接跟随、开发面板 `new Function`、会话桥子串、审计覆盖、不安全部署脚本、兼容测试范围仍按下文描述。 |

威胁模型：管理员会安装社区注册表或 ZIP 里的第三方包。产品界面把这类包装成「未受信任、进子进程、不继承密钥」。学生和教师打开应用后，活跃插件的前端会在他们的页面里执行。审计问题是：这个边界是否真的挡住了第三方代码，而不是管理员是否「自愿」执行任意程序。

---

## 1. 和上次全系统审计的关系

| 上次编号 | 上次结论 | 本次 |
| --- | --- | --- |
| H-4 第三方插件默认 inline | 缺省 `executionMode` 落成宿主进程 | **部分修复，关键洞还在。** 不以 `@openlearn/` 开头的 id 会被改写成 `process`（PoC 已安装两份 ZIP 对照）。但任意 ZIP 只要把 `manifest.id` 写成 `@openlearn/...`，策略就把它当成内置插件，安装结果是 `inline`。没有签名。 |
| M-5 `/plugins` 静态目录无鉴权 | 匿名可拉插件源码 | **仍在。** `server.ts:298` |
| 插件前端 Blob URL | CSP `scriptSrc` 含 `blob:` | **仍在，而且比「源码泄露」严重。** 活跃插件的 `frontend.js` 会在主页面里 `import()`，和学生/教师同源。 |
| H-5 SDK `dist/` 不进构建 | 干净环境类型检查失败 | 不在本次范围。当前根 `package.json` 的 `prepare` 和 `build` 都会跑 `scripts/build-plugin-sdk.mjs`，本次 `pnpm install` 已生成 `dist/`。没有重跑 CI。 |

上次报告建议「非 `@openlearn/` 默认 process，inline 只允许白名单」。白名单做成了「字符串前缀」，没有做成「这份代码确实来自平台」。

---

## 2. 结论

第三方插件**没有**跑在文档所写的沙箱里。

- 后端：不带 `@openlearn/` 前缀的包会进子进程，环境变量白名单和 Node 权限模型是真的（密钥不继承、不能再起子进程、不能 `eval`、不能新建指向外部的符号链接）。但子进程仍能出网；SQL 守卫是一张不完整的黑名单；命令总线相信插件自己填的 `actorId`；能力字符串由插件自己声明，`*` 等于超级用户。
- 只要清单 id 以 `@openlearn/` 开头，上述子进程约束全部不生效，插件与宿主同进程。清单 schema 不拒绝这个前缀。
- 前端：有 `frontend.js` 的活跃插件对所有打开应用的用户执行，位置是主页面的 Blob URL，不是课件那种无 `allow-same-origin` 的 iframe。方法策略只包住 SDK 句柄，插件可以直接 `fetch`。

公测前必须修的是第 3 节里标了「必须」的 PL-01 到 PL-06。不修的话，不能把「安装社区插件」描述成沙箱内的扩展。

---

## 3. 发现

严重程度：严重 > 高 > 中 > 低。

### PL-01 严重 — 伪造 `@openlearn/` 前缀即可在宿主进程内执行

**状态：已修复。** 下文保留发现时的证据。当前策略见 `execution-policy.ts` 与迁移说明。

| | |
| --- | --- |
| 位置 | `packages/core/plugin-host/execution-policy.ts:19`、`:35`–`:37`；`packages/core/esm-loader/manifest-schema.ts:761`–`:764`；`packages/core/plugin-host/install.ts:599`–`:606`；`packages/core/plugin-host/core.ts:890`–`:893` |
| 证据 | PoC「生产环境策略把任意 `@openlearn/not-a-builtin` 当成内置插件」与「ZIP 安装落成 inline」。同一测试里 `ext-audit-community` 在 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1` 下被改写成 `process`。 |

`isTrustedInProcessPlugin` 只看 `manifestId.startsWith('@openlearn/')`，或者 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 里的精确 id。schema 只禁止 id 里出现冒号，防止 `plugin:@evil:admin` 这种旧的角色后缀伪造，不禁止占用平台前缀。

安装走 `resolvePluginExecutionMode(manifest.id, requestedMode)`，没有「这个 id 必须是预加载内置插件」的检查。`isSystemPluginRecord` 会挡住**更新**伪造 id，挡不住**首次安装**。因此攻击者可以装一个永远无法用更新接口替换、但以 inline 运行的包。

inline 之后插件与宿主同进程，权限模型和 `buildMinimalEnv` 都不适用。`ctx.resolve` 的字符串白名单包含 `IDatabase`、`IPluginHost`、`IAuthSessionBridgeService` 等（`packages/core/di/interfaces.ts:881`–`:905`）。`IDatabase` 在这条路径上是 better-sqlite3 原句柄，没有 worker 那层 SQL 守卫。`AuthSessionBridgeService.createSession`（`packages/core/di/auth-session-bridge-service.ts:14`–`:22`）不核对调用方，传入 `role: 'administrator'` 就会签发 `token_` 会话。Token 对象路径在 `context-builder.ts:871` 不做白名单，注释写「必须 import SDK 常量所以天然安全」，而 SDK 导出了这些特权 Token。

另外：`execution-policy.ts:37` 在设置了 `VITEST` 且没有 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1` 时，**所有** id 都视为可进程内执行。这是测试夹具开关。生产进程不应带 `VITEST`。

**复现**

1. 打一个 ZIP：`manifest.json` 的 `id` 为 `@openlearn/not-a-builtin`，`executionMode` 为 `inline` 或省略，加上一个只导出 `activate` 的 `index.js`。
2. 管理员走 ZIP 安装或 `POST /api/plugins/install-from-url`（后者要 `acknowledgeRisk: true`）。
3. 安装结果的 `executionMode` 为 `inline`，且 `executionModeCoerced` 不为 true。

**修复**

- 进程内信任只认启动时注册的预加载 id（`registerPreloadedPlugin` 那一组），不要认清单字符串前缀。
- 社区包和 ZIP 禁止使用 `@openlearn/`。`OPENLEARN_TRUSTED_INLINE_PLUGINS` 只接受精确 id，并且管理界面要显示「此包将与宿主同进程」。
- 生产启动若发现 `VITEST`，拒绝启动或强制 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION`。

### PL-02 严重 — 插件前端在主页面执行，方法策略挡不住

**状态：已修复。** 远程激活改走 `/plugin-sandbox/frame`。父页面里的 Blob `import()` 只留在内联单测加载器。

| | |
| --- | --- |
| 位置 | `src/plugin-host/plugin-host.ts:412`–`:446`；`src/hooks/useClassroomSlice.ts:220`–`:269`；`src/App.tsx:37`（`useAppComposer` → 该 slice）；`server.ts:190`–`:199`、`:298`；`packages/core/plugin-host/method-policy.ts:255`–`:266` |
| 证据 | PoC 锁定了源码里的 `URL.createObjectURL`、`import(blobUrl)`、slice 里写死的 `executionMode: 'inline'`、CSP 的 `blob:`，以及 `/plugins` 的 `express.static`。 |

`activateRemotePlugin` 拉取 `/plugins/<uuid>/frontend.js`，包成 Blob，在主页面 `import()`。Blob URL 继承页面源。会话 cookie `edu_os_token` 是 HttpOnly（`server/routes/roster.ts:776`），脚本读不到 cookie 文本，但同源 `fetch` 会带上它。CSRF 门控按 `Sec-Fetch-Site` 放行 same-origin（`server/middleware/csrf.ts:39`–`:41`），页面内脚本发的写请求过这道门。

谁会跑到这段代码：应用壳对每个 `has_frontend` 的**活跃**插件调用 `activateRemotePlugin`。学生和教师都走这个壳。slice 把前端执行模式写死成 `inline`，后端即便是 `process`，浏览器侧也不进 Worker。

`checkMethodPolicy` 只包 SDK 的 `IFrontendAPI`。插件不调用它，直接 `fetch('/api/students/...')` 即可。源码注释已经写明：capability 由插件自填，只读接口可以用来把数据外传。

`/plugins` 静态目录没有登录校验。匿名请求可以下载 `index.js`、`frontend.js`、`package.zip`。这是上次 M-5，本次确认未改。源码泄露本身是「高」；和 PL-02 的执行合在一起才是「严重」。

**复现**

1. 安装并激活一个带 `frontend.js` 的插件。`frontend.js` 在顶层调用 `fetch('/api/plugins', { credentials: 'include' })`。
2. 用学生或教师账号打开应用。
3. 该请求带会话发出，不经过 `checkMethodPolicy`。

**修复**

- 未受信任插件的前端放进 sandbox iframe：`sandbox` 不含 `allow-same-origin`，父页面用 postMessage 提供显式 API。不要在主页面 `import()` 第三方源码。
- 在此之前，社区包禁止携带 `frontend.js`，或激活前端需要与后端隔离同等的二次确认，并且不要对所有登录用户自动激活。
- `/plugins` 改为登录后访问；至少不要把 `package.zip` 和 `index.js` 匿名挂出去。`blob:` 从生产 `script-src` 去掉，只在确认加载通道不再需要它之后。

### PL-03 严重 — 子进程插件可以冒充管理员并自己批准高危命令

**状态：已修复。** 插件边界改写 actor 并删除 `metadata.approved`。宿主自己的 `admin` / `user:*:administrator` 调用不受影响。 这发生在 PL-01 之外：普通 `ext-*` 插件、已经进了子进程，依然能走通。

| | |
| --- | --- |
| 位置 | `packages/core/worker-runtime/service-host.ts:789`–`:831` 与 `:860`–`:872`；`packages/core/worker-runtime/bootstrap/sections/message-handler.ts:214`；`packages/core/kernel/index.ts:310`–`:331`；`packages/core/command-bus/index.ts:88`–`:91`；`packages/core/capability/guard/capability-guard.ts:24`–`:36` |
| 证据 | PoC「命令 execute 原样转发 actorId=admin 与 metadata.approved=true」。PoC「真实 Kernel：`actorId: 'admin'` 执行高危命令成功并打印 Bypassing human approval；插件自己的 actor 被 CapabilityGuard 拒绝；授予对应能力后 `metadata.approved: true` 不再要求人工审批；`actorId: ''` 被改写成 `agent-system-0` 并执行了需要 `lesson:delete` 的命令」。 |

Worker 基础白名单包含 `ICommandBusService`（`worker-manager.ts:72`）。`registerHandler` 会加插件命名空间，`execute` 不会改写命令体。内核把下面这些 actor 当成管理员，跳过能力检查和高危审批：

- `admin`、`usr_admin`、`admin-demo`、`role:administrator`
- `user:<id>:administrator` 或 `user:<id>:admin`

插件把 `actorId` 设成 `admin` 即命中。高危命令还要 `metadata.approved === true` 才跳过审批；这个字段也由调用方提供，没有「审批来自管理员点击」的校验。

不填 `actorId` 时，命令总线把它补成 `agent-system-0`。这个 actor 在 `CapabilityGuard` 构造时就拥有 `lesson:write`、`lesson:delete`、`vfs:write`、`management:write` 等。非高危、但能力落在这张表里的命令会被放行。

**复现**

见 PoC 最后一段 Kernel 用例：注册 `capabilityRequired: 'site:destroy'` 且 `isHighRisk: true` 的命令，用 `createCommand(type, {}, 'admin')` 执行，处理器运行并返回。

**修复**

- 插件上下文和 ServiceHost 在执行命令前把 `actorId` 覆盖为 `plugin:<manifestId>`，丢掉调用方传入的值。
- 插件不能设置 `metadata.approved`。审批只来自管理端的审批接口。
- 缺省 actor 不要落成 `agent-system-0`。没有 actor 就拒绝。
- 管理员短路只接受会话层签发的 `user:<id>:administrator`，不要保留裸字符串 `admin`。

### PL-04 高 — 能力声明即授权，`*` 是超级用户，插件还能继续 `grant`

**状态：已修复。**

**公测前必须修。** 它让 PL-03 不必冒充 `admin`：先拿到 `*`，再自批高危命令。

| | |
| --- | --- |
| 位置 | `packages/core/plugin-host/lifecycle.ts:427`–`:432`（激活时同样的调用在 `:173`、`:251`、`:483`）；`packages/core/capability/guard/capability-guard.ts:41`–`:46`、`:134`；`packages/core/plugin-host/method-policy.ts:96`–`:98`、`:262`–`:263`；`packages/core/worker-runtime/worker-manager.ts:75`；`packages/core/plugin-host/context-builder.ts:459`–`:465` |
| 证据 | PoC：清单里只要有任意一项能力（测试用 `storage:read`），RPC `ICapabilityService.grant('plugin:ext-community', '*')` 成功，随后 `guard.check(..., 'site:destroy')` 为 true。能力列表为空时，同一调用被 Barrier 2 拒绝。 |

`grantCapabilities` 把 `capabilitiesProposed` 里的每个字符串原样 `grant` 给 `plugin:<manifestId>`，没有平台侧能力目录，也没有管理员批准。`check()` 看到 `*` 或 `*:*:*` 直接通过。方法策略的 `hasCapability` 同样把 `*` 当成「拥有该项」。

Worker 基础白名单始终下发 `ICapabilityService`。`wrapCapability` 把 `grant` 和 `revokeAll` 暴露给 inline 插件，且不限制 actor。因此插件可以给别的 actor 加能力，或 `revokeAll` 掉别人的能力。

空能力列表确实会把 worker 收成只读。绕过方式是在清单里写任意一项，例如 `storage:read`。

**修复**

- 激活时只授予平台枚举过的能力。`*`、`api:admin`、`grades:write`、`agent:tool` 必须管理员在安装界面逐项勾选，不能随清单自动生效。
- 从插件可见的能力服务里去掉 `grant` / `revokeAll`。插件只保留 `check`。
- `ICapabilityService` 移出 `BASE_WORKER_SERVICE_TOKENS`。

### PL-05 高 — 数据库守卫是黑名单，学生提交、VFS、投票和 `sqlite_master` 不在其中

**状态：已修复。** 研究表默认只给精确 id `lianyun-course`，可用 `OPENLEARN_RESEARCH_SQL_PLUGINS` 替换。

**公测前必须修。**

| | |
| --- | --- |
| 位置 | `packages/core/worker-runtime/service-host.ts:940`–`:1085`，黑名单 `:965`–`:1007`，研究表特例 `:1016`–`:1023`；`packages/core/worker-runtime/worker-manager.ts:71`–`:79` |
| 证据 | PoC：`SELECT password_hash FROM users` 返回 error；下面这些返回 result：`submission_raw`、`submission_result`、`vfs_nodes`、`classroom_poll_votes`、`classroom_danmaku`、`sqlite_master`、`class_groups`。`ext-research-helper` 可以 `SELECT` `plugin_research_grades`，`ext-homework-hub` 不可以。 |

`IDatabase` 在基础白名单里，不需要清单声明。守卫做了三件事：禁止 ATTACH / PRAGMA / VACUUM / 触发器和视图；DDL 和 `plugin_` 表限制在自己的命名空间；核心表名用正则扫整段 SQL。

`migrations/000_initial_schema.sql` 里的 `submission_raw`、`submission_result`、`vfs_nodes`，以及后续迁移里的 `classroom_poll_votes`、`classroom_danmaku`、`class_groups` 等，不在黑名单里，也不以 `plugin_` 开头，所以 DML 放行。`sqlite_master` 可读，表结构（含列名）会泄露。黑名单是「记得住的表」，源码注释自己写过曾经漏过一批；这次漏的是学生提交原文、虚拟文件系统节点和课堂投票。

特例更宽：`pluginId` 字符串包含 `research` 或 `lianyun` 就额外允许整个 `plugin_research_` 前缀。第三方 id `ext-research-helper` 命中。这不是参数化的授权，是子串。

inline 路径（PL-01）连这层守卫都没有。

**复现**

PoC `invokeSql`。修复前，worker 插件执行 `SELECT * FROM submission_raw` 不会收到 `WorkerCapabilityError`。

**修复**

- 改成默认拒绝：只允许 `plugin_<本插件命名空间>_` 与明确列出的共享表。新增业务表不用改黑名单也不会自动暴露。
- 删掉 `includes('research')` / `includes('lianyun')`。研究插件用预加载 id 或单独授权。
- 禁止 `sqlite_master` / `sqlite_schema`。
- 不要把原始 `IDatabase` 放进基础白名单；只留 `ensureTable` / 带前缀的读写 API。

### PL-06 高 — 卸载按 UUID 删表，子进程按 manifest id 建表，学生数据会留下

**状态：已修复。** 新表只用安装主键。卸载会同时删除旧 manifest id 前缀，避免留下历史表。

**公测前必须修。**

| | |
| --- | --- |
| 位置 | 建表：`packages/core/worker-runtime/bootstrap/sections/message-handler.ts:287`。删除：`packages/core/plugin-host/install.ts:273`–`:280`。inline 建表用的是传入的 `pluginId`（UUID）：`packages/core/plugin-host/context-builder.ts:759` |
| 证据 | PoC 计算 `plugin_ext_homework_hub_scores` 不以 `plugin_<uuid>_` 开头，并锁定两处源码公式。 |

子进程 `tablePrefix` 用 `workerData.manifestId`。卸载在 `resolvePluginUuid` 之后用 DB UUID 做 `LIKE` 前缀并 `DROP`。两边对不上。`plugin_storage` 和公开路由是按 manifest id 删的（`install.ts:270`–`:271`），自建表不是。

同一 manifest id 再次安装会得到新 UUID，但表前缀仍是 manifest id，新进程可以读到上次卸载没删的表。对把作业、名单写进自建表的插件，这是卸载后的数据残留。

inline 与 process 的前缀规则也不一样，同一插件换执行模式后看不到原来的表。

**修复**

- 建表和删表只用一个前缀函数，入参同时含 UUID 和 manifest id，卸载时两个前缀都删。
- 卸载时删除 `plugin_migrations` 里该插件的行。
- 加一个测试：process 模式 `ensureTable` 之后卸载，`sqlite_master` 里不再有该表。

### PL-07 高 — 没有包签名；「已认证」是注册表 JSON 里的布尔值

**状态：已修复。** 默认 `OPENLEARN_COMMUNITY_INSTALL` 未设置时拒绝社区安装。签名公钥是 `OPENLEARN_COMMUNITY_PUBKEY`。

**社区市场对外开放前必须修。** 只做管理员手工 ZIP、且 PL-01–PL-06 已修时，可以降为安装确认文案问题。

| | |
| --- | --- |
| 位置 | `server/services/community-registry.ts:124`–`:126`、`:166`；`src/components/plugin-center/sub-views/PluginCommunityPanel.tsx:597`–`:604`；完整性校验只在 `packages/core/plugin-host/plugin-distribution-manager.ts:156`–`:176`，且仅当仓库元数据自带 `integrity` |
| 证据 | PoC：`normalizeCommunityEntry` 接受 `verified: 'true'` 和 id `@openlearn/not-a-builtin`。面板把 `verified` 标成「官方校验来源 / VERIFIED」。 |

注册表条目没有公钥、没有包哈希字段。`install-from-url` 不核对哈希。`one-click-update`（`server/routes/plugins.ts:600`）也不核对，并且不要求 `acknowledgeRisk`（PoC 锁定该路由处理函数片段里没有这两个词）。更新源可以是清单里插件作者自己写的 URL，只要通过 `isSafeExternalUrl`。

ZIP 上传同样不验证来源。这在「管理员明确上传本地文件」时是预期；和市场里的认证徽章不是一回事。

**修复**

- 注册表条目带 `sha256`，下载后校验，不匹配就拒绝安装。徽章只在签名校验通过时显示，不要展示条目自报的 `verified`。
- `one-click-update` 与首次安装一样要求管理员确认，并复用同一哈希。代码变了就作废 `plugin_public_routes` 里的批准（见 PL-09）。

### PL-08 高 — 子进程可以任意出网；堆和 CPU 只挡住一部分耗尽

**状态：已修复。** `OPENLEARN_PLUGIN_PERMISSION=off` 仍会同时关掉权限模型和网络入口脚本。RSS / CPU 可用 `OPENLEARN_PLUGIN_QUOTA=off` 关闭。

**出网：在 PL-05 修掉之前必须修，否则读到的学生数据可以直接送出。** 只修 PL-05、出网仍开放，则降为「插件能把自己收到的请求外传」，界面已经有这句话，可以记为已知限制。

| | |
| --- | --- |
| 位置 | `packages/core/worker-runtime/plugin-permission.ts:33`–`:39`、`:102`–`:125`；`packages/core/worker-runtime/plugin-limits.ts:30`–`:44`；`packages/core/worker-runtime/liveness-monitor.ts:1`–`:26`；`packages/core/worker-runtime/worker-manager.ts:149`–`:150`；`packages/core/plugin-host/base.ts:123` |
| 证据 | PoC 在 `--permission` 下对 `127.0.0.1` 建连成功，输出 `NET_OK`，不是 `ERR_ACCESS_DENIED`。Node v22.14.0 的 `--help` 没有 `--allow-net`。 |

已核实的其它边界（同一 Node，手工探针，未写进 Vitest）：

- `child_process.spawnSync` → `ERR_ACCESS_DENIED`
- `eval` 在 `--disallow-code-generation-from-strings` 下 → `EvalError`
- 读 `/proc/self/environ` → `ERR_ACCESS_DENIED`
- `buildMinimalEnv` 不带出 `OPENAI_API_KEY` 和 `NODE_OPTIONS`（这条在 PoC 里）

资源限制的缺口与代码注释一致，本次没有再跑一条「吃满 CPU」的长进程：

- `--max-old-space-size` 只管 V8 老生代。`Buffer` 等 external 内存不受限，子进程仍可能把宿主机推向 OOM。
- 同步死循环会被 ping/pong 探活杀掉（默认间隔 30s、宽限 15s，检出大约几十秒）。让出事件循环的同时狂占 CPU 的循环仍能 pong，杀不掉。
- inline（含 PL-01）的 `while (true)` 卡住的是宿主事件循环。激活超时 5 秒取消不了同步循环。
- 同时运行的隔离插件上限 32。32 个烧 CPU 的子进程是宿主机级别的压力，不是「一个插件崩了」的隔离。

**修复**

- 出网默认拒绝。在 Node 没有网络权限旗标的版本上，用单独的 uid/网络命名空间，或强制 HTTP 走宿主代理并做目标白名单。
- external 内存用 cgroup / `RLIMIT_AS`（接受其误伤），不要只依赖 V8 堆旗标。
- 对 CPU 使用进程记账而不只是事件循环探活。inline 禁止用于任何非预加载代码（PL-01）。

### PL-09 中 — 公开路由批准不跟代码版本走

| | |
| --- | --- |
| 位置 | `packages/core/plugin-host/public-routes.ts:44`–`:65`；清除只出现在卸载 `install.ts:271`。`updatePluginFromZipExclusive` 起始于 `install.ts:689`，函数体内没有 `clearPublicRouteApprovals`（PoC 锁定） |
| 证据 | PoC 写入批准后 `isPublicRouteApproved` 为 true；更新函数源码不调用清除。 |

管理员勾了一次 `approvePublicRoutes` 之后，同一 method + path 在包被一键更新替换后仍然匿名可访问。新代码不需要再次批准。

**修复**：更新成功后清空该插件的批准行，要求重新批准。批准记录带上当时的包哈希。

### PL-10 中 — 权限模型会跟随插件目录里已经存在的符号链接

| | |
| --- | --- |
| 位置 | `packages/core/worker-runtime/plugin-permission.ts:114`–`:118`（`--allow-fs-read/write=<pluginDir>/*`） |
| 证据 | PoC：目录外的 `secret.txt` 经 `plugin/via-symlink` 被读出 `TOPSECRET`，随后被写成 `PWNED`。同一进程里 `fs.symlinkSync` 指向外部路径返回 `ERR_ACCESS_DENIED`。 |

当前安装链没有把这个洞接上，所以不是「上传 ZIP 就能写宿主机文件」：

- 解压用 `writeFileSync` 写普通文件（`install.ts:420` 一带），不会按 ZIP 的 symlink 位创建链接。
- 手工探针：`npm pack` 不把包内符号链接打进 tarball，再叠加 `--ignore-scripts`，依赖安装种不进逃逸链接。
- 子进程自己 `symlinkSync` / `linkSync` 被权限模型拒绝。`plugin/../secret` 这种路径也被拒绝。`*` 会匹配子目录（`plugin/sub/dir/file` 可读），这是注释里「`*` 会跨 `/`」在 Node 22.14.0 上的实际含义；`..` 不会被当成通配的一部分。

若以后改用系统 `unzip`、或宿主在插件目录里预先放了符号链接，读写都会穿透到链接目标。

**修复**：安装后拒绝插件目录内任何符号链接；权限检查使用 `realpath` 之后的路径，目标必须仍在插件目录内。

### PL-11 中 — 开发面板用 `new Function` 执行编辑器里的源码，界面写着静态解析

| | |
| --- | --- |
| 位置 | `src/components/plugin-center/utils/pluginCenterUtils.ts:1`–`:26`；调用点 `src/components/plugin-center/sub-views/PluginDevPanel.tsx:164`–`:165`。同仓库 `src/utils/pluginParsers.ts:22` 已经改成正则提取，并注释禁止 `new Function` |
| 证据 | PoC 锁定 `pluginCenterUtils.ts` 含 `new Function`。 |

每次渲染都执行文本框内容。默认模板是本地示例，不会自动加载已安装的社区包。能打开这个面板的人执行的是自己贴进去的代码，影响面是该浏览器会话。标签写「MANIFEST 实时解析」「Live Static」，和实现不符。生产 CSP 没有 `unsafe-eval` 时，这里会直接抛错或被 CSP 拦住；开发环境 `script-src` 含 `unsafe-eval`（`server.ts:199`）。

**修复**：删掉这个 `parsePluginSource`，复用 `src/utils/pluginParsers.ts` 的静态提取。

### PL-12 中 — 会话桥的 cookie 注入用子串匹配

| | |
| --- | --- |
| 位置 | `server/routes/plugin-api-gateway.ts:497`–`:516` |
| 证据 | PoC：`requires` 含 `@evil/pkg:NotReallyIAuthSessionBridgeServiceX` 时，`includes('IAuthSessionBridgeService')` 为 true。`computeAllowedWorkerTokens` 即使清单写了真正的 `@openlearn/core:IAuthSessionBridgeService`，也不会把该 Token 放进 worker 白名单。 |

网关在插件响应里看到 `sessionToken` 以 `token_` 开头、且 `requires` 子串命中时，设置 `edu_os_token`。子进程插件拿不到这个服务，不能自己 `createSession`。inline 插件（PL-01 或受信名单）可以，因为字符串白名单包含该 Token。子串匹配是积分服务已经修过的同类错误（`worker-manager.ts:125`–`:127` 改为精确比较），这里没跟上。

请求 DTO 不转发 cookie 头（`plugin-api-gateway.ts:363`），插件不能从请求里把现成会话抄回来。单独这一条不能伪造会话，它放大的是 PL-01。

**修复**：与积分服务相同，剥掉版本范围后全等比较 `@openlearn/core:IAuthSessionBridgeService`。并且只有预加载插件可以返回 `sessionToken`。

### PL-13 中 — 审计日志盖不住插件的实际权力

| | |
| --- | --- |
| 位置 | `recordSecurityAudit` 的插件调用点：`server/routes/plugins.ts:527`、`:878`（安装）、`:1021`（公开路由批准）；`packages/plugins/builtin.ts:872`、`:910`、`:992`。实现：`packages/core/observability/audit-log.ts:58` |
| 证据 | 全库检索。没有卸载、激活、执行模式被改写、命令派发、SQL、能力授予的审计事件。 |

安装事件记录 actor 和 manifest id，不记录最终 `executionMode`、是否被改写、包哈希。`one-click-update` 成功路径不写审计。日志在本地轮转，没有外送。

**修复**：安装、更新、卸载、激活、执行模式改写、公开路由批准、高危命令派发各记一条，带上最终执行模式和包哈希。

### PL-14 低 — 开启 `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 时，部署脚本在宿主里用 shell 执行

| | |
| --- | --- |
| 位置 | `packages/core/plugin-host/install.ts:514`–`:532`。更新路径只把脚本写进目录（`:826`–`:829`），不执行 |
| 证据 | 默认 `!== 'true'` 时只打警告，不执行。本次没有设置该变量，因此没有跑脚本。 |

一旦设为 `true`，`execSync(\`node "${deployScriptPath}" "${process.cwd()}"\`)` 在宿主进程执行，隔离策略还没开始。脚本路径来自清单。这是显式逃生舱，不是默认配置。

**修复**：保持默认关闭。若必须保留，改成 `execFile` 参数数组，并且只允许预加载插件。

### PL-15 低 — 第三方插件兼容测试没有覆盖这次的信任边界

| | |
| --- | --- |
| 位置 | `vitest.config.ts:42`–`:45` 排除 `packages/core/__tests__/lti-provider-plugin.test.ts`（依赖不在仓库里的 `v2_plugins/`）。既有 canary 在 `server/__tests__/canary/`，覆盖 ZIP 炸弹、路径穿越等畸形包。`execution-policy.test.ts` 把 `@openlearn/` 前缀当成合法信任来源，没有用例要求非预加载的 `@openlearn/` id 被拒绝 |
| 证据 | 配置与测试名。本次 PoC 补上了前缀、SQL 黑名单缺口、actor 冒充、能力自授、符号链接和出网。 |

没有「拿一个仓库外的第三方插件，对当前 SDK 契约跑通安装—激活—卸载」的套件。LTI 插件测试被排除在默认 `pnpm test` 之外。

**修复**：默认测试保留本次 PoC 里那些应在修复后改成安全断言的用例。LTI 若仍是支持的插件，把夹具收进仓库，不要依赖被 gitignore 的目录。

---

## 4. 本次核实仍然有效的控制

这些不是漏洞，避免和上面的洞混在一起。

| 控制 | 结果 |
| --- | --- |
| 不在 `OPENLEARN_TRUSTED_INLINE_PLUGINS`、且不在内置目录的包 | 清单写 `inline` 也会安装成 `process`。`@openlearn/` 前缀同样不能单独放行。PoC 两份 ZIP 对照通过 |
| `buildMinimalEnv` | 不继承 `OPENAI_API_KEY`、`NODE_OPTIONS`。PoC 通过 |
| 权限模型禁止插件再起子进程、禁止 `eval`、禁止读 `/proc/self/environ` | Node v22.14.0 手工探针成立 |
| 插件在权限模型下不能新建指向外部的符号链接或硬链接 | PoC 与手工探针。既有符号链接读穿仍见 PL-10 |
| 插件自己的表前缀之外的表 | worker SQL 被拒。`users`、提交、VFS、投票不再靠黑名单。PoC 通过 |
| 空 `capabilitiesProposed` | worker 不能调用非 `get*` 方法，`grant` 被拒。PoC 通过 |
| worker 白名单不含 `IAuthSessionBridgeService`、不含 `IPluginHost` | `computeAllowedWorkerTokens` PoC；`IPluginHost` 不在 `BASE_WORKER_SERVICE_TOKENS` |
| `auth: false` | 仍要管理员写入 `plugin_public_routes` 才匿名放行。本次没有推翻既有 `plugin-rest-api` 测试。批准不会在更新时失效，见 PL-09 |
| 依赖安装 | `dependency-install.ts` 使用 `--ignore-scripts`，安装与更新共用。本次没有发现更新路径再次漏掉该旗标 |
| ZIP 路径穿越 | `install.ts` 对 `..` 和越出插件目录的目标抛错。canary 已有用例。本次没有新的穿越样本 |
| 部署脚本 | 默认不执行（PL-14） |

---

## 5. 文档对齐

PL-01 到 PL-08 修复时改过的说明：

| 文档 | 现在怎么写 |
| --- | --- |
| `docs/plugin/plugin-architecture.md` | 未受信任插件走子进程。Worker 线程只给白名单或内置目录。插件前端是 `sandbox="allow-scripts"` 的不透明源 iframe |
| `docs/plugin/community-plugin-registry.md` | 社区安装默认关闭，要哈希和签名。`verified` 被服务端忽略。`@openlearn/` 前缀不能单独获得进程内身份 |
| `docs/plugin/plugin-security-migration.md` | 兼容性变化和迁移步骤 |
| `.env.example` | 白名单、社区开关、研究表名单、网络与配额 |
| `PluginCommunityPanel.tsx` | 徽章标题是「平台公钥验签通过」 |
| `plugin-permission.ts` | 权限模型仍没有 `--allow-net`；出站由入口脚本和宿主代理补上 |

仍成立、且没有被这次修复关掉的说明：`docs/plugin/plugin-lifecycle.md` 里 inline 同步死循环会卡住宿主。第三方包默认进不了这条路径。

---

## 6. 仍开放

PL-01 到 PL-08 已修复，迁移说明见 `docs/plugin/plugin-security-migration.md`。

PL-09 到 PL-15 仍开放。PL-09（更新后公开路由仍有效）应在任何允许 `auth: false` 的部署里一起修。PL-10 的既有符号链接读穿、PL-12 的更新回滚、PL-15 的 `new Function` 课件脚本都还在。

---

## 7. PoC 与探针

```bash
pnpm exec vitest run packages/core/plugin-host/__tests__/plugin-audit-poc.test.ts
```

PL-01 到 PL-08 的用例断言漏洞已被阻断。PL-09、PL-10、PL-12、PL-15 仍锁定未修复行为，不要把它们改成“已修复”。

PoC 里的 Kernel 用例会初始化仓库内的 SQLite（与其它内核测试相同），并在内存里注册测试命令。它不修改插件业务代码。
