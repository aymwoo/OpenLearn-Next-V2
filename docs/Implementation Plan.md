# OpenLearn Composition Root Implementation Plan (组合根实施方案)

## 1. Executive Summary (概述)

本实施方案详尽规划了 OpenLearn Platform Composition Root 的代码落地步骤。实施方案遵循“独立构建、步步可测、步步可运行、随时可回滚”的敏捷原则。

在 Architecture Sprint K1-B0 中，**未修改任何源代码**，仅完成实施计划的全面评审。

---

## 2. Implementation Execution Phases (实施阶段划分)

1. **Step 1 (Types & Context)**: 新建 `packages/core/bootstrap/types/index.ts` 及 `bootstrap-context.ts`。
2. **Step 2 (Pipeline & Stages)**: 新建 `packages/core/bootstrap/pipeline/bootstrap-pipeline.ts`，涵盖 6 阶启动阶段。
3. **Step 3 (PlatformBuilder & Test Suite)**: 新建 `platform-builder.ts`，并补全 `packages/core/__tests__/bootstrap.test.ts` 测试套件。
4. **Step 4 (Server Wiring)**: 接入 `server.ts`，完成 Composition Root 的主线程切换。
