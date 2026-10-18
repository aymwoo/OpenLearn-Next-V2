# 公测隐私与学生数据说明（草稿）

日期：2026-10-14。版本 `openlearn-next@0.6.1`。

**这是草稿，不是已经生效的隐私政策，也不是法律意见。** 标了 **【待学校/法务确认】** 的句子，在学校书面确认之前不能发给家长或学生。软件仓库不代替学校做告知同意。

公测若由学校自己的服务器运行，处理学生个人信息的是学校，不是 GitHub 上的代码仓库。**【待学校/法务确认】处理者、受托人、以及软件作者在这次公测里算不算受托处理。**【待填写：学校全称、服务器所在地、联系人】

## 1. 系统里实际会保存的学生相关数据

以下来自当前库表和接口，不是计划中的功能。

| 数据 | 放在哪里 | 谁写入 |
| --- | --- | --- |
| 姓名、学号、邮箱、头像、登录口令的哈希、名册备注 `private_notes` | 表 `students` | 教师或管理员创建、导入 |
| 班级成员关系 | 表 `class_students` | 教师或管理员 |
| 班级临时口令（AES-256-GCM 密文，前缀 `olenc1:`） | 表 `classes.class_passcode` | 教师或管理员。教师读取口令的接口解密后显示原文。登录先解密，再做常量时间比较。启动时把仍是明文的旧行加密 |
| 作业正文与学生提交（含 `content`）、分数、反馈 | 表 `assignments`、`assignment_submissions` | 教师布置，学生提交，教师批改 |
| 课时进度、完成标记 | 表 `student_lesson_progress` | 服务端事件，也可由学生本人调用进度接口写入 |
| 出勤 | 表 `attendance` | 课堂点名相关流程 |
| 考试成绩、学期报告 | 表 `exam_scores`、`student_semester_reports` | 教师或管理员 |
| 课堂点名记录 | 表 `student_rollcalls` | 教师 |
| 插件作业提交、同伴互评 | 表 `plugin_submissions`、`plugin_peer_reviews` 等 | 取决于已启用的插件 |
| 课件文件、上传文件 | 数据目录 `storage/`、`uploads/` | 教师上传为主。头像在 `/uploads/avatars/`，该路径不校验登录 |
| AI 对话的角色与正文 | 表 `agent_conversations` | 使用 AI 的教师（及能调用该接口的会话） |
| 登录会话 | 表 `client_sessions` | 登录时写入。Cookie 为 HttpOnly |
| 内核事件 | 表 `events` | 平台自动写入 |
| 访问日志与安全审计 | `openlearn.log`、`audit.log`（compose 在 `/data/logs`） | 平台自动写入。字段含用户 ID、路径、状态码、耗时。设计上不写口令、Cookie、班级口令和学生作答 |

邮箱是否收集，取决于建档时有没有填。系统没有单独的「家长手机号」「家庭住址」「身份证号」字段。**【待学校/法务确认】学校是否禁止教师把这类信息写进备注、作业或 AI 对话。**

名册备注在导入说明里写成仅教师可见。学生打开自己的仪表盘时，接口仍返回 `private_notes`。详见 [已知问题](known-issues.md)。

## 2. 数据放在哪台机器上

默认部署把数据库和文件放在学校（或学校指定的托管方）控制的磁盘上：容器卷 `/data` 与备份卷 `/backups`。代码仓库不会自动把数据库同步到软件作者。

**【待学校/法务确认】**

- 服务器物理位置或云区域是否在学校要求的范围内。
- 托管方的人员能否登录这台机器。机器登录权限等于能读取全部数据库和备份，包括班级口令密文和 AI 密钥密文。解开这些密文还需要同一把 `ENCRYPTION_KEY`，或数据目录里的 `storage/encryption-key`。`site-backup` 不打包该密钥文件。
- 备份是否允许拷到另一台机器，那台机器在哪里，谁可以下载。

## 3. 谁能在系统里看到什么

角色是 `administrator`、`teacher`、`student`。

- 管理员可以管理用户、插件、AI 提供商和站点设置。
- 教师默认管理自己有归属的班级（`classes.owner_user_id`）。从旧版本升级后，空归属的班要管理员用 `scripts/backfill-class-owners.mjs` 指定教师，否则原教师列表里看不到该班。
- 学生可以看自己的仪表盘、自己的作业和进度。公测旅程覆盖了跨班读取被拒绝。
- 同一班的作业聚合、提交和成绩在班级仪表盘上。该接口要求工作人员身份并校验班级归属。不要向学生承诺「同学之间绝对看不到任何提交」——若有插件或导出文件把数据带出，以该插件和文件为准。
- 任意已登录用户可以读写任意学生的「通知已读」标记。这不是成绩。
- 教师可以看到每个 AI 提供商密钥的前 4 位和后 4 位。完整密钥的写入限于管理员。密钥在库里用 `ENCRYPTION_KEY` 做 AES-256-GCM。历史明文密钥会被原样拿去掩码和调用。

**【待学校/法务确认】公测教师是否都允许看到本班全部提交和分数。有没有任课教师以外的人需要账号。**

## 4. 什么时候数据会离开这台服务器

不配置下列功能时，平台不因为这些功能对外连接。

### AI

管理员在后台填写的提供商地址，会收到对话请求。请求使用解密后的密钥。对话正文会先写入 `agent_conversations`，再发往该地址。失败响应的文本可能进入错误信息。

热路径会跟随 HTTP 重定向（见已知问题）。提供商 URL 只有管理员能改。

默认种子的 DeepSeek 与 Minimax 行没有 API Key，不会凭空开始上传。

**【待学校/法务确认】**

- 公测是否允许启用 AI。
- 允许的服务商名称、其隐私政策、数据是否用于训练。
- 教师能否把学生作业、姓名、学号放进对话。建议在确认前，公告要求不要粘贴。

### 错误报告

设置 `SENTRY_DSN` 或 `OPENLEARN_ERROR_DSN` 后，未捕获异常、路由 5xx 和浏览器运行时错误会发到该地址（兼容 Sentry 的自建 Sentry 或 GlitchTip）。上报前按字段名和凭据形态脱敏，去掉口令、Cookie、会话、班级口令、学生作答和请求体。留空则不外连。DSN 只在服务端。

**【待学校/法务确认】是否启用、接收端由谁管理、保留多久。** 公测可以不启用。

### 插件

管理员安装的第三方插件默认在子进程里运行。原始出站连接默认关闭，HTTP 只经宿主代理访问已批准的域名。插件只能按管理员确认过的能力读取数据。匿名访问的 URL 必须再经管理员批准。社区注册表安装默认关闭。

**【待学校/法务确认】公测允许的插件清单。未在清单上的，建议不要装。**

### 浏览器

教师和学生的浏览器会保存会话 Cookie。用学校域名且全程 HTTPS 时，应同时让 Cookie 带 `Secure`（由 HTTPS 或 `ENABLE_HTTPS` 触发）并考虑 HSTS。明文 HTTP 时 Cookie 可在同一局域网被窃听。见已知问题。

### 5. 保存多久与数据保留策略

系统在 `packages/core/db/retention-policy.ts` 中内置了多类别数据保留与定期清理策略（Issue #145）。服务启动与数据库就绪时会自动执行超期数据清理，各类别支持通过环境变量独立配置保留天数（设置为 `0` 表示禁用清理）：

| 数据类别 | 对应表名 | 默认保留天数 | 环境变量配置项 |
| --- | --- | --- | --- |
| 总线事件 | `events` | 90 天 | `OPENLEARN_EVENT_RETENTION_DAYS` |
| 考勤流水 | `attendance` | 365 天 | `OPENLEARN_ATTENDANCE_RETENTION_DAYS` |
| 点名记录 | `student_rollcalls` | 180 天 | `OPENLEARN_ROLLCALLS_RETENTION_DAYS` |
| 已读通知标记 | `student_read_notifications` | 30 天 | `OPENLEARN_NOTIFICATIONS_RETENTION_DAYS` |
| 客户端会话 | `client_sessions` | 30 天 | `OPENLEARN_SESSIONS_RETENTION_DAYS` |

**核心名册、班级与作业数据**：
数据库中的 `students` 核心名册、班级关系与正式作业提交等业务数据不会被保留策略自动删除，将一直保留直至管理员/教师手动删除或触发 GDPR 级联删除。

**【待学校/法务确认】**

- 公测结束后保留、导出还是删除。
- 保留期限，以及谁有权在期限前删除。
- 日志和备份是否适用同一期限。备份里的班级口令是当时的密文，另含全部作业。密钥文件不在 `site-backup` 里，要单独保管；没有这把钥匙，备份里的口令和 AI 密钥都解不开。

## 6. 导出和删除实际做了什么

教师或管理员可以调用：

- `GET /api/students/:id/export`：导出该生数据。管理员可导出任意学生；教师限于 `teacherCanSeeStudent` 能看到的学生。
- `DELETE /api/students/:id/gdpr-delete`：请求体 `{ "confirm": true }`。注释写管理员专用，代码允许能看到该生的教师。

两者都走 `server/services/roster-service.ts`：

1. **单事务级联清理表集**：
   `class_students`、`student_lesson_progress`、`assignment_submissions`、`attendance`、`exam_scores`、`student_semester_reports`、`student_rollcalls`、`plugin_submissions`、`plugin_peer_reviews`（按 `reviewer_id`）、`student_seats`、`student_read_notifications`、`student_point_logs`（已纳入级联事务），以及 `students` 行本身。
2. **调度插件扩展数据钩子**：
   - 导出时：并发调用活跃插件的 `onStudentExport(studentId)` 钩子（支持 Worker 隔离插件异步 RPC），汇总为 `pluginData` 随报告导出。
   - 删除时：并发调度活跃插件的 `onStudentDelete(studentId)` 钩子清理插件私有状态，并在安全审计中记录 `student.gdpr_deleted`。
3. **数据脱敏**：导出里的口令字段统一脱敏为 `[REDACTED]`。

这次删除仍**未**清掉的系统级内容包括：

- `courseware_attempt`（课件答题过程快照，后续规划独立清理策略）
- 课堂同伴互评相关表（迁移 `migrations/009_classroom_peer_review.sql` 中的 `classroom_peer_reviews` 等）
- `plugin_assignment_files` 以及磁盘上的课件、上传文件
- `agent_conversations`、`events`（受数据保留策略 90 天清理覆盖）、访问日志、已有备份

**【待学校/法务确认】这个范围能否回答家长的删除或导出要求。** 在确认之前，公告和界面都不要写成「已满足 GDPR」或「已彻底删除」。接口路径里的 `gdpr` 是代码里的名字，不是合规结论。

普通的 `DELETE /api/students/:id` 同样调用 `deleteStudentCascade`，范围与上面相同。

## 7. 公测开始前建议学校做的决定

1. 书面指定处理者和联系人。
2. 决定学生账号由谁创建、初始口令怎么交到学生本人、交完后教师是否还保留明文。
3. 决定是否使用班级临时口令。使用的话，写明它是全班共用。库和 `site-backup` 里这一列是密文，授权教师的接口仍显示原文。知道口令的人仍可以学生身份进入。
4. 决定 AI、错误报告、插件三者各自开或关。
5. 决定公测结束时的数据去向，并告知教师不要把本系统当唯一成绩档案。
6. 若面向未成年人，**【待学校/法务确认】告知家长的文本、同意方式、以及不满十四周岁的处理规则。** 软件本身没有年龄字段，也无法替学校完成告知。
