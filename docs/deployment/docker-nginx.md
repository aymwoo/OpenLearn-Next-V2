# Docker & Nginx 反向代理配置

> 本文覆盖两部分：① 基于仓库内 `Dockerfile` + `docker-compose.yml` 的容器化部署；② 支撑 Socket.IO 白板实时同步的 Nginx 反向代理配置。
>
> 裸机 / PM2 部署见[安装指南](../getting-started/installation-guide.md)。

---

## 1. 容器化部署

### 1.1 仓库内的容器定义

| 文件                 | 作用                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `Dockerfile`         | 两阶段构建：build 阶段 pnpm 全量安装 + `pnpm run build` + `pnpm prune --prod`；production 阶段只带产物 |
| `docker-compose.yml` | 服务 `app` + 可选 `proxy` profile + 数据卷 / 备份卷                                                    |
| `.dockerignore`      | 排除 `node_modules` / `dist` / 本地数据库等，避免污染构建上下文                                        |

**`Dockerfile` 要点**（改配置时按此对齐）：

- 构建阶段用 `node:22-alpine`，`apk add python3 make g++ gcc` 装 `better-sqlite3` 等原生模块的编译工具
- 依赖清单单独 COPY（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` + 两个 workspace 包的 `package.json`）以利用 Docker 层缓存
- **必须 COPY `migrations/`** —— 生产镜像没有 devDependencies，不会跑 `tsc`，迁移执行器直接读 `migrations/*.sql`
- 入口以 root 修正 `/data` 与 `/backups` 的属主，再 `su-exec` 降到 `node`。不要再写成 `USER node` 直接启动，否则命名卷属主是 root 时写不了库。
- 生产依赖保留 `esbuild`。安装插件时宿主会 `import('esbuild')`；它若只在 devDependencies，`pnpm prune --prod` 会把它删掉，容器里安装插件返回 500。
- `HEALTHCHECK` 打 `http://127.0.0.1:9000/health`（对应 `server.ts` 的 `GET /health`）

### 1.2 持久化卷（最容易踩坑的一处）

运行阶段的数据根是 `OPENLEARN_DATA_DIR=/data`，库文件是 `OPENLEARN_DB_PATH=/data/educational_os.db`。课件、插件和上传文件都是这个根下面的子目录，**不要**再单独把库挂到 `/app/packages/core/db`、把课件挂到 `/app/storage`。以前那样挂，设置了 `OPENLEARN_DB_PATH` 却没设置 `OPENLEARN_DATA_DIR` 时，课件实际写到库文件的同级目录，`/app/storage` 卷里只有种子口令文件。

| 容器内路径 | 装什么                                                                                        | 漏挂的后果                         |
| ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------- |
| `/data`    | `educational_os.db`、`storage/`（课件与 `bootstrap-credentials.txt`）、`plugins/`、`uploads/` | **业务数据、课件、已装插件一起丢** |
| `/backups` | `node scripts/site-backup.mjs` 的数据库快照和文件包                                           | 无法按脚本恢复                     |

应用日志走标准输出，用 `docker compose logs app` 查看。镜像不再挂 `/app/logs`：进程本身不往那个目录写文件。

> ❌ **常见错误**：`docker run -v ./data:/app/data`，或只挂 `/app/packages/core/db` 与 `/app/storage`。当前镜像不使用这两处作为数据根。

### 1.3 docker compose（推荐）

`docker-compose.yml` 已经声明数据卷、备份卷和可选的 Nginx profile：

```bash
# 1. 先在 .env 中设置密钥（32 字节 hex，用于 AES-256-GCM 加解密 AI Provider API Key）
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
# 可选：指定种子口令。留空则初始口令 = 用户名（admin / admin），登录页会提示，首次登录强制改密
# echo "OPENLEARN_ADMIN_PASSWORD=$(openssl rand -base64 18)" >> .env
# echo "OPENLEARN_TEACHER_PASSWORD=$(openssl rand -base64 18)" >> .env

# 2. 构建并后台启动（直连 9000，不要设 TRUST_PROXY）
docker compose up -d --build

# 反代（发布 8080）。必须让应用信任这一层 Nginx，否则限流桶是代理地址。
# TRUST_PROXY=1 docker compose --profile proxy up -d --build

# 3. 查看状态 / 日志
docker compose ps
docker compose logs -f app

# 4. 健康检查
curl -fsS http://127.0.0.1:9000/health
```

镜像内置的环境变量：

| 变量                                                      | 值                        | 说明                                                                                                                           |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                | `production`              | 决定前端资源与调试开关                                                                                                         |
| `PORT`                                                    | `9000`                    | `server.ts` 的 `startServer` 读取                                                                                              |
| `OPENLEARN_DATA_DIR`                                      | `/data`                   | 课件、插件、上传的根                                                                                                           |
| `OPENLEARN_DB_PATH`                                       | `/data/educational_os.db` | 主库路径                                                                                                                       |
| `ENCRYPTION_KEY`                                          | 由 `.env` 注入            | 64 位 hex。空着时首次启动写入 `/data/storage/encryption-key`（0600），并在日志里警告应改设环境变量且单独备份该文件             |
| `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD` | 空则 = 用户名             | 默认 `admin` / `admin`，首次登录强制改密；`OPENLEARN_SEED_PASSWORD_MODE=random` 才写 `/data/storage/bootstrap-credentials.txt` |
| `TRUST_PROXY`                                             | 空（不信任）              | 使用 `--profile proxy` 时必须设为 `1`                                                                                          |
| `LOG_LEVEL`                                               | `info`                    | 日志级别                                                                                                                       |
| `BACKUP_DIR`                                              | `/backups`                | 站点备份目录                                                                                                                   |

> ⚠️ **`ENCRYPTION_KEY` 一旦设定就不能改**。改动后既有 AI Provider API Key 和班级临时口令全部无法解密。API Key 只能在「系统管理 → AI 提供商管理」重新保存；班级口令需要教师重新设置。若环境变量与 `/data/storage/encryption-key` 不一致，进程会拒绝启动并打印处理步骤。`node scripts/site-backup.mjs` 不包含该密钥文件，恢复后要单独放回。
>
> ⚠️ **不要**把 `ENCRYPTION_KEY` 写进 git 跟踪的 `ecosystem.config.cjs`（PM2 侧已改为 `dotenv.config()` 运行时读取 `.env`，容器侧走 compose 的 `environment` 注入，两者都避免密钥入库）。

### 1.4 纯 docker run

不用 compose 时：

```bash
docker build -t openlearnv2 .

docker run -d --name openlearnv2 \
  -p 9000:9000 \
  -e NODE_ENV=production \
  -e ENCRYPTION_KEY=<你的 32 字节 hex> \
  -e OPENLEARN_ADMIN_PASSWORD='<管理员初始口令>' \
  -e OPENLEARN_TEACHER_PASSWORD='<教师初始口令>' \
  -e LOG_LEVEL=info \
  -v openlearn_data:/data \
  -v openlearn_backups:/backups \
  --restart unless-stopped \
  openlearnv2
```

入口先以 root 把 `/data` 和 `/backups` 交给 `node`（uid 1000），再降权启动。命名卷第一次是 root 属主；不要再把容器改成直接 `USER node`，否则空卷上建不了库。绑定挂载若是只读，日志会以 `[Startup] FATAL` 开头并退出。

### 1.5 数据备份与恢复

镜像里带了不依赖 `tsx` 的脚本。数据库用 `VACUUM INTO`，服务开着也能做一致性快照；文件包是 `storage/`、`plugins/`、`uploads/` 的 tar。

```bash
# 备份（不必停服）
docker compose exec app node scripts/site-backup.mjs
docker compose exec app node scripts/site-backup.mjs -- --list 2>/dev/null || \
  docker compose exec app node scripts/site-restore.mjs --list

# 恢复：必须先停应用，避免写坏正在使用的库
docker compose stop app
docker compose run --rm --no-deps app \
  node scripts/site-restore.mjs --i-understand-downtime
docker compose start app
```

`docker compose run` 会走同一个入口和同一对卷。恢复默认取 `/backups` 里最新一份清单。指定某一份时传入 `--manifest /backups/openlearn_<时间>.manifest.json`。

源码部署仍可使用 `pnpm run db:backup` / `pnpm run db:restore`（只覆盖 SQLite）。要连课件一起备份，用 `node scripts/site-backup.mjs`。服务端没有备份 REST 端点。

---

## 2. Nginx 反向代理

### 2.1 完整 server 块

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # ---- 主站 ----
    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;

        # WebSocket 升级（Socket.IO）
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_cache_bypass $http_upgrade;

        # 真实来源（后端据此拼绝对 URL）
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 应用默认不信任 X-Forwarded-For。本段只有一层 Nginx 时，
        # 进程环境变量必须设置 TRUST_PROXY=1（或 loopback），限流才会按真实客户端分桶。
        # 应用若直接对公网监听，不要设置 TRUST_PROXY。

        # ⚠️ 白板实时同步必需：默认 60s 会静默掐断长连接
        proxy_read_timeout  86400s;
        proxy_send_timeout  86400s;
    }

    # ---- 课件 runtime（沙箱 iframe 以 credentialless + sandbox 加载，路径独立）----
    location /runtime/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host            $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 课件 HTML 由后端 setCoursewareDocumentCsp 下发自有宽松 CSP，
        # nginx 不要再叠加 restrictive CSP，否则课件内联脚本会被拦
        proxy_hide_header Content-Security-Policy;
    }
}
```

### 2.2 关键指令说明

| 指令                                                          | 为什么必需                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `proxy_read_timeout 86400s`                                   | **白板实时同步的核心**。nginx 默认 60s 读超时会在无数据时断开 Socket.IO 长连接，表现为「上课中途白板同步断掉」。 |
| `proxy_send_timeout 86400s`                                   | 与之配套，避免长连接在写入侧提前超时                                                                             |
| `proxy_set_header Host $host`                                 | 缺失时后端拿到的是 `127.0.0.1:9000`，会影响课件 `?ct=` 令牌绑定与绝对 URL 拼装                                   |
| `proxy_cache_bypass $http_upgrade`                            | 防止 WebSocket 请求被缓存层吞掉                                                                                  |
| `proxy_hide_header Content-Security-Policy`（仅 `/runtime/`） | 后端已为第三方课件下发自有宽松 CSP；nginx 叠加会覆盖它并拦掉课件内联脚本                                         |

> ⚠️ 如果把 WebSocket 与主站**分开**成两个 `location` 块，`/socket.io/` 必须单独配，且**同样不能漏 `proxy_read_timeout`**：

```nginx
location /socket.io/ {
    proxy_pass         http://127.0.0.1:9000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "Upgrade";
    proxy_set_header   Host       $host;
    proxy_set_header   X-Real-IP  $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout  86400s;   # ⚠️ 白板实时同步必需
    proxy_send_timeout  86400s;
}
```

### 2.3 验证

```bash
# 1. 确认 WebSocket 升级成功（应返回 101 Switching Protocols）
curl -i -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://your-domain.com/socket.io/?EIO=4&transport=websocket"

# 2. 后端健康检查
curl -fsS http://127.0.0.1:9000/health
```

**排障对照**：

| 现象                                   | 检查                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 课件能打开，但 iframe 内一直「加载中」 | `/runtime/` 是否配了 `proxy_hide_header Content-Security-Policy`；否则看浏览器 console 的 CSP 报错 |
| 课件内联脚本不执行                     | 同上                                                                                               |
| 上课中途白板同步断掉                   | 是否漏 `proxy_read_timeout`（默认 60s）                                                            |
| 随机点名「教师端已抽中、学生端不同步」 | 确认 `Upgrade` / `Connection` / `Host` 三个 header 齐全                                            |
| 登录后被反复登出                       | 确认后端信任的代理来源；`server/middleware/` 的会话 Cookie 依赖请求协议判定                        |

---

## 3. 相关源文件

| 路径                                 | 内容                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `Dockerfile`                         | 两阶段构建定义、运行用户、健康检查                     |
| `docker-compose.yml`                 | 服务定义、数据卷、可选 Nginx profile                   |
| `deploy/nginx/openlearn.conf`        | compose 网络内的 Nginx（upstream `app:9000`）          |
| `deploy/nginx/openlearn.host.conf`   | 裸机 Nginx（upstream `127.0.0.1:9000`）                |
| `scripts/site-backup.mjs`            | 数据库 VACUUM INTO + storage/plugins/uploads 打包      |
| `scripts/site-restore.mjs`           | 停服后恢复上述备份                                     |
| `scripts/backfill-class-owners.mjs`  | 把空 `owner_user_id` 回填给指定教师                    |
| `scripts/docker-entrypoint.sh`       | 容器入口：目录权限与启动失败日志                       |
| `server.ts`                          | `startServer` 监听 `PORT`（默认 9000）、`GET /health`  |
| `server/routes/bridge.ts`            | `/runtime/:uuid` 课件加载路由                          |
| `server/routes/shared.ts`            | `setCoursewareDocumentCsp` 课件自有宽松 CSP            |
| `packages/core/db/index.ts`          | 读取 `OPENLEARN_DB_PATH` 决定 SQLite 主库路径          |
| `packages/core/di/api-key-crypto.ts` | `ENCRYPTION_KEY` 解析与 AES-256-GCM 加解密             |
| `scripts/restore-db.ts`              | 备份枚举与恢复（读取 `BACKUP_DIR`）                    |
| `ecosystem.config.cjs`               | PM2 进程定义（裸机部署路径，密钥走 `.env` 运行时读取） |
