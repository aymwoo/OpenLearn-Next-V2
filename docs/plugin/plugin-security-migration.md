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

## 数据表与 SQL 隔离

- **方案 A 复合表前缀**：新建表使用语义复合前缀 `plugin_<manifestSlug>_<shortUuid>_<table>`（例如 `@courseware/hub` 的 `scores` 表名为 `plugin_courseware_hub_01a1404b_scores`）。既保证了数据库中表名的业务可读性，又通过实例 UUID 前缀防止命名冲突与数据越权。同时平滑兼容历史单前缀 `plugin_<uuid>_` 与 `plugin_<manifestId>_`。
- **AST 级 SQL 守卫**：引入 `assertPluginSqlAllowed` 词法解析器，彻底剥离注释（`--`、`/* */`）、字符串字面量、括号与别名，严格阻断逗号隐式 JOIN（`FROM own_table, users`）、注释注入与 `sqlite_master` 任意模式窃取。
- 直接对 `users`、`vfs_nodes`、提交、投票等平台内核核心表执行 SQL 会被绝对拒绝。
- 卸载会精确删除该安装实例对应的复合前缀与 UUID 前缀表；仅在无其他兄弟插件共享同一 `manifest.id` 时才清理历史旧前缀表，杜绝误删风险。
- `plugin_research_` 只给 `OPENLEARN_RESEARCH_SQL_PLUGINS` 里的精确 id。变量未设置时默认只有 `lianyun-course`。设成空字符串则关闭。

## 命令身份与沙箱桥

- 前端沙箱通过专用通道 `POST /api/plugins/:id/sandbox-command` 派发命令，由服务端权威数据库绑定 `plugin:<manifestId>` actor，剥离 `metadata.approved`。
- 即使管理员在线，沙箱发起的内核命令也必须进入待审批队列，杜绝 Confused Deputy 越权。
- 命令总线拒绝空 actor，不再回落到 `agent-system-0`。

## 前端沙箱

- 活跃插件的 `frontend.js` 在 iframe 中执行。iframe 拥有 `sandbox="allow-scripts"`，源是 `/plugin-sandbox/frame`。
- 长生命周期 RPC 监听器与激活 Promise 彻底解耦，防止插件初始化后 API 调用失效挂起。
- 接入 iframe 二次异常导航监控，一旦检测到内部重定向外逃行为立即安全熔断并销毁 frame。
- `GET /plugins/...` 需要有效会话，和 `/uploads` 一样。

## 社区包认证

- `OPENLEARN_COMMUNITY_INSTALL` 不是 `1` 时，`install-from-url`、带下载地址的一键更新，以及带 `x-community-install` 的浏览器直传（包含超时回退路径）均被统一门禁拦截并拒绝。
- 社区包必须带 `integrity`（sha256 十六进制或 `sha256-` base64）和 `signature`（Ed25519 签名，支持绑定 manifest ID 与版本元数据）。公钥 PEM 放在 `OPENLEARN_COMMUNITY_PUBKEY`。
- 验签过程支持流式文件分块读取，防止大包占用过多主进程 V8 堆内存。

## 子进程出站网络与资源 Quota

- 权限策略不是 `off` 时，子进程入口加载 `plugin-net-preload.cjs`。原始 Socket、UDP (`dgram`)、DNS 全系列方法（包含 `Resolver.prototype`）、TLS 及 HTTP2 底层连接均被彻底封锁。
- `fetch` 与 `http(s).request` 将请求转发给宿主代发，宿主只代发已获批的主机名，并严格阻断 IPv4/IPv6 私有网段、环回地址与云厂商元数据（`169.254.169.254`）。
- 宿主代发放行第三方 API `Authorization` 头（Bearer Token），同时限制请求体 10MB、响应流 10MB，并注入全局 30 秒超时，防止宿主 OOM 崩溃。
- 默认采样 512MB RSS 和每个 10 秒窗口 8000 毫秒 CPU。**注意：进程资源 Quota 目前基于 Linux `/proc` 接口生效，非 Linux 系统自动跳过采样。**
