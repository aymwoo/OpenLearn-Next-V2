# 公测运营手册

日期：2026-10-14。读者是看管公测服务器的人。教师公告在 [announcement.md](announcement.md)。学生数据的法律表述在 [privacy.md](privacy.md)，发出前要学校确认。

命令以仓库里的脚本和 compose 为准。演练记录是 [DEPLOY_REHEARSAL.md](../DEPLOY_REHEARSAL.md)。

## 1. 上线前

按 [公测上线检查清单](../deployment/production-guide.md#4-公测上线检查清单) 从第 1 项做到第 11 项。2026-10-14 的完成情况在 [4.1 节](../deployment/production-guide.md#41-清单状态2026-10-14)。仓库里已经绿的 CI，不能代替目标机器上的密钥、口令、卷和反代。

开放给教师之前，在目标环境再确认这几件：

1. `ENCRYPTION_KEY` 是 64 位十六进制，已抄到学校的离线位置。换机器、做恢复，都用这一把。进程日志里出现 `Generating ephemeral in-memory key` 时，不要接入真实的 AI 密钥，先停下来把钥匙写进环境变量。
2. `OPENLEARN_ADMIN_PASSWORD` 与 `OPENLEARN_TEACHER_PASSWORD` 已设置，且都不等于用户名。数据目录里的 `storage/bootstrap-credentials.txt` 若存在，抄走后删除。环境里没有 `PLAYWRIGHT_TEST`。
3. 卷只有 `/data` 和 `/backups`。课件在 `/data/storage`，插件在 `/data/plugins`，日志在 `/data/logs`。
4. 前面有 Nginx 时 `TRUST_PROXY` 等于真实层数（演练是 `1`）。应用端口 9000 不对公网。compose 的 `app` 默认发布 `9000:9000`，启用 `proxy` profile 时改掉这行，只留 Nginx 的端口。
5. `GET /health` 为 `{"status":"ok"}`，可带 `uptime` 与 `version`。`GET /health/ready` 为 `{"status":"ready"}`。未就绪是 503，正文只有 `{"status":"not_ready"}`。
6. 匿名 `GET /metrics` 为 401。用管理员会话或 `Authorization: Bearer <METRICS_TOKEN>` 能看到 Prometheus 文本，其中有 `openlearn_up 1`。
7. `LOG_REDACT` 不要设成 `false`。`SENTRY_DSN` 与 `OPENLEARN_ERROR_DSN` 可以空着。
8. 若是从 v0.6.1 的旧库升级：`_migrations` 含 `021_class_owner_and_password_gate` 与 `022_plugin_public_routes`，并用 `node scripts/backfill-class-owners.mjs --assign <教师用户名>` 回填空归属。需要匿名访问的插件再执行批准。空库开新则跳过回填。
9. 执行一次 `node scripts/site-backup.mjs`，确认 `/backups` 里有数据库、文件包和 `openlearn_*.manifest.json`。把这三份再拷到另一块磁盘。**【待作者确认：备份周期，例如每个教学日结束后一次。】**
10. 用管理员走完改密、教师建班、学生提交、插件安装后启用。安装成功不等于已启用。

只读卷的失败演练在 2026-10-14 已经做过：日志第一行业务结论是 `[Startup] FATAL`，退出码非 0。目标机的卷权限若不确定，再做一次，不要在已经装有公测数据的卷上把目录改成只读。

## 2. 平时看什么

不引入必须付费的监控。下面都是进程自己提供的。

### 活着没有

| 检查 | 正常 | 不正常时 |
| --- | --- | --- |
| `GET /health` | 200，`status` 为 `ok` | 进程没在听。看 `docker inspect` 的 Health 和 `RestartCount` |
| `GET /health/ready` | 200，正文只有 `{"status":"ready"}` | 503 `{"status":"not_ready"}`。原因在服务端日志，不在响应里。常见是数据库打不开、`storage` 不可写、迁移没做完 |
| 容器 Health | `healthy` | 一直 `unhealthy` 时不要对教师开放 |

`docker kill` 之后容器保持停止。要恢复服务用 `docker compose start`，不要等 `unless-stopped` 把它拉起来。

### 指标

`GET /metrics` 是 Prometheus 文本：进程是否存活、运行时间、常驻内存、按状态类汇总的 HTTP 计数。公测没有现成的告警规则。**【待作者确认：用什么抓取，抓取失败时谁收到通知。】** 没有抓取系统时，每个教学日开始前手工程一次：

```bash
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:9000/metrics
```

从本机访问。不要把这个接口暴露到公网而不带凭证。内存持续升高时，对照已知问题里的 110MB JSON 上限，先看是不是有异常的大请求，再考虑重启。重启不代替备份。

### 日志

每条访问是一行 JSON，消息为 `http.request`，含 `requestId`、`userId`、`method`、`path`、`status`、`durationMs`。路径不含查询串，没有请求体。响应头 `x-request-id` 与日志里的 `requestId` 对应。调用方传入的值须匹配 `^[A-Za-z0-9._:-]{8,64}$`，否则由服务端生成。

`LOG_LEVEL` 在生产默认 `info`。目录由 `LOG_DIR` 决定，compose 为 `/data/logs`。目录不可写时只打 stdout，进程仍会启动。

| 文件 | 默认保留 | 变量 |
| --- | --- | --- |
| `openlearn.log` | 10MB × 当前文件加 5 份历史 | `LOG_MAX_SIZE_MB`、`LOG_MAX_FILES` |
| `audit.log` | 20MB × 当前文件加 20 份历史 | `AUDIT_LOG_MAX_SIZE_MB`、`AUDIT_LOG_MAX_FILES` |

安全审计事件：

| 事件 | 何时 |
| --- | --- |
| `auth.login_failed` | 登录 401/403。有账号和原因，没有口令 |
| `rate_limit.triggered` | HTTP 429 |
| `auth.forbidden` | HTTP 403（登录接口走上面的登录失败事件） |
| `plugin.installed` | 源码或 ZIP 安装成功 |
| `plugin.enabled` | 插件被切换为 `active` |
| `plugin.public_route_approved` | 管理员批准公开路由 |

抽查时确认这些行里没有口令、Cookie、班级口令和学生作答。`LOG_REDACT` 被关掉之后，这个保证不再成立。

### 错误报告

`SENTRY_DSN` 或 `OPENLEARN_ERROR_DSN` 指向自建 Sentry 或 GlitchTip 时，未捕获异常、路由 5xx、浏览器 `window.onerror` 与未处理的 Promise（经 `POST /api/client-errors`）会转发过去。留空不外连，启动不受影响。学校没确认接收端之前，保持留空。

## 3. 出了事故

先判断要不要停写。

| 现象 | 先做 |
| --- | --- |
| 个别教师报错，健康检查正常 | 记下 `x-request-id`，按 [反馈流程](feedback.md) 收集。不要停服 |
| `/health` 失败或容器反复重启 | 看日志里的 `[Startup] FATAL`、`[Kernel] FATAL`、`[Migration] FATAL`、`[DB SSOT] FATAL`。先恢复进程，再决定要不要回滚数据 |
| 误删班级、错误迁移、磁盘上的库已损坏 | 停服，从站点备份恢复。不要在服务开着时覆盖数据库文件 |
| 怀疑学生数据被不该看的人打开 | 停掉对外端口或反代。保留日志。不要在公开 Issue 里贴样本。通知学校联系人。**【待作者确认：谁有权决定停站】** |
| AI 报解密失败或 `[UNDECRYPTABLE]` | 不要旋转 `ENCRYPTION_KEY`。把环境变量改回备份时那一把，再重启 |

### 停服并恢复站点备份

备份在服务运行时就可以做（`VACUUM INTO`）。恢复必须先停服。

生产镜像的入口是 `scripts/docker-entrypoint.sh`：先修正 `/data` 与 `/backups` 的属主，再降权执行后面的命令。恢复用一次性容器，不要把恢复命令写成镜像的长期 `CMD`。

```bash
# 1. 停应用。不要用 docker kill 当作最后状态。
docker compose stop app

# 2. 看有哪些站点备份。清单文件是 openlearn_<时间>.manifest.json
docker compose run --rm --no-deps app node scripts/site-restore.mjs --list

# 3. 覆盖恢复。不加这个旗标会直接拒绝。
#    不写文件名时用最新一份。建议写明 manifest，数据库和文件包一起退回。
docker compose run --rm --no-deps app \
  node scripts/site-restore.mjs --i-understand-downtime \
  --manifest /backups/openlearn_YYYYmmdd_HHMMSS.manifest.json

# 4. 拉起
docker compose start app
```

脚本行为（`scripts/site-restore.mjs`）：

- 没有 `--i-understand-downtime` 时退出，并提示用 `--list`。
- 恢复前对备份库做 `integrity_check`。复制到临时文件后再查一次，失败则不覆盖原库。
- 原库还在时，先复制一份 `educational_os.db.bak_<时间>`，除非加了 `--force`。
- 写回新库后删除旁边的 `-wal` 与 `-shm`，避免旧的预写日志贴回新文件。
- 若 manifest 带了文件包，把 `storage`、`plugins`、`uploads` 解压回数据目录。
- 会尝试用 `fuser` 看库是否仍被占用。生产镜像没有 `fuser`，这条检查可能是空的。第 1 步的停服不能省。

恢复后核对：

1. `/health` 与 `/health/ready`。
2. 用改密后的管理员登录，打开一个公测班，看学生人数。
3. 打开备份时特意留下的课件文件，确认内容还在。
4. AI 提供商若在备份之后配置过，恢复会回到备份那一刻。密钥解不开时，是 `ENCRYPTION_KEY` 不一致，不是备份损坏。

迁移前自动生成的 `pre_migration_*.db` 只有数据库，没有文件包。整站退回用 `openlearn_*.manifest.json`。只用迁移前快照时，课件目录不会跟着退回。

### 恢复后的插件与账号

- 第三方插件若在备份里是 `process`，启动恢复时仍会按这个模式拉起。公开路由以备份里的批准记录为准。
- 备份之后才修改的密码会退回备份时的口令。通知管理员。
- 种子口令文件若在 `storage/` 里被备份打进去，恢复后文件会重新出现。再次删除。

### 不要做的恢复

- 不要在服务运行时用文件拷贝替换 `educational_os.db`。在线备份用 `scripts/site-backup.mjs`。
- 不要为了「修好 AI」重新生成 `ENCRYPTION_KEY`。新钥匙解不开旧密文，`getEncryptionKey` 也不会覆盖 `.env` 里已经存在的那一行。
- 不要用 `PLAYWRIGHT_TEST` 绕过改密门禁。
- 不要把 `TRUST_PROXY` 开在直接对公网监听的进程上。

## 4. 开放当天的顺序

1. 清单 4.1 里「待目标环境执行」的项做完。
2. 做一份新备份并拷到另一块磁盘。
3. 学校确认隐私草稿里要发出的部分。未确认前，不要批量创建学生。
4. 把 [公告](announcement.md) 里的空填上再发给教师。
5. 开放后的第一个小时，看 `/health/ready`、`RestartCount`、`audit.log` 里的登录失败和 429。
