# Dependency Injection 依赖注入容器

实现位于 `packages/core/di/`。平台基于类型安全的 `Token<T>` 实体管理服务。

```typescript
import { Token } from '@openlearn/plugin-sdk';

export const IMyServiceToken = new Token<IMyService>('IMyService', '1.0.0');

// 注册
kernel.serviceRegistry.register(IMyServiceToken, myServiceInstance);

// 解析
const myService = kernel.serviceRegistry.resolve(IMyServiceToken);
```
