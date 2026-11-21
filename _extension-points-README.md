# extension-points 正名说明

## 结论

`packages/core/extension-points/` **不是运行时扩展注册表**，而是「扩展点弃用账本」。

它只回答三件事：

1. 哪些扩展点已弃用；
2. 从哪个版本开始弃用；
3. 计划在哪个版本移除、替换方案是什么。

## 不要用它做这些事

| 错误用法 | 正确入口 |
|---|---|
| 发现"当前有哪些扩展" | `packages/core/extension-registry/extension-points.ts`（Phase 1.4 建立） |
| 注册 manifest slot 扩展 | `packages/core/plugin-host/contribution-registry.ts` |
| 注册活动 provider | `packages/activity-ecosystem/registry.ts` |
| 注册课堂运行时钩子 | `packages/core/classroom-runtime/hooks-system.ts` |

## 当前真实消费方（2026-11-21）

- `contribution-registry.ts`：`warnDeprecation('slot', ...)`
- `context-builder.ts`：`warnDeprecation('service', ...)`
- `event-bus/index.ts`：`warnDeprecation('event', ...)`
- `command-bus/index.ts`：`warnDeprecation('command', ...)`
- `extension-catalog.ts`：读取 `CORE_EXTENSION_POINTS` 生成弃用目录（只读派生）
- `compatibility-reporter.ts`：读取 `CORE_EXTENSION_POINTS` 生成兼容性报告（只读派生）

## 改名计划（Phase 3）

目标名称：`extension-deprecation-ledger`

计划：

1. 新建 `packages/core/extension-deprecation-ledger/`，原样迁移 `metadata.ts` 与 `compatibility-reporter.ts`；
2. `extension-points/index.ts` 改为 re-export 薄壳，标注 `@deprecated`；
3. 同步更新 4 个 `warnDeprecation` 消费方与 `extension-catalog` 的 import；
4. 保留旧路径一个 minor，随后删除。

不在 Phase 1 执行：改名会触及 6 个以上模块与 SDK 生成面，按「禁止大爆炸」拆到 Phase 3。
