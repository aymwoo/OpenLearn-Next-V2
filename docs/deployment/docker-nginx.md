# Docker & Nginx 反向代理配置

> 本文覆盖两部分：① 基于仓库内 `Dockerfile` + `docker-compose.yml` 的容器化部署；② 支撑 Socket.IO 白板实时同步的 Nginx 反向代理配置。
>
> 裸机 / PM2 部署见[安装指南](../getting-started/installation-guide)。

---

## 1. 容器化部署

### 1.1 仓库内的容器定义

| 文件                 | 作用                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `Dockerfile`         | 两阶段构建：build 阶段 pnpm 全量安装 + `pnpm run build` + `pnpm prune --prod`；production 阶段只带产物 |
| `docker-compose.yml` | 单服务 `app` + 四个命名卷 + 关键环境变量                                                     |
| `.dockerignore`      | 排除 `node_modules` / `dist` / 本地数据库等，避免污染构建上下文                            |

**`Dockerfile` 要点**（改配置时按此对齐）：

- 构建阶段用 `node:22-alpine`，`apk add python3 make g++ gcc` 装 `better-sqlite3` 等原生模块的编译工具
- 依赖清单单独 COPY（`package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` + 两个 workspace 包的 `package.json`）以利用 Docker 层缓存
- **必须 COPY `migrations/`** —— 生产镜像没有 devDependencies，不会跑 `tsc`，迁移执行器直接读 `migrations/*.sql`
- 运行阶段 `USER node`（非 root），`chown -R node:node /app` 保证三个数据目录可写
- `HEALTHCHECK` 打 `http://127.0.0.1:9000/health`（对应 `server.ts` 的 `GET /health`）

### 1.2 持久化卷（最容易踩坑的一处）

`Dockerfile` 用 `ENV OPENLEARN_DB_PATH=/app/packages/core/db/educational_os.db`（`packages/core/db/index.ts` 读取该环境变量），并在运行阶段预建三个目录。因此**必须挂载这三个路径**：

| 容器内路径                  | 装什么                        | 漏挂的后果                     |
| --------------------------- | ----------------------------- | ------------------------------ |
| `/app/packages/core/db`     | SQLite 主库 `educational_os.db` | **全部业务数据丢失**（账户、课程、成绩） |
| `/app/storage`              | 课件文件（`storage/courseware/<uuid>/`） | 课件文件丢失                   |
| `/app/backups`              | 备份产物（`scripts/restore-db.ts` 按 `BACKUP_DIR` 读取） | 无法恢复                       |
| `/app/logs`                 | 排障日志                      | 容器重建即丢失全部日志         |

> ❌ **常见错误**：按早期文档写 `docker run -v ./data:/app/data openlearnv2`。`/app/data` **不是**任何数据目录，容器一重启数据全没。

### 1.3 docker compose（推荐）

`docker-compose.yml` 已把四个卷与 `ENCRYPTION_KEY` 都声明好，直接：

```bash
# 1. 先在 .env 中设置密钥（32 字节 hex，用于 AES-256-GCM 加解密 AI Provider API Key）
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env

# 2. 构建并后台启动
docker compose up -d --build

# 3. 查看状态 / 日志
docker compose ps
docker compose logs -f app

# 4. 健康检查
curl -fsS http://127.0.0.1:9000/health
```

镜像内置的环境变量：

| 变量                  | 值                                            | 说明                                        |
| --------------------- | --------------------------------------------- | ------------------------------------------- |
| `NODE_ENV`            | `production`                                  | 决定前端资源与调试开关                       |
| `PORT`                | `9000`                                        | `server.ts` 的 `startServer` 读取            |
| `OPENLEARN_DB_PATH`   | `/app/packages/core/db/educational_os.db`     | 主库路径                                     |
| `ENCRYPTION_KEY`      | 由 `.env` 注入                                | **必填**，缺失则 AI Provider 密钥无法解密     |
| `LOG_LEVEL`           | `info`                                        | 日志级别                                     |
| `BACKUP_DIR`          | `/app/backups`                                | 备份目录                                     |

> ⚠️ **`ENCRYPTION_KEY` 一旦设定就不能改**。改动后既有 AI Provider API Key 全部无法解密，只能在「系统管理 → AI 提供商管理」重新保存。轮换前务必先备份数据库。
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
  -e LOG_LEVEL=info \
  -e BACKUP_DIR=/app/backups \
  -v openlearn_db:/app/packages/core/db \
  -v openlearn_storage:/app/storage \
  -v openlearn_backups:/app/backups \
  -v openlearn_logs:/app/logs \
  --restart unless-stopped \
  openlearnv2
```

> 卷名建议用**命名卷**而非 `./data` 绑定挂载：绑定挂载会把宿主机 UID 带入容器，与镜像内的 `USER node` 冲突导致 SQLite 文件不可写。

### 1.5 数据备份与恢复

生产镜像不含 devDependencies，`scripts/restore-db.ts` 需在仓库环境（`pnpm` + `tsx`）执行：

```bash
# 备份：停机后直接复制卷中的 db 文件最稳妥
docker compose stop app
docker run --rm -v openlearn_db:/data -v "$PWD":/backup alpine \
  tar czf /backup/educational_os-$(date +%F).db.tar.gz -C /data .
docker compose start app

# 恢复：覆盖回卷后重启
docker run --rm -v openlearn_db:/data -v "$PWD":/backup alpine \
  tar xzf /backup/educational_os-2026-10-03.db.tar.gz -C /data
docker compose restart app
```

> **备份/恢复的权威实现是 `scripts/restore-db.ts`（枚举 `BACKUP_DIR` 下的备份并回写）**，不是 HTTP 路由——当前服务端**没有**暴露备份相关的 REST 端点。备份动作请用 §1.5 的「停机 + 复制卷」方式，或自行实现定时快照后交给该脚本恢复。

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

| 指令                          | 为什么必需                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| `proxy_read_timeout 86400s`   | **白板实时同步的核心**。nginx 默认 60s 读超时会在无数据时断开 Socket.IO 长连接，表现为「上课中途白板同步断掉」。 |
| `proxy_send_timeout 86400s`   | 与之配套，避免长连接在写入侧提前超时                                       |
| `proxy_set_header Host $host` | 缺失时后端拿到的是 `127.0.0.1:9000`，会影响课件 `?ct=` 令牌绑定与绝对 URL 拼装 |
| `proxy_cache_bypass $http_upgrade` | 防止 WebSocket 请求被缓存层吞掉                                       |
| `proxy_hide_header Content-Security-Policy`（仅 `/runtime/`） | 后端已为第三方课件下发自有宽松 CSP；nginx 叠加会覆盖它并拦掉课件内联脚本 |

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

| 现象                                    | 检查                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| 课件能打开，但 iframe 内一直「加载中」    | `/runtime/` 是否配了 `proxy_hide_header Content-Security-Policy`；否则看浏览器 console 的 CSP 报错 |
| 课件内联脚本不执行                      | 同上                                                                |
| 上课中途白板同步断掉                     | 是否漏 `proxy_read_timeout`（默认 60s）                                |
| 随机点名「教师端已抽中、学生端不同步」    | 确认 `Upgrade` / `Connection` / `Host` 三个 header 齐全               |
| 登录后被反复登出                        | 确认后端信任的代理来源；`server/middleware/` 的会话 Cookie 依赖请求协议判定 |

---

## 3. 相关源文件

| 路径                       | 内容                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `Dockerfile`               | 两阶段构建定义、运行用户、健康检查                         |
| `docker-compose.yml`       | 服务定义、四个命名卷、环境变量                             |
| `server.ts`                | `startServer` 监听 `PORT`（默认 9000）、`GET /health`      |
| `server/routes/bridge.ts`  | `/runtime/:uuid` 课件加载路由                             |
| `server/routes/shared.ts`  | `setCoursewareDocumentCsp` 课件自有宽松 CSP                |
| `packages/core/db/index.ts` | 读取 `OPENLEARN_DB_PATH` 决定 SQLite 主库路径             |
| `packages/core/di/api-key-crypto.ts` | `ENCRYPTION_KEY` 解析与 AES-256-GCM 加解密      |
| `scripts/restore-db.ts`    | 备份枚举与恢复（读取 `BACKUP_DIR`）                        |
| `ecosystem.config.cjs`     | PM2 进程定义（裸机部署路径，密钥走 `.env` 运行时读取）      |
