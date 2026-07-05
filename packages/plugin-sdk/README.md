# @openlearn/plugin-sdk

OpenLearn 平台插件开发的类型定义包。

## 安装

```bash
npm install --save-dev @openlearn/plugin-sdk
```

## 使用

```typescript
import type { PluginContext, Manifest } from '@openlearn/plugin-sdk';
import { ICommandBusServiceToken } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: 'ext-my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    main: 'index.js',
    engines: { openlearn: '^2.5.0' },
    capabilitiesProposed: ['lesson:read'],
  } satisfies Manifest,

  async activate(ctx: PluginContext) {
    ctx.log.info('Plugin activated');
    // ...
  },
};
```

## 提供的内容

| 类别 | 导出 |
|------|------|
| 上下文 | `PluginContext`, `PluginDatabaseAPI`, `PluginInfo`, `IPluginLogger` |
| Manifest | `Manifest`, `ManifestV3` |
| 服务接口 | `ICommandBusService`, `IEventBusService`, `IActionRegistryService`, `ICapabilityService`, `IProcessService`, `IStorageService`, `IAIService` |
| Token | `ICommandBusServiceToken`, `IEventBusServiceToken`, ... (10 个 Token) |
| 命令/事件 | `PlatformCommand`, `PlatformEvent`, `CommandHandler`, `EventSubscriber` |
| 动作注册 | `ActionDescriptor` |
