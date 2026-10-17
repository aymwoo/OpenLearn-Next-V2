# 系统管理员手册 (Administrator Guide)

> 本文面向部署并维护 OpenLearnV2 实例的系统管理员（`role = administrator`）。每条操作都给出**界面入口或可直接调用的 API 端点**，并标注源码依据文件。
>
> 角色权限矩阵见 [安全与权限](../architecture/security-permissions)，插件能力审核见 [插件能力矩阵](../reference/plugin-capability-matrix)，部署步骤见[安装指南](../getting-started/installation-guide) 与 [Docker & Nginx](../deployment/docker-nginx)。
>
> ⚠️ 本文所列 API 的**鉴权**统一由 `server/middleware/auth.ts` 的 `requireAuth(...roles)` 提供。多数管理端点是 `requireAuth('administrator')`，**不接受教师角色**——用教师账号调会拿到 403。

---

## 0. 管理员的权限边界与第一个动作

### 0.1 角色标识

`requireAuth` 同时接受 `'admin'` 与 `'administrator'`（前者会归一化为后者）。数据库 `users.role` 中规范值是 **`administrator` / `teacher` / `student`**。

### 0.2 内置种子账号（⚠️ 不再使用默认口令）

`packages/core/db/index.ts` 在用户表为空时插入两个账号：

| 用户名     | 初始口令 | 角色            | user id       |
| ---------- | -------- | --------------- | ------------- |
| `admin`    | 环境变量或随机生成 | `administrator` | `usr_admin`   |
| `teacher`  | 环境变量或随机生成 | `teacher`       | `usr_teacher` |

- `OPENLEARN_ADMIN_PASSWORD` / `OPENLEARN_TEACHER_PASSWORD` 有值时使用该值。
- 未设置时生成 20 位随机口令，打印一次，并写入数据目录下的 `storage/bootstrap-credentials.txt`（容器里是 `/data/storage/bootstrap-credentials.txt`）。
- 已经用 `admin` / `teacher` 当密码的存量库不会被改写哈希，但会把 `must_change_password` 置 1，登录后必须修改。

**改密**：`POST /api/auth/change-password`（见 §2.3）。新密码不能与用户名相同。带 `mustChangePassword` 的会话除改密、登出、`/api/auth/session`、`/api/auth/me` 外，**包括 GET 在内的** `/api` 请求一律 403 `FORBIDDEN_DEFAULT_PASSWORD`。静态页面仍可加载。生产环境不要设置 `PLAYWRIGHT_TEST`。

### 0.3 密码存储

`packages/core/db/index.ts` 的 `hashPassword` 用 **bcrypt**（`BCRYPT_ROUNDS = 10`）。`verifyPassword` **兼容旧 SHA-256 哈希**：若存量哈希不以 `$2` 开头则按 SHA-256 比对，成功时返回 `needsUpgrade: true` 触发重算升级。

> ❗ **平台没有「密码哈希配置」开关**。bcrypt 轮数是源码常量，不可通过配置或环境变量调整。管理员唯一能做的是通过 `POST /api/auth/change-password` 让用户改密，借此把旧 SHA-256 哈希升级为 bcrypt。

---

## 1. 登录与会话

### 1.1 端点

| 方法   | 路径                       | 鉴权               | 说明                                       |
| ------ | -------------------------- | ------------------ | ------------------------------------------ |
| POST   | `/api/auth/login`          | 公开 + `loginLimiter` | 登录，返回会话 Cookie（`edu_os_token`）  |
| GET    | `/api/auth/session`        | 公开               | 前端启动时恢复会话                          |
| GET    | `/api/auth/me`             | 公开               | 取当前用户资料                              |
| POST   | `/api/auth/logout`         | 公开               | 登出                                        |
| POST   | `/api/auth/change-password`| 需登录             | 改密                                        |
| POST   | `/api/auth/profile`        | 需登录             | 改个人资料                                  |
| POST   | `/api/auth/avatar`         | 需登录             | 上传头像                                    |
| DELETE | `/api/auth/avatar`         | 需登录             | 删除头像                                    |

> ⚠️ **令牌不是 JWT**。`edu_os_token` 是不透明会话 ID，服务端直接查 `client_sessions` 表（见 [安全与权限](../architecture/security-permissions)）。因此**令牌无法离线验证、也无法伪造过期时间**。

### 1.2 会话生命周期（`server/middleware/auth.ts` 的 `getValidSession`）

- **绝对过期**：读 `client_sessions.expires_at`，过期即删行返回 null
- **空闲超时**：24 小时（距 `updated_at` 超过 24h 即删行）
- **刷新节流**：`SESSION_REFRESH_INTERVAL_MS = 5 分钟`——距上次 `updated_at` 不足 5 分钟不写库，降低写放大
- **入库加固**：`session_data` 里的 `role` 必须是白名单值，**禁止通过 session 数据注入任意角色字符串**

### 1.3 频率限制（`server.ts`）

| 限制器         | 窗口     | 上限      | 挂载点                                     |
| -------------- | -------- | --------- | ------------------------------------------ |
| `loginLimiter` | 1 分钟   | 5 次/IP   | `POST /api/auth/login`                     |
| `writeLimiter` | 1 分钟   | 60 次/IP  | 写请求                                     |
| `aiLimiter`    | 1 分钟   | 10 次/IP  | `POST /api/agent/chat`、`POST /api/ai-providers/test` |

超限返回 429，body 为 `{ error: '… Too many …' }`。

---

## 2. 用户与角色管理

### 2.1 端点（全部 `requireAuth('administrator')`）

实现于 `server/routes/roster.ts`，转发命令总线：

| 方法   | 路径             | 命令类型        | 说明                                   |
| ------ | ---------------- | --------------- | -------------------------------------- |
| GET    | `/api/users`     | `user.list`     | 列出用户                               |
| POST   | `/api/users`     | `user.create`   | 建用户，Body：`{ username, password, role, name, status? }`（`status` 默认 `active`） |
| PUT    | `/api/users/:id` | `user.update`   | 改用户，Body：`{ username, role, name, password?, status? }` |
| DELETE | `/api/users/:id` | `user.delete`   | 删用户                                 |

> ⚠️ 教师**不能**管理用户——这四个端点不包含 `teacher`。教师只能改自己的资料（`/api/auth/profile`）与密码（`/api/auth/change-password`）。

### 2.2 角色能力概览

| 能力                | administrator | teacher     | student    |
| ------------------- | :-----------: | :---------: | :--------: |
| 用户 CRUD           | ✅            | ❌          | ❌         |
| AI Provider 增删改  | ✅            | ❌（只读）  | ❌         |
| 插件安装 / 卸载 / 启停 / 改配置 | ✅ | ❌  | ❌         |
| 班级 / 学生 CRUD    | ✅            | ✅          | ❌         |
| 课件成绩录入        | ✅            | ✅          | ❌         |
| 学生自身数据        | ✅            | ✅          | ✅（仅自己） |

完整矩阵见 [安全与权限](../architecture/security-permissions) §1。

### 2.3 强制改密流程

```
管理员 PUT /api/users/:id { password }
  → 学生/教师下次登录被标 mustChangePassword
  → 前端全屏拦截
  → 服务端 enforcePasswordChanged 中间件兜底（非 GET 一律 403）
  → 用户 POST /api/auth/change-password 完成改密
  → 哈希同时从旧 SHA-256 升级为 bcrypt
```

> **学生端策略（Issue #94 起）**：学生以初始默认口令 `123456` 登录**不再强制改密**，可直接进入学生端；会话仅携带 `usedDefaultPassword` 提示标记，学生端顶部显示一条可关闭的横幅引导修改。教师/管理员种子账号的强制改密行为不变。

---

## 3. AI 提供商配置

### 3.1 端点（`server/routes/plugins.ts`）

| 方法   | 路径                       | 鉴权                          | 说明                     |
| ------ | -------------------------- | ----------------------------- | ------------------------ |
| GET    | `/api/ai-providers`        | `requireAuth('teacher', 'administrator')` | 列出（API Key **已掩码**） |
| POST   | `/api/ai-providers`        | `requireAuth('administrator')` | 新增，Body：`{ name, api_url, api_key?, model_name }` |
| PUT    | `/api/ai-providers/:id`    | `requireAuth('administrator')` | 更新（同上 Body）        |
| DELETE | `/api/ai-providers/:id`    | `requireAuth('administrator')` | 删除                     |
| POST   | `/api/ai-providers/test`   | `requireAuth('administrator')` + `aiLimiter` | 连通性测试 |

**新增 / 更新校验**：`name` / `api_url` / `model_name` 三者缺一即 `400 Missing name, api_url or model_name`。

**掩码回写规则**：`PUT` 时若 `api_key` 含 `****`（即前端回传了掩码值），服务端**保留原密钥不变**；只有传入不含 `****` 的明文才重新加密。

### 3.2 密钥加密

实现于 `packages/core/di/api-key-crypto.ts`（**AES-256-GCM**）。同一把钥匙也加密班级临时口令。

- 密钥来源：非空的 `process.env.ENCRYPTION_KEY` → `.env` 里非空的 `ENCRYPTION_KEY=`（避免 PM2 用空字符串挡住 dotenv）→ 数据目录 `storage/encryption-key`
- 都没有时，首次启动用随机 32 字节生成该文件（权限 600，与 `bootstrap-credentials.txt` 同目录）。启动日志和管理后台会显示醒目警告：正在使用自动生成的密钥，请设置 `ENCRYPTION_KEY` 并离线备份文件
- 环境变量若与已持久化的文件不一致，进程报错并说明如何二选一，不会覆盖文件，也不会退回临时内存密钥
- 解密失败的报错文案：「AI Provider API Key 解密失败：ENCRYPTION_KEY 与加密时不一致（常见于 PM2 将 ENCRYPTION_KEY 置空或密钥被轮换）」

> ⚠️ **`ENCRYPTION_KEY` 不可轮换**。改动后全部既有 API Key 和班级临时口令无法解密。API Key 要在本页 §3.1 逐个重新保存，班级口令要由教师重新设置。轮换前务必先备份数据库，并单独备份密钥文件。`site-backup` 不包含 `storage/encryption-key`。

### 3.3 AI 功能可用性

平台**不依赖任何静态 API Key 环境变量**。未配置任何 provider 时，AI 相关功能（`/api/agent/chat`、成绩自然语言分析等）不可用，其余功能不受影响。

---

## 4. 插件管理

### 4.1 端点（`server/routes/plugins.ts`）

| 方法   | 路径                                        | 鉴权                          | 说明                             |
| ------ | ------------------------------------------- | ----------------------------- | -------------------------------- |
| GET    | `/api/plugins`                              | `requireAuth()`               | 列出已装插件                     |
| GET    | `/api/plugins/by-manifest/:manifestId`      | 公开                          | 按 manifest id 查               |
| GET    | `/api/plugins/market`                       | `requireAuth()`               | 市场列表                         |
| GET    | `/api/plugins/community`                    | `requireAuth()`               | 社区插件列表                     |
| POST   | `/api/plugins`                              | `requireAuth('administrator')` | 以源码安装（`plugin.install`）   |
| POST   | `/api/plugins/upload-zip`                   | `requireAuth('administrator')` | ZIP 安装（`plugin.install_zip`） |
| POST   | `/api/plugins/upload-zip-raw`               | `requireAuth('administrator')` | 原始 ZIP 流式安装（上限 400mb）  |
| POST   | `/api/plugins/install-from-url`             | `requireAuth('administrator')` | 从 URL 安装（须 `acknowledgeRisk: true`） |
| POST   | `/api/plugins/:id/public-routes`            | `requireAuth('administrator')` | 批准或撤销 manifest 中 `auth: false` 的公开路由 |
| POST   | `/api/plugins/:id/update-zip-raw`           | `requireAuth('administrator')` | in-place 更新（原始 ZIP）        |
| POST   | `/api/plugins/:id/check-update`             | `requireAuth()`               | 检查更新                         |
| POST   | `/api/plugins/:id/one-click-update`         | `requireAuth('administrator')` | 一键更新                         |
| GET    | `/api/plugins/:id/contributions`            | `requireAuth()`               | 该插件的 UI 贡献                 |
| GET    | `/api/plugins/:id/config`                   | `requireAuth()`               | 读声明式配置                     |
| POST   | `/api/plugins/:id/config`                   | `requireAuth('administrator')` | 写声明式配置                     |
| POST   | `/api/plugins/:id/toggle`                   | `requireAuth('administrator')` | 启用 / 停用                      |
| DELETE | `/api/plugins/:id`                          | `requireAuth('administrator')` | 卸载（`plugin.uninstall`）       |
| POST   | `/api/plugins/execute-command`              | `requireAuth()`               | 执行插件注册的命名命令           |

### 4.2 ZIP 上传的请求头约定

`upload-zip-raw` / `update-zip-raw` 走 `express.raw({ type: 'application/octet-stream', limit: '400mb' })`，因此需带以下头：

| 头                    | 取值                        | 作用                                     |
| --------------------- | --------------------------- | ---------------------------------------- |
| `x-filename`          | URL-encoded 文件名          | 缺省 `plugin.zip`                        |
| `x-execution-mode`    | `worker` / `inline` / `process` | 请求的执行模式。非 `@openlearn/` 且不在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 中的插件一律改写为 `process` |
| `x-install-mode`      | `install`（默认）/ 其他     | 安装语义                                 |
| `x-allow-downgrade`   | `true` / 其它               | 允许降级安装                             |
| `x-target-plugin-id`  | URL-encoded 插件 id         | 指定更新目标                             |
| `x-approve-public-routes` | `true` / 其它           | 为 `true` 时批准清单里 `auth: false` 的路由；其它值不批准 |

### 4.3 能力审核

插件在 manifest 中通过 `capabilitiesProposed` 声明所需能力字符串（如 `lesson:read` / `lesson:write` / `whiteboard:write`）。运行时由 `CapabilityGuard` 按 `actorId` 逐条校验。管理员在安装时应核对声明的能力是否与插件功能相符——完整能力字典见 [插件能力矩阵](../reference/plugin-capability-matrix)，槽位清单见 [UI 扩展槽位全目录](../reference/plugin-ui-extension-slots)。

> ⚠️ **第三方插件固定为子进程**。Worker 线程与宿主共享环境变量，不能隔离密钥。manifest id 不以 `@openlearn/` 开头、且未列入 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 的包，安装、更新、激活和启动恢复时都会改成 `process`。响应里的 `executionMode` / `isolation_mode` 是实际模式；`executionModeCoerced: true` 表示请求被改写。
>
> ⚠️ **`auth: false` 只是申请**。网关在管理员把该方法与路径写入 `plugin_public_routes` 之前仍然要求登录。批准：安装体 `approvePublicRoutes: true`、头 `x-approve-public-routes: true`，或 `POST /api/plugins/:id/public-routes`（body `{ "approvePublicRoutes": true }` 写入，省略或 `false` 清空）。社区安装另须 `acknowledgeRisk: true`，否则 400 `COMMUNITY_RISK_ACK_REQUIRED`。

### 4.4 插件日志

`GET /api/admin/logs?limit=200&component=<子>&level=<级别>`（`requireAuth('administrator')`）读取 `logs/openlearn.log`（Pino JSON 行格式），支持按 Pino 数字级别过滤（`10=trace` … `60=fatal`）。文件不存在时返回 `{ success: true, logs: [] }`。

---

## 5. 班级 / 学生管理

### 5.1 班级（`server/routes/roster.ts`）

| 方法   | 路径                        | 鉴权                              | 说明             |
| ------ | --------------------------- | --------------------------------- | ---------------- |
| GET    | `/api/classes`              | `requireAuth()`                   | 列出班级         |
| POST   | `/api/classes`              | `requireAuth('teacher', 'administrator')` | 建班级   |
| PUT    | `/api/classes/:id`          | `requireAuth('teacher', 'administrator')` | 改班级   |
| DELETE | `/api/classes/:id`          | `requireAuth('teacher', 'administrator')` | 删班级   |
| GET    | `/api/classes/:id/passcode` | `requireAuth()`                   | 取班级口令       |
| GET    | `/api/classes/:id/students` | `requireAuth()`                   | 班级成员         |
| POST   | `/api/classes/:id/students` | `requireAuth('teacher', 'administrator')` | 加入学生   |
| POST   | `/api/classes/:id/students/bulk-enroll` | `requireAuth('teacher', 'administrator')` | 批量招生 |
| GET    | `/api/classes/:id/progress` | `requireAuth()`                   | 班级进度         |
| POST   | `/api/classes/:id/lock_lesson`   | `requireAuth('teacher', 'administrator')` | 全班锁屏   |
| POST   | `/api/classes/:id/unlock_lesson` | `requireAuth('teacher', 'administrator')` | 全班解锁   |
| POST   | `/api/classes/import`       | `requireAuth('teacher', 'administrator')` | 批量导入，Body：`{ classes: [...] }` |

### 5.2 学生

| 方法   | 路径                              | 鉴权                              | 说明                       |
| ------ | --------------------------------- | --------------------------------- | -------------------------- |
| GET    | `/api/students`                   | `requireAuth()`                   | 列出学生                   |
| POST   | `/api/students`                   | `requireAuth('teacher', 'administrator')` | 建学生             |
| PUT    | `/api/students/:id`               | `requireAuth('teacher', 'administrator')` | 改学生             |
| DELETE | `/api/students/:id`               | `requireAuth('teacher', 'administrator')` | 删学生             |
| GET    | `/api/students/:id/export`        | `requireAuth('teacher', 'administrator')` | 导出单生数据     |
| DELETE | `/api/students/:id/gdpr-delete`   | `requireAuth('teacher', 'administrator')` | **GDPR 彻底删除**（不可逆） |
| GET    | `/api/students/:id/progress`      | `requireAuth()`                   | 学生进度                   |
| POST   | `/api/students/import`            | `requireAuth('teacher', 'administrator')` | 批量导入，Body：`{ students: [...] }` |

> ⚠️ `DELETE /api/students/:id/gdpr-delete` 会清除该生在本平台的全部个人数据（作答、成绩、进度等）。执行前**必须**确认已按合规流程取得授权，并留档。

### 5.3 演示数据与报告下载

| 方法 | 路径                                          | 鉴权                          | 说明                             |
| ---- | --------------------------------------------- | ----------------------------- | -------------------------------- |
| POST | `/api/admin/seed-demo`                        | `requireAuth('administrator')` | 播种演示班级 / 课节 / 学生       |

> `seed-demo` 是**幂等**的：会先清理历史遗留的 `demo-class-%` 前缀班级（连带 `class_students` / `schedules`），再用固定 id `demo-class` / `demo-schedule` 重建。

### 5.4 站点设置

| 方法 | 路径                  | 鉴权                          | 说明                             |
| ---- | --------------------- | ----------------------------- | -------------------------------- |
| GET  | `/api/site-settings`  | 公开                          | 读站点名 / 口号 / Logo           |
| PUT  | `/api/site-settings`  | `requireAuth('administrator')` | 写站点名 / 口号 / Logo           |

---

## 6. 系统运维

### 6.1 健康与数据库状态

| 方法 | 路径             | 鉴权                              | 说明                                       |
| ---- | ---------------- | --------------------------------- | ------------------------------------------ |
| GET  | `/health`         | 公开                              | 存活探针（Docker `HEALTHCHECK` 打的就是它） |
| GET  | `/api/db-status`  | `requireAuth('teacher', 'administrator')` | 查 `page_size` / `page_count` / `journal_mode` / `auto_vacuum` / `integrity_check` / `freelist_count` |

> **`/api/db-status` 每月至少查一次**。`integrity_check` 返回非 `ok` 说明数据库已损坏，此时**先备份当前文件再排查**，不要直接重启。

### 6.2 站点级安全配置

| 配置项            | 作用                                                                                     | 生效位置                          |
| ----------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| `ENCRYPTION_KEY`  | AES-256-GCM 主密钥（AI Provider API Key 与班级临时口令）。未设置时用 `storage/encryption-key` | `packages/core/di/api-key-crypto.ts` |
| `ALLOWED_ORIGINS` | 逗号分隔的 CORS 白名单；**未配置时**对无 `Origin` 头与同源请求智能放行                     | `server.ts` 的 `isOriginAllowed`  |
| `PORT`            | 监听端口，默认 `9000`                                                                      | `server.ts` 的 `startServer`      |
| `OPENLEARN_DB_PATH` | SQLite 主库路径（容器内固定为 `/app/packages/core/db/educational_os.db`）                 | `packages/core/db/index.ts`       |
| `BACKUP_DIR`      | 备份目录（默认 `backups`）                                                                 | `scripts/restore-db.ts`           |
| `LOG_LEVEL`       | 日志级别（compose 默认 `info`）                                                            | 日志子系统                        |
| `DISABLE_HMR`     | 置真后关闭 Vite HMR（生产/AI Studio 兼容）                                                 | 前端构建                          |

完整环境变量清单见 [系统配置](../configuration/system-configuration)。

### 6.3 请求层安全门控

| 机制                          | 作用                                                                                             | 实现                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Cookie 会话                   | `edu_os_token`，HttpOnly + SameSite=Lax；令牌是 `client_sessions` 表的不透明 ID                     | `server/middleware/auth.ts`                  |
| CSRF 门控                     | 拦 `POST`/`PUT`/`PATCH`/`DELETE`；按 `Sec-Fetch-Site` 判定，`cross-site` 仅豁免清单内放行             | `server/middleware/csrf.ts`                  |
| 强制改密门控                  | 带 `mustChangePassword` 标记的会话，非 GET 且非豁免路径一律 403                                      | `enforcePasswordChanged`                     |
| 频率限制                      | 登录 5/min、通用写 60/min、AI 10/min                                                                | `server.ts` 的 `express-rate-limit`          |
| 课件 HTML 令牌                | 沙箱 iframe 不带 cookie，改用父页面铸造的短时 HMAC token（`?ct=`）                                  | `server/utils/courseware-access.ts`          |
| 成绩榜字段脱敏                | 非 staff 会话剥除 `extra_json` / `comment`                                                          | `server/routes/courseware.ts`                |
| API Key 掩码                  | 列表接口只返掩码值；`PUT` 回传含 `****` 时保留原值                                                 | `server/routes/plugins.ts`                   |
| 能力守卫                      | 命令执行前按 `actorId` 校验 capability 字符串                                                       | `packages/core/capability-system/`           |
| 内核事件审计                  | 所有 EventBus 事件落 `events` 表，可带 `correlationId` 串联                                          | `kernelContainer.initAuditLog()`              |

### 6.4 备份与恢复

平台**没有**备份相关的 HTTP 端点。数据库和课件一起备份用 `node scripts/site-backup.mjs`（容器：`docker compose exec app node scripts/site-backup.mjs`）。它用 `VACUUM INTO` 做一致性快照，并把 `storage/`、`plugins/`、`uploads/` 打进 tar。只备份 SQLite 时仍可用 `pnpm run db:backup` / `scripts/restore-db.ts`。

**必须一起备份的目录**（容器里都在 `/data`，备份在 `/backups`）：

| 路径 | 内容 | 漏备份的后果 |
| --- | --- | --- |
| 数据库文件 | `educational_os.db` | 全部业务数据丢失 |
| `storage/` | 课件、种子口令文件 | 课件 404 |
| `plugins/` | 已安装插件源码 | 插件启动失败 |
| `uploads/` | 头像等上传 | 附件 404 |

**恢复**（先停服）：

```bash
node scripts/site-restore.mjs --list
node scripts/site-restore.mjs --i-understand-downtime
```

**恢复校验清单**：

1. 停服务 → 运行恢复脚本 → 再启动
2. `curl -fsS http://127.0.0.1:9000/health` 应含 `"status":"ok"`。`/health/ready` 成功时正文是 `{"status":"ready"}`，不要再期待 `db` 或错误详情。
3. 抽查一个班级、一个课件文件、一个学生成绩
4. **确认 `ENCRYPTION_KEY` 未随备份变更**——换了密钥则所有 AI Provider API Key 需重新保存

**升级后回填无归属班级**（迁移 021 不猜老师）：

```bash
node scripts/backfill-class-owners.mjs --list
node scripts/backfill-class-owners.mjs --assign teacher
```

详见[版本迁移指南](../migration/version-migration.md) §0。

---

## 7. 排障速查

| 现象                              | 根因与处置                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 教师账号调管理端点返回 403         | 端点是 `requireAuth('administrator')`，不含 teacher。改用管理员账号。                                                                                                          |
| 登录后立刻被弹回改密页            | 种子账号带 `mustChangePassword`。走 `POST /api/auth/change-password`。                                                                                                        |
| AI 功能报「API Key 解密失败」     | `ENCRYPTION_KEY` 与加密时不一致，或被 PM2 env 块置空。恢复原值，或在 AI 提供商管理逐个重存 Key。                                                                              |
| 登录被限流 429                    | `loginLimiter` 5 次/分钟/IP。等待或从 nginx 层确认不是反向代理把大量用户汇聚成同一 IP。                                                                                        |
| 写操作 403 `CORS not allowed`      | `ALLOWED_ORIGINS` 未包含实际访问来源。注意未配置时对无 `Origin` 头与同源请求是放行的。                                                                                        |
| 写操作 403 且响应来自 csrfGuard    | `Sec-Fetch-Site: cross-site` 且路径不在豁免清单。检查是否有第三方页面在跨站调用本站写接口。                                                                                      |
| 上课中途白板同步断掉                | nginx 缺 `proxy_read_timeout`（默认 60s）。见 [Docker & Nginx](../deployment/docker-nginx) §2。                                                                             |
| 课件 iframe 一直「加载中」         | `GET /api/courseware/:id` 需要 `?ct=` 短时令牌（父页面经 `GET /api/courseware/:id/access-token` 铸造）。检查父页面是否被拦截。                                                       |
| 插件安装后功能不出现                | 核对 manifest 的 `capabilitiesProposed` 与 `contributes`；用 `GET /api/plugins/:id/contributions` 查看实际注册的贡献。                                                          |
| 容器重启后数据全没                  | 卷挂错路径。必须挂 `/app/packages/core/db`（不是 `/app/data`）。见 [Docker & Nginx](../deployment/docker-nginx) §1.2。                                                        |

---

## 8. 相关源文件

| 路径                                       | 内容                                             |
| ------------------------------------------ | ------------------------------------------------ |
| `server/routes/roster.ts`                  | 登录 / 会话 / 用户 CRUD / 班级 / 学生 / 导入导出 / DB 状态 |
| `server/routes/admin.ts`                   | 演示数据播种、审计报告下载                        |
| `server/routes/plugins.ts`                 | 插件生命周期、AI 提供商、站点设置、管理日志       |
| `server/middleware/auth.ts`                | `requireAuth` / `getValidSession` / `enforcePasswordChanged` |
| `server/middleware/csrf.ts`                | 写请求跨站来源门控                               |
| `server.ts`                                | 限流器装配、CORS 白名单、`/health`、端口          |
| `packages/core/db/index.ts`                | `hashPassword` / `verifyPassword`、种子用户、schema |
| `packages/core/di/api-key-crypto.ts`       | `ENCRYPTION_KEY` 解析与 AES-256-GCM 加解密       |
| `packages/core/capability-system/`         | 能力守卫                                         |
| `server/utils/courseware-access.ts`        | 课件 HTML 短时 HMAC 令牌                         |
| `scripts/restore-db.ts`                    | 备份枚举与恢复                                   |
| `docker-compose.yml` / `Dockerfile`        | 部署卷与环境变量                                 |
