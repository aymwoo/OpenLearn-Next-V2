# Plugin SDK API 参考手册

`@openlearn/plugin-sdk` (v3.3.1) 是 OpenLearn V2 插件开发者使用的标准 NPM 包。

---

## 安装与引入

```bash
npm install @openlearn/plugin-sdk@3.3.1
```

在插件代码中使用：

```typescript
import type { PluginContext, ManifestV3 } from '@openlearn/plugin-sdk';
import { Token, ICommandBusServiceToken } from '@openlearn/plugin-sdk';
```

---

## 导出 API 全集

### 1. 核心 Token 实体与 Class
- `Token`: 类型安全的 DI Token 构造类（`new Token<T>(name, version)`）。
- `BaseActivityProvider`, `defineActivityProvider`: 活动生态提供者定义帮助函数。

### 2. 导出接口 (Types & Interfaces)

| 类别 | 接口名称 |
|---|---|
| **上下文与生命周期** | `PluginContext`, `PluginDatabaseAPI`, `PluginInfo`, `PluginState`, `Disposable` |
| **基础配置与贡献** | `IConfigService`, `ContributionConfig`, `TeacherTabConfig`, `ClassroomToolConfig` |
| **Manifest 规范** | `Manifest`, `ManifestV3` |
| **核心 DI 服务 Tokens** | `ICommandBusServiceToken`, `IEventBusServiceToken`, `IStorageServiceToken`, `IAIServiceToken`, `ILessonEngineServiceToken`, `IClassroomRuntimeServiceToken`, `IPresenceEngineServiceToken`, `ITeachingCollaborationServiceToken`, `ILearningAnalyticsServiceToken` |
| **活动生态 (P7)** | `ActivityProvider`, `ActivityContext`, `ActivityCategory`, `IActivityRegistryToken` |
