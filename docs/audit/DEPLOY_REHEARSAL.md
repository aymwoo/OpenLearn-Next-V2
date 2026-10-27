# 公测上线演练记录

> **归档快照**：本文是带日期的历史记录，不随代码更新。当前事实请以 [审计归档索引](audit-index.md) 列出的权威页面或源码为准。

日期：2026-10-14。基线是当时的 `main`（`cc0b56e`，已包含 PR #12）。演练在本分支上边做边修，最后用修过的镜像重跑了失败的步骤。

镜像：`docker build -t openlearn-rehearsal:latest .`（仓库 `Dockerfile`，`node:22-alpine`）。本环境的 Docker CLI 没有 `compose` 子命令，所以没有执行 `docker compose up`。服务参数与 `docker-compose.yml` 一致：卷 `/data`、`/backups`，环境变量 `OPENLEARN_DATA_DIR`、`OPENLEARN_DB_PATH`、`BACKUP_DIR`、`OPENLEARN_PLUGINS_DIR`、`ENCRYPTION_KEY`、种子口令、`TRUST_PROXY`。反代使用 compose profile 会挂载的 `deploy/nginx/openlearn.conf`。

旧库对照的是标签 `v0.6.1`（`d735db63`）。`git diff v0.6.1 -- migrations` 只多出 `021`、`022` 和 README，`000`–`020` 的 SQL 与该标签相同。

上线前按 [公测上线检查清单](../deployment/production-guide.md#4-公测上线检查清单) 再走一遍。

---

## 1. 空库全新部署

**做了什么**

1. 用 Dockerfile 构建镜像，空卷挂到 `/data` 和 `/backups`。
2. 一组容器设置 `OPENLEARN_ADMIN_PASSWORD=admin`（等于用户名，应强制改密）、`OPENLEARN_TEACHER_PASSWORD` 为不等于用户名的口令。
3. 另一组容器不设种子口令，确认 `storage/bootstrap-credentials.txt`。
4. 管理员登录 → 改密 → 教师建班 → 批量入学号 `S9001` → 布置允许文本的作业 → 学生提交 → 用源码安装带 `auth: false` 的 `GET /ping` 插件 → 批准公开路由 → 启用插件 → 匿名访问。

**结果：通过**（修复后的镜像）

| 步骤                                                       | 结果                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                              | 200，`status: ok`，版本 0.6.1                                                                                        |
| `GET /health/ready`                                        | 200，`db: connected`                                                                                                 |
| 管理员用 `admin` 登录                                      | 200，`mustChangePassword: true`                                                                                      |
| 改密前 `GET /api/classes`                                  | 403 `FORBIDDEN_DEFAULT_PASSWORD`                                                                                     |
| 改密后再登录                                               | `mustChangePassword` 消失，班级列表 200                                                                              |
| 教师用强口令登录                                           | 200，不强制改密                                                                                                      |
| 建班、入学、布置作业、学生文本提交                         | 全部 200                                                                                                             |
| `POST /api/plugins` 源码安装                               | 200，返回 manifest                                                                                                   |
| 批准前匿名 `GET /ping`                                     | 401                                                                                                                  |
| `POST .../public-routes` `{ "approvePublicRoutes": true }` | 200，`publicRoutesApproved: ["GET /ping"]`                                                                           |
| `POST .../toggle`                                          | 200，`status: active`，库中 `execution_mode=process`                                                                 |
| 启用后匿名 `GET /ping`                                     | 200，`{"ok":true,"from":"fresh"}`                                                                                    |
| 不设口令的空库                                             | 文件在 `/data/storage/bootstrap-credentials.txt`，权限 `600`；用文件里的口令能登录，且必须改密；改密后可用新口令登录 |

**发现的问题**

1. **镜像一开始构建不了。** `corepack prepare pnpm@latest` 带默认的 `minimumReleaseAge`，锁文件里当天的传递依赖被拒绝。`pnpm prune --prod` 在没有 TTY 时中止；prune 又会跑 `prepare`，而 typescript 已经被删掉。已修：钉 pnpm `10.33.4`、构建前复制 `.npmrc`、`CI=true pnpm prune --prod --ignore-scripts`。
2. **容器启动即崩溃。** 只设置了 `OPENLEARN_DATA_DIR` 时，内核仍去创建工作目录下的 `/app/plugins`，node 用户没有权限，日志是 `EACCES: permission denied, mkdir '/app/plugins'`，`unless-stopped` 反复重启。已修：插件目录跟随 `OPENLEARN_DATA_DIR/plugins`，镜像和 compose 都设置 `OPENLEARN_PLUGINS_DIR=/data/plugins`。创建失败时日志以 `[Kernel] FATAL` 开头。
3. **生产镜像装不上插件。** `esbuild` 只在 devDependencies，prune 之后 `import('esbuild')` 抛 `Cannot find package 'esbuild'`，安装接口 500。已修：把 `esbuild` 放进 dependencies。新镜像里 `require.resolve('esbuild')` 能解析，源码安装返回 200。
4. **批准公开 GET 之后仍然 401。** `GET /api/plugins/:id(*)` 比网关先匹配，而且 `requireAuth()` 写在中间件位置。路径里带 `/` 时虽然会 `next()` 给网关，但鉴权在那之前就已经 401。已修：含 `/` 的路径先交给网关，纯插件 id 的详情查询仍然要登录。修复后匿名 ping 为 200。
5. **源码安装不会自动启用。** 安装成功后状态是 `installed`。此时访问路由是 503：`Plugin "ext-rehearsal-echo" is currently installed`。`POST /api/plugins/:id/toggle` 之后才是 `active`，匿名 ping 才 200。这是既有设计（安装不等于运行不可信代码），演练按这个步骤做通，并写进上线清单。不改成安装即启用。
6. **激活日志写错隔离方式。** 库里 `execution_mode` 已是 `process`，日志仍是 `activated in WORKER mode`。已修：按实际隔离打印 `process` 或 `thread`。用修复后的镜像再次拉起旧库插件，日志为 `activated in process mode`。

生产环境加载 SDK 时还曾因为去加载已 prune 的 `pino-pretty` 而在 import 阶段退出，日志目录不可写时也会在启动时 mkdir 失败。这两处已改成：生产环境走 stdout；日志目录不可写就告警并继续。

---

## 2. 旧库升级

**做了什么**

用与标签 `v0.6.1` 相同的 `000`–`020` 迁移造库（没有 `owner_user_id`，没有 `plugin_public_routes`），写入：

- `admin` / `admin`、`teacher` / `teacher`（口令等于用户名）
- 班级 `cls_legacy`「公测前的班」，`owner_user_id` 为空，学生 `S2026001`
- 课件 `les_legacy`「升级不能丢的课」
- 插件 `ext-rehearsal-echo`，`GET /ping` 且 `auth: false`，执行模式 `inline`
- 数据卷里另放 `storage/courseware/keep.txt`

然后用最新镜像挂上这个库启动。没有把历史镜像再跑一遍；迁移 SQL 与 `v0.6.1` 的 diff 只有新增的 021/022。

**结果：通过**（公开 GET 在路由修复后的镜像上通过）

- 启动日志：`Safety snapshot created before applying 2 migration(s)`。`_migrations` 末尾是 `021_class_owner_and_password_gate`、`022_plugin_public_routes`。
- 课、学生、班级、`keep.txt` 都在。插件文件被迁移到 `/data/plugins/plug_legacy_echo/index.js`，`execution_mode` 被改成 `process`。
- `admin`、`teacher` 的 `must_change_password` 为 1。改密前访问班级列表是 403 `FORBIDDEN_DEFAULT_PASSWORD`。改密后管理员能看到「公测前的班」，教师列表为空。
- `node scripts/backfill-class-owners.mjs --list` 显示无归属。`--assign teacher` 把 `owner_user_id` 写成 `usr_teacher`（服务开着也能写）。回填后教师 `GET /api/classes` 能看到该班，学生数 1。
- 学生用原口令登录 200。
- 升级后、批准前，匿名 ping 为 401。批准接口 200。**路由修复前**批准后仍是 401（问题见场景 1 第 4 条）。换上修复后的镜像再启动，同一条已批准路由返回 200 `{"ok":true,"from":"legacy"}`。

**发现的问题**

- 文档里的 `UPDATE classes SET owner_user_id = ...` 要先查用户 id。已提供 `scripts/backfill-class-owners.mjs`，按用户名回填，默认只改空归属。
- 公开路由不能只靠清单里的 `auth: false`。必须再批准。GET 被详情路由提前 401 的问题已修，见场景 1。
- 激活日志把子进程说成 WORKER。已修，见场景 1。

---

## 3. 反向代理、限流与 WebSocket

**做了什么**

应用设置 `TRUST_PROXY=1`，前面放 `nginx:1.27-alpine`，配置文件是 `deploy/nginx/openlearn.conf`（upstream `app:9000`，`/socket.io/` 单独升级）。写限流是每分钟 60 次，按 `req.ip` 分桶。登录限流按账号，不用它证明 IP。

本机 `dockerd` 把自定义网络的规则写进 nft，而内核实际生效的是 iptables-legacy，且 `FORWARD` 策略是 DROP，容器之间一开始互相超时。在这台机器的 legacy 表上对 `172.18.0.0/16` 加了一条 ACCEPT 之后，Nginx 才能访问应用。这是演练机的 Docker 后端不一致，不是应用配置错误。正常只使用一种 iptables 后端的 Docker 不需要这条规则。

**结果：通过**

| 检查                                             | 结果                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| 不设 `TRUST_PROXY`，直连并轮换 `X-Forwarded-For` | 第 61 个 POST 开始 429。伪造头没有拆桶                                           |
| `TRUST_PROXY=1` 经 Nginx，客户端 A 打 65 次      | 第 61 次起 429                                                                   |
| 同时在线的客户端 B（另一源地址）                 | 3 次都是 200，没有被 A 的桶连坐                                                  |
| 客户端 C 经 Nginx 轮换伪造的 `X-Forwarded-For`   | 仍然第 61 次起 429。`TRUST_PROXY=1` 使用 Nginx 看到的真实地址                    |
| 匿名 Socket.IO（仅 websocket）                   | `connect_error`：`Authentication required: missing edu_os_token`。握手到达了应用 |
| 带登录 cookie 的 Socket.IO                       | `connect` 成功                                                                   |
| `GET /socket.io/?EIO=4&transport=polling`        | 200，响应里 `upgrades` 包含 `websocket`                                          |

直连公网时不要开 `TRUST_PROXY`。应用端口不要和 Nginx 一起暴露到公网，否则客户端可以自己写 `X-Forwarded-For`。

**发现的问题**

- 仓库里原有的根目录 `nginx.conf` 写了个人机器路径，也不能单独作为「整站反代」用。已改为指向 `deploy/nginx/openlearn.conf`（compose）和 `deploy/nginx/openlearn.host.conf`（裸机，upstream `127.0.0.1:9000`）。
- PM2 的 `ecosystem.config.cjs` 以前不把 `TRUST_PROXY`、种子口令和数据目录传进进程。已补上。反代后面若用 PM2，这些值必须出现在 `.env` 里。

---

## 4. 备份与恢复

**做了什么**

在运行中的容器里执行 `node scripts/site-backup.mjs`。先在 `/data/storage/courseware/keep.txt` 写入标记。然后停服，删掉数据卷里的库和 `storage` / `plugins` / `uploads`，再执行：

```bash
node scripts/site-restore.mjs --i-understand-downtime
```

恢复命令走镜像入口（先改属主再降权）。不加 `--i-understand-downtime` 时脚本直接拒绝。

**结果：通过**

备份产物在 `/backups`：

- `openlearn_20261014_042616.db`（约 0.81 MB）
- `openlearn_files_20261014_042616.tar.gz`
- `openlearn_20261014_042616.manifest.json`

清空后再恢复：`keep.txt` 内容仍是 `keep-fresh-courseware`。用改密后的管理员登录，两个「公测演练班」都在，`owner_user_id` 仍指向教师。进程崩溃被拉起之后，这个文件还在。

迁移前快照在启动日志里能看到，路径形如 `/backups/pre_migration_20261014_042627.db`。快照改为 `VACUUM INTO`，避免只拷主库文件时丢掉 WAL。

**发现的问题**

- 原有 `scripts/backup-db.ts` 依赖 tsx，生产镜像里没有。已增加纯 Node 的 `scripts/site-backup.mjs` 和 `scripts/site-restore.mjs`，并打进镜像。备份包含数据库和 `storage` / `plugins` / `uploads`。
- 文档里的卷曾经写成 `/app/packages/core/db` 和 `/app/storage`，和运行时路径不一致。已统一成 `/data` 与 `/backups`。种子口令文件也写到数据目录的 `storage/`，避免落在镜像里另一个卷。

---

## 5. 健康检查与启动失败

**做了什么**

- 看 Dockerfile 与 compose 的 HEALTHCHECK，并对三个容器 `docker inspect`。
- `docker restart` 后再请求 `/health`，并核对课件文件。
- 从宿主机向容器主进程发 SIGKILL（容器内对 PID 1 的 SIGKILL 在这台内核上送不进去），看 `unless-stopped`。
- 把 `/data` 和 `/backups` 只读挂载后启动。

**结果：通过**

- 三个业务容器的 Health 都到过 `healthy`。`/health` 为 200。
- 演练当时的 `/health/ready` 还带 `db: connected`。随后的公测运维改动把就绪响应收成 `{"status":"ready"}`，不再返回数据库、WAL 或错误文本。上线检查以 [生产指南](../deployment/production-guide.md#4-公测上线检查清单) 的现行合同为准。
- `docker restart` 之后 `/health` 恢复，`keep.txt` 还在。
- 主进程被宿主机杀掉后：`RestartCount` 从 0 变为 1，`StartedAt` 更新，几秒内 `/health` 再次 200，课件文件还在。
- `docker kill` 会把容器停住且 **不会** 自动拉起。这是 Docker 对「人为停止」的策略，`unless-stopped` 只处理进程自己退出。
- 只读卷：退出码 1。日志第一行业务结论是 `[Startup] FATAL: 无法把 /data 与 /backups 的属主改为 node（uid 1000）。卷可能是只读挂载。` 后面最多再带 5 行 `chown` 明细，不再刷满整个目录。

迁移目录缺失或 SQL 失败会以 `[Migration] FATAL` / `[DB SSOT] FATAL` 退出，这条在 `server/__tests__/migrate-safety.test.ts` 覆盖。本次没有往镜像里故意放坏迁移文件。

**发现的问题**

- 早期镜像没有入口降权。命名卷首次创建属主是 root，直接 `USER node` 会写不了库。入口现在先 `chown` 再 `su-exec node`。
- 只读失败时 `chown -R` 按文件刷屏，FATAL 被淹没。已收成一行 FATAL 加最多 5 行明细。
- 文档仍写「运行阶段 `USER node`」。已改成入口降权的说明。

---

## 仍未关闭的风险

- 插件子进程的出站网络不受 Node 权限模型约束（既有说明，本次没有新增隔离）。
- 源码安装后必须再 toggle 才会响应路由。社区一键安装同样不要默认批准公开路由。
- 恢复后的 AI Provider 密钥依赖备份时的 `ENCRYPTION_KEY`。密钥丢了，库能起来，已存的供应商密钥解不开。
- AI Provider 种子写入失败只打日志，不拒绝启动。账号种子失败会拒绝启动。
- 登录限流按账号每分钟 5 次，不按 IP。写请求才按客户端地址。
- `TRUST_PROXY` 的跳数必须等于真实反代层数。多一层代理时 `1` 会看错地址。
- 平台版本号仍是 0.6.1，这次演练没有切发布标签。
- 演练机的 Docker 同时存在 nft 与 iptables-legacy，自定义网络要额外加 FORWARD 规则才能容器互通。部署到只使用一种后端的 Docker 时按 compose 文件即可；若 Nginx 连不上应用，先查 `FORWARD` 策略，不要把 `TRUST_PROXY` 开到直连公网的进程上。
