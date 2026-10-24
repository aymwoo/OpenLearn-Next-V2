# 公测准备材料

日期：2026-10-14。平台版本仍是 `openlearn-next@0.6.1`，这次没有打新的发布标签。

这套材料给公测使用。教师公告、已知问题、反馈流程、隐私草稿和运营手册都在本目录。上线当天仍按 [公测上线检查清单](../deployment/production-guide.md#4-公测上线检查清单) 操作；各项完成情况写在该清单的 [4.1 节](../deployment/production-guide.md#41-清单状态2026-10-14)。

| 文档                                      | 读者                       | 用途                                     |
| ----------------------------------------- | -------------------------- | ---------------------------------------- |
| [公测说明与教师招募公告](announcement.md) | 学校教师                   | 功能范围、限制、数据怎么处理。发布前填空 |
| [已知问题与限制](known-issues.md)         | 运维、作者、需要细节的教师 | 只写当前代码和审计、演练对得上的事实     |
| [反馈与问题上报](feedback.md)             | 教师、运维                 | 学校内部怎么报，什么时候开 GitHub Issue  |
| [隐私与学生数据说明（草稿）](privacy.md)  | 学校、法务、运维           | 草稿。标出必须由学校或法务确认的句子     |
| [公测运营手册](operations.md)             | 运维                       | 上线前检查、监控看什么、停服后怎么恢复   |

仓库里的 Issue 表单：

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`

## 清单里还没做完的

仓库和演练已经具备的，不在这里重复。下面这些还不能打勾。完整对照表在生产指南 4.1 节。

1. **目标环境的当次构建。** CI 会阻断 `pnpm lint`、`pnpm lint:strict`、`pnpm test`、`pnpm audit --audit-level high` 和 `Public beta journey`。清单第 1 项还要求 `pnpm lint:eslint`（0 error）和当次 `pnpm build`。这两条不在 CI 里。2026-10-14 的演练用仓库 `Dockerfile` 构建过镜像。ESLint 最近一次有记录的结果在 [审计报告](../AUDIT_REPORT.md)（2026-10-13：0 error、5060 warning）。起草本目录时没有重跑 ESLint、`pnpm build` 和 `pnpm audit`。
2. **`ENCRYPTION_KEY`。** 目标环境要自己生成 64 位 hex，设成环境变量并离线备份。空着不会拒绝启动，也不再使用临时内存钥匙：首次启动写入 `storage/encryption-key`（权限 600，与 `bootstrap-credentials.txt` 同目录），之后每次读取。启动日志和管理后台会警告正在使用自动生成的密钥。环境变量与该文件不一致时进程报错退出。
3. **种子口令。** 强制改密在演练和公测旅程里通过了。目标机器上的 `OPENLEARN_ADMIN_PASSWORD`、`OPENLEARN_TEACHER_PASSWORD`、删除 `storage/bootstrap-credentials.txt`、确认没有 `PLAYWRIGHT_TEST`，都还没做。
4. **数据卷、反代、证书、健康检查的现场确认。** compose 与演练已经按 `/data`、`/backups` 跑通。目标机的卷、Nginx、`TRUST_PROXY` 跳数、`docker inspect` 的 Health，要在那台机器上再看一次。`docker-compose.yml` 的 `app` 服务发布了 `9000:9000`；启用 `proxy` profile 时，公网只应暴露 Nginx。
5. **日志字段的现场抽查，以及是否接入 GlitchTip。** 代码和公测旅程覆盖了指标鉴权，并确认那次测试作答没有进 `audit.log`。目标环境仍要抽一条 `http.request`。`SENTRY_DSN` 留空可以启动。
6. **从 v0.6.1 升级还是空库开新。** 演练做过升级和 `scripts/backfill-class-owners.mjs`。空库不需要回填。两条路都还没在公测机器上选定。
7. **备份的周期和异地副本。** `scripts/site-backup.mjs` 与 `scripts/site-restore.mjs` 在演练里做过一次停服恢复。compose 没有定时任务，也没有把 `/backups` 拷到另一台机器的步骤。
8. **只读卷失败演练在目标机上是可选的。** 演练已经看到 `[Startup] FATAL`。卷权限如果不确定，上线前再做一次。

## 须作者本人决定

这些不能从代码里填上。公告和隐私草稿里用 **【待填写】** 或 **【待学校/法务确认】** 标出。

- 公测由谁托管，网址、起止日期、名额、每日可用时段、停机怎么通知。
- 面向哪些学校、哪些学科、大约多少教师和学生。
- 教师反馈找谁（姓名、邮箱或即时通讯）。响应时限。学生是否允许直接联系运维。
- 教师能否登录本 GitHub 仓库开 Issue，还是只由运维代开。
- 是否在公测启用 AI。若启用，用哪一家 OpenAI 兼容服务，学生作业和姓名能否进入提示词。
- 是否允许管理员安装社区插件或 ZIP。社区注册表安装默认关闭。第三方插件默认进子进程，原始出站连接默认拒绝。
- 是否允许班级临时口令。口令在 `classes.class_passcode` 里是 AES-256-GCM 密文（前缀 `olenc1:`），`site-backup` 的数据库快照也是密文。授权教师的接口仍显示原文。密钥文件要单独备份。
- 公网是否强制 HTTPS，以及是否设置 `ENABLE_HSTS` 或 `FORCE_HTTPS`。
- 是否把 Windows 本机安装算进公测支持范围。CI 的 Windows 探测 job 是 `continue-on-error`。
- 是否在开放前打一个新版本标签。当前包版本是 0.6.1。
- 隐私草稿里每一条 **【待学校/法务确认】**，包括谁是个人信息处理者、保存多久、家长告知、以及现有删除接口算不算学校要的删除。
