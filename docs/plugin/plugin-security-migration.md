# 插件安全边界迁移（PL-01 至 PL-08）

这次改的是第三方插件和宿主之间的信任边界。内置插件仍由内核 `registerPreloadedPlugin` 预加载，在宿主进程里激活，不经过 ZIP 安装路径。Vitest 在未设置 `OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1` 时仍把夹具视为可进程内执行，第三方兼容测试因此继续走 inline。

## 身份

- `manifest.id` 以 `@openlearn/` 开头不再表示官方插件，也不再允许 inline / worker。
- 进程内执行只来自三处：预加载进宿主的内置代码、`OPENLEARN_TRUSTED_INLINE_PLUGINS` 里的精确 id、入口文件位于 `packages/plugins`。
- 插件中心上传的 ZIP 固定请求 `process`。服务端仍会按上面的规则再判一次。

## 能力

- 预加载内置插件继续自动获得清单里的非通配能力。
- 第三方插件的 `capabilitiesProposed` 只是申请。管理员安装时勾选「确认授予」，或请求带 `approveCapabilities: true` / `X-Approve-Capabilities: true`，对应行写入 `plugin_capability_grants` 后，下次激活才会 `grant`。
- `*`、`*:*`、`*:*:*` 不能写入批准表，也不会授予。插件上下文里的 `grant` 和 `revokeAll` 直接拒绝。
- 清单里写 `*` 不再因此打开积分账本或学期成绩服务的 Token 白名单。要这些服务，就声明对应的能力或 `requires`。

## 数据表

- 新建表的前缀是安装主键（ZIP 为 UUID）：`plugin_<id>_`。子进程和 worker 都用这一套，不再用 manifest id 另起前缀。插件代码应走 `ctx.db.ensureTable` / `ctx.db.table`。
- 直接对 `users`、`vfs_nodes`、提交、投票等平台表执行 SQL 会被拒绝。这些数据走对应的服务接口。
- 卸载会删除主键前缀和旧的 manifest id 前缀，并清掉能力批准、出站域名批准和 `plugin_storage`。
- `plugin_research_` 只给 `OPENLEARN_RESEARCH_SQL_PLUGINS` 里的精确 id。变量未设置时默认只有 `lianyun-course`。设成空字符串则关闭。id 里出现 `research` 或 `lianyun` 不再算授权。

## 命令身份

- 插件发出的命令由宿主改写成 `plugin:<manifest id>`。插件自己填的 `actorId` 和 `metadata.approved` 被忽略。
- 命令总线拒绝空 actor，不再回落到 `agent-system-0`。
- 宿主路由和审批流继续使用 `user:<id>:<role>`、`admin` 或 `agent-system-0`。这些调用方不是 `plugin:` 前缀，审批语义不变。

## 前端

- 活跃插件的 `frontend.js` 在 iframe 中执行。iframe 只有 `sandbox="allow-scripts"`，源是 `/plugin-sandbox/frame`，和父页面不同源。
- 插件通过 `postMessage` 调用 `frontendApi`、按插件隔离的 storage、`invokeCommand` 和 JSON 扩展点。函数、React 渲染器不能穿过这道桥。需要渲染器的插件改为清单里的声明式贡献，或留在宿主提供的扩展槽。
- `GET /plugins/...` 需要有效会话，和 `/uploads` 一样。

## 社区包

- `OPENLEARN_COMMUNITY_INSTALL` 不是 `1` 时，`install-from-url`、带下载地址的一键更新，以及带 `x-community-install` 的浏览器直传都会被拒绝。
- 社区包必须带 `integrity`（sha256 十六进制或 `sha256-` base64）和 `signature`（对 integrity 字符串做 Ed25519，base64）。公钥 PEM 放在 `OPENLEARN_COMMUNITY_PUBKEY`，换行写成 `\n`。
- 注册表 JSON 的 `verified` 会被服务端忽略，列表接口固定返回 `verified: false`。面板不再把该字段画成「官方校验来源」。
- 管理员手里的 ZIP 文件仍可手工安装。更新 ZIP 需要 `X-Acknowledge-Risk: true`。

## 子进程资源

- 权限策略不是 `off` 时，子进程加载 `plugin-net-preload.cjs`。原始 socket 和 DNS 拒绝。`fetch` 与 `http(s).request` 把请求发给宿主，宿主只代理 `plugin_network_grants` 里的主机名，不跟随重定向，并去掉 `Cookie` 和 `Authorization`。
- 清单里的域名不会自动获批。空批准集就是全部拒绝。
- 默认还有 512MB RSS 和每个 10 秒窗口 8000 毫秒 CPU。`OPENLEARN_PLUGIN_QUOTA=off` 关闭采样。非 Linux 没有 `/proc` 采样。
- `OPENLEARN_PLUGIN_PERMISSION=off` 同时关闭 Node 权限模型和这层网络入口。
