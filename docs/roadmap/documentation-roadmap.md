# Documentation Roadmap 文档演进路线图

**Project**: OpenLearn V2
**Current Milestone**: `openlearn-next@0.2.7`（2026-08-31 发布）

> **平台开发目标请见 [v0.3.0+ 开发路线图](v0.3.0-roadmap)**（2026-08-30 审计产出，含 A/B/C/D 四阶段）。
> 本页专注**文档体系**自身的演进。

## 阶段状态

| Phase | 目标 | 状态 |
|---|---|---|
| **Phase 1 (v0.1.12)** | 全量 25 目录体系建设，0 Warning Sphinx 构建，对齐与升级白板多页隔离与积分审计体系 | ✅ 完成（v0.2.x 已覆盖 25+ 目录，构建仅剩 3 条非阻断 warning） |
| **Phase 2 (v0.2.0)** | 自动生成基于 TypeDoc 的 TypeScript 纯 API 交互式网页文档 | ⏳ **未实现**（排入 [v0.3.0 路线图 阶段B4](v0.3.0-roadmap.md)） |
| **Phase 3 (v1.0.0)** | 多语言国际化（英文/中文 双语 Sphinx 规范切换） | ⏳ **未启动**（排入 [v0.3.0 路线图 阶段C1](v0.3.0-roadmap.md)） |

## v0.2.x 文档交付记录（2026-07~08）

- **插件开发文档闭环**：`reference/activity-ecosystem.md`（活动生态）、`reference/capability-provider-framework.md`（能力框架）、`reference/platform-data-tables.md`（数据表）、`api/typescript-interfaces.md`（TS 接口索引）——补齐此前零覆盖的方法/接口/数据表说明。
- **版本同步**：conf.py → 0.2.5；SDK 引用 → 3.5.0；`engines.openlearn` → `^0.2.5` 全库统一。
- **发布日志**：新增 `release-notes/v0.2.4.md`、`v0.2.5.md`。
- **修复**：3 处失效 MyST 锚点（§2.5 多余围栏 + 重复 2.6 编号）、`plugin-sdk.md` Token 清单 13→28、积分结构体字段、失效行号。

## 文档维护机制（防漂移）

1. **行号引用失效检测**（计划 §B5）：CI 检查 md 中 `file.ts:NNN` 与 HEAD diff，失效即阻断 PR。
2. **过期报告自动标注**：审计类文档（如 `architecture/platform-foundation-audit-report.md`）已加"⚠️ 已过时"banner，未来归档到 `architecture/_archive/`。
3. **版本对齐规则**：docs 中的平台/SDK 版本号以 `package.json` 为准，发布时同步更新（`docs/conf.py` + release-notes + index toctree）。

> 最后更新：2026-08-30
