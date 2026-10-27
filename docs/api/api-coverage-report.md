# API Coverage Report API 覆盖率报告

**Project**: OpenLearn V2
**Module**: Core Services & Plugin SDK APIs
**Last verified**: 2026-10-27（v0.7.5）

## 覆盖面实测

以下数字由脚本按 `export const <Name>Token` 统计得出，可随代码复算：

| 维度                              | 数值   | 说明                                                              |
| --------------------------------- | ------ | ----------------------------------------------------------------- |
| `packages/core/` 定义的服务 Token | 35     | 分布在 `packages/core/di/`、`worker-runtime/`、`security/` 等模块 |
| `@openlearn/plugin-sdk` 对外导出  | 32     | 31 个内核 Token + `IActivityRegistryToken`（4 个已收回的不计入）  |
| `docs/api/di-tokens.md` 收录      | 见该页 | 该页是 Token 的**唯一权威字典**，含已停用 Token 的历史说明        |

> 早期版本此处写作「所有 19 个公共 DI Token」，该数字已严重滞后于代码。

## 文档索引

| 契约                    | 权威文档                                                               |
| ----------------------- | ---------------------------------------------------------------------- |
| DI Token 与 Service API | [di-tokens](di-tokens.md)                                              |
| TypeScript 接口         | [typescript-interfaces](typescript-interfaces.md)                      |
| 课件作答契约            | [courseware-attempts-contract](courseware-attempts-contract.md)        |
| 白板事件槽位契约        | [whiteboard-event-slot-contract](whiteboard-event-slot-contract.md)    |
| 插件扩展槽位            | [plugin-ui-extension-slots](../reference/plugin-ui-extension-slots.md) |
| 数据表                  | [platform-data-tables](../reference/platform-data-tables.md)           |

## 维护方式

本页**不做逐项勾选**——逐 Token / 逐接口的覆盖情况由 [di-tokens](di-tokens.md) 与各契约页承担，避免两处清单互相漂移。新增或删除 Token 时请同步更新字典页，并复算上表数字。
