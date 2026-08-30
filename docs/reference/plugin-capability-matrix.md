# 能力权限矩阵全集 (Capabilities Permission Matrix)

> **适用范围**：`@openlearn/plugin-sdk@3.5.0`
> 本页是插件声明与校验 `resource:action` 权限的**唯一权威字典**，用于避免 AI 捏造权限名导致 `CAPABILITY_DENIED` / `Access Denied`。
> **关键事实**：代码库中存在**三套互不相干的 "capability" 机制**，请勿混淆：
> 1. **权限 / RBAC 系统**（`CapabilityGuard`）—— 即本页所述 `resource:action` 字符串，在命令总线拦截器中强制执行。
> 2. **AI 能力层**（`ai-capability/`）—— `capability_*` 功能 ID，**不是**权限字符串（见 [DI Token 字典](../api/di-tokens) 的 `IPluginCapabilityGatewayToken`）。
> 3. **通用能力 Provider 框架**（`capability/`）—— 按角色数组鉴权，**不是** `resource:action` 字符串。
> **不存在**名为 `CAPABILITY_DENIED` 的常量；拒绝消息为 `[CapabilityGuard] Access Denied`。

---

## 1. 完整权限字符串全集（按模块）

权限字符串**没有**集中的枚举/注册表，它们散落在各 `ActionDescriptor.capabilityRequired` 与 `CapabilityGuard` 的默认授权中。以下为从 `packages/core` 与 `packages/plugins` 源码中收集到的**每一个真实字符串**：

### `lesson:*`
| 权限 | 使用位置（节选） |
|---|---|
| `lesson:read` | builtin.ts:1502,1527；assignment-eval.ts:93；ai-planner.ts；CapabilityGuard 默认授予 `teacher-demo` |
| `lesson:write` | builtin.ts:66,104,140,185,253,1139,1347,1547；ai-planner.ts:111 |
| `lesson:delete` | builtin.ts:323 |

### `whiteboard:*`
| 权限 | 使用位置（节选） |
|---|---|
| `whiteboard:read` | builtin.ts:554,611；spotlight-magnifier 插件 |
| `whiteboard:write` | builtin.ts:374,446,483,519,641,720；spotlight-magnifier 插件 |

### `quiz:*`
| 权限 | 说明 |
|---|---|
| `quiz:write` | **仅默认授予** `agent-system-0`，从未作为 `capabilityRequired` 出现（已识别但未作为需求使用） |

### `plugin:*`
| 权限 | 使用位置（节选） |
|---|---|
| `plugin:read` | builtin.ts:882 |
| `plugin:write` | builtin.ts:779,804,832,857 |

### `vfs:*`
| 权限 | 使用位置（节选） |
|---|---|
| `vfs:read` | vfs.ts:99,125 |
| `vfs:write` | vfs.ts:58,158 |

### `management:*`
| 权限 | 使用位置（节选） |
|---|---|
| `management:read` | management.ts:83,136,286,759,866；PluginCenter.tsx:912 |
| `management:write` | management.ts:55,103,156,189,220,...（大量） |

### `process:*`
| 权限 | 使用位置（节选） |
|---|---|
| `process:read` | process.ts:113,133 |
| `process:write` | process.ts:60,89；ai-planner.ts:81 |

### `class:*`（即 `classroom:*`）
| 权限 | 使用位置 |
|---|---|
| `class:read` | management.ts:22（manifest `capabilitiesProposed`） |
| `class:write` | management.ts:22 |

### `student:*`
| 权限 | 使用位置（节选） |
|---|---|
| `student:read` | management.ts:22（manifest） |
| `student:write` | builtin.ts:1422 |

### `assignment:*`
| 权限 | 使用位置 |
|---|---|
| `assignment:write` | ai-planner.ts:168（manifest 亦声明于 `plugin-ai-planner/manifest.json`） |

> 注意：`assignment-eval` 插件自身将其动作映射到 `lesson:read` / `lesson:write`，而非 `assignment:*`。

### 通配符（超级管理员绕过）
| 权限 | 说明 |
|---|---|
| `*:*:*` / `*` | 超级管理员绕过（`capability-system/index.ts:6-7,45`）。`CapabilityGuard.check` 支持部分通配（`lesson:*` 匹配 `lesson:write`）。 |

---

## 2. ⚠️ 不存在的权限模块（切勿捏造）

以下常被误以为存在的权限字符串**在源码中并不存在**（用户操作实际由上述已有模块覆盖）：

- **`user:*`** —— 不存在。用户操作（如 `user.delete`）由 `management:write` 把关。
- **`system:*`** —— 不存在。"System" 仅作为 Provider 框架的 `CapabilityRole` 出现。
- **`courseware:*`** —— 不存在。课件由 `whiteboard:*` / `lesson:*` 覆盖。
- **`classroom:*`** —— 不存在，等价于 `class:*`（见上）。
- **`analytics:*`** —— 不存在。唯一的 "analytics 能力" 是 AI 层的 `capability_analytics` 功能 ID。
- **`ai:*`** —— 不存在。AI 层使用 `capability_*` ID，而非 `ai:read` / `ai:write` 权限。

---

## 3. 插件如何声明权限

声明**仅通过 manifest 字段 `capabilitiesProposed: string[]`**，运行期无单独 ctx API 声明权限。

- SDK 类型：`packages/plugin-sdk/openlearn.d.ts:43` → `capabilitiesProposed?: string[];`
- Schema（权威）：`packages/core/esm-loader/manifest-schema.ts:93` → `capabilitiesProposed: z.array(z.string()).optional()`
- 消费侧 `ActionDescriptor` 也含 `capabilityRequired: string`（`packages/core/registry/index.ts:6`）

真实 manifest 示例：
```json
// @openlearn/plugin-builtin/manifest.json
["lesson:read","lesson:write","whiteboard:read","whiteboard:write"]
// @openlearn/plugin-vfs/manifest.json
["vfs:read","vfs:write"]
// @openlearn/plugin-management/manifest.json
["class:read","class:write","student:read","student:write"]
// @openlearn/plugin-ai-planner/manifest.json
["process:write","lesson:write","assignment:write"]
```

**激活期强制**：宿主仅在激活时授予 manifest 中列出的字符串（`packages/core/plugin-host/index.ts:1030-1042`）。插件若执行未声明的 `capabilityRequired` 命令，将触发 `Access Denied`。
插件运行期可通过 `ctx.capability`（包装后的 `ICapabilityService`，`context-builder.ts:350-361`）进行 `grant` / `revokeAll` / `check`，但这是**校验/授权**，不是声明新权限。

---

## 4. 高危权限与动态审批

> **重要**："高危"**不是权限字符串的属性**，而是 `ActionDescriptor.isHighRisk?: boolean`（`packages/core/registry/index.ts:7`）——即**命令动作**的属性。仓库中**不存在** `CAPABILITY_DENIED` 常量。

被标记为高危的命令（执行前需管理员动态审批）：

| 命令类型 | 所需权限 | 位置 |
|---|---|---|
| `lesson.delete` | `lesson:delete` | builtin.ts:319-324 |
| `plugin.install` | `plugin:write` | builtin.ts:775-780 |
| `plugin.install_zip` | `plugin:write` | builtin.ts:800-805 |
| `plugin.toggle` | `plugin:write` | builtin.ts:828-833 |
| `plugin.uninstall` | `plugin:write` | builtin.ts:853-858 |
| `user.delete` | `management:write` | builtin.ts:1086-1091 |
| `ai.apply_recommendation` | `lesson:write` | ai-planner.ts:107-112 |
| `ai.apply_grade` | `assignment:write` | ai-planner.ts:164-169 |

> 对比：`plugin.info` 显式设置 `isHighRisk: false`（builtin.ts:883）。

**决策逻辑**（内核拦截器，`packages/core/kernel/index.ts:269-286`）：
```typescript
if (action.isHighRisk && command.metadata?.approved !== true) {
  if (isAdmin) {
    // 管理员直接绕过人工审批（仅记录日志）
  } else {
    // INSERT INTO pending_commands (...)
    // publish event 'approval.requested'
    throw new Error(`[Security] Command ${command.type} requires human approval. ...`);
  }
}
```
即：非管理员且未 `approved` 的高危动作会被写入 `pending_commands` 表、发布 `approval.requested` 事件并抛出异常；管理员 actor 直接绕过队列。

---

## 5. 校验流程（缺失权限时发生什么）

主路径（`resource:action` 权限检查，内核命令总线拦截器，`kernel/index.ts:262-267`）：
```typescript
if (action.capabilityRequired && !isAdmin) {
  const allowed = this.capabilityGuard.check(command.actorId, action.capabilityRequired);
  if (!allowed) {
    throw new Error(`[CapabilityGuard] Access Denied: Actor ${command.actorId} missing capability ${action.capabilityRequired} for ${command.type}`);
  }
}
```
- **管理员绕过**：`role:administrator` / `admin` / `usr_admin` / `admin-demo` 或含 `:administrator` / `:admin` 的 `actorId` 同时跳过权限检查与高危队列。
- `CapabilityGuard.check` 支持部分通配（`lesson:*` 匹配 `lesson:write`）与超级管理员 `*:*:*` / `*`。
- 因宿主仅授予 `capabilitiesProposed` 中的字符串，未声明的命令必然在此处 `Access Denied`。

副路径（独立的 `capability/` Provider 框架）按**角色**而非 `resource:action` 鉴权：
```typescript
const hasPermission = PermissionChecker.validatePermission(desc, request.context.actorRole);
// roles: Teacher | Student | Plugin | AI | Observer | System
```
每个 descriptor 携带 `permission: CapabilityRole[]`（而非 `resource:action` 字符串）。

> 最后更新：2026-07-26
