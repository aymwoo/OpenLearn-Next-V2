# OpenLearn Developer Guide - Platform Kernel Bootstrap (开发者指南)

## 1. Executive Summary (概述)

本指南指导开发者如何通过 Platform Kernel 暴露的 `ServerBootstrapAdapter` 与 `PlatformBuilder`API 自定义开发与拓展平台启动逻辑。

---

## 2. Standard Bootstrap Usage (标准启动方法)

```typescript
import { ServerBootstrapAdapter } from './packages/core/bootstrap/index.js';

await ServerBootstrapAdapter.bootstrap({
  environment: 'development',
  config: { port: 9000 },
  kernelContainer: myKernelInstance,
});
```

---

## 3. Extending Bootstrap Stages (扩展启动阶段)

可以通过 `PlatformBuilder` 添加自定义启动阶段：

```typescript
import { PlatformBuilder, IBootstrapStage } from './packages/core/bootstrap/index.js';

const customStage: IBootstrapStage = {
  id: 'custom_check',
  name: 'CustomCheck',
  description: 'Custom pre-flight health check',
  execute: async (context) => {
    // Custom check logic
  },
};

const builder = PlatformBuilder.create().addBootstrapStage(customStage);
```
