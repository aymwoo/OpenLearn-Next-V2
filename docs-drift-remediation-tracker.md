# 文档漂移修复跟踪台账

> 状态：**门禁全绿（drift_count=0）** ｜ 建立日期：2026-10-03 ｜ 最后更新：2026-10-03（第二轮） ｜ 关联审计报告：[`docs-drift-audit-2026-10-03.md`](docs-drift-audit-2026-10-03.md)
>
> 本文件是 2026-10-03 文档 vs 代码全量审计（129 篇）后续修复的**待办总入口**。
> 机器可读版本由 `audit-tools/refchecks.py` 的「待复核横幅台账」自动生成：
> `bash audit-tools/run.sh` → `audit-tools/reports/ref_report.md`。**两者不一致时以工具输出为准。**

---

## 维护规则（重要）

1. 文档顶部带 `<!-- drift-banner: YYYY-MM-DD -->` 标记 + `⚠️ 内容待复核` 横幅，表示**内容已知与代码不符但尚未修复**。
2. 横幅**不算 drift**（内容已如实警示读者），但它是本台账的来源，**必须保持可见**。
3. **修好内容后，必须连同横幅与 HTML 标记一起删除。** 否则横幅会与已修正的内容冲突，读者会误以为已修好的内容仍有问题。
4. 修完后跑 `bash audit-tools/run.sh`，确认「待复核横幅台账」的篇数下降，且没有新增 `MISSING` 路径或断链。

---

## 当前状态

| 指标 | 数值 |
| --- | --- |
| 文档总数 | 123 篇 |
| 带待复核横幅 | **0 篇** ✅ 全部修完并摘除 |
| 重复文档组 | 0 |
| 失效文档内链 | 0 |
| 失效路径引用 | 0 |
| canonical drift | **0** ✅ |

---

## 阶段一：会产出错误代码的高危项 —— ✅ 已全部完成

| 项 | 状态 |
| --- | --- |
| 教程 `db.table()` 前缀语义写反（inline=UUID / worker=manifestId） | ✅ |
| 分析引擎 `HighLevelIndicators` 字段不符（3 → 9 字段） | ✅ |
| DI 文档 Token 示例**运行即抛** `TokenError` | ✅ |
| 认证被描述成 JWT（实为不透明会话表） | ✅ |
| `plugin-database-api.md` 页内自相矛盾 + 交叉引用指错 | ✅ |

## 阶段二：站点结构 —— ✅ 已全部完成

| 项 | 状态 |
| --- | --- |
| 24 个 toctree 块的 `:hidden:` 全量删除（侧栏 0 → 724 条链接） | ✅ |
| 2 篇游离文档收编进 toctree | ✅ |
| 删除 `docs/core/` 5 篇重复文档 | ✅ |
| 3 组跨目录重复归并（lesson / workspace / whiteboard 拆分为 3 份职责文档） | ✅ |
| 文档内链失效清零 | ✅ |

## 阶段三：已重写的高引用文档 —— ✅ 已全部完成

按被引用热度排序，4 篇全部以代码为唯一真源重写，**0 处裸行号引用**。

| 文档 | 原引用数 | 状态 |
| --- | --- | --- |
| `architecture/platform-kernel.md` | 8 | ✅ 重写 |
| `reference/plugin-ui-extension-slots.md` | 6 | ✅ 重写 |
| `architecture/capability-gateway.md` | 5 | ✅ 重写 |
| `reference/plugin-capability-matrix.md` | 5 | ✅ 重写 |

## 阶段四：行号引用迁移 —— 部分完成

规范类文档已迁移完毕；**审计快照与 roadmap 中的行号按决策保留**（它们是有日期的历史记录，行号在其中是合理的历史定位）。

| 文档 | 处数 | 状态 |
| --- | --- | --- |
| `api/di-tokens.md` | 29 | ✅ 已迁移为「路径 + 符号名」 |
| `reference/plugin-host-shared-deps.md` | 3 | ✅ |
| 审计快照 / roadmap | 约 56 | ⏸ 按决策保留 |

---

## 阶段五：待复核横幅台账

### 5.0 ✅ 第一批已修完（横幅已摘除）

`api/courseware-attempts-contract`、`api/whiteboard-event-slot-contract`、
`reference/platform-data-tables`、`plugin/plugin-documentation-report`、
`deployment/docker-nginx`、`administrator-guide/admin-manual`、
`migration/version-migration`、`sdk/plugin-sdk`、`getting-started/installation-guide`

其中三篇从占位/极短扩写为实质内容：`admin-manual` 3→353 行、`docker-nginx` 12→225 行、
`version-migration`→249 行。文档内链由 94 增至 119 条。

### 5.1 ✅ 第二批（9 篇中低引用）已修完

`lesson/lesson-lifecycle`、`lesson/lesson-runtime`、`plugin/plugin-architecture`、
`architecture/database-and-migrations`、`api/typescript-interfaces`、
`architecture/presence-collaboration`、`architecture/layer-topology`、
`architecture/command-event-bus`、`analytics/learning-analytics-engine`

其中 `lesson-lifecycle` 完全重写（按真实 `LessonStatus` 六态与迁移表），
`layer-topology` 重建（29 个 `public readonly` 属性全部归层）。

### 5.2 ✅ 第三批（7 篇高引用）已修完

`architecture/security-permissions`（RBAC 矩阵 + 前后端三道沙箱门禁全面重写）、
`api/di-tokens`（14 处行号全部改为路径+符号；签名纠正为真实联合类型）、
`architecture/bootstrap-pipeline`（**删除虚构的五阶段叙事**，按真实空壳 stage 重写）、
`architecture/composition-root`、`plugin/plugin-lifecycle`、
`whiteboard/canvas-object-model`、`whiteboard/whiteboard-runtime`

**横幅台账归零。**

---

## 阶段六：剩余 2 条 canonical drift —— ✅ 已消解

| 项 | 根因 | 状态 |
| --- | --- | --- |
| `observability` MISSING_IN_DOCS | `packages/core/observability/` 确无任何文档 | ✅ 新增 `docs/architecture/observability.md` |
| `configuration` MISSING_IN_CODE | **`packages/core/configuration/` 已于 `207ca36`（2026-10-01）作为死子系统整体删除**（12 文件 ~1190 行，无生产消费方）。文档重写后如实记录"平台没有集中配置子系统"，反而是工具的硬编码映射在断言一个已死的子系统 | ✅ 移除 `extractors.py` 中的 `configuration` 映射 |

---

## 阶段七：按决策暂缓（待排期）

| 项 | 决策 | 备注 |
| --- | --- | --- |
| 发布记录三载体缺口 | 暂缓 | 0.3.19/0.3.20 缺 release-notes；0.2.9 与 0.3.23 缺 tag |
| `v0.2.3` SDK 版本自相矛盾 | 暂缓 | v0.2.0 写升 3.5.0，v0.2.3 写"保持 ^3.4.3"，v0.2.4 又写 3.5.0 |
| `v0.3.15` 声称交付不存在的插件 | 暂缓 | `@openlearn/plugin-lti-provider` 在 `packages/` 下不存在 |
| `CHANGELOG.md` 格式问题 | 暂缓 | `:1888` 日期为 `2025`（全文件唯一非 `YYYY-MM-DD`）；`:5` 括号未闭合 |
| 审计快照/roadmap 的行号 | 保留 | 有日期的历史记录，行号是合理的历史定位 |

---

## 阶段八：代码侧待办（非文档问题）

| 项 | 说明 | 状态 |
| --- | --- | --- |
| `CapabilityLogger` 无限量无脱敏存 AI 载荷 | 完整 prompt/completion 存内存、上限缺失、TTL 缺失、生产零消费者 | ✅ 已改为有界环形缓冲(200) + 30min TTL + 默认只存形状摘要；14 项新测试 |
| 数据库灾备不闭环 | 有 `db:backup` 但无恢复脚本 | ✅ 新增 `npm run db:restore`（校验 + 安全副本 + 退出码），已用真实备份端到端验证 |
| 容器日志丢失 | `docker-compose.yml` 未挂 `/app/logs` | ✅ 已补 `logs_data` 卷 |
| 裸 `console.*` 绕过 pino（203 处） | 已核实**未泄露凭据值**（`api-key-crypto.ts` 只打印事件不打印值）；属一致性问题 | ⏸ 未改（低优先级） |
| 日志无脱敏兜底 | 全仓 `redact` 命中 0 | ✅ 已加 12 字段脱敏 + 10MB×5 轮转，零新增依赖（18 项测试） |
| Barrier 3 缺失 | `IFrontendAPI` 任意声明即可全 API 写 | ✅ 已加方法/路径级门禁（`method-policy.ts`，33 项测试） |
| 发布说明自相矛盾 | v0.2.3 SDK 版本、v0.3.15 仓库归属 | ✅ 已加勘误与归属说明 |

| 项 | 说明 | 状态 |
| --- | --- | --- |
| 前端插件 Token 白名单 | 后端 `e731239` 已修，前端 `src/plugin-host/` 当时未同步 | ✅ 已补（Barrier 1 + 9 项测试） |
| `tsc` 扫进 gitignore 的 `plugins/` | 与金丝雀测试并发时报 `TS6053` | ✅ 已加 `exclude: ["plugins"]` |
| `activateWorkerPlugin` 不传 `capabilitiesProposed` | 导致 Barrier 2 把所有 worker 插件限制为只读 | ✅ 已打通数据链（`server/routes/plugins.ts` → `FrontendPluginInfo` → manifest），12 项新测试 |
| Barrier 2 现为"自声明"信任 | 基础白名单含 `IFrontendAPI`（任意 path 的同源 fetch），任一声明即可解锁全部用户会话 API | ⏸ **待决策**（见下） |

### 8.1 待决策：Barrier 2 放宽后的加固建议

已核实：插件安装的全部入口（`/api/plugins`、`/api/plugins/upload-zip`、`/api/plugins/install-from-url`、删除/切换/一键更新）**均为 `requireAuth('administrator')` 专属**。因此插件本就是管理员显式安装的可信代码，**未跨越信任边界**，但纵深防御确有削弱。建议后续（按需）：

- `IFrontendAPI` 默认仅允许 `get`；`post`/`del` 需专门 capability（如 `api:write` / `api:admin`）
- `IFrontendAPI` 需**按路径前缀**门禁（`post('/api/grade-sync')`、`del('/api/plugins/x')` 会绕过任何纯方法名规则）
- `ISemesterGradeService` 需 `grades:write` 专属 capability（`grades:read` 不应解锁写入）
- `ISocketService.disconnect()` 对 worker 一律拒绝（无正当理由让插件杀掉课堂 socket）
