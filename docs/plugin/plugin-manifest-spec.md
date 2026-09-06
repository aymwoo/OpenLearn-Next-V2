# 插件 Manifest 规范 (Plugin Manifest Specification)

每一个 OpenLearn V2 插件在根目录下必须包含一个 `manifest.json` 清单文件。宿主环境（`PluginHost`）在插件安装与激活时通过 **Zod Schema**（定义于 [`packages/core/esm-loader/manifest-schema.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/esm-loader/manifest-schema.ts#L86)）对其进行强制运行时校验。

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
  "optional": [
    "@openlearn/core:IAIService@^2.0.0"
  ],
  "pluginDependencies": [
    "@openlearn/plugin-vfs"
  ],
  "provides": [
    "IHomeworkAnalysisService"
  ],
  "capabilitiesProposed": [
    "storage:read",
    "storage:write",
    "ai:chat"
  ],
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
      { "method": "POST", "path": "/submissions/:id/grade", "auth": true, "roles": ["teacher", "administrator"], "rateLimit": { "max": 60, "windowMs": 60000 } }
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

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | **插件唯一标识符**。必须全局唯一，建议采用 snake-case 或带命名空间的格式（如 `@org/plugin-name`）。 |
| `name` | `string` | **显示名称**。用于管理后台面板和插件中心界面展示。 |
| `version` | `string` | **语义化版本号**（SemVer），如 `"1.0.0"`。 |
| `main` | `string` | **插件代码入口**相对路径（如 `"index.js"` 或 `"dist/index.js"`）。 |

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

字符串数组，声明插件运行所需的受控能力凭证。宿主仅在插件清单显式声明了对应 Capability 时才会通过 `CapabilityService` 授权：
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
> ```ts
> ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
>   id: 'my-button',
>   label: '我的按钮',
>   placement: 'before',
>   component: () => import('./MyButton'),
> });
> ```
> 宿主必须在锚点按钮前后各渲染一次 `<ExtensionPointRenderer slot="anchor:..." placement="before|after" />`，插件按钮才会出现在对应侧。
>
> 完整锚点目录见 [`anchor-slots.md`](./anchor-slots.md)。

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

| 属性名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `method` | `string` | 是 | - | HTTP 请求方法：`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `ALL` |
| `path` | `string` | 是 | - | 相对子路径（如 `/status` 或 `/items/:id`），支持命名参数与通配符 `*` |
| `auth` | `boolean` | 否 | `true` | 是否必须登录认证。设为 `false` 允许未认证访问（公开端点） |
| `roles` | `string[]` | 否 | `[]` | 允许访问的用户角色白名单（如 `["teacher", "administrator"]`）。若为空则仅需认证，管理员总是具备最高访问权限 |
| `rateLimit.max` | `number` | 否 | `120` | 单 IP 在时间窗口内允许的最大请求次数（防刷防 DoS） |
| `rateLimit.windowMs` | `number` | 否 | `60000` | 滑动窗口时长（毫秒），默认 1 分钟（60000ms） |

> **提示**：所有插件 RESTful API 统一挂载至宿主 `/api/plugins/:pluginId/*` 路径。在插件代码中通过 `ctx.http.get(...)` 注册具体的路由处理逻辑。

---

### 2.8 远端版本更新源声明 (`updateSource`)（v0.3.10+）

声明插件检查版本升级的外部 Git 仓库或发布源。平台插件中心据此执行远端版本检测；当未配置时平台自动回退扫描本地 `v2_plugins/*/manifest.json` 进行 SemVer 版本比对：

```json
"updateSource": {
  "type": "github-release",
  "repo": "owner/openlearn-plugin-homework-hub"
}
```

- `type`: 更新源类型，支持 `"github-release"` 或 `"gitee-release"`。
- `repo`: 仓库路径（`owner/repo`）。

