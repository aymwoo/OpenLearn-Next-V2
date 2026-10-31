# manifest.json 安装期校验

> 逐字段转写（zod schema 的字段级参考）见 [ai-reference/development/manifest-reference.md](../../ai-reference/development/manifest-reference.md)。
> 本文面向**写 manifest 的插件作者**：只讲哪些写法会被拒绝、哪些会被静默保留，以及为什么。

`manifest.json` 是插件唯一的**安装期校验点**。平台用 zod schema（`packages/core/esm-loader/manifest-schema.ts`
的 `manifestSchema`）在**安装与激活时**校验，遵循「早失败 + 精确错误消息」原则。

> 顶层是 `.passthrough()`：**未知字段不会被拒绝，会被原样保留并入库**。
> 这既是兼容通道也是陷阱——写错字段名不会报错，只会静默失效。

---

## 1. 顶层字段总表

| 字段                       | 类型     | 必填 | zod 约束                                | 说明                                                                                                                                     |
| :------------------------- | :------- | :--- | :-------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | string   | ✅   | `min(1)` **且不含 `:`**                 | 插件唯一标识；第三方惯例 `@author/name`。禁止冒号是因为插件 actor 形如 `plugin:${manifest.id}`，含 `:` 可伪造出命中 admin 启发式的 actor |
| `name`                     | string   | ✅   | `min(1)`                                | 人类可读名称                                                                                                                             |
| `version`                  | string   | ✅   | `min(1)`                                | 建议 SemVer；schema 本身不做 SemVer 校验                                                                                                 |
| `main`                     | string   | ✅   | `min(1)`                                | 服务端入口文件名。缺失 → **插件装不上**                                                                                                  |
| `icon`                     | string   | ❌   | optional                                | 图标标识                                                                                                                                 |
| `description`              | string   | ❌   | optional                                |                                                                                                                                          |
| `author`                   | string   | ❌   | optional                                | 也是 `sign` 的默认 publisher 身份                                                                                                        |
| `requires`                 | string[] | ❌   | 每项过 `requiresItemSchema` 正则        | **强依赖**；缺失或版本不匹配 → 激活被拒                                                                                                  |
| `optional`                 | string[] | ❌   | 同上                                    | **可选依赖**；不匹配 → 对应 `ctx.services[key]` 置 `null`，**不阻止激活**                                                                |
| `capabilitiesProposed`     | string[] | ❌   | `array(string)`                         | 申请的能力；见 [capabilities.md](capabilities.md)                                                                                        |
| `network.outbound`         | string[] | ❌   | 每项 `min(1)`                           | 申请出网域名；**不自动授权**                                                                                                             |
| `engines.openlearn`        | string   | ❌   | `min(1)`（对象本身 optional）           | 宿主版本兼容范围，如 `">=0.2.5"`                                                                                                         |
| `pluginDependencies`       | string[] | ❌   | `min(1)`                                | 依赖的其它插件 id；被依赖插件必须已 `ACTIVE`，否则激活被拒                                                                               |
| `provides`                 | string[] | ❌   | `min(1)`                                | 本插件向 DI 容器注册的服务 Token 名（配合 `ctx.provide`）                                                                                |
| `configuration.properties` | record   | ❌   | 见 §4                                   | 可配置项声明                                                                                                                             |
| `contributes`              | object   | ❌   | 见 [槽位全集](contributes-slots.md)     | 声明式 UI 贡献点                                                                                                                         |
| `classroomTools`           | array    | ❌   | `z.array(z.unknown())`                  | 课堂白板工具栏按钮；**顶层宽松校验**，实际形状见 §3.6                                                                                    |
| `deploy`                   | object   | ❌   | `{ script?, staticRoute?, staticDir? }` | 插件自带的静态资源/脚本部署声明                                                                                                          |
| `api`                      | object   | ❌   | `{ baseRoute?, routes? }`               | REST 端点声明，见 §5                                                                                                                     |

**旧版兼容**：`manifestSchemaV3` / 类型 `ManifestV3` 仍存在，唯一区别是 `requires`/`optional` 严格**不带** `@version` 后缀。新插件请直接用 `Manifest`。

---

## 2. `requires` / `optional` 条目格式

正则（线性，无 ReDoS 风险）：

```
^@[\w-]+/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$
```

即 `@scope/domain:IServiceName` 或 `@scope/domain:IServiceName@^x.y.z`。

| 合法                                        | 非法（会被拒）                                                            |
| :------------------------------------------ | :------------------------------------------------------------------------ |
| `@openlearn/core:ICommandBusService`        | `ICommandBusService`（缺 scope/domain）                                   |
| `@openlearn/core:ICommandBusService@^1.0.0` | `@openlearn/core:commandBus`（服务名必须 `I` 开头 `\w+`）                 |
| `@openlearn/core:IDatabase@~1.2.0`          | `@openlearn/core:IDatabase@1`（版本号必须是 x.y.z）                       |
| `@openlearn/core:IDatabase@1.0.0`           | `@openlearn/core:IDatabase@>=1.0.0`（单条目正则只接 `^`/`~`/精确/预发布） |

解析规则：以**第二个 `@`** 分界，前为 `tokenName`，后为 `versionRange`；无第二个 `@` 时 `versionRange = null`（接受任意版本）。

```{note} 降级语义
`optional` 里的 Token 版本不兼容时，宿主走 D-12 降级：`services[serviceKey] = null` 并继续激活。
所以 `manifest.optional` 是「我有就更好，没有也能跑」的声明 —— **消费侧必须判空**，
这是类型上唯一无法替你兜住的地方。
```

---

## 3. 逐字段详解与示例

### 3.1 完整示例（覆盖所有常用字段）

```json
{
  "id": "@myteam/exam-helper",
  "name": "考试助手",
  "version": "1.2.0",
  "main": "index.js",
  "icon": "Puzzle",
  "description": "随堂测验、组卷与成绩回写",
  "author": "myteam",
  "engines": { "openlearn": ">=0.7.0" },

  "requires": [
    "@openlearn/core:ICommandBusService@^1.0.0",
    "@openlearn/core:IEventBusService@^1.0.0",
    "@openlearn/core:IDatabase@^1.0.0"
  ],
  "optional": ["@openlearn/core:IActionRegistryService@^1.0.0"],
  "provides": ["IExamAnalysisService"],
  "pluginDependencies": ["@openlearn/plugin-vfs"],

  "capabilitiesProposed": ["lesson:read", "lesson:write", "assignment:manage"],
  "network": { "outbound": ["api.example.com"] },

  "configuration": {
    "properties": {
      "passScore": {
        "type": "integer",
        "default": 60,
        "minimum": 0,
        "maximum": 100,
        "description": "及格分数线"
      },
      "providerKey": {
        "type": "string",
        "description": "外部题库 API Key",
        "scope": ["platform", "school"]
      }
    }
  },

  "classroomTools": [
    {
      "id": "exam-helper-tool",
      "name": "考试助手",
      "icon": "ClipboardList",
      "description": "下发随堂测验",
      "commandType": "@myteam/exam-helper.open_tool",
      "payload": { "lessonId": "$lessonId", "classId": "$classId" }
    }
  ],

  "contributes": {
    "teacher.tab": [
      { "id": "exam-dashboard", "label": "考试看板", "icon": "BarChart3", "position": 20, "view": "dashboard.html" }
    ],
    "command_palette.item": [
      {
        "id": "exam-create",
        "title": "新建测验",
        "category": "Exam",
        "commandType": "@myteam/exam-helper.create",
        "shortcut": "ctrl+alt+t"
      }
    ],
    "anchor:whiteboard-toolbar:rollcall": [
      { "id": "exam-quick", "label": "快捷测验", "icon": "Sparkles", "placement": "before" }
    ]
  },

  "api": {
    "routes": [
      { "method": "GET", "path": "/state", "auth": true, "roles": ["teacher", "student"] },
      { "method": "POST", "path": "/submit", "auth": true, "roles": ["student"] },
      { "method": "GET", "path": "/stream/logs", "auth": true, "rateLimit": { "windowMs": 60000, "max": 30 } }
    ]
  },

  "deploy": { "staticRoute": "/assets", "staticDir": "public" }
}
```

### 3.2 `configuration.properties`

| 属性                  | 类型                                             | 说明                                                  |
| :-------------------- | :----------------------------------------------- | :---------------------------------------------------- |
| `type`                | `'string' \| 'number' \| 'boolean' \| 'integer'` | 枚举，写其它值直接被拒                                |
| `default`             | unknown                                          | 读取时自动应用                                        |
| `description`         | string                                           | 管理界面展示                                          |
| `enum`                | unknown[]                                        | 候选值                                                |
| `minimum` / `maximum` | number                                           | 数值区间                                              |
| `scope`               | `('platform' \| 'school' \| 'class')[]`          | 覆盖作用域。**缺省只有 `platform`**（老插件行为不变） |

读取通过 `ctx.config`：`get<T>(key)` / `getAll()` / `set(key, value)` / `onChange(cb) → 取消函数`。

### 3.3 `classroomTools` 条目

```typescript
{ id: string(必填 min1); name: string(必填 min1); icon?: string;  // Lucide 图标名
  description?: string; commandType: string(必填 min1); payload?: Record<string, unknown> }
```

```{important} $lessonId / $classId 占位符
`payload` 里的 `"$lessonId"` / `"$classId"` 由宿主在**点击瞬间**替换成当前课堂上下文。
这是课堂工具按钮拿到 `lessonId` / `classId` 的**唯一通道** —— 不要自己猜字段名，
也不要在 Handler 里从别处找。
```

> 注意：顶层 `classroomTools` 在校验中是 `z.array(z.unknown())`（宽松），而 `contributes["classroom.tool"]`
> 才是严格 zod 校验的等价通道。**推荐写 `contributes["classroom.tool"]`**，把形状错误挡在安装期。

### 3.4 `provides`

声明本插件注册进 DI 容器的服务名。配套服务端调用：

```typescript
import { Token } from '@openlearn/plugin-sdk';
export interface IExamAnalysisService {
  summarize(lessonId: string): Promise<number>;
}
export const ExamAnalysisToken = new Token<IExamAnalysisService>('@myteam/exam-helper:IExamAnalysisService', '1.0.0');

// 提供方
await ctx.provide(ExamAnalysisToken, {
  async summarize(id) {
    return 0;
  },
});

// 消费方（另一个插件）
const svc = await ctx.resolve(ExamAnalysisToken);
```

契约文件请放在 `src/contracts/index.ts`（`full-stack` 模板已生成），让消费方 import 得到编译期类型。

---

## 4. `contributes` 校验强度说明（重要）

审计 E-1 的结论：早期 `contributes` 只严格枚举 6 个 slot，其余全靠顶层 `.passthrough()` 原样入库 ——
**写坏形状不会在安装期被拒，要等前端渲染时才炸**，现象与病因离得很远。

现在已补全 `contribution-registry.ts` 定义的全部 slot 的 zod 校验（数十个）。仍然保留两类宽松：

| 类别                                                        | 校验强度                                                                    |
| :---------------------------------------------------------- | :-------------------------------------------------------------------------- |
| 显式枚举的 slot（见 [槽位全集](contributes-slots.md) 表 A） | **严格**：字段缺失/类型错误 → 安装失败                                      |
| `frontendSlotsShape` 内的前端专属/演进 slot（表 B）         | **宽松**：`frontendSlotEntrySchema` 兜底，仅拒结构性错误                    |
| `anchor:*`                                                  | **透传**：`.passthrough()` 保留任意键，运行时由 `ExtensionPointConfig` 校验 |

```{warning} 拼错 slot 名 = 静默不显示
`.passthrough()` 意味着 `contributes["teacher.tabs"]`（多打一个 s）**不会报错**，
也不会有任何渲染。交付前请用 [§4 自检清单](../playbook/agent-playbook.md) 逐项比对 slot 名。
```

---

## 5. `api`（REST 端点声明）

```typescript
api: {
  baseRoute?: string;   // ⚠ 无路由作用（审计 P1）
  routes?: Array<{
    method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE';
    path: string;        // min(1)
    auth?: boolean;
    roles?: string[];
    rateLimit?: { windowMs?: number; max?: number };
  }>;
}
```

```{danger} baseRoute 是历史遗留的误导性字段
全仓**没有任何代码**按 `baseRoute` 挂载或匹配路由。插件 REST 端点的真实路径固定为：

    /api/plugins/{manifest.id}/*

（网关：`server/routes/plugin-api-gateway.ts`。）声明 `baseRoute` 时宿主会输出一次告警。
把它当文档注释用可以，当能力用不行。

```

实际的路由注册在运行期用 `ctx.http`（`IPluginHttpRouter`），见 [http-api.md](http-api.md)。
`api.routes` 声明主要用于**展示、鉴权与限流元数据**。

---

## 6. `deploy`

| 字段          | 约束                                        | 用途                 |
| :------------ | :------------------------------------------ | :------------------- |
| `script`      | `min(1)`，为空则报 `deploy.script 不能为空` | 部署脚本             |
| `staticRoute` | optional                                    | 静态资源对外路由前缀 |
| `staticDir`   | optional                                    | 静态资源目录         |

---

## 7. Agent 生成 manifest 的顺序建议

1. 先写 `id` / `name` / `version` / `main` / `engines` —— 五个「装不上」级字段。
2. 再写 `requires`（确定要用的一定放 `requires` 而不是 `optional`，避免判空成本）。
3. 能力只从真值表取，写之前先查 [capabilities.md](capabilities.md)。
4. `contributes` 从 [槽位全集](contributes-slots.md) **复制** slot 名，不要手打。
5. 第三方 UI 一律 `view`，不写 `component`。
6. 最后补 `configuration` 与 `api.routes`。

---

## 取证

| 内容                                                 | 位置                                                                             |
| :--------------------------------------------------- | :------------------------------------------------------------------------------- |
| `manifestSchema` / `manifestSchemaV3` 全部字段与约束 | `packages/core/esm-loader/manifest-schema.ts`                                    |
| `requiresItemSchema` 正则与解析                      | `packages/core/esm-loader/manifest-schema.ts`、`manifest-utils.ts`               |
| id 禁冒号（审计 C-3）                                | `manifest-schema.ts`（`manifestSchema.id.refine`）                               |
| `configuration.scope`（Issue #151）                  | `manifest-schema.ts`                                                             |
| `baseRoute` 无路由作用（审计 P1）                    | `manifest-schema.ts`（`apiSchema` 注释）                                         |
| contributes 校验强度（审计 E-1）                     | `manifest-schema.ts`（contributes 段注释）                                       |
| `$lessonId` 占位符                                   | `packages/plugin-sdk/scaffold/templates/full-stack/src/index.ts`                 |
| optional → `null` 降级（D-12）                       | `packages/core/plugin-host/types.ts`、`docs/plugin/plugin-manifest-spec.md` §2.2 |
| 能力必须来自 19 个真值                               | `docs/plugin/plugin-manifest-spec.md` §2.3                                       |

```

```
