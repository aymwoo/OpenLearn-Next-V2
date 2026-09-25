# Verifiable Examples 可编译验证示例全集

包含符合 `@openlearn/plugin-sdk@3.7.0` 与 `@openlearn/plugin-test-kit@3.3.3` 契约的标准完整代码示例。

```typescript
import { Token } from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@example/my-plugin',
    name: '示例插件',
    version: '1.0.0',
    main: 'index.js', // 必填：入口文件
    capabilitiesProposed: ['vfs:read'],
  },
  activate: async (ctx: PluginContext) => {
    ctx.log.info('示例插件激活成功'); // 注意：PluginContext 上的日志服务是 ctx.log，不是 ctx.logger
  },
};
```
