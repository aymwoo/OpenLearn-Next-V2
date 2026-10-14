# 公测已知问题与限制

日期：2026-10-14。对照的是当前仓库代码、[审计报告](../AUDIT_REPORT.md)（2026-10-13，针对当时的树）和 [演练记录](../DEPLOY_REHEARSAL.md)（2026-10-14）。审计报告里的编号（H-1、M-3 等）保留，便于和原文对照。某条若已在后来的代码里改掉，写在文末「不要再当成未修复缺陷」，不写进开放列表。

起草时没有重跑 `pnpm lint:eslint`、`pnpm build`、`pnpm audit`。涉及命令结果的句子，都标明记录来自哪一天。

## 1. 上课时会碰到的限制

### 单机数据库

业务数据在一个 SQLite 文件里（容器内默认 `/data/educational_os.db`）。没有第二台热备会自动接管。进程崩溃后，compose 的 `restart: unless-stopped` 会再拉起；`docker stop` 和 `docker kill` 不会。磁盘满、卷只读或迁移失败时进程退出，全站不可用。

### 限流

实现在 `server/security/rate-limit.ts`，限额在 `server.ts` 里（未设置 `PLAYWRIGHT_TEST` 时）：

| 动作 | 限额 | 按什么分桶 |
| --- | --- | --- |
| 登录 | 每分钟 5 次 | 用户名或学号。学生登录读 `studentId` |
| 写请求 | 每分钟 60 次 | 客户端地址 |
| AI 请求 | 每分钟 10 次 | 客户端地址 |

同一间教室共用一个出口地址时，写请求会挤在一个桶里。登录桶按账号，不会因为别人猜错密码而锁住全班。直连公网时不要设置 `TRUST_PROXY`，否则客户端可以改 `X-Forwarded-For`，写请求的地址桶会被拆开。反代有几层，`TRUST_PROXY` 就要写几层；演练用的是一层 Nginx 配 `1`。

### 登录与口令

- 会话 Cookie 名 `edu_os_token`，HttpOnly、`SameSite=Lax`。绝对过期 7 天，空闲 24 小时（`server/middleware/auth.ts` 的 `getValidSession`）。
- 教师登录对未知用户名返回 `User not found`，对错误密码返回 `Incorrect password`（`server/routes/roster.ts`）。可以据此判断用户名是否存在。
- 学生个人口令在 bcrypt 之后，仍接受无盐 SHA-256 和与库存字符串相同的明文，匹配后升级为 bcrypt。新建学生走 bcrypt。存量明文行用该明文仍能登录。
- 学生个人口令仍是字面量 `123456` 时，会话带上必须改密。用班级临时口令登录不会因为这个字面量被要求改密。班级临时口令可以设置过期时间。它在库里是密文，细节见文末「不要再当成未修复缺陷」。
- Cookie 的 `Secure` 只在请求被判定为 HTTPS，或 `ENABLE_HTTPS=true` 时附加。HSTS 要 `ENABLE_HSTS=true`，或生产环境且 `FORCE_HTTPS=true`（`server.ts`）。明文 HTTP 的校内部署上，同一局域网可以窃听会话 Cookie。`.env.example` 没有列出这两个变量。

### 备注并不是只给教师看

名册导入的注释把 `private_notes` 写成教师私有备注（`src/services/bulkImportService.ts`）。学生查看自己的仪表盘时，`GET /api/students/:id/dashboard` 的 profile 查询包含 `private_notes`（`server/routes/roster.ts`）。学生会话可以读到写进该字段的文字。

教师端编辑器 `src/components/StudentPrivateNotesEditor.tsx` 用 `innerHTML` 和 `document.execCommand` 编辑这段 HTML。

### 学生可以自己把进度写成完成

`POST /api/students/:id/progress` 允许学生本人写入 `completed` 和 `progressPercent`。若有人把这个进度当成成绩或解锁条件，学生可以自行标完成。

### 白板代码运行

`src/features/whiteboard/widgets/CodeSandboxWrapper.tsx` 把白板里保存的代码交给浏览器 Worker 里的 `new Function`。这个 Worker 由页面创建，与页面同源，里面的 `fetch` 会带上登录 Cookie。能改白板代码块的人，可以让点击「运行」的人用自己的会话访问平台接口。隔离停在没有页面 DOM。公测公告已要求不要在代码块里放账号和未公开的学生信息。

### 课件与上传体积

`server.ts` 对所有路由使用 `express.json({ limit: '110mb' })`，解析发生在路由鉴权之前。业务上传上限是管理后台里的 1–90MB，挡不住这个解析器上限。仓库里的 Nginx 配置 `deploy/nginx/openlearn.conf` 与 `deploy/nginx/openlearn.host.conf` 把 `client_max_body_size` 也设成 `110m`。未登录客户端可以提交接近这个大小的 JSON。

### 头像可被匿名读取

`/uploads` 除 `/avatars/` 外要求有效会话。头像路径不校验会话。

## 2. 仍在代码里的安全与隐私缺口

这些不适合写进给教师的短公告，运维和作者要知道。

### AI 对话仍跟随重定向（审计 M-1）

`packages/core/ai/utils/fetch-with-retry.ts` 的 `fetchWithRetry` 使用裸 `fetch`，没有 `redirect: 'manual'`，失败时把响应体拼进错误信息。调用方包括对话、批改和课表。社区安装和「测试 AI 提供商」走的是另一条会复检跳转的路径。提供商 URL 只有管理员能改。公测不要把提供商地址指到不受控的服务。错误信息可能含上游响应片段，排障时不要把整段错误转贴到公开场合。

### 生产环境仍放行本机来源（审计 M-4）

`server.ts` 的 `isOriginAllowed`：Origin 的 host 与请求的 `Host` 头相同则放行；主机名为 `localhost`、`127.0.0.1`、`[::1]`、`0.0.0.0` 也放行，并设置 `Access-Control-Allow-Credentials: true`。生产环境没有关掉本机来源。应用若以 `localhost` 访问，同一主机其他端口的网页可以带着会话 Cookie 调用接口（Cookie 不区分端口）。`NODE_ENV !== 'production'` 时任意 Origin 放行。`ALLOWED_ORIGINS=*` 会改成不带凭证的 `*`。

对外域名请把 `ALLOWED_ORIGINS` 设成实际来源。本机来源的放行目前仍然生效。

### 插件静态文件无需登录（审计 M-5 的一部分）

`server.ts` 对 `/plugins` 使用 `express.static`，没有会话校验。插件源码可以被匿名拉取。管理接口本身要求登录。

### 已读通知不校验是不是本人（审计 M-5 的一部分）

`GET/POST /api/students/:id/read_notifications` 只要求已登录，不检查 `:id` 是不是当前用户。影响是已读标记，不是作业和成绩。

### 教师可以删除自己能看到的学生（审计 M-5 的一部分）

`DELETE /api/students/:id/gdpr-delete` 的注释写管理员专用。路由允许 `teacher` 与 `administrator`，教师还要通过 `teacherCanSeeStudent`。请求体要 `{ "confirm": true }`。删除函数的实际范围见隐私草稿：它不是全库删除。

### AI 密钥对教师显示首尾各 4 位（审计 M-6 的一部分）

`GET /api/ai-providers` 对教师和管理员开放。`server/utils/crypto.ts` 的 `maskApiKey` 保留首尾各 4 个字符。写入和删除提供商仍只要管理员。`decryptApiKey` 在字符串不是 `iv:tag:cipher` 三段时把原值当明文返回。空的 `ENCRYPTION_KEY=` 不会被改写。未设置时不再使用只活在内存里的临时钥匙：首次启动把随机 64 位 hex 写到 `storage/encryption-key`（权限 600），之后每次读取；启动日志和管理后台会警告应改设环境变量并离线备份该文件。环境变量与该文件不一致时拒绝启动。长度不是 64 位 hex 时启动报错，不再拖到加解密才失败。

### 第三方插件的网络

非 `@openlearn/` 且不在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 里的插件，会被改成子进程（`executionMode=process`）。Node 权限模型约束不了出站网络。这是演练记录里仍未关闭的风险。插件若拿到平台数据库句柄，可以读到学生数据。公测是否允许安装插件，由作者决定。

`manifest` 里的 `auth: false` 只表示申请公开。匿名访问还要管理员写入批准记录。源码安装成功后状态是 `installed`，不调用启用接口时路由返回 503。

### 删除与导出不是全库

见 [隐私草稿](privacy.md) 第 6 节。这里不重复表名以外的结论：`deleteStudentCascade` 与 `exportStudentData` 覆盖同一组业务表，不管课件尝试、积分、同伴互评、作业文件表、磁盘文件、`events` 和 `agent_conversations`。

## 3. 部署与工程上的限制

- **恢复依赖同一把 `ENCRYPTION_KEY`，或同一份 `storage/encryption-key`。** 库能起来，已存的 AI 密钥和班级口令密文解不开。`site-backup` 不含该密钥文件。演练记录已写明密钥必须与备份时一致。
- **AI 提供商种子失败只打日志。** `packages/core/db/index.ts` 里种子账号失败会拒绝启动；默认 AI 提供商插入失败被吃掉，进程继续。种子行的 `api_key` 是空字符串，不会自带可用模型。
- **生产镜像里没有 `fuser`。** `scripts/site-restore.mjs` 用 `fuser` 看库是否被占用。镜像只安装了 `wget` 和 `su-exec`（`Dockerfile`）。容器里这条检查可能看不到占用者。停服是操作者的责任。
- **没有定时备份。** 只有手工执行 `scripts/site-backup.mjs`。迁移前还会在备份目录写 `pre_migration_*.db`，那是数据库快照，不含课件文件包。
- **日志按大小轮转，不是按天。** 默认大约 60MB 访问日志、420MB 审计日志。更长的保留要在采集侧自己做。`LOG_REDACT` 默认开启。
- **CI 不跑 ESLint，也不跑 `pnpm build`。** 阻断的是类型检查、严格类型检查、Vitest、`pnpm audit --audit-level high`、公测旅程、浏览器课堂流程（仅 `e2e/lesson-classroom-flow.spec.ts`）、文档漂移和插件兼容。Windows 探测 job 失败不阻断合并。覆盖率 job 在测试失败时可能不产出报告，低于阈值也不会让该 job 失败。
- **README 徽章仍写 “1282 passed”。** 这是文档过期。审计日的 Vitest 是三千余条通过。不要用徽章数字对外介绍测试规模。
- **版本号仍是 0.6.1。** 演练没有切新标签。公测实例的「版本」在 `/health` 里会显示包版本。

审计日还记录了巨型前端模块和超过 500KB 的 chunk 警告（审计报告 M-10）。本次没有重跑构建，不引用当时的字节数当作今天的测量。课堂页体积大，弱网教室要有心理准备。

审计日 ESLint 为 0 error、5060 warning，且 ESLint 不在 CI。warning 数量今天可能已经不同。清单第 1 项要求的「0 error」没有被 CI 锁住。

## 4. 不要再当成未修复缺陷

2026-10-13 审计里的下列项，已经能在当前代码、演练或 CI 配置上对上。公测缺陷单请不要按旧报告原样重开。若现场仍能复现，按新问题上报，并写明请求和响应。

| 编号 | 当时的问题 | 现在能对上的事实 |
| --- | --- | --- |
| H-1 | 班级作业与成绩缺少对象级授权 | 班级仪表盘等接口调用 `authorizeClass`。公测旅程覆盖跨班拒绝。学生仪表盘不再返回 `class_passcode` |
| H-2 | 默认可伪造 IP 冲掉限流 | `resolveTrustProxy` 默认不信任转发头。登录桶按账号，含学号 |
| H-3 | 种子口令改密前仍能读数据 | 除改密、登出和会话查询外，`/api` 的 GET 也返回 403 `FORBIDDEN_DEFAULT_PASSWORD`。演练与公测旅程都断言过 |
| H-4 | 第三方插件默认在宿主进程 | 非内置插件安装、激活和恢复时改为 `process`。`auth: false` 还要管理员批准 |
| H-5 | SDK 的 `dist/` 不进构建与 CI | `pnpm install` 的 `prepare`、`pnpm build`、CI 和镜像都会构建 SDK |
| M-7 | 主 tsconfig 未开 strict，严格检查失败 | `tsconfig.json` 已设 `strict`、`noImplicitAny`、`strictNullChecks`。CI 的 `pnpm lint:strict` 失败即红 |
| M-9 | 依赖审计有 critical/high，且 CI 不阻断 | `CHANGELOG.md` 记录审计项已收到 0。CI 执行 `pnpm audit --audit-level high`，无 `continue-on-error`。起草时未重跑审计 |
| MED-04 | 班级临时口令明文落库，登录做字符串相等比较 | `classes.class_passcode` 为 AES-256-GCM（前缀 `olenc1:`）。登录解密后做常量时间比较。授权教师的口令接口返回原文，列表不返回该列。迁移 `023` 在启动时加密剩余明文行，已是密文的跳过。`site-backup` 的数据库快照是密文 |
| M-6 密钥回退 | 空的 `ENCRYPTION_KEY` 使用临时内存钥匙，重启后旧密文无法解密 | 未设置时持久化 `storage/encryption-key`（0600）。启动日志和管理后台警告应设置 `ENCRYPTION_KEY` 并离线备份该文件。环境变量优先；与文件不一致则拒绝启动。代码里没有默认密钥 |

审计报告第 3.4 节列出的「当时不成立」的项（前端包不含 AI Key、Cookie 为 HttpOnly、CSRF 门控、课件 iframe 沙箱等）没有在本次被推翻。那些句子描述的是审计当天的树；公测以本节和上文的开放项为准。
