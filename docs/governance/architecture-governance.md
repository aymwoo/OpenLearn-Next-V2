# Architecture Governance & Policies 架构治理

规范 Platform Kernel 的模块演进机制、Capability 网关三级防线与第三方插件代码沙箱审核标准。同步于 v0.3.22；安全细节的权威页面为 [security-permissions](../architecture/security-permissions) 与 [security-remediation-report](../architecture/security-remediation-report)。

---

## 1. Capability 网关三级防线

第三方插件发起的每个命令（`commandBus.execute`）依次经过：

| 层级 | 机制 | 实现 | 拦截效果 |
| --- | --- | --- | --- |
| ① 命令级权限 | `CapabilityGuard` 校验 `ActionDescriptor.capabilityRequired`（如 `lesson:write`） | `packages/core/capability-system/` + `packages/core/registry/` | 无权限抛 `PERMISSION_DENIED`；角色默认授权矩阵见 [capability-matrix](../reference/plugin-capability-matrix) |
| ② 高危审批闸门 | `isHighRisk: true` 的动作不直接执行，进入 Approvals Gateway 待教师/管理员批准 | `server/routes/os.ts` 的 pending commands 流程 | 未批准前命令停在 pending 状态 |
| ③ 插件能力网关 | `PluginCapabilityGateway` 统一能力发现/解析/执行，宿主只授予 `capabilitiesProposed` 中声明的字符串 | `packages/core/plugin-host/plugin-capability-gateway.ts` | 未声明的能力无法获得（例：`lesson:control` 未声明则 `startActivity` 被拒） |

## 2. 插件沙箱审核标准

插件代码在安装与激活时被多层机制约束：

1. **静态导入扫描（token-enforcer）**：上传 ZIP 后，esbuild 自定义插件 `openlearn-token-enforcer` 扫描入口文件，**只允许相对导入与 `@openlearn/*` 导入**，其余裸 specifier（含 Node 内置模块）直接拒绝（见 [tutorial §11.4](../tutorials/plugin-development-tutorial)）。
2. **共享模块白名单**：运行时 `ctx.require()` 只放行白名单（`recharts` / `react-markdown` / `jspdf` / `jspdf-autotable` / `exceljs` / `lucide-react` / `uuid`）。
3. **SQL 注入防护**：插件自建表 `ensureTable` 的表名/schema 强制校验（标识符正则、≤4000 字符、禁分号），详见 [plugin-database-api](../reference/plugin-database-api)。
4. **Worker 隔离**：默认 Worker Thread 模式运行，插件与宿主仅经结构化克隆 RPC 通信；inline 模式为受控例外。
5. **HTTP 网关纵深防御**：插件 RESTful 端点统一挂载 `/api/plugins/:pluginId/*`，经 `plugin-api-gateway`（鉴权、角色白名单、限流、响应头清洗、body ≤ 1MB）。
6. **出站请求校验**：涉及远端 URL 的操作（插件更新、社区市场、AI Provider 连通性测试）统一经 `server/utils/url-safety.ts` 的 `isSafeExternalUrl` SSRF 防护。

## 3. 模块演进机制

- 内核子系统（`packages/core/*`）与插件（`packages/plugins/*`、`v2_plugins/*`）分层演进：内核 API 变更须同步 `@openlearn/plugin-sdk` 类型（版本随平台发布）；
- 文档↔代码一致性由 `audit-tools/` 三脚本 + CI `docs-drift-audit` job 守护（见 [docs-drift-audit](../developer-guide/docs-drift-audit)），提交钩子自动运行；
- 破坏性变更记录于 `CHANGELOG.md`（平台）与 `packages/plugin-sdk/CHANGELOG.md`（SDK），迁移路径见 [version-migration](../migration/version-migration)。
