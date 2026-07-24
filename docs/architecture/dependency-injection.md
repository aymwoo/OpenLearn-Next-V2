# Dependency Injection 依赖注入系统

OpenLearn V2 实现了强类型、基于 Token 的依赖注入（DI）系统。底层核心由 `packages/core/di/` 与 `@openlearn/plugin-sdk` 共同提供。

---

## 核心概念

### 1. Service Token (`Token<T>`)
`Token<T>` 是代表服务契约的唯一标识符。包含了服务名称与版本信息，保证编译期与运行期的双重类型安全。

```typescript
import { Token } from '@openlearn/plugin-sdk';

export interface ICustomService {
  doWork(): void;
}

export const ICustomServiceToken = new Token<ICustomService>(
  'ICustomService',
  '1.0.0'
);
```

### 2. ServiceRegistry (容器)
`ServiceRegistry` 负责存储与解算所有的服务 Token：

- `register<T>(token: Token<T> | string, instance: T): void`
- `resolve<T>(token: Token<T> | string): T`
- `has<T>(token: Token<T> | string): boolean`

---

## 核心系统 Token 一览表

在 `packages/core/di/interfaces.ts` 中定义了平台所有的核心服务 Token：

| DI Token | 对应的服务接口 | 作用描述 |
|---|---|---|
| `ICommandBusServiceToken` | `ICommandBusService` | 指令总线服务，负责系统指令分发 |
| `IEventBusServiceToken` | `IEventBusService` | 事件总线服务，支持事件发布与订阅 |
| `IActionRegistryServiceToken` | `IActionRegistryService` | 动作注册表，管理系统 API 动作 |
| `ICapabilityServiceToken` | `ICapabilityService` | 能力管理与策略评价网关 |
| `IProcessServiceToken` | `IProcessService` | 进程管理服务 |
| `IStorageServiceToken` | `IStorageService` | 持久化数据库存储服务 |
| `IAIServiceToken` | `IAIService` | AI 大模型对话与工具调用服务 |
| `IPluginHostToken` | `PluginHost` | 插件宿主服务 |
| `ILessonEngineServiceToken` | `ILessonEngineService` | 课程引擎服务 |
| `IClassroomRuntimeServiceToken` | `IClassroomRuntimeService` | 课堂实时运行时服务 |
| `IPresenceEngineServiceToken` | `IPresenceEngineService` | 在线感知与状态服务 |
| `ITeachingCollaborationServiceToken` | `ITeachingCollaborationService` | 教学协同与分组服务 |
| `ILearningAnalyticsServiceToken` | `ILearningAnalyticsService` | 学习分析与数据引擎服务 |
| `IAICapabilityServiceToken` | `IAICapabilityService` | AI 能力网关 |
| `IPlatformServiceRegistryToken` | `ServiceRegistryKernel` | 平台级服务注册表内核 |

---

## 依赖解算模式

在服务或插件中使用 Token 解算依赖示例：

```typescript
import { ServiceRegistry } from './packages/core/di/service-registry.js';
import { IStorageServiceToken, IAIServiceToken } from './packages/core/di/interfaces.js';

const registry = new ServiceRegistry();

// 解算存储服务
const storage = registry.resolve(IStorageServiceToken);
const aiService = registry.resolve(IAIServiceToken);
```
