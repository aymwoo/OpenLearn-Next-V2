# `@openlearn/plugin-sdk` API 参考手册

`@openlearn/plugin-sdk` 包是 OpenLearn V2 插件开发者使用的官方类型定义与 Token 契约库（定义于 [`packages/plugin-sdk/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugin-sdk/index.ts)）。它仅包含 TypeScript 类型定义与 `Token<T>` 值，不含运行时逻辑，确保编译产物轻量。

---

## 1. 快速导入

```typescript
import type { PluginContext, Manifest } from '@openlearn/plugin-sdk';
import {
  Token,
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
  IAIServiceToken,
} from '@openlearn/plugin-sdk';
```

---

## 2. 核心类型: `PluginContext`

当插件被激活时，`PluginHost` 向 `activate` 入口函数传入 `PluginContext` 实例。

### 属性列表

#### `ctx.services`
包含 7 个受控内核核心服务的预解析代理：
- **`commandBus`**: `ICommandBusService` —— 注册与触发系统命令。
- **`eventBus`**: `IEventBusService` —— 订阅与发布跨系统事件。
- **`actionRegistry`**: `IActionRegistryService` —— 注册可被 AI 智能体调用的 Action 描述符。
- **`capability`**: `ICapabilityService` —— 运行时权限与 Capability 检查。
- **`processManager`**: `IProcessService` —— 管理受控后台进程。
- **`storage`**: `IStorageService` —— 插件专属键值存储。
- **`ai`**: `IAIService` —— 调用大语言模型（Gemini / OpenAI）。

#### `ctx.pluginId`
`string`，插件在宿主中的唯一实例 UUID。

#### `ctx.manifest`
`Manifest`，插件当前激活的 `manifest.json` 只读元数据对象。

#### `ctx.db`
`PluginDatabaseAPI`，插件自建表数据库 API。自动为所有表名添加 `plugin_${pluginId}_` 命名空间前缀：
- **`ensureTable(tableName: string, schema: string): Promise<void>`**: 保证表结构存在（幂等）。
- **`table(tableName: string): string`**: 获取带前缀的完整物理表名。
- **`migrate(targetVersion: number, upgradeFn: (db: any) => void): Promise<void>`**: 声明式版本迁移。

#### `ctx.log`
`IPluginLogger`，结构化日志工具。自动注入 `pluginId` 与高精度时间戳：
- `ctx.log.debug(msg, meta?)`
- `ctx.log.info(msg, meta?)`
- `ctx.log.warn(msg, meta?)`
- `ctx.log.error(msg, meta?)`

#### `ctx.contributions`
`ContributionAccessor`，只读内省工具。`ctx.contributions.list()` 可列出该插件声明的所有 UI 贡献点。

#### `ctx.config`
`IConfigService`，类型安全的配置服务。通过 `ctx.config.get("key")` 读取在 `manifest.configuration` 中声明的参数。

#### `ctx.require(moduleName: string)`
引用主应用共享模块白名单。仅允许引用：`recharts`, `react-markdown`, `jspdf`, `jspdf-autotable`, `xlsx`, `lucide-react`, `uuid`。

---

## 3. 依赖注入与 Token 系统 (DI System)

插件可以使用 `ctx.resolve(token)` 按需解析系统中的高级服务，或者使用 `ctx.provide(token, instance)` 向全平台共享自己的服务。

### 导出 Token 清单

> 完整 28 个 Token 的方法签名与标识字符串，请以 [DI Token 字典](../api/di-tokens) 为权威。下表列出最常用的 Token 速查。

| Token 常量名 | 服务接口类型 | 说明 |
| :--- | :--- | :--- |
| `IDatabaseToken` | `Database` | 原生 SQLite 数据库只读/写连接 |
| `ICommandBusServiceToken` | `ICommandBusService` | 命令总线服务 |
| `IEventBusServiceToken` | `IEventBusService` | 事件总线服务 |
| `IActionRegistryServiceToken` | `IActionRegistryService` | AI Action 注册表 |
| `ICapabilityServiceToken` | `ICapabilityService` | 权限能力服务 |
| `IProcessServiceToken` | `IProcessService` | 受控后台进程 |
| `IStorageServiceToken` | `IStorageService` | 键值存储 |
| `IAIServiceToken` | `IAIService` | AI 文本生成 |
| `IPluginHostToken` | `PluginHost` | 插件宿主对象（仅限管理插件） |
| `ILessonEngineServiceToken` | `ILessonEngineService` | 课程引擎控制接口 |
| `IClassroomRuntimeServiceToken` | `IClassroomRuntimeService` | 课堂实时运行时 |
| `IPresenceEngineServiceToken` | `IPresenceEngineService` | 在线状态感知引擎 |
| `ITeachingCollaborationServiceToken` | `ITeachingCollaborationService` | 协同教学引擎 |
| `ILearningAnalyticsServiceToken` | `ILearningAnalyticsService` | 学习分析与指标引擎 |
| `IPluginLifecycleManagerToken` | `PluginLifecycleManager` | 插件生命周期统一接口 |
| `IPluginDistributionManagerToken` | `PluginDistributionManager` | 插件分发与仓库管理 |
| `IPluginRuntimeCompositionToken` | `PluginRuntimeComposition` | 插件运行时组合 |
| `IUnifiedExtensionRegistryToken` | `UnifiedExtensionRegistry` | 统一扩展注册表 |
| `IPluginCapabilityGatewayToken` | `PluginCapabilityGateway` | 插件能力网关 |
| `ICapabilityRegistryToken` | `CapabilityRegistry` | AI 能力注册表 |
| `ISemesterGradeServiceToken` | `ISemesterGradeService` | 学期成绩 |
| `IPointsDimensionRegistryToken` | `IPointsDimensionRegistry` | 积分维度注册表 |
| `IPointsLedgerServiceToken` | `IPointsLedgerService` | 积分流水 |
| `IAICapabilityServiceToken` | `IAICapabilityService` | AI 能力网关 |
| `ICapabilityRuntimeServiceToken` | `ICapabilityRuntimeService` | 能力运行时内核（见[能力 Provider 框架](../reference/capability-provider-framework)） |
| `ICapabilityGovernanceServiceToken` | `ICapabilityGovernanceService` | 能力治理内核 |
| `IPlatformServiceRegistryToken` | `IPlatformServiceRegistryService` | 平台服务注册表 |
| `IActivityRegistryToken` | `ActivityRegistry` | 活动生态（见[活动生态开发指南](../reference/activity-ecosystem)） |

### 代码使用范例

#### 1. 解析内置服务 (`ctx.resolve`)
```typescript
import { IDatabaseToken } from '@openlearn/plugin-sdk';

export const MyPlugin = {
  manifest: { /* ... */ },
  activate: async (ctx: PluginContext) => {
    const db = await ctx.resolve(IDatabaseToken);
    const rows = db.prepare("SELECT * FROM users").all();
    ctx.log.info(`Fetched ${rows.length} users`);
  }
};
```

#### 2. 自定义服务声明与共享 (`ctx.provide`)
```typescript
import { Token } from '@openlearn/plugin-sdk';

export interface IAnalyticsCustomService {
  calculateScore(studentId: string): number;
}

export const IAnalyticsCustomServiceToken = new Token<IAnalyticsCustomService>('IAnalyticsCustomService');

export const ServiceProviderPlugin = {
  manifest: {
    id: "provider-plugin",
    provides: ["IAnalyticsCustomService"],
    // ...
  },
  activate: async (ctx: PluginContext) => {
    await ctx.provide(IAnalyticsCustomServiceToken, {
      calculateScore(studentId: string) {
        return 95;
      }
    });
  }
};
```
