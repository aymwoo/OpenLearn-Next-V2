# Verifiable Examples 可编译验证示例全集

包含符合 `@openlearn/plugin-sdk@3.5.2` 与 `@openlearn/plugin-test-kit@3.3.1` 契约的标准完整代码示例。

```typescript
import { Token } from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@example/my-plugin',
    name: '示例插件',
    version: '1.0.0',
    capabilitiesProposed: ['vfs:read'],
  },
  activate: async (ctx: PluginContext) => {
    ctx.logger.info('示例插件激活成功');
  },
};
```
