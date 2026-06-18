---
phase: 01-token-di
plan: 01
subsystem: testing
tags: [vitest, token-di, typescript, unit-test]

# Dependency graph
requires: []
provides:
  - vitest 4.1.9 测试框架安装和配置
  - vitest.config.ts（include: packages/core/di/__tests__, environment: node）
  - package.json scripts.test = "vitest run"
  - packages/core/di/types.ts（RegisterOptions, ServiceEntry, DepEdge 共享类型接口）
  - packages/core/di/token.ts（Token<T> 泛型类，含 phantom type 和命名格式验证）
  - packages/core/di/errors.ts（5 个具名 Error 子类）
  - packages/core/di/__tests__/token.test.ts（17 个 Token 单元测试）
affects:
  - 02-service-registry
  - 03-kernel-integration

# Tech tracking
tech-stack:
  added: [vitest@4.1.9]
  patterns:
    - "Token<T> phantom type 泛型模式（JupyterLab 风格）"
    - "具名 Error 子类 + this.name 赋值（instanceof 检查和调试友好）"
    - "ESM .js 扩展名导入规范（后端 packages/ 下）"
    - "vitest describe/it/expect + it.each 参数化测试"

key-files:
  created:
    - vitest.config.ts
    - packages/core/di/types.ts
    - packages/core/di/token.ts
    - packages/core/di/errors.ts
    - packages/core/di/__tests__/token.test.ts
  modified:
    - package.json（添加 test 脚本，添加 vitest devDependency）
    - pnpm-lock.yaml

key-decisions:
  - "vitest 4.1.9 作为测试框架：Vite 原生生态，与项目已有 Vite 6 零配置兼容"
  - "Token 命名格式验证：正则 /^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/ 防止 Phase 3 URL/文件路径上下文中的注入风险"
  - "phantom type 使用 eslint-disable-next-line 而非 @ts-expect-error：项目未启用 noUnusedLocals，@ts-expect-error 反而触发 TS2578"

patterns-established:
  - "Token<T> phantom type: 编译期类型安全 + 运行时零开销"
  - "具名 Error 类层次结构: 每个异常类型对应独立 Error 子类，错误信息包含 Token name 和上下文"
  - "vitest it.each 参数化测试: 测试命名格式验证和合法格式接受"

requirements-completed: [PLUG-04]

# Metrics
duration: 7min
completed: 2026-06-18
---

# Phase 01 Plan 01: Token DI 基础设施和测试框架

**vitest 4.1.9 测试框架安装，Token<T> 泛型类含命名格式验证，5 个具名 Error 子类，17 个 Token 单元测试全部通过**

## 性能

- **Duration:** 7 min
- **Started:** 2026-06-18T06:18:51Z
- **Completed:** 2026-06-18T06:25:51Z
- **Tasks:** 2
- **Files modified:** 7

## 成果

- 安装 vitest 4.1.9 作为项目首个测试框架，创建 vitest.config.ts 配置
- 创建 packages/core/di/types.ts：RegisterOptions、ServiceEntry、DepEdge 三个共享类型接口
- 实现 Token<T> 泛型类：phantom type 参数、命名格式正则验证（@scope/domain:Name）、非空检查
- 创建 5 个具名 Error 子类：TokenError、DuplicateRegistrationError、MissingDependencyError、CircularDependencyError、HasDependentError
- 编写 17 个 Token 单元测试，覆盖创建、类型推导、空名拒绝、非法格式拒绝、合法格式接受、唯一性验证

## 任务提交

每个任务原子提交：

1. **Task 1: 安装 vitest 并创建测试配置和共享类型** - `0a1d469` (feat)
2. **Task 2: 实现 Token<T> 类和错误类，编写 Token 单元测试** - `ea2f7c9` (feat)

## 文件创建/修改

- `vitest.config.ts` - vitest 配置文件（include: packages/core/di/__tests__，environment: node）
- `packages/core/di/types.ts` - RegisterOptions、ServiceEntry、DepEdge 共享类型接口
- `packages/core/di/token.ts` - Token<T> 泛型类（phantom type + 命名格式验证）
- `packages/core/di/errors.ts` - 5 个具名 Error 子类（TokenError、DuplicateRegistrationError、MissingDependencyError、CircularDependencyError、HasDependentError）
- `packages/core/di/__tests__/token.test.ts` - 17 个 Token 单元测试
- `package.json` - 添加 test 脚本，添加 vitest devDependency
- `pnpm-lock.yaml` - 锁文件更新

## 决策

- vitest 4.1.9 作为测试框架：Vite 原生生态，与项目已有 Vite 6 零配置兼容
- Token 命名格式验证：正则 `/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/` 防止 Phase 3 URL/文件路径上下文中的注入风险
- phantom type 使用 eslint-disable-next-line 而非 @ts-expect-error：项目未启用 noUnusedLocals，@ts-expect-error 反而触发 TS2578

## 偏离计划

### 自动修复的问题

**1. [Rule 3 - Blocking] 修复 @ts-expect-error 指令在非 strict 模式下报错**
- **发现于:** Task 2（Token<T> 类实现）
- **问题:** `@ts-expect-error` 指令标记 phantom type 字段，但项目未启用 strict 模式，phantom type 不会产生 TS 错误，导致 TS2578 "Unused @ts-expect-error directive"
- **修复:** 将 `@ts-expect-error — phantom type` 替换为 `eslint-disable-next-line @typescript-eslint/no-unused-vars` 注释
- **修改文件:** packages/core/di/token.ts
- **验证:** `npx tsc --noEmit` 通过，di 目录零错误
- **提交于:** ea2f7c9（Task 2 提交的一部分）

---

**总偏离:** 1 自动修复（1 个阻塞问题）
**对计划的影响:** 所有自动修复为确保正确编译所必需，无范围蔓延。

## 遇到的问题

- pnpm 镜像源（registry.npmmirror.com）连接不稳定，切换到官方 registry（registry.npmjs.org）后成功安装 vitest
- 工作树中 pnpm 无法找到 vitest 二进制，通过直接调用 node_modules 中的 vitest.mjs 路径解决

## 用户设置要求

无 — 无外部服务配置需求。

## 下一阶段准备

- DI 共享类型（types.ts）和错误类（errors.ts）已就绪，为 Plan 02（ServiceRegistry）提供基础
- Test 基础架构已建立，Plan 02 可直接编写 ServiceRegistry 测试
- packages/core/di/ 目录结构已确立，遵循与其他 core 子系统一致的组织模式

---
*Phase: 01-token-di*
*Completed: 2026-06-18*
