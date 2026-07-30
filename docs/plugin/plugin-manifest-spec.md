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
    "openlearn": "^2.5.0"
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
指定要求的 OpenLearn 主应用平台版本号（SemVer 匹配）。例如 `"^2.5.0"` 表示仅允许在 `2.5.x` 及以上的宿主环境激活。

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
