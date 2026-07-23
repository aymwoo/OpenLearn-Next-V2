# OpenLearn Product SDK Specification (产品层 SDK 扩展规范)

## 1. Overview (概述)

Product SDK 整合了 OpenLearn V2 产品层的所有功能扩展点，为开发团队与插件作者提供统一的入口机制。

---

## 2. Product Layer Extension Entrypoints (产品层扩展入口)

```typescript
// Product Layer Subsystems
export * from './src/features/workspace/index.js';
export * from './src/features/whiteboard/tool-system/index.js';
export * from './src/features/command-palette/index.js';
export * from './src/features/quick-insert/index.js';
export * from './src/features/interaction-runtime/index.js';
export * from './src/features/resource-runtime/index.js';
export * from './src/features/lesson-workflow/index.js';
export * from './src/features/activity-workflow/index.js';
export * from './src/features/classroom-runtime/index.js';
export * from './src/features/ai-classroom-context/index.js';
export * from './src/features/ai-action-api/index.js';
export * from './src/features/ai-skill-registry/index.js';
export * from './src/features/ai-teaching-workflow/index.js';
export * from './src/features/ai-prompt-registry/index.js';
export * from './src/features/ai-teacher-workspace/index.js';
```
