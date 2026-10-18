# 生产环境部署与运维指南 (Production Deployment & Operations)

本指南针对高校、培训机构及中小学机房的教学现场，提供 **OpenLearn V2**（`openlearn-next`）在生产环境下的标准化部署、守护进程配置、数据容灾备份与应急运维最佳实践。

---

## 1. 运行环境要求

- **操作系统**: Linux (Ubuntu 20.04 LTS / Debian 11+ / Rocky Linux 8+ 推荐) / macOS / Windows Server
- **Node.js 运行时**: `>= 20.0.0` LTS（推荐 Node.js 22 LTS）
- **内存与 CPU**: 最低 2 核 2GB RAM，推荐 4 核 8GB RAM（大并发课件与白板同步）
- **存储权限**: 对数据库持久化目录（默认 `~/openlearn-next/`）具备读写操作权限

---

## 2. 生产环境部署方式

### 方式一：NPX / 全局安装轻量化部署 (推荐现场快速交付)

适用于单台服务器或局域网主机直接交付教学系统：

```bash
# 全局安装最新版本
npm install -g openlearn-next

# 启动环境健康自检
openlearn-next doctor

# 生产环境后台守护运行（结合 PM2）
pm2 start openlearn-next --name "openlearn-core" -- -p 9000 -H 0.0.0.0
```

### 方式二：源码构建与 Systemd 守护

适用于有二次定制或插件扩展需求的企业及自建服务器：

```bash
# 1. 克隆源码与拉取依赖
git clone https://github.com/aymwoo/OpenLearn-Next-V2.git /opt/openlearn
cd /opt/openlearn
# prepare 会构建 @openlearn/plugin-sdk 的 dist/。若使用 --ignore-scripts，
# 请在 lint / 启动前另执行：node scripts/build-plugin-sdk.mjs
pnpm install --frozen-lockfile

# 2. 全量生产制品构建 (plugin-sdk + bridge-sdk + Vite + 插件 + esbuild 后端 Bundle)
pnpm build

# 3. 验证构建产物
ls -lh dist/server.cjs dist/index.html

# 4. 配置 Systemd 守护单元 (/etc/systemd/system/openlearn.service)
```

Systemd 配置示范：

```ini
[Unit]
Description=OpenLearn V2 Educational OS Server
After=network.target

[Service]
Type=simple
User=openlearn
WorkingDirectory=/opt/openlearn
Environment=NODE_ENV=production
Environment=PORT=9000
Environment=HOST=0.0.0.0
Environment=OPENLEARN_DB_PATH=/var/lib/openlearn/data.db
ExecStart=/usr/bin/node /opt/openlearn/dist/server.cjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now openlearn
```

---

## 2.5 多校部署（一校一实例）

平台**不是** SaaS 多租户：一个实例服务一所学校。多校部署为每校一套实例（独立库、独立数据目录、独立 `ENCRYPTION_KEY`、独立备份），通过反向代理按域名路由。

- 决策依据与代价：[ADR-001 多租户 / 多校区与数据库抽象层](../architecture/adr-001-tenant-and-db-abstraction)
- 配置清单、Compose 隔离、Nginx 示例、逐实例升级/备份/恢复：[多校部署（一校一实例）](multi-school)

---

## 3. 生产运维与容灾保障 (CLI Toolchain)

OpenLearn 内置了免启动服务、免 Web 界面的完整命令行数据运维能力。

### 3.1 环境健康诊断与防版本漂移 (`doctor`)

在首次部署、平台升级或系统排错时，使用自检工具快速排查潜在问题：

```bash
npx openlearn-next doctor
```

自检覆盖全方位运行状态：

- **基础设施**：Node.js 运行时版本（>=20）、CPU 与内存余量、数据库目录写权限、目标服务端口探活与局域网接入点探测；
- **SDK Suite 综合检测**：同步校验 `@openlearn/plugin-sdk` 与 `@openlearn/plugin-test-kit` 的解析版本与依赖形态（workspace 链接 / 精确 pin / caret 范围）；
- **核心版本防漂移**：校验宿主内核单一真理源与 `package.json` 的版本强一致性；
- **插件生态平台兼容性**：
  - **内置核心插件 (`Core Plugins`)**：校验 7 个系统核心插件的 `engines.openlearn` 是否被当前平台版本满足；
  - **已安装扩展插件 (`Installed Plugins`)**：扫描数据库与本地插件，使用轻量级 SemVer 判定引擎校验扩展插件与平台版本的兼容性；
- **一键自愈 (`doctor --fix`)**：
  ```bash
  npx openlearn-next doctor --fix
  ```
  自动清理 NPX 历史旧版本缓存、自动创建数据存储目录，消除运行期版本漂移与目录缺失隐患。

### 3.2 在线数据冷备 (`backup`)

系统依托 SQLite WAL 预写日志机制，可在**业务不中断、数据库读写零阻塞**的情况下毫秒级生成一致性快照：

```bash
# 生成自动带时间戳的备份文件 (如 openlearn_backup_20260906_120000.db)
npx openlearn-next backup

# 指定目标导出路径
npx openlearn-next backup /backup/openlearn_daily.db
```

> **建议**：通过 Crontab 配置每日凌晨定时冷备：
>
> ```bash
> 0 3 * * * npx openlearn-next backup /backup/openlearn_$(date +\%Y\%m\%d).db > /dev/null 2>&1
> ```

### 3.3 数据安全回滚与还原 (`restore`)

当遭遇误操作、数据损坏或灾备演练时，通过还原命令一键切换主库：

```bash
npx openlearn-next restore /backup/openlearn_daily.db
```

- **Magic Header 校验**：还原前自动校验文件头是否以 `SQLite format 3\0` 开头，杜绝坏文件注入；
- **自动生成回滚镜像**：覆盖前系统自动为现有数据库生成 `.bak_<timestamp>` 副本，确保二次容错安全；
- **日志清理**：自动清理旧库的 WAL 与 SHM 预写日志。

### 3.4 管理员密码应急重置 (`reset-admin`)

若管理人员遗忘密码或系统受锁，无需启动 Web 界面，直接在宿主机重置：

```bash
# 未指定口令时随机生成，并打印一次。不要再使用 admin 作为口令。
npx openlearn-next reset-admin

# 指定高强度自定义密码
npx openlearn-next reset-admin --password 'YourStrongPasswd#2026'
```

### 3.5 远端包与运行缓存清理 (`clean`)

针对 NPX 历史旧版本缓存或本地调试日志堆积：

```bash
# 仅清理 ~/.npm/_npx 中的远端包缓存
npx openlearn-next clean --npx

# 清理日志与临时缓存（严格保护主业务数据库 data.db 不被误删）
npx openlearn-next clean
```

---

## 4. 公测上线检查清单

按顺序做。任何一项失败都不要对外放量。演练记录见 [DEPLOY_REHEARSAL.md](../DEPLOY_REHEARSAL.md)。2026-10-14 的完成情况见下文 [4.1](#41-清单状态2026-10-14)。公测说明、已知问题、反馈、隐私草稿和运营手册在 [docs/beta](../beta/README.md)。

1. **构建**：`pnpm lint`、`pnpm lint:strict`、`pnpm lint:eslint`（0 error）、`pnpm test`、`pnpm build`、`pnpm audit`（无 high / critical）都通过。CI 里的 `Public beta journey` 必须绿（`pnpm exec playwright test --config=playwright.beta.config.ts`）。镜像用仓库 `Dockerfile` 构建，不要在构建机上临时改锁文件。
2. **密钥**：`ENCRYPTION_KEY` 是 64 位 hex，已离线备份。它同时加密 AI Provider API Key 和班级临时口令 `classes.class_passcode`（AES-256-GCM，口令密文带 `olenc1:` 前缀）。设置了环境变量就用环境变量。没设置时，首次启动会用 `crypto.randomBytes` 生成钥匙，写到数据目录的 `storage/encryption-key`（权限 600，与 `bootstrap-credentials.txt` 同目录），之后每次启动都读这个文件。启动日志和管理后台会出现醒目警告，提示正在使用自动生成的密钥，应改设 `ENCRYPTION_KEY` 并离线备份该文件。环境变量若与这个文件不一致，进程会报错并给出处理步骤，不会静默换钥匙。换机器时带上同一把密钥，否则已保存的 API Key 和班级口令都解不开。
3. **种子口令**：设置 `OPENLEARN_ADMIN_PASSWORD` 与 `OPENLEARN_TEACHER_PASSWORD`，且都不等于用户名。若留空，从数据目录 `storage/bootstrap-credentials.txt` 抄走口令后删除该文件。生产环境不要设置 `PLAYWRIGHT_TEST`。
4. **数据卷**：容器只挂 `/data` 与 `/backups`。确认课件出现在 `/data/storage`，插件出现在 `/data/plugins`。
5. **健康检查**：`GET /health` 返回 `{"status":"ok"}`（可带 `uptime` 与 `version`）。`GET /health/ready` 只返回 `{"status":"ready"}`，不包含数据库路径、错误文本、WAL 或备份年龄。未就绪时 HTTP 503，正文只有 `{"status":"not_ready"}`。`docker inspect` 里 Health 为 healthy。主进程异常退出后 `restart: unless-stopped` 会把容器拉起来（`RestartCount` 增加）。`docker stop` / `docker kill` 是人为停止，策略不会再拉起。
6. **日志与错误**：确认 `logs/openlearn.log`（或容器 stdout 与 `/data/logs`）里有 `http.request`，字段含 `requestId`、`userId`、`status`、`durationMs`，没有口令、Cookie、班级口令和学生作答。登录失败、429、403、插件安装/启用、公开路由批准出现在 `audit.log`。若使用自建 Sentry / GlitchTip，设置 `SENTRY_DSN` 或 `OPENLEARN_ERROR_DSN`；留空必须仍能启动。`GET /metrics` 匿名访问为 401；管理员会话或 `METRICS_TOKEN` 返回 Prometheus 文本。
7. **反向代理**：Nginx 使用 `deploy/nginx/openlearn.host.conf`（或 compose 的 `deploy/nginx/openlearn.conf`）。进程设置 `TRUST_PROXY=1`（一层）或 `loopback`。应用不要同时对公网暴露 9000。用两个不同来源地址打写请求，确认 429 只打中打满的那一个地址。`/socket.io/` 能完成 WebSocket 握手。
8. **升级**：从 v0.6.1 库启动后，`_migrations` 含 `021_class_owner_and_password_gate`、`022_plugin_public_routes` 与 `023_encrypt_class_passcodes`。启动时会把仍是明文的 `classes.class_passcode` 加密；已经是 `olenc1:` 密文的行会跳过，可以重复启动。用 `node scripts/backfill-class-owners.mjs --assign <教师用户名>` 回填空归属。对需要匿名访问的插件调用 `POST /api/plugins/:id/public-routes`，body 为 `{ "approvePublicRoutes": true }`。仍使用默认口令的账号先改密。
9. **备份**：`node scripts/site-backup.mjs`（容器里 `docker compose exec app node scripts/site-backup.mjs`）生成数据库快照和文件包。库里的班级口令是密文。文件包排除 `storage/encryption-key`，脚本会提示该文件（或 `ENCRYPTION_KEY`）必须单独离线备份。做一次停服恢复演练，核对班级、课件文件和账号还在，并用备份时的同一把密钥确认教师端仍能看到班级口令原文。
10. **失败可见**：把数据目录改成只读再启动，日志里应有 `[Startup] FATAL` 或 `[Migration] FATAL`，进程退出码非 0，而不是一直报 healthy。
11. **账号**：管理员登录、强制改密（若口令等于用户名）、教师建班、学生提交、安装一个插件并 `POST /api/plugins/:id/toggle` 启用。源码安装成功后状态是 `installed`，不启用时访问插件路由会返回 503。这几步都走通再开放。

### 4.1 清单状态（2026-10-14）

「演练已通过」指 [DEPLOY_REHEARSAL.md](../DEPLOY_REHEARSAL.md) 那次镜像演练，不是公测服务器已经对外开放。「CI 有此门禁」指 `.github/workflows/ci.yml` 里失败会红的 job。起草公测材料时没有重跑 `pnpm lint:eslint`、`pnpm build` 和 `pnpm audit`。

| 项 | 状态 | 已经对上的事实 | 还缺 |
| --- | --- | --- | --- |
| 1 构建 | 部分具备 | CI 阻断 `pnpm lint`、`pnpm lint:strict`、`pnpm test`、`pnpm audit --audit-level high`、`Public beta journey`。演练用仓库 `Dockerfile` 构建过镜像 | 清单里的 `pnpm lint:eslint`（0 error）和当次 `pnpm build` 不在 CI。ESLint 最近一次记录是审计日的 0 error、5060 warning。目标环境要用即将发布的提交再构建一次 |
| 2 密钥 | 待目标环境执行 | AES-256-GCM。设置了 `ENCRYPTION_KEY` 就用环境变量。未设置时首次启动把随机 64 位 hex 写入 `storage/encryption-key`（权限 600，与 `bootstrap-credentials.txt` 同目录），之后每次读取。与已有文件不一致则拒绝启动，不再使用临时内存钥匙。班级口令密文前缀 `olenc1:` | 在目标环境确认 64 位 hex，设成环境变量并离线备份。日志或管理后台若警告正在使用自动生成的密钥，先备份 `storage/encryption-key`，再把同一内容写入 `ENCRYPTION_KEY` |
| 3 种子口令 | 机制已演练，目标环境未做 | 演练场景 1：改密前 GET 为 403；不设口令时凭 `storage/bootstrap-credentials.txt` 登录 | 在公测机器上设置两枚口令、确认没有 `PLAYWRIGHT_TEST`、抄走并删除口令文件 |
| 4 数据卷 | 演练已通过 | compose 挂 `/data` 与 `/backups` | 目标机的卷和磁盘空间 |
| 5 健康检查 | 合同有测试，容器行为演练过 | 公测旅程断言 `/health`、`/health/ready` 只有 `status`、匿名 `/metrics` 为 401。演练看过 healthy 和 `unless-stopped`；当时就绪响应还带 `db` 字段 | 目标环境 `docker inspect`。收紧合同之后没有在演练记录里重跑容器 |
| 6 日志与错误 | 代码已落地，现场未抽查 | 第 5 节；公测旅程确认指标鉴权，且该次作答不在 `audit.log`。DSN 留空可以启动 | 在目标环境抽一条 `http.request`。是否部署 GlitchTip、是否设置 `METRICS_TOKEN` 由作者定 |
| 7 反向代理 | 演练已通过 | 演练第 3 节：不设 `TRUST_PROXY` 时伪造转发头不能拆桶；一层 Nginx 时只打满来源地址 | 目标 Nginx、证书、跳数。`docker-compose.yml` 的 `app` 发布了 `9000:9000`，开 `proxy` profile 时公网不要同时暴露 9000 |
| 8 升级 | 演练已通过 021/022；023 随当前代码在启动时执行 | 演练从与 v0.6.1 相同的 `000`–`020` 库启动，应用 021 与 022，并用 `scripts/backfill-class-owners.mjs` 回填。当前代码另有 `023_encrypt_class_passcodes`：启动时把仍是明文的 `classes.class_passcode` 加密，已经是 `olenc1:` 的行跳过 | 作者选定空库还是升级。空库不用回填。升级后公开路由要重新批准。目标库启动后确认 `_migrations` 含 023 |
| 9 备份 | 演练做过一次 | `scripts/site-backup.mjs` 与 `scripts/site-restore.mjs` 停服恢复过课件和班级。当前备份的数据库快照里班级口令是密文，文件包排除 `storage/encryption-key`，清单会提醒该文件单独备份 | 没有定时任务，也没有异地副本。密钥文件要单独离线备份。周期由作者定 |
| 10 失败可见 | 演练已通过 | 只读卷退出码 1，日志有 `[Startup] FATAL` | 目标机卷权限不确定时再做一次。不要在已有公测数据的卷上改只读 |
| 11 账号旅程 | 演练与 E2E 已通过 | 演练场景 1；`e2e/public-beta-journey.spec.ts` | 目标环境用正式账号再走一遍，然后再对教师开放 |

材料索引和仍须作者决定的事项见 [docs/beta/README.md](../beta/README.md)。

---

## 5. 公测可观测性

不引入必须付费的服务。不配置外部 DSN 时，平台只在本机记日志。

### 5.1 错误

收集三类事件：进程未捕获异常（`uncaughtException` / `unhandledRejection`）、路由 5xx、浏览器运行时错误（`window.onerror` 与未处理的 Promise，经 `POST /api/client-errors`）。上报前按字段名和凭据形态脱敏，去掉口令、Cookie、会话、班级口令、学生作答和请求体。

可选转发到 Sentry 兼容接口（自建 Sentry 或 GlitchTip）：

```bash
SENTRY_DSN="https://<public-key>@glitchtip.example/1"
# 或者
OPENLEARN_ERROR_DSN="https://<public-key>@glitchtip.example/1"
```

留空或只写空白时不发起外连，启动不受影响。DSN 只放在服务端，不会打进前端包。

### 5.2 日志

每条访问日志是一行 JSON，消息为 `http.request`，包含 `requestId`、`userId`、`method`、`path`、`status`、`durationMs`。路径不含查询串，请求体不记录。响应头回写 `x-request-id`（调用方传入的值须匹配 `^[A-Za-z0-9._:-]{8,64}$`，否则由服务端生成）。

`LOG_LEVEL` 控制级别。生产默认 `info`，开发默认 `debug`。`LOG_REDACT` 默认开启；生产不要关掉。

安全审计写到同一目录的 `audit.log`，事件名：

| 事件                           | 何时                                         |
| ------------------------------ | -------------------------------------------- |
| `auth.login_failed`            | 登录 401/403（账号、原因；不含口令）         |
| `rate_limit.triggered`         | HTTP 429                                     |
| `auth.forbidden`               | HTTP 403（登录接口除外，那里走登录失败事件） |
| `plugin.installed`             | 源码或 ZIP 安装成功                          |
| `plugin.enabled`               | 插件被切换为 `active`                        |
| `plugin.public_route_approved` | 管理员批准公开路由                           |

### 5.3 轮转与保留

按文件大小轮转，不是按天。超出份数后删除最旧的文件。生产环境同时写 stdout，容器日志系统若需要更长保留，请在采集侧配置。

| 文件            | 变量                                           | 默认                                    |
| --------------- | ---------------------------------------------- | --------------------------------------- |
| `openlearn.log` | `LOG_MAX_SIZE_MB`、`LOG_MAX_FILES`             | 10MB × 当前文件 + 5 份历史，大约 60MB   |
| `audit.log`     | `AUDIT_LOG_MAX_SIZE_MB`、`AUDIT_LOG_MAX_FILES` | 20MB × 当前文件 + 20 份历史，大约 420MB |

目录由 `LOG_DIR` 决定，默认 `<cwd>/logs`。Compose 设为 `/data/logs`，随数据卷保留。目录不可写时只输出 stdout，进程继续启动。

### 5.4 健康检查与指标

- `GET /health`：存活。不访问数据库。给 Docker `HEALTHCHECK` 和负载均衡用。
- `GET /health/ready`：就绪。检查数据库能执行 `SELECT 1`、`storage` 目录可写、`migrations/*.sql` 都已记入 `_migrations`。失败原因只出现在服务端日志。
- `GET /metrics`：Prometheus 文本（进程存活、运行时间、常驻内存、按状态类汇总的 HTTP 计数）。默认受保护：没有 `METRICS_TOKEN` 时要管理员 Cookie；设置了 token 则还接受 `Authorization: Bearer <token>`。不要把这个接口暴露到公网而不带其中一种凭证。

抓取示例：

```bash
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:9000/metrics
```
