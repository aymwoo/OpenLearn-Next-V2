# 多校部署（一校一实例）

> 决策依据见 [ADR-001：多租户 / 多校区与数据库抽象层](../architecture/adr-001-tenant-and-db-abstraction.md)。
> 结论：**一个学校 = 一个平台实例 = 一个数据库 = 一个数据目录**。平台不提供跨校账号、跨校班级或跨库联合查询。

---

## 1. 拓扑

```
                 ┌────────────────────────────┐
  school-a.edu ──▶│ Nginx (TLS, Host 路由)      │──▶ 127.0.0.1:9001  实例 A
  school-b.edu ──▶│  或每校独立入口             │──▶ 127.0.0.1:9002  实例 B
                 └────────────────────────────┘
                                                   每实例独立：
                                                   - SQLite 库
                                                   - OPENLEARN_DATA_DIR（课件/上传/插件/日志）
                                                   - BACKUP_DIR
                                                   - ENCRYPTION_KEY
```

两种落地方式，按运维能力选择：

| 方式 | 适用 | 要点 |
| --- | --- | --- |
| 多 Compose 项目（同一主机） | 学校数量少、主机资源充足 | 每校一个目录 + 独立 `.env` + 独立端口 + 独立卷名；用 `docker compose -p school-a` 隔离 |
| 每校一台主机 / 一个 VM | 学校数量多、运维边界清晰 | 完全独立，升级与故障互不影响；统一用同一镜像 tag |

## 2. 逐实例配置

每个实例必须有自己的 `.env`（不要共用）：

```dotenv
# 实例 A（school-a）
OPENLEARN_DATA_DIR=/srv/openlearn/school-a/data
OPENLEARN_DB_PATH=/srv/openlearn/school-a/data/educational_os.db
OPENLEARN_PLUGINS_DIR=/srv/openlearn/school-a/data/plugins
BACKUP_DIR=/srv/openlearn/school-a/backups
LOG_DIR=/srv/openlearn/school-a/data/logs

# 每校独立生成：openssl rand -hex 32
# 共用会导致一校泄露即全校泄露（AI Provider 凭据加密边界）
ENCRYPTION_KEY=<每实例独立 32 字节 hex>

# 有且只有一层 Nginx 时设置；直连公网时留空
TRUST_PROXY=1
METRICS_TOKEN=<每实例独立随机值>
```

Compose 隔离示例（同一主机跑两校）：

```bash
# 目录约定：/srv/openlearn/school-a、/srv/openlearn/school-b，各自一份 compose + .env
cd /srv/openlearn/school-a && docker compose -p school-a up -d --build
cd /srv/openlearn/school-b && docker compose -p school-b up -d --build
```

- 两台实例的宿主端口不能相同（在各自 compose 里改 `ports:`，如 `9001:9000`、`9002:9000`）。
- 卷名随 `-p` 前缀隔离，避免 `docker compose down -v` 误删另一校的数据。

## 3. 反向代理按 Host 路由

```nginx
# school-a
server {
    listen 443 ssl;
    server_name school-a.example.edu;
    # ... TLS 证书、安全头 ...
    location / {
        proxy_pass http://127.0.0.1:9001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;   # 白板实时同步必需
        proxy_send_timeout 86400s;
    }
    location /runtime/ {
        proxy_pass http://127.0.0.1:9001;
        proxy_hide_header Content-Security-Policy;
    }
}
```

- 每校独立证书（或统一泛域名证书）。
- `/socket.io/` 与 `/runtime/` 的注意事项与单实例部署相同，见 [Docker & Nginx 反向代理配置](docker-nginx)。
- 代理后面必须给对应实例设置 `TRUST_PROXY`，否则限流桶会按代理地址合并。

## 4. 升级、备份、恢复（逐实例执行）

一校一实例意味着**所有变更按实例粒度进行**，不做「一次升级全校生效」：

| 操作 | 命令 / 位置 | 注意 |
| --- | --- | --- |
| 升级 | 每实例拉新镜像/新代码后重启 | 先在 1 个实例试点；观察 `/health/ready` 与 `openlearn_plugin_*` 指标 |
| 升级前快照 | 启动日志里的 `pre_migration_*.db`（`BACKUP_DIR`） | 每实例一份，互不覆盖 |
| 迁移失败恢复 | `npx openlearn-next restore --snapshot <pre_migration_*.db>` | 见 [运维手册 · 快照恢复](../beta/operations) |
| 整站备份 | `scripts/site-backup.mjs`（容器内 `docker compose exec app node scripts/site-backup.mjs`） | 含数据库、`storage/`、`plugins/`、`uploads/` |
| 恢复演练 | 迁移失败 → 快照恢复 → 启动的 CI 演练；本地 `pnpm exec tsx scripts/db/migration-restore-drill.ts` | 建议每学期在预发实例跑一次 |

> 不要把某校的 `ENCRYPTION_KEY`、备份或数据目录复制到另一校。备份文件跨实例恢复只适用于「同一校的灾备」。

## 5. 观测

- 每实例独立暴露 `/metrics`（管理员会话或该实例的 `METRICS_TOKEN`）。
- Prometheus 抓取时加 `instance="school-a"` 之类的标签区分；平台指标里没有跨校维度，实例标签就是「学校维度」。
- 告警按实例配置（每校一套通知渠道）；升级窗口逐实例错开。

## 6. 插件与内容分发

- 插件 ZIP 在每校实例分别安装/升级（管理后台或 `POST /api/plugins/upload-zip-raw`）。
- 插件配置是**实例级**的：`plugin_config.scope_type='platform'` 即该校的全局值；`school` 层在一校一实例下没有自动来源。
- 需要多校共用课件模板时，离线分发文件包，不建立跨实例共享存储。

## 7. 明确不支持

- 跨校统一账号（需要时评估外部 IdP 单点登录，属新决策）；
- 跨校班级、跨校选课、跨校实时协作；
- 跨库联合查询与在线跨校报表 —— 用各实例导出 + 离线聚合。

## 8. 容量与限制

- SQLite 单写者：同一实例内的写操作串行。院校规模下（单校数千学生、并发写集中在课堂环节）通常足够；若单实例迁移时长或写等待持续增长，优先做实例拆分（按校区/学段），而不是多校共库。
- 判断依据：`openlearn_migrations_pending`、迁移耗时日志、`openlearn_plugin_command_duration_seconds_sum/count` 与 `openlearn_http_responses_total`。
- 单实例资源建议按校配额（CPU/内存/卷），空闲实例可降配。
