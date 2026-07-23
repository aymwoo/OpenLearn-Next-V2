# OpenLearn Developer Guide - Platform Permission Framework (开发者指南)

## 1. Executive Summary (概述)

本指南指导开发者如何使用 `PermissionManager` 注册平台基础设施权限描述符，授予或撤销 Subject 权限，以及执行 `check()` / `require()` 鉴权断言。

---

## 2. Registering and Checking Infrastructure Permissions (注册与校验权限)

```typescript
import {
  PermissionManager,
  PermissionDescriptor,
} from './packages/core/bootstrap/index.js';

const manager = new PermissionManager();

const capPerm: PermissionDescriptor = {
  id: 'perm_capability_invoke',
  name: 'Invoke Capability Permission',
  category: 'Capability',
  defaultPolicy: 'Allow',
};

manager.register(capPerm);

// Check permission
const context = await manager.check('kernel_worker', 'ai_capability', 'perm_capability_invoke');
if (context.result?.allowed) {
  // Proceed with capability invocation
}

// Enforce permission assertion (throws Infrastructure Permission Exception on deny)
await manager.require('trusted_service', 'config_store', 'perm_capability_invoke');
```
