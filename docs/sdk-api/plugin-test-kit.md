# Plugin Test Kit 单元测试工具包

`@openlearn/plugin-test-kit` (`packages/plugin-test-kit/`) 提供了用于隔离测试 OpenLearn V2 插件的 Mock 工厂与测试桩。

---

## 核心 API

### `createMockContext(options?: MockContextOptions): PluginContext`

创建完全符合 `PluginContext` 契约的模拟上下文对象，无需启动真实的 Platform Kernel 或 SQLite 数据库。

---

## 使用示例 (Vitest)

```typescript
import { describe, it, expect } from 'vitest';
import { createMockContext } from '@openlearn/plugin-test-kit';
import { activate } from '../src/index';

describe('My Plugin Tests', () => {
  it('should activate successfully', async () => {
    const ctx = createMockContext({
      pluginId: 'my-test-plugin',
    });

    await activate(ctx);
    expect(ctx.logger.info).toHaveBeenCalled();
  });
});
```
