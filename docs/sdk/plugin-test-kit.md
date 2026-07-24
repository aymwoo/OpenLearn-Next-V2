# Plugin Test Kit 工具包

`@openlearn/plugin-test-kit` (v3.3.1) 提供了 `createMockContext()` 测试桩，便于在 Vitest 中离线单元测试插件逻辑。

```typescript
import { createMockContext } from '@openlearn/plugin-test-kit';

const ctx = createMockContext({ pluginId: 'test-plugin' });
```
