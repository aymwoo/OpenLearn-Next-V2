# OpenLearn Developer Guide - Platform Module Catalog (开发者指南)

## 1. Executive Summary (概述)

本指南汇总了 OpenLearn 平台开发中平台内核、集成层与模块注册表 (`PlatformModuleRegistry`) 的协同用法。

---

## 2. Using Platform Module Registry (使用模块注册表)

```typescript
import { PlatformModuleRegistry } from './packages/core/bootstrap/index.js';

const registry = new PlatformModuleRegistry();
// Register top-level module metadata
registry.register({
  id: 'mod_lesson_engine',
  name: 'lesson-engine',
  displayName: 'Lesson Flow Engine',
  version: '2.0.0',
  description: 'Lesson timeline and state machine engine',
  category: 'Core',
  status: 'Active',
  health: { isHealthy: true, status: 'Healthy' },
});
```
