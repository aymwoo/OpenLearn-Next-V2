# Manifest 规范

**唯一真源**：`packages/core/esm-loader/manifest-schema.ts`（892 行，zod）。
本文是该文件的逐字段转写；**schema 变了本文就过期**，冲突时以源码为准。

---

## 1. 顶层字段总表

| 字段                   | 类型                                              | 必填 | zod 约束                                    | 用途                                      |
| ---------------------- | ------------------------------------------------- | ---- | ------------------------------------------- | ----------------------------------------- |
| `id`                   | `string`                                          | ✅   | `.min(1)` + **不得含 `:`**                  | 全局唯一标识；命令命名空间前缀            |
| `name`                 | `string`                                          | ✅   | `.min(1)`                                   | 显示名（支持中文）                        |
| `version`              | `string`                                          | ✅   | `.min(1)`（不校验 semver 格式）             | 版本                                      |
| `main`                 | `string`                                          | ✅   | `.min(1)`                                   | 入口文件，ZIP 内相对路径，通常 `index.js` |
| `icon`                 | `string`                                          | ❌   | —                                           | 图标名（Lucide）或 URL                    |
| `description`          | `string`                                          | ❌   | —                                           | 简介                                      |
| `author`               | `string`                                          | ❌   | —                                           | 作者                                      |
| `requires`             | `string[]`                                        | ❌   | 正则见 §2                                   | 硬依赖的服务 Token                        |
| `optional`             | `string[]`                                        | ❌   | 同上                                        | 软依赖；不满足时对应服务为 `null`         |
| `capabilitiesProposed` | `string[]`                                        | ❌   | `z.array(z.string())` **无白名单**          | 申请的能力                                |
| `network`              | `{ outbound?: string[] }`                         | ❌   | —                                           | 出站域名申请                              |
| `engines`              | `{ openlearn: string }`                           | ❌   | `.min(1)`                                   | 宿主版本范围（**不是** SDK 版本）         |
| `pluginDependencies`   | `string[]`                                        | ❌   | `.min(1)`                                   | 依赖的其他插件 id                         |
| `provides`             | `string[]`                                        | ❌   | `.min(1)`                                   | 对外提供的服务                            |
| `configuration`        | `{ properties?: Record<string, ConfigProperty> }` | ❌   | 见 §3                                       | 声明式配置项                              |
| `contributes`          | `Record<string, Array<…>>`                        | ❌   | 见 §4                                       | 声明式贡献                                |
| `classroomTools`       | `unknown[]`                                       | ❌   | **无校验**                                  | 旧式课堂工具（仍支持）                    |
| `deploy`               | `{ script?, staticRoute?, staticDir? }`           | ❌   | —                                           | 部署脚本 / 静态路由                       |
| `api`                  | `{ baseRoute?, routes? }`                         | ❌   | 见 §5                                       | REST 路由声明                             |
| `updateSource`         | `{ type, repo }`                                  | ❌   | 类型层有，**schema 无**（passthrough 保留） | 自动更新来源                              |

> 顶层是 `.passthrough()`（L841）：**未知字段保留**，所以 `icon`/`author`/`updateSource`/`executionMode` 等都能通过。
> 但**不要依赖这一点**做校验 —— 缺字段不会被拦，错字段也不会被报。

---

## 2. `requires` / `optional` 的格式（正则逐字）

```regex
^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$
```

| 写法                                 | 合法 | 说明                  |
| ------------------------------------ | ---- | --------------------- |
| `@openlearn/core:ICommandBusService` | ✅   | 无版本                |
| `@openlearn/core:IDatabase@^1.0.0`   | ✅   | caret 范围            |
| `@acme/x:IFoo@1.2.3-pre.1`           | ✅   | 预发布                |
| `ICommandBusService`                 | ❌   | 缺 `@scope/domain`    |
| `@openlearn:ICommandBusService`      | ❌   | 缺 `/domain`          |
| `@openlearn/core:CommandBus`         | ❌   | 接口名必须以 `I` 开头 |
| `@openlearn/core:IDatabase@1.0`      | ❌   | 必须三段版本号        |

常用 Token 名对照见 [context-and-services.md](../plugin-system/context-and-services.md) §3.1。

---

## 3. `configuration.properties`

```json
{
  "configuration": {
    "properties": {
      "points_per_check_in": {
        "type": "integer",
        "default": 5,
        "description": "每次签到发放的积分数",
        "minimum": 0,
        "scope": ["platform", "class"]
      }
    }
  }
}
```

| 键                    | 允许值                                         | 说明                                  |
| --------------------- | ---------------------------------------------- | ------------------------------------- |
| `type`                | `string` \| `number` \| `boolean` \| `integer` | 必填                                  |
| `default`             | 任意                                           | 读取时的兜底值                        |
| `description`         | string                                         | 管理端展示                            |
| `enum`                | `unknown[]`                                    | 枚举约束                              |
| `minimum` / `maximum` | number                                         | 数值范围                              |
| `scope`               | `('platform'\|'school'\|'class')[]`            | 允许覆盖的作用域，缺省 `['platform']` |

读取（`ctx.config.get(key, { classId })`）的优先级：**class > school > platform > default**。

真实样本：`[P] src/index.ts` L126-160（5 个配置项）。

---

## 4. `contributes`（声明式贡献）

### 4.1 两组键，行为不同

| 组       | 数量 | 校验强度                      | 未声明字段的处置 |
| -------- | ---- | ----------------------------- | ---------------- |
| A 严格键 | 71   | 每个键有专属 zod 对象         | **被 strip**     |
| B 宽松键 | 38   | `.object({id}).passthrough()` | 保留             |

来源：`manifest-schema.ts → contributesSchema`（L594）/ `frontendSlotsShape`（L542）。

> **最高危**：A 组条目里未声明的字段会被静默删除。`view` 只在 5 个槽位的 schema 里显式声明
> （`teacher.tab` L607、`teacher.panel` L501、`teacher.dashboard.widget` L619、`student.view` L631、`student.lesson.tool` L641）。

### 4.2 常用 A 组条目的字段

| 槽位键                           | 字段                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `classroom.tool`                 | `id`_, `name`_, `icon`, `description`, `commandType`*, `payload`                             |
| `teacher.tab`                    | `id`_, `label`_, `icon`, `position`, `view`, `route`                                         |
| `teacher.panel`                  | `id`_, `title`_, `icon`, `view`                                                              |
| `teacher.dashboard.widget`       | `id`_, `label`_, `icon`, `position`, `view`                                                  |
| `student.view`                   | `id`_, `label`_, `icon`, `route`, `view`                                                     |
| `student.lesson.tool`            | `id`_, `label`_, `icon`, `view`                                                              |
| `help.plugin_docs`               | `id`_, `title`_, `description`, `markdownUrl`                                                |
| `command_palette.item`           | `id`_, `title`_, `category`, `description`, `keywords`, `commandType`, `shortcut`, `payload` |
| `quick_insert.item`              | `id`_, `title`_, `category`, `description`, `icon`, `keywords`, `commandType`, `payload`     |
| `ai.prompt.template`             | `id`_, `title`_, `description`, `category`, `prompt`*, `parameters[]`                        |
| `ai.skill.provider`              | `id`_, `name`_, `description`*, `parametersSchema`, `commandType`                            |
| `classroom.seating.toolbar`      | `id`_, `label`_, `icon`, `commandType`                                                       |
| `classroom.seating.legend`       | `id`_, `label`_, `color`, `icon`                                                             |
| `classroom.seating.seat_badge`   | `id`_, `label`_, `icon`                                                                      |
| `classroom.seating.seat_actions` | `id`_, `label`_, `icon`, `commandType`                                                       |
| `classroom.seating.summary`      | `id`_, `title`_, `icon`                                                                      |
| `timeline.segments`              | `id`_, `labelZh`_, `labelEn`*, `icon`, `color`, `defaultDurationMin`                         |
| `palette.items`                  | `id`_, `type`_, `labelZh`_, `labelEn`_, `icon`, `category`, `defaultData`                    |
| `locales`                        | `Record<lang, string \| Record<string,string>>`                                              |
| `classroom.attribution.award`    | `id`_, `dimensionId`_, `name`_, `description`_, `icon`, `defaultDeltaPoints`*                |
| `student.profile.dimension`      | `id`_, `label`_, `key`*, `maxScore`, `defaultWeight`, `icon`, `category`                     |

`*` = 必填。完整 71 组见源码 L594-720；不要凭记忆猜字段名。

`id` 在**同一槽位内**唯一（注册表主键 `(slot, id)`）。跨插件同 id 会互相覆盖。

### 4.3 `anchor:*` 与未知键

`contributesSchema` 末尾 `.passthrough()` 保留任意键，因此 `"anchor:whiteboard-toolbar:rollcall": [...]`
能入库。但只有 8 个 anchor 真有渲染点（见 [extension-points-and-slots.md](../plugin-system/extension-points-and-slots.md) §1.1）。

### 4.4 `classroomTools`（旧式，仍生效）

```json
{
  "classroomTools": [{ "id": "lab-seat", "name": "机房座位", "icon": "Armchair", "commandType": "lab_seat.open_panel" }]
}
```

- **无 zod 校验**（`z.array(z.unknown())`，L837）；
- 与 `contributes['classroom.tool']` **二选一**：同时存在时只处理 `classroomTools`（`plugin-host.ts` L227 的 `continue`）；
- 注册结果等价于 `contributes['classroom.tool']`，组件为 `NullExtensionComponent`。

---

## 5. `api`（REST 路由）

```json
{
  "api": {
    "routes": [
      { "method": "GET", "path": "/roster/:classId", "auth": true, "roles": ["teacher", "administrator"] },
      { "method": "POST", "path": "/check-in", "rateLimit": { "windowMs": 60000, "max": 300 } }
    ]
  }
}
```

| 字段        | 约束                            | 说明                                 |
| ----------- | ------------------------------- | ------------------------------------ |
| `method`    | `GET\|POST\|PUT\|PATCH\|DELETE` | 枚举                                 |
| `path`      | `.min(1)`                       | 相对路径（以 `/` 开头）              |
| `auth`      | boolean，默认 true              | `false` = **申请**匿名，需管理员批准 |
| `roles`     | `string[]`                      | 允许角色，不匹配 403                 |
| `rateLimit` | `{ windowMs?, max? }`           | 默认 60000ms / 120 次                |

**`api.baseRoute` 是 no-op**：真实挂载路径恒为 `/api/plugins/{manifest.id}/*`（`manifest-schema.ts` L747-758 注释）。
install 时会对声明 `baseRoute` 的 manifest 输出一次告警。

---

## 6. `engines.openlearn` 怎么填

按**实际用到的 API 的最低宿主版本**填，不要一律抄旧值。

| 用到的能力                          | 最低宿主版本 |
| ----------------------------------- | ------------ |
| `ctx.log` / `ctx.config` / `ctx.db` | `>=0.2.3`    |
| `ctx.http`（`api.routes`）          | `>=0.3.11`   |
| 声明式 `contributes` / 前端沙箱行为 | `>=0.7.0`    |
| `view` 字段（双轨制 UI）            | `>=0.7.6`    |

写低了不会报错，但插件会在旧宿主上装着、用到新 API 时才崩。写高了会被拒装 —— 这是想要的行为。

---

## 7. 完整样例（可直接抄）

```json
{
  "id": "@aymwoo/plugin-lab-seat",
  "name": "机房座位管理",
  "version": "0.6.3",
  "description": "统一机房座位管理 - 教师编排布局分配座位，学生查看座位并签到",
  "author": "aymwoo",
  "main": "index.js",
  "engines": { "openlearn": ">=0.1.0" },
  "requires": [
    "@openlearn/core:ICommandBusService@^1.0.0",
    "@openlearn/core:IActionRegistryService@^1.0.0",
    "@openlearn/core:IEventBusService@^1.0.0",
    "@openlearn/core:IDatabase@^1.0.0"
  ],
  "optional": ["@openlearn/core:IPointsLedgerService@^1.0.0"],
  "provides": ["@aymwoo/plugin-lab-seat:ILabSeatService"],
  "capabilitiesProposed": ["lesson:read", "lesson:write", "management:read", "student:write"],
  "configuration": {
    "properties": {
      "points_per_check_in": { "type": "integer", "default": 5, "minimum": 0 }
    }
  },
  "contributes": {
    "classroom.seating.toolbar": [
      { "id": "assign", "label": "一键排座", "icon": "Armchair", "commandType": "lab_seat.assign_seats" }
    ],
    "teacher.tab": [{ "id": "seat-panel", "label": "机房座位", "icon": "Armchair", "view": "storage/seat.html" }]
  }
}
```

> 注意 `engines` 这里写的是 `>=0.1.0`（历史遗留，偏低）。新插件应按 §6 填。

---

## 8. 校验自查清单

- [ ] `id` 无 `:`，且形如 `@scope/name`
- [ ] `main` 与 ZIP 内文件名一致
- [ ] 每个 `requires` 条目过 §2 正则
- [ ] `capabilitiesProposed` 每条都在 19 条命令能力内（或用 `api:write` 等 8 个方法能力）
- [ ] `contributes` 里每个 `commandType` 都有对应 handler + ActionDescriptor
- [ ] 用了 `view` 的条目，其槽位在 §4.1 的 5 个白名单内
- [ ] `view` 值以 `storage/` 开头
- [ ] `engines.openlearn` 与用到的 API 匹配
- [ ] 没有 `api.baseRoute`（写了也不生效）
