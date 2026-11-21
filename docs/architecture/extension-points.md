# Extension Registry（扩展点注册表）

`packages/core/extension-registry/extension-points.ts` 是扩展槽校验与启动对账的唯一实现。
它不保存注册结果（注册表仍在 `packages/core/plugin-host/contribution-registry.ts`），只回答
三个问题：**哪些槽合法、未知槽怎么处理、启动时清单是否对齐**。

## 1. 规范清单从哪来

`ALL_EXTENSION_POINTS` 由 `packages/core/esm-loader/manifest-schema.ts` 的
`CONTRIBUTES_SLOT_KEYS` 派生（排除 `locales`）。manifest schema 是唯一规范源，本模块只做
派生视图，**不再反向写回 schema**——曾经的 `UnifiedExtensionRegistry` 双写已被移除。

## 2. 未知槽处理模式

环境变量 `OPENLEARN_EXTENSION_STRICT_SLOTS` 控制注册表侧对未知槽的处置：

| 取值      | 行为                                       |
| --------- | ------------------------------------------ |
| `strict`  | 直接抛错，阻止插件激活                     |
| `warn`    | 默认值。打印告警并继续，同时写入未知槽日志 |
| `lenient` | 静默放行，仅记录到健康快照                 |

非法取值回落 `warn` 并只告警一次。注意：该开关只放宽**注册表未知槽**；manifest 自身声明的
漂移在任何模式下都会抛错。

## 3. 注册期与启动期两道守卫

- 注册期：`contribution-registry.register()` 会先调用 `assertSlotExists(slot)`。规范槽直接
  通过；宿主专用槽（`anchor:*`、`legacy.*`）通过；其余按上表模式处理。
- 启动期：内核在 `restoreActivePlugins()` 之后调用 `assertExtensionPointsAligned(...)`，对账
  「当前注册表槽位」与「manifest 规范槽位」，结果供健康接口读取。

未知槽以 JSONL 追加到 `_extension-points-unknown.log`（`NODE_ENV=test` 时跳过），避免测试
污染仓库。

## 4. 观测

`GET /api/system/extension-points`（仅管理员）返回：

```json
{ "ok": true, "mode": "warn", "count": 0, "unknownSlots": [] }
```

`unknownSlots` 来自最近一次启动对账与注册期记录，用于判断第三方插件是否仍在使用已删除的槽。

## 5. 相关文件

- 规范槽位：`packages/core/esm-loader/manifest-schema.ts`
- 注册实现：`packages/core/plugin-host/contribution-registry.ts`
- 启动对账：`packages/core/kernel/index.ts`
- 只读目录：`IExtensionCatalog`（`packages/core/activity-contract/types.ts`）
