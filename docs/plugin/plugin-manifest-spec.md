# 插件 Manifest 规范 (Plugin Manifest Specification)

<!-- doc-version: sdk=3.7.2 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.2`

每一个 OpenLearn V2 插件在根目录下必须包含一个 `manifest.json` 清单文件。宿主环境（`PluginHost`）在插件安装与激活时通过 **Zod Schema**（定义于 `packages/core/esm-loader/manifest-schema.ts`）对其进行强制运行时校验。

---

## 1. 完整 JSON 结构示例

```json
{
  "id": "ext-homework-hub",
  "name": "作业批改与学习分析中心",
  "version": "1.2.0",
  "main": "dist/index.js",
  "engines": {
    "openlearn": ">=0.2.5"
  },
  "requires": [
    "@openlearn/core:ICommandBusService@^1.0.0",
    "@openlearn/core:IEventBusService@^1.0.0",
    "@openlearn/core:IStorageService@^1.0.0"
  ],
  "optional": ["@openlearn/core:IAIService@^2.0.0"],
  "pluginDependencies": ["@openlearn/plugin-vfs"],
  "provides": ["IHomeworkAnalysisService"],
  "capabilitiesProposed": ["storage:read", "storage:write", "ai:chat"],
  "configuration": {
    "properties": {
      "autoGradeEnabled": {
        "type": "boolean",
        "default": true,
        "description": "是否开启提交作业后的 AI 自动初批"
      },
      "maxScore": {
        "type": "number",
        "default": 100,
        "minimum": 1,
        "maximum": 150,
        "description": "满分分值设定"
      }
    }
  },
  "contributes": {
    "teacher.tab": [
      {
        "id": "homework-manager",
        "label": "作业管理",
        "icon": "BookOpen",
        "position": 5
      }
    ],
    "classroom.tool": [
      {
        "id": "quick-quiz",
        "name": "随堂小测",
        "commandType": "homework.quick_quiz"
      }
    ]
  },
  "deploy": {
    "staticRoute": "/plugins/homework-hub/static",
    "staticDir": "public"
  },
  "api": {
    "routes": [
      { "method": "GET", "path": "/public-status", "auth": false },
      {
        "method": "POST",
        "path": "/submissions/:id/grade",
        "auth": true,
        "roles": ["teacher", "administrator"],
        "rateLimit": { "max": 60, "windowMs": 60000 }
      }
    ]
  },
  "updateSource": {
    "type": "github-release",
    "repo": "owner/openlearn-plugin-homework-hub"
  }
}
```

---

## 2. 字段详细说明手册

### 2.1 基础必需字段 (Required Fields)

| 字段名    | 类型     | 说明                                                                                                                                                                                               |
| :-------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string` | **插件唯一标识符**。必须全局唯一，建议采用 snake-case 或带命名空间的格式（如 `@org/plugin-name`）。                                                                                                |
| `name`    | `string` | **显示名称**。用于管理后台面板和插件中心界面展示。                                                                                                                                                 |
| `version` | `string` | **语义化版本号**（SemVer），如 `"1.0.0"`。                                                                                                                                                         |
| `main`    | `string` | **插件代码入口**相对路径（如 `"index.js"` 或 `"dist/index.js"`）。Schema 层**必填**；唯一例外：ZIP 安装路径会在 schema 校验前对缺失值注入默认 `"index.js"`（`install-utils.ts`）。请始终显式声明。 |

---

### 2.2 平台与服务依赖字段 (Dependencies)

#### `engines.openlearn`

指定要求的 OpenLearn 主应用平台版本号范围（SemVer 匹配）。例如 `">=0.2.5"` 表示允许在 `0.2.5` 及以上的任意宿主环境激活。

> **重要注意**：在 SemVer 规范中，零主版本（如 `"^0.2.9"`）严格等价于 `">=0.2.9 <0.3.0"`，当宿主升级到 `0.3.x` 时会被判定为不兼容而拒载。因此推荐使用 `">=0.2.5"` 进行向前兼容声明。

#### `requires`

声明插件**强依赖**的宿主服务接口与版本范围。如果宿主环境缺少对应服务或服务版本不满足范围，插件激活将直接抛出 `SemverMismatchError` 并终止。

- **字符串格式**: `@scope/domain:IServiceName@SemVerRange`
- **示例**: `"@openlearn/core:ICommandBusService@^1.0.0"`

#### `optional`

声明插件**可选依赖**的服务。格式与 `requires` 完全相同。如果宿主未提供该服务或版本不匹配，宿主**不会阻止**插件激活，但会自动将 `ctx.services[serviceName]` 置为 `null`，插件需在代码中自行判断判空。

#### `pluginDependencies`

声明插件依赖的其他第三方或内置插件 ID 列表。例如 `["@openlearn/plugin-vfs"]`。被依赖的插件必须在当前插件激活前处于 `ACTIVE` 状态，否则激活会被拒绝。

#### `provides`

声明该插件向依赖注入（DI）容器注册的服务 Token 字符串列表。例如 `["IHomeworkAnalysisService"]`。其他插件可以通过 `ctx.resolve(token)` 消费由该插件提供的服务。

---

### 2.3 权限与能力声明 (`capabilitiesProposed`)

字符串数组，声明插件运行所需的受控能力凭证。宿主仅在插件清单显式声明了对应 Capability 时才会通过 `ICapabilityService` 授权：

- `"vfs:read"`, `"vfs:write"`: 虚拟文件系统读写
- `"storage:read"`, `"storage:write"`: 持久化存储
- `"ai:chat"`, `"ai:completion"`: AI 大模型调用权限
- `"process:execute"`: 子进程与系统任务触发权限

---

### 2.4 声明式 UI 贡献点 (`contributes`)

声明插件插入主应用 UI 的插槽与组件元数据：

- **`teacher.tab`**: 教师端导航栏/侧边栏新增页面标签。
  - `id`: 标签 ID
  - `label`: 展示文本
  - `icon`: Lucide 图标名称
  - `position`: 排序权重数值
- **`classroom.tool`**: 课堂互动工具箱工具。
  - `id`: 工具 ID
  - `name`: 工具名称
  - `commandType`: 点击时发起的 Command 类型
- **`teacher.dashboard.widget`**: 教师仪表盘小组件。
- **`student.view`**: 学生端导航视图。
- **`student.lesson.tool`**: 学生课中互动小工具。
- **`anchor:*`（锚点槽位，v0.2.6+）**: 在宿主某个原生按钮/元素**前后**插入插件按钮。
  - 槽位名遵循 `anchor:{页面或区域}:{锚点 id}` 约定，锚点 id 由宿主定义并公布（如 `anchor:whiteboard-toolbar:rollcall`）。
  - `id`: 扩展 ID
  - `label`: 按钮展示文本
  - `icon`: Lucide 图标名称
  - `placement`: `"before"` 插入锚点前 / `"after"` 插入锚点后（缺省 `"after"`）

示例：在「随机点名」按钮前插入一个按钮：

```json
"contributes": {
  "anchor:whiteboard-toolbar:rollcall": [
    { "id": "my-button", "label": "我的按钮", "icon": "Sparkles", "placement": "before" }
  ]
}
```

> 前端实际渲染由插件在 `activate(ctx)` 内**命令式**注册完成（`contributes` 仅用于管理后台预览/枚举）：
>
> ```ts
> ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
>   id: 'my-button',
>   label: '我的按钮',
>   placement: 'before',
>   component: () => import('./MyButton'),
> });
> ```
>
> 宿主必须在锚点按钮前后各渲染一次 `<ExtensionPointRenderer slot="anchor:..." placement="before|after" />`，插件按钮才会出现在对应侧。
>
> 完整锚点目录见 [`anchor-slots.md`](./anchor-slots.md)。

#### 2.4.1 国际化语言包与声明式文案 (`contributes.locales`) (Issue #148 新增)

插件可通过 `contributes.locales` 提供多语言本地化字典，支持两种声明形态：

1. **内联字典形态** (`Record<string, Record<string, string>>`)：

```json
"contributes": {
  "locales": {
    "zh": {
      "tab.title": "作业中心",
      "welcome": "欢迎使用作业批改系统"
    },
    "en": {
      "tab.title": "Homework Hub",
      "welcome": "Welcome to Homework Hub"
    }
  },
  "teacher.tab": [
    {
      "id": "homework-manager",
      "label": "%tab.title%",
      "icon": "BookOpen"
    }
  ]
}
```

2. **独立文件路径形态** (`Record<string, string>`)：

```json
"contributes": {
  "locales": {
    "zh": "locales/zh.json",
    "en": "locales/en.json"
  }
}
```

- **声明式 UI 国际化 (`%key%`)**：当槽位标签声明为 `%key%` 格式时（如 `label: "%tab.title%"`），宿主渲染器会自动按当前系统语言解析对应词条。
- **级联回退与防裸键泄露**：查找遵循 `当前语言 -> 默认语言 (zh) -> defaultValue -> 友好格式化`，杜绝未翻译的代码级键名直接暴露给终端用户。
- **运行时 API**：插件可在 `activate(ctx)` 中通过 `ctx.i18n.t(key, defaultValue?, params?)` 和 `ctx.i18n.getLanguage()` 消费多语言能力。

---

### 2.5 配置项声明 (`configuration`)

通过 `properties` 字段声明插件的可配参数，支持类型校验与默认值设定。平台会自动生成配置编辑界面，并允许插件通过 `ctx.config.get(key)` 访问：

```json
"configuration": {
  "properties": {
    "timeout": {
      "type": "integer",
      "default": 30,
      "minimum": 5,
      "maximum": 300,
      "description": "请求超时秒数"
    }
  }
}
```

#### 分层覆盖（Issue #151）

配置支持 **平台 → 学校 → 班级** 三层，解析顺序为 `班级 > 学校 > 平台 > manifest 默认值`。哪些配置项允许在更细的层级覆盖，由每个属性上的 `scope` 声明：

```json
"configuration": {
  "properties": {
    "weight": {
      "type": "number",
      "default": 10,
      "scope": ["platform", "class"],
      "description": "该插件在本班的评分权重"
    }
  }
}
```

- `scope` 缺省为 `["platform"]`：老插件行为不变，只有一层（写入平台层）。
- `platform` 始终隐含允许；`class` / `school` 必须显式声明后才能写入，未声明时 `set()` 会拒绝。
- `school` 层依赖多租户模型（Issue #149）。在其落地前，调用方可以显式传 `schoolId` 触发该层解析，但没有自动来源。

运行时读取：

```ts
// 平台值（等同旧行为）
const weight = ctx.config.get<number>('weight');

// 班级有效值：班级覆盖 > 学校覆盖 > 平台值 > 默认值
const classWeight = ctx.config.get<number>('weight', { classId });

// 一次取全部（同样支持 classId / schoolId）
const all = ctx.config.getAll({ classId });
```

写入（一般由管理端或平台 API 调用）：

```ts
await ctx.config.set('weight', 20); // 平台层
await ctx.config.set('weight', 30, { scopeType: 'class', scopeId }); // 班级覆盖
```

存储落点是 `plugin_config(plugin_id, scope_type, scope_id, key, value, updated_at)`（迁移 `037_plugin_config_scopes.sql`）。旧库升级时，`plugin_storage` 里的 `config:<key>` 值会原样搬到平台层；迁移未执行时 `ConfigService` 仍会回退读取旧位置。

---

### 2.6 静态资源与部署扩展 (`deploy`)

用于配置插件托管的静态资源路由（例如前端打包出的 HTML/JS/CSS 静态资源）：

- `staticRoute`: 挂载到 Express 主服务上的 URL 路由前缀（如 `/plugins/my-plugin/static`）。
- `staticDir`: 插件物理目录下的静态文件相对路径（如 `"public"` 或 `"dist/frontend"`）。

---

### 2.7 静态 RESTful API 路由与安全配置 (`api`)（v0.3.11 新增）

用于声明插件对外暴露的 HTTP RESTful 路由清单及其前置安全审计规则。主平台网关（`PluginApiGateway`）依据此处声明在将流量分发至插件前执行安全与 RBAC 拦截：

```json
"api": {
  "routes": [
    {
      "method": "GET",
      "path": "/public-status",
      "auth": false
    },
    {
      "method": "POST",
      "path": "/submissions/:id/grade",
      "auth": true,
      "roles": ["teacher", "administrator"],
      "rateLimit": {
        "max": 60,
        "windowMs": 60000
      }
    }
  ]
}
```

#### `api.routes` 数组属性说明：

| 属性名               | 类型       | 必填 | 默认值  | 说明                                                                                                                                                        |
| :------------------- | :--------- | :--- | :------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`             | `string`   | 是   | -       | HTTP 请求方法：`GET`, `POST`, `PUT`, `DELETE`, `PATCH`（不支持 `ALL`，需要多动词匹配时分别声明多条 route，或使用 `ctx.http.stream(method, path, handler)`） |
| `path`               | `string`   | 是   | -       | 相对子路径（如 `/status` 或 `/items/:id`），支持命名参数与通配符 `*`                                                                                        |
| `auth`               | `boolean`  | 否   | `true`  | 是否必须登录认证。设为 `false` 允许未认证访问（公开端点）                                                                                                   |
| `roles`              | `string[]` | 否   | `[]`    | 允许访问的用户角色白名单（如 `["teacher", "administrator"]`）。若为空则仅需认证，管理员总是具备最高访问权限                                                 |
| `rateLimit.max`      | `number`   | 否   | `120`   | 单 IP 在时间窗口内允许的最大请求次数（防刷防 DoS）                                                                                                          |
| `rateLimit.windowMs` | `number`   | 否   | `60000` | 滑动窗口时长（毫秒），默认 1 分钟（60000ms）                                                                                                                |

> **提示**：所有插件 RESTful API 统一挂载至宿主 `/api/plugins/:pluginId/*` 路径。在插件代码中通过 `ctx.http.get(...)` 注册具体的路由处理逻辑。

#### `api.baseRoute` —— 无路由作用（历史遗留字段）

`apiSchema` 接受 `baseRoute`，但**全仓没有任何代码按它挂载或匹配路由**。插件 REST 端点的真实路径固定为：

```
/api/plugins/<manifest.id>/<route.path>
```

两点常见误解：

1. **它不能改挂载前缀**。`baseRoute: "/api/plugins/exam-bank"` 不会让端点落在该路径下；真实路径由 `manifest.id` 决定。
2. **`manifest.id` 可以是多段形式**（如 `@teacher/plugin-exam-bank`）—— 市场 id 校验正则（`PLUGIN_ID_PATTERN`）允许 `/` 与 `@`。宿主网关会把 `/api/plugins/@teacher/plugin-exam-bank/questions` 正确重组为 `pluginId='@teacher/plugin-exam-bank'` + 子路径 `questions`（未编码形态同样支持；`%2F` 编码形态本就工作）。调用方自然拼 `/api/plugins/{manifest.id}/...` 即可，无需手工编码。

安装时宿主对声明了 `baseRoute` 的 manifest 输出一次告警。该字段保留仅为兼容存量 manifest，**新插件请忽略它**，不要在代码里依赖任何由它推导出的路径。

---

### 2.8 远端版本更新源声明 (`updateSource`)（SDK 3.4.3 / 平台 v0.3.10 新增）

声明插件检查版本升级的外部 Git 仓库或发布源。平台插件中心据此执行远端版本检测；当未配置时平台自动回退扫描本地 `v2_plugins/*/manifest.json` 进行 SemVer 版本比对。

> ⚠️ **校验口径**：`updateSource` 通过 manifest 的 passthrough 透传（**不在 Zod schema 强校验范围内**），安装期不会校验其取值；`repo` 的白名单校验（仅 `owner/repo` 形式的 GitHub / Gitee）发生在服务端触发更新检测时。

```json
"updateSource": {
  "type": "github-release",
  "repo": "owner/openlearn-plugin-homework-hub"
}
```

- `type`: 更新源类型，支持 `"github-release"` 或 `"gitee-release"`。
- `repo`: 仓库路径（`owner/repo`）。

---

## 3. 扩展点生命周期与弃用策略规范 (Extension Point Lifecycle & Deprecation Policy)

为保证平台在持续演进过程中插件生态的稳定性，OpenLearn 对扩展点（命令、事件、UI 插槽、DI 服务）建立了严格的生命周期与弃用策略（Issue #146）。

### 3.1 扩展点元数据契约

平台内核维护标准化的扩展点元数据契约（`CORE_EXTENSION_POINTS`）：

| 属性          | 类型                                          | 说明                                                                                                                         |
| :------------ | :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `string`                                      | 扩展点唯一标识符（如命令 `lesson.create`、事件 `quiz.answered`、插槽 `teacher.tab`、服务 `@openlearn/core:IStorageService`） |
| `kind`        | `'command' \| 'event' \| 'slot' \| 'service'` | 扩展原语种类                                                                                                                 |
| `description` | `string`                                      | 功能简述                                                                                                                     |
| `since`       | `string`                                      | 首次引入该扩展点的平台语义化版本（如 `"0.1.0"`）                                                                             |
| `deprecated`  | `string` (可选)                               | 标记弃用的平台版本（如 `"0.6.0"`）                                                                                           |
| `removedIn`   | `string` (可选)                               | 计划彻底移除该扩展点的目标版本（如 `"0.7.0"`）                                                                               |
| `replacement` | `string` (可选)                               | 推荐的官方替代扩展点或迁移指引（如 `"Use 'quiz.answered' instead"`）                                                         |

### 3.2 弃用策略与缓冲期约定

1. **至少 1 个 Minor 版本缓冲期**：任何扩展点一旦被标记为弃用（`deprecated`），平台承诺**至少保留 1 个完整的 minor 版本周期**（即在 `deprecated <= platformVersion < removedIn` 期间保持可用）。严禁在无弃用过渡期的情况下直接移除任何已发布的扩展点。
2. **渐进式生命周期流转**：
   - **Active (正常生效)**：`platformVersion >= since` 且未标记 `deprecated`。
   - **Deprecated (已弃用但在期内可用)**：`deprecated <= platformVersion < removedIn`。宿主在插件注册或调用时发射结构化警告，但不阻断执行。
   - **Removed (已移除并阻断)**：`platformVersion >= removedIn`。该扩展点不再被内核支持；声明其为必需依赖（`requires`）或调用其将触发不兼容错误。

### 3.3 运行时弃用告警机制

当插件在运行时注册或使用已弃用的扩展点时，宿主四大接入层将自动输出统一格式的结构化告警：

- **命令总线 (`CommandBus`)**：注册遗留处理器或执行弃用命令时触发；
- **事件总线 (`EventBus`)**：订阅或发布弃用事件时触发；
- **贡献注册表 (`ContributionRegistry`)**：遍历插件 manifest 声明的弃用 UI 插槽（`contributes`）时触发；
- **上下文构造器 (`ContextBuilder`)**：为插件依赖注入注入声明的弃用服务（`requires`/`optional`）时触发。

告警输出范式：

```
[DeprecationWarning] Plugin "plugin-id" is using deprecated <kind> "<name>" (deprecated since v0.6.0, will be removed in v0.7.0). Replacement: Use 'new-name' instead.
```

宿主内置单进程 Set 去重机制（`callerPluginId:kind:name`），防止高频调用与循环触发造成控制台刷屏。

### 3.4 升级前兼容性预检报告 (CLI Doctor)

在平台版本升级前，系统运维人员与开发者可通过命令行工具快速扫描已安装插件的兼容性状况：

```bash
# 对照当前版本运行预检
npx openlearn-next doctor --compat-report

# 指定升级目标版本运行预检
npx openlearn-next doctor --compat-report --target-version 0.7.0

# 快捷命令别名
npx openlearn-next compat-report --target-version 0.8.0
```

预检引擎将自动核验：

1. **Engines 约束**：检查各插件 `engines.openlearn` 是否满足目标版本范围；
2. **UI 插槽贡献**：扫描 `contributes` 中是否存在已弃用或将在目标版本移除的插槽；
3. **DI 服务依赖**：扫描 `requires` 与 `optional` 中声明的服务 Token 是否在目标版本已移除或已弃用；
4. **Commands / Events**：扫描插件显式声明的命令与事件生命周期。

报告汇总插件的兼容状态（`compatible`、`has_warnings`、`incompatible`），并在存在阻断性冲突时返回非零退出码（exit code 1），方便集成至 CI/CD 自动化部署前置检查中。
