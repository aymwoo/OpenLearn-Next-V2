# OpenLearn Developer Guide - AI Runtime Integration (开发者指南)

## 1. Executive Summary (概述)

本指南指导开发者如何在 OpenLearn V2 平台中接入 AI Runtime，使用 `AICompositionModule` 进行全局依赖装配，并消费注册的 AI 服务与 AI 能力。

---

## 2. Using AI Composition Module in Bootstrap Flow (在启动流中挂载 AI 模块)

```typescript
import {
  PlatformBuilder,
  PlatformCompositionRoot,
  AICompositionModule,
} from './packages/core/bootstrap/index.js';

// 1. Initialize Platform Builder & Composition Root
const builder = PlatformBuilder.create();
const compositionRoot = PlatformCompositionRoot.create();

// 2. Register AI Composition Module
compositionRoot.registerModule(new AICompositionModule());
compositionRoot.compose({ environment: 'development' });

// 3. Build Platform Result
const result = builder.buildResult();
```
