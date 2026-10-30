# 审计归档（Audit Archive）

本目录保存**带日期的审计、演练与同步快照**。它们记录的是某一时点的发现、处置和残余风险，**不是当前事实**。

引用前请注意：

- 每篇文档的对象版本与日期见下表。文中提到的文件路径、行号、计数、配置项都可能已变化。
- 需要"现在是什么样"时，请查对应的权威页面（见「现行权威页面」一节），或直接读源码。
- 这些文档只做归档，不再随代码更新。发现问题请在 PR 中修当前实现，不要回改历史快照。

## 归档清单

| 文档                                                                                         | 日期                    | 对象 / 基线                     | 内容                                        |
| -------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------- | ------------------------------------------- |
| [AUDIT_REPORT.md](AUDIT_REPORT.md)                                                           | 2026-10-13              | `openlearn-next@0.6.0`          | 全系统结构梳理与代码审计（首轮基线）        |
| [PLUGIN_AUDIT_REPORT.md](PLUGIN_AUDIT_REPORT.md)                                             | 2026-10-14              | `@0.6.1`                        | 插件子系统专项审计，PL-01～PL-08 的修复记录 |
| [trust-boundary-hardening-audit-2026-10-14.md](trust-boundary-hardening-audit-2026-10-14.md) | 2026-10-14              | `main@9244703`                  | 插件信任边界与部署链路加固，含残余风险清单  |
| [classroom-time-flow-audit.md](classroom-time-flow-audit.md)                                 | 2026-09-30              | —                               | 上课时间流（教师端 → 学生端）事件链路走查   |
| [whiteboard-realtime-sync-audit.md](whiteboard-realtime-sync-audit.md)                       | 2026-09-30 / 10-03 复核 | —                               | 白板实时同步通路；触发随机点名不同步问题    |
| [course-import-audit.md](course-import-audit.md)                                             | 2026-10-21              | —                               | 课程导入（CSV / 课程包）流程审计            |
| [security-remediation-report.md](security-remediation-report.md)                             | 2026-09-25              | `@0.3.21`                       | 安全审计与修复（SEC-01～SEC-17）            |
| [DEPLOY_REHEARSAL.md](DEPLOY_REHEARSAL.md)                                                   | 2026-10-14              | `main@cc0b56e`（对照 `v0.6.1`） | 公测上线演练记录与镜像验证                  |

## 已清理的快照

以下文档的结论已被现行文档或代码取代、且没有外部引用，已于 2026-10-27 从工作区移除。需要查历史时按文件名从 git 历史恢复：

```bash
git log --diff-filter=D --oneline -- docs/
git show <commit>^:docs/architecture/platform-foundation-audit-report.md
```

- `architecture-synchronization-report.md`（架构同步快照）
- `navigation-audit-report.md`（2026-07-24 导航审计）
- `platform-foundation-audit-report.md`（2026-07-24 平台基础审计）
- `plugin-documentation-report.md`（2026-07-30 插件文档审计）
- `ai-documentation-report.md`（AI 文档同步状态）
- `sync-report.md`（2026-07-24 文档结构报告）
- `broken-reference-report.md`（链接检查快照）

## 现行权威页面

| 主题             | 当前权威页面                                                                     |
| ---------------- | -------------------------------------------------------------------------------- |
| 安全与权限模型   | [architecture/security-permissions](../architecture/security-permissions.md)     |
| 插件信任边界     | [reference/plugin-trust-boundary](../reference/plugin-trust-boundary.md)         |
| Plugin SDK Token | [api/di-tokens](../api/di-tokens.md)                                             |
| UI 扩展槽位      | [reference/plugin-ui-extension-slots](../reference/plugin-ui-extension-slots.md) |
| 部署与上线检查   | [deployment/production-guide](../deployment/production-guide.md)                 |
| 版本变更         | [release-notes](../release-notes/v0.7.8.md) 与根目录 `CHANGELOG.md`              |

## 未归档的报告型文档

以下页面名字像报告，但内容是**当前生效的规则或流程**，因此保留在正式文档区：

- [developer-guide/docs-drift-audit](../developer-guide/docs-drift-audit.md)：文档漂移门禁的**操作规范**，说明新增 subsystem 时必须同步更新哪些页面。
- [api/api-coverage-report](../api/api-coverage-report.md)：数字由脚本统计、可随代码复算，按版本校准后作为覆盖度参考。

```{toctree}
:hidden:

AUDIT_REPORT
DEPLOY_REHEARSAL
PLUGIN_AUDIT_REPORT
classroom-time-flow-audit
course-import-audit
security-remediation-report
trust-boundary-hardening-audit-2026-10-14
whiteboard-realtime-sync-audit
```
