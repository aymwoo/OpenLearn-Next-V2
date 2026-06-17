# Phase 1: Token DI 内核 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 01-token-di
**Areas discussed:** 设计哲学, Token 命名, 依赖格式, 集成方式, 错误处理, 生命周期预留, 类型推导, 文件组织, 同步/异步, 测试策略, 依赖检查时机, 级联注销, Token 版本预留, 测试工具选型, 重复注册, 调试 API, 初始化时机, TS 严格模式

---

## DI 容器设计哲学

| Option | Description | Selected |
|--------|-------------|----------|
| JupyterLab 显式风格 | `new Token<T>('@scope:name')` + registry.register(token, instance)。手动注册，显式控制，跨运行时兼容 | ✓ |
| 装饰器自动注入 | @injectable() + @inject() 装饰器模式。依赖 reflect-metadata，浏览器需 polyfill | |
| 两者混合 | 核心显式 Token 注册 + 装饰器语法糖可选层 | |

**User's choice:** JupyterLab 显式风格（推荐）
**Notes:** 与 ROADMAP 的 JupyterLab 参考一致，无 reflect-metadata 依赖

---

## Token 命名规范

| Option | Description | Selected |
|--------|-------------|----------|
| 反向域名 + 冒号 | `@openlearn/core:ICommandBusService`，类 Java 包名，冒号分隔 scope 和 name | ✓ |
| 斜杠层级 | `@openlearn/core/ICommandBusService`，URL 友好 | |
| 扁平命名 | `core.commandBus`，dot 分隔 | |

**User's choice:** 反向域名 + 冒号（推荐）
**Notes:** 符合 JupyterLab 惯例

---

## 依赖声明格式

| Option | Description | Selected |
|--------|-------------|----------|
| 字符串标识符 | `requires: ['@openlearn/core:ICommandBusService']`，跨 bundle 字符串比较 | ✓ |
| Token 对象引用 | `requires: [ICommandBusServiceToken]`，保留泛型类型推导 | |
| 混合模式 | 内部用 Token 对象，manifest 用字符串，通过 Token Registry 查找 | |

**User's choice:** 字符串标识符（推荐）
**Notes:** 避免跨 bundle Token 对象 !== 不匹配

---

## 集成方式

| Option | Description | Selected |
|--------|-------------|----------|
| Kernel 新属性 | `kernelContainer.serviceRegistry`，Kernel 第 7 个子系统 | ✓ |
| 独立于 Kernel | ServiceRegistry 完全独立模块 | |
| 替代 Kernel 构造函数 | Kernel 内部使用 ServiceRegistry 组装子系统 | |

**User's choice:** Kernel 新属性（推荐）
**Notes:** 与现有架构一致，渐进式引入

---

## 错误处理策略

| Option | Description | Selected |
|--------|-------------|----------|
| 抛出明确异常 | 重复注册、缺失依赖、循环依赖均抛出具名 Error | ✓ |
| 返回值 + 警告 | register 返回 boolean，resolve 返回 T \| null | |
| 可配置模式 | 开发抛异常，生产降级 warn + null | |

**User's choice:** 抛出明确异常（推荐）
**Notes:** Fail-fast 原则，开发者立即知道问题

---

## 生命周期预留

| Option | Description | Selected |
|--------|-------------|----------|
| 纯 DI + 预留接口 | Phase 1 只做 register/resolve/unregister，接口设计预留扩展点 | ✓ |
| 纯 DI + 不预留 | Phase 1 毫不考虑生命周期 | |
| 部分实现 | ServiceRegistry 实现基本 dispose 钩子 | |

**User's choice:** 纯 DI + 预留接口（推荐）
**Notes:** 接口设计预留 onDispose 回调签名，不实现具体逻辑

---

## 类型推导

| Option | Description | Selected |
|--------|-------------|----------|
| 完整泛型推导 | `Token<T>` → `resolve(token)` 返回 `T`，编译期类型安全 | ✓ |
| 运行时检查 + 标记 | 泛型仅作标记，resolve 返回 unknown | |
| 简化泛型 | Token 无泛型参数 | |

**User's choice:** 完整泛型推导（推荐）
**Notes:** 如 JupyterLab 的 Token<T>

---

## 文件组织

| Option | Description | Selected |
|--------|-------------|----------|
| packages/core/di/ | 新建 di/ 目录，与 command-bus/、event-bus/ 同级 | ✓ |
| packages/core/kernel/ 内 | Token 和 ServiceRegistry 放在 kernel/ 目录下 | |
| 独立顶级包 | packages/di/ 独立包 | |

**User's choice:** packages/core/di/（推荐）
**Notes:** 遵循现有 packages/core/ 模块化惯例

---

## 同步/异步

| Option | Description | Selected |
|--------|-------------|----------|
| 同步 register + 异步 resolve 预留 | register 同步，接口声明 async | ✓ |
| 全异步 | register 和 resolve 都是 async | |
| 全同步 | register 和 resolve 都同步 | |

**User's choice:** 同步 register + 异步 resolve 预留（推荐）
**Notes:** 为 Phase 5 RPC proxy 预留异步签名

---

## 测试策略

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 1 加入测试 | 为 Token 和 ServiceRegistry 写单元测试 | ✓ |
| Phase 1 不写测试 | 保持与项目现有风格一致（0 测试） | |
| 只写关键场景 | 只测试 5 个成功标准 | |

**User's choice:** Phase 1 加入测试（推荐）
**Notes:** DI 容器纯逻辑、无副作用，是建立测试文化的最佳起点

---

## 依赖检查时机

| Option | Description | Selected |
|--------|-------------|----------|
| Register 时检查 | 注册时立即验证 requires Token 是否已注册 | ✓ |
| Resolve 时检查 | resolve 时才拓扑排序解析 | |
| 混合检查 | register 时 best-effort，resolve 时补检 | |

**User's choice:** Register 时检查（推荐）
**Notes:** 早发现配置错误

---

## 级联注销

| Option | Description | Selected |
|--------|-------------|----------|
| 阻止注销 | unregister 被依赖服务时抛错 | ✓ |
| 自动级联注销 | 注销时递归注销依赖方 | |
| 标记 + 警告 | 标记 stale，resolve 时警告 | |

**User's choice:** 阻止注销（推荐）
**Notes:** 最安全，强制显式处理依赖

---

## Token 版本预留

| Option | Description | Selected |
|--------|-------------|----------|
| 不预留 | Phase 1 Token 只含标识符，Phase 6 通过 Token Registry 叠加 | ✓ |
| 预留 version 字段 | Token 构造函数接受可选 version 参数 | |
| 标识符内嵌版本 | Token 字符串内含 @1.0 后缀 | |

**User's choice:** 不预留（推荐）
**Notes:** 职责分离，避免 Phase 1 过度设计

---

## 测试工具选型

| Option | Description | Selected |
|--------|-------------|----------|
| vitest | Vite 生态原生，零配置，速度快 | ✓ |
| node:test | Node.js 内置，无额外依赖 | |
| jest | 最成熟但需要额外配置 | |

**User's choice:** vitest（推荐）
**Notes:** 与项目已有的 Vite 配置兼容

---

## 重复注册

| Option | Description | Selected |
|--------|-------------|----------|
| 抛异常 | 同一 Token 注册两次直接抛错 | ✓ |
| 覆盖旧实例 | 后注册静默覆盖 | |
| 双 API 模式 | 抛异常 + registerOrReplace() | |

**User's choice:** 抛异常（推荐）— 实际采用了双 API 模式（基础抛异常 + registerOrReplace 显式覆盖）
**Notes:** 兼顾安全性和 Phase 7 热重载需求

---

## 调试 API

| Option | Description | Selected |
|--------|-------------|----------|
| 完整内省 | list() + has(token) + dependencies(token) | ✓ |
| 最小化 | 只提供 has(token) + listTokens() | |
| 无内省 | ServiceRegistry 是黑盒 | |

**User's choice:** 完整内省（推荐）
**Notes:** 开发调试必备

---

## 初始化时机

| Option | Description | Selected |
|--------|-------------|----------|
| Kernel 构造时 | ServiceRegistry 在 Kernel 构造函数中初始化 | ✓ |
| server.ts 显式初始化 | 在启动流程中显式初始化 | |
| Lazy 初始化 | 首次使用时自动创建 | |

**User's choice:** Kernel 构造时（推荐）
**Notes:** 与现有子系统初始化模式一致

---

## TypeScript 严格模式

| Option | Description | Selected |
|--------|-------------|----------|
| 文件级 strict | Token 和 ServiceRegistry 源码使用 strict 模式，不改变全局 tsconfig | ✓ |
| 全局 strict | tsconfig.json 中开启 strict: true | |
| 与项目一致 | 不开启 strict | |

**User's choice:** 文件级 strict（推荐）
**Notes:** 新代码高标准，不影响现有代码

---

## Claude's Discretion

以下技术细节由下游 agent 自主决定：
- 拓扑排序算法的具体实现（Kahn 算法 vs DFS）
- 循环依赖检测的具体数据结构
- registerOrReplace 的实现策略
- 内省 API 的返回格式
- Token 的唯一性保证机制（Symbol vs 字符串比较）
- 测试用例的具体组织和数量

## Deferred Ideas

讨论中未出现超出 Phase 1 范围的想法——用户始终聚焦于 DI 容器的设计决策。
