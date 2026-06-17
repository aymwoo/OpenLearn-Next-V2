# Phase 1: Token DI 内核 - Research

**Researched:** 2026-06-17
**Domain:** TypeScript 类型安全依赖注入容器（JupyterLab Token DI 模式）
**Confidence:** HIGH

## Summary

Phase 1 的目标是建立一个零外部依赖、纯 TypeScript 实现的依赖注入基础设施。参考 JupyterLab/Lumino 的 Token DI 设计模式，但完全自研实现，不引入 `@lumino/coreutils` 依赖（该包体积大且与项目无耦合点）。核心技术是两个纯逻辑类：`Token<T>` 泛型服务标识符和 `ServiceRegistry` 注册/解析/注销容器，使用 Kahn 拓扑排序算法实现依赖解析和循环检测。

JupyterLab 的 Token DI 模式经过 8+ 年生产环境验证，核心设计清晰且可完全独立重实现：`Token<T>` 本质是一个带泛型参数的包装类（携带字符串标识符），`ServiceRegistry` 是一个基于 `Map` 的注册表加依赖图拓扑排序器。Phase 1 不涉及任何外部服务调用、文件 I/O、数据库操作或异步逻辑，是最理想的纯逻辑单元测试引入点。

**Primary recommendation:** 采用 Kahn 算法实现拓扑排序和循环检测（O(V+E) 线性时间，错误信息清晰），ServiceRegistry 内部使用两个 `Map<string, ...>` 分别存储注册记录和依赖关系图。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token 定义与实例化 | API / Backend | 前端（Phase 9） | 纯数据结构，天然跨运行时兼容；后端先实现，前端后续复用 |
| 服务注册/解析 | API / Backend | 前端（Phase 9） | ServiceRegistry 在 Kernel 内运行，但接口设计预留浏览器兼容 |
| 拓扑排序依赖解析 | API / Backend | — | 纯算法逻辑，无运行时依赖 |
| 循环依赖检测 | API / Backend | — | 图论算法，无平台差异 |
| 内省 API（list/has/dependencies） | API / Backend | — | 纯数据结构遍历 |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** JupyterLab 显式风格 — `new Token<T>('@scope:name')` + `registry.register(token, instance)` 手动注册。不使用装饰器或 reflect-metadata，确保跨运行时零依赖兼容
- **D-02:** Token 命名规范 — 反向域名 scope + 冒号分隔符：`@openlearn/core:IServiceName`、`@openlearn/plugin:IQuizGenerator`
- **D-03:** 依赖声明格式 — manifest 中使用字符串标识符（`requires: ['@openlearn/core:ICommandBusService']`）。字符串比较避免跨 bundle 的 Token 对象 `===` 不匹配问题
- **D-04:** 完整泛型推导 — `Token<T>` 携带服务接口类型，`registry.resolve(token)` 返回类型 `T`（非 unknown），编译期类型安全
- **D-05:** 同步 register + async 接口预留 — `register(token, instance)` 同步执行，但方法签名声明为 async/返回 Promise，为 Phase 5 RPC proxy 预留异步签名
- **D-06:** Register 时检查依赖 — 注册时立即验证 requires 指向的 Token 是否已注册，早发现配置错误
- **D-07:** Fail-fast 抛异常 — 所有异常情况抛出具名 Error，错误信息包含 Token 名称和上下文
- **D-08:** 重复注册抛异常 — 同一 Token 注册两次抛错，同时提供 `registerOrReplace(token, instance)` 显式覆盖方法
- **D-09:** 级联注销阻止 — `unregister(token)` 若存在依赖方则抛错，强制开发者先手动注销依赖方
- **D-10:** 完整内省 API — 提供 `list()`、`has(token)`、`dependencies(token)`
- **D-11:** Kernel 新属性 — `kernelContainer.serviceRegistry`，作为 Kernel 的第 7 个子系统
- **D-12:** 文件组织 — `packages/core/di/` 目录，包含 `token.ts`、`service-registry.ts`、`index.ts` barrel
- **D-13:** 初始化时机 — ServiceRegistry 在 Kernel 构造函数中初始化
- **D-14:** 纯 DI + 接口预留 — Phase 1 只实现 register/resolve/unregister 核心逻辑，预留扩展点
- **D-15:** Token 不预留版本字段 — Phase 1 的 Token 只包含标识符字符串
- **D-16:** Phase 1 加入单元测试 — 为 Token 和 ServiceRegistry 编写测试
- **D-17:** vitest 作为测试框架
- **D-18:** 文件级 TypeScript strict 模式 — Token 和 ServiceRegistry 源码文件使用 typescript-strict-plugin

### Claude's Discretion
- 拓扑排序算法的具体实现（Kahn 算法 vs DFS）
- 循环依赖检测的具体数据结构
- registerOrReplace 的实现策略
- 内省 API 的返回格式
- Token 的唯一性保证机制（Symbol vs 字符串比较）
- 测试用例的具体组织和数量

### Deferred Ideas (OUT OF SCOPE)
无。讨论中未出现超出 Phase 1 范围的想法。

### Project Constraints (from CLAUDE.md)
- ESM 导入规范：后端代码使用 `.js` 扩展名的相对导入（`import { EventBus } from '../event-bus/index.js'`）
- 无装饰器生态：项目不使用装饰器、无 reflect-metadata 依赖
- console 日志惯例：使用 `[ServiceRegistry]` 前缀标签
- 文件组织：每个子系统一个目录 + index.ts barrel + 类导出
- SQLite 同步 API：DI 容器的 register 同步执行与此一致
- TypeScript 5.8，target ES2022，module ESNext，moduleResolution bundler
- Kernel 全局单例模式：在模块加载时实例化，ServiceRegistry 作为其属性
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-04 | Token 依赖注入系统——插件通过 `requires`/`optional` 声明对其他服务的依赖，基座在激活时解析并注入 | Token 类 + ServiceRegistry 提供完整 DI 基础设施。Phase 2-4 在此时机上构建 requires/optional 解析逻辑 |
</phase_requirements>

## Standard Stack

### Core（手写实现，零外部依赖）
| Component | 文件 | 目的 | 为何手写 |
|-----------|------|------|----------|
| Token&lt;T&gt; 类 | `packages/core/di/token.ts` | 类型安全的服务标识符 | JupyterLab `@lumino/coreutils` Token 引入整个 lumino 依赖树（~15 包），不必要。核心逻辑 <30 行 |
| ServiceRegistry 类 | `packages/core/di/service-registry.ts` | 注册/解析/注销容器 + 拓扑排序 + 循环检测 | 纯数据结构和图算法，无外部依赖需求 |
| barrel 导出 | `packages/core/di/index.ts` | 统一导出 Token + ServiceRegistry | 项目惯例 |

### 测试框架
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.9 | 单元测试运行器和断言 | Vite 团队官方出品，与项目已有的 Vite 6 零配置兼容；Node 24 原生支持 ESM [VERIFIED: vitest.dev + npm registry] |

### 文件级 Strict 模式
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript-strict-plugin | ^2.4.4 | 文件级 TypeScript strict 模式 | 参考 JupyterLab 惯例，由 Allegro 维护（MIT 协议，342+ stars）。在 opt-out 模型下，所有新文件自动 strict，不符合 strict 的文件添加 `// @ts-strict-ignore` [VERIFIED: npm registry + allegro/typescript-strict-plugin GitHub repo] |

### 关键发现：`// @ts-strict` 并非 TypeScript 原生功能
TypeScript 5.8 不包含 `// @ts-strict` 注释指令 [VERIFIED: TypeScript 官方文档 + release notes]。文件级 strict 模式需要通过 `typescript-strict-plugin` TypeScript 语言服务插件实现。该插件已在项目依赖中（CONTEXT.md 建立后安装）。插件的 v2.0+ "opt-out" 模型：所有文件默认 strict，仅在需要排除的文件中加 `// @ts-strict-ignore` 注释。对于 CI/构建时检查，使用 `tsc-strict` CLI 工具。

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 手写 Token&lt;T&gt; | `@lumino/coreutils` Token | lumino 作为依赖引入 ~15 个子包，增加 bundle 体积和依赖管理复杂度。Token 类核心逻辑极简（~20 行），手写零成本 |
| 手写 ServiceRegistry | `tsyringe` / `inversify` / `typedi` | 这些库依赖 `reflect-metadata` + 装饰器，违反 D-01 决策，且不支持浏览器环境。JupyterLab 模式更适合 |
| 手写拓扑排序 | `fast-toposort` / `graph-sequencer` | 引入额外 npm 依赖用于 ~30 行算法。Phase 1 范围极小，手写保证理解和调试便利 |
| vitest 4.x | vitest 3.x / jest | vitest 4.x 与 Vite 6 完美兼容，原生 ESM 支持，jest 需额外配置 ts-jest/transform |

**Installation:**
```bash
# 在项目根目录下（使用 pnpm，项目主要包管理器）
pnpm add -D vitest@^4.1.9
# typescript-strict-plugin 已安装（slopcheck 过程确认）
```

**Version verification:**
```bash
npm view vitest version          # => 4.1.9
npm view typescript-strict-plugin version # => 2.4.4
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| vitest | npm | ~4 yrs | 50M+/wk | github.com/vitest-dev/vitest | [SUS] (误报) | Approved — Vite 团队官方测试框架 |
| typescript-strict-plugin | npm | ~4 yrs | ~500K/wk | github.com/allegro/typescript-strict-plugin | [OK] | Approved |

**slopcheck 误报分析：** vitest 被标记为 `[SUS]`（"Suspiciously close to 'vite'. Could be a typosquat."）。这是误报——vitest 是 Vite 核心团队开发的官方测试框架（vitest.dev 官网，@vitest npm org），weekly downloads 5000 万+，GitHub 仓库 `vitest-dev/vitest` 拥有 14k+ stars。无 postinstall 脚本。可以安全使用。

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** vitest (已确认为 slopcheck 误报)

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        DI Container                              │
│                                                                  │
│  ┌──────────────┐     ┌──────────────────────────────────────┐  │
│  │   Token<T>   │     │         ServiceRegistry              │  │
│  │              │     │                                      │  │
│  │ - name:string│     │  ┌──────────────────────────────┐   │  │
│  │ + _T:(phantom)│    │  │  registry: Map<name, entry>  │   │  │
│  │              │     │  │  keyed by token.name         │   │  │
│  └──────┬───────┘     │  └──────────────────────────────┘   │  │
│         │             │                                      │  │
│         │ identifies  │  ┌──────────────────────────────┐   │  │
│         ▼             │  │  depGraph: Map<name, DepEdge>│   │  │
│  ┌──────────────┐     │  │  { requires: Set<name>,      │   │  │
│  │  Register    │────▶│  │    dependents: Set<name> }   │   │  │
│  │  (token, T)  │     │  └──────────────────────────────┘   │  │
│  └──────────────┘     │                                      │  │
│                       │  ┌──────────────────────────────┐   │  │
│  ┌──────────────┐     │  │  Kahn Topological Sort      │   │  │
│  │  Resolve     │────▶│  │  resolve → sort → instantiate│  │  │
│  │  (token) → T │     │  └──────────────────────────────┘   │  │
│  └──────────────┘     │                                      │  │
│                       │  ┌──────────────────────────────┐   │  │
│  ┌──────────────┐     │  │  Cycle Detection             │   │  │
│  │  Unregister  │────▶│  │  in-degree > 0 after sort    │   │  │
│  │  (token)     │     │  │  → named error + cycle list   │  │  │
│  └──────────────┘     │  └──────────────────────────────┘   │  │
│                       └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  ┌──────────────┐            ┌──────────────────┐
  │   Kernel     │            │  Error Handling  │
  │  .serviceReg │            │  DuplicateRegErr  │
  │  istry       │            │  NotFoundError    │
  └──────────────┘            │  CircularDepErr   │
                              │  HasDependentErr  │
                              └──────────────────┘
```

### Recommended Project Structure
```
packages/core/di/
├── token.ts               # Token<T> 泛型类定义
├── service-registry.ts    # ServiceRegistry 容器 + 拓扑排序
├── errors.ts              # 具名错误类（DuplicateRegistrationError 等）
├── types.ts               # 共享类型定义（ServiceEntry, DepEdge 等）
└── index.ts               # barrel 导出：Token, ServiceRegistry, 错误类, 类型
```

### Pattern 1: Token<T> 泛型 Phantom 类型
**What:** Token 类通过 phantom 类型参数携带服务接口类型信息，使 `resolve(token)` 返回类型 `T` 而非 `unknown`。
**When to use:** 每个需要从 DI 容器获取的服务都需定义一个 Token 实例。
**Example:**
```typescript
// Source: JupyterLab Lumino Token 设计模式 [CITED: jupyterlab-plugin-playground/#5]
// token.ts
export class Token<T> {
  // @ts-expect-error — phantom type parameter，仅用于类型推导，不在运行时使用
  private readonly _phantom: T;

  constructor(public readonly name: string) {
    if (!name || typeof name !== 'string') {
      throw new TokenError(`Token name must be a non-empty string, got: ${String(name)}`);
    }
    // 验证命名规范：@scope/domain:ServiceName
    if (!/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/.test(name)) {
      throw new TokenError(
        `Invalid Token name format: "${name}". Expected: @scope/domain:ServiceName`
      );
    }
  }
}
```

### Pattern 2: Kahn 拓扑排序依赖解析
**What:** 使用 Kahn 算法（BFS 入度队列法）按依赖顺序解析服务。O(V+E) 线性时间。被依赖的服务先注册，依赖它们的服务后注册。
**When to use:** `register()` 调用时验证依赖，`resolve()` 按拓扑顺序注入。
**Example:**
```typescript
// 基于 Kahn 算法标准实现 [CITED: CS 算法教材]
// service-registry.ts (核心逻辑伪代码)
private topologicalOrder(tokens: string[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  // 构建子图
  for (const name of tokens) {
    inDegree.set(name, 0);
    adjacency.set(name, new Set());
  }
  for (const name of tokens) {
    const deps = this.depGraph.get(name)?.requires ?? new Set();
    for (const dep of deps) {
      if (tokens.includes(dep)) {
        adjacency.get(dep)!.add(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  const result: string[] = [];

  // 入度为 0 的节点入队
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? new Set()) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // 循环检测：结果数量 != 输入数量
  if (result.length !== tokens.length) {
    const remaining = tokens.filter(t => !result.includes(t));
    throw new CircularDependencyError(remaining);
  }

  return result;
}
```

### Pattern 3: registerOrReplace 原子覆盖
**What:** 显式的覆盖注册方法，为 Phase 7 热重载预留。清除旧实例的依赖边，插入新实例和新的依赖声明。
**When to use:** Phase 7 热重载时使用，Phase 1 仅提供接口。
**Example:**
```typescript
// service-registry.ts
public async registerOrReplace<T>(token: Token<T>, instance: T, options?: RegisterOptions): Promise<void> {
  if (this.registry.has(token.name)) {
    this.removeEdges(token.name); // 清除旧依赖边
    this.registry.delete(token.name);
  }
  await this.register(token, instance, options);
}
```

### Pattern 4: 具名 Error 类层次结构
**What:** 每种异常情况对应一个具名 Error 子类，错误信息包含 Token 名称和上下文。
**When to use:** 所有错误抛出场景。
**Example:**
```typescript
// errors.ts
export class DuplicateRegistrationError extends Error {
  constructor(public readonly tokenName: string) {
    super(`[ServiceRegistry] Duplicate registration: "${tokenName}" is already registered. Use registerOrReplace() to overwrite.`);
    this.name = 'DuplicateRegistrationError';
  }
}

export class MissingDependencyError extends Error {
  constructor(public readonly tokenName: string, public readonly missingDeps: string[]) {
    super(`[ServiceRegistry] Cannot register "${tokenName}": missing dependencies: ${missingDeps.join(', ')}`);
    this.name = 'MissingDependencyError';
  }
}

export class CircularDependencyError extends Error {
  constructor(public readonly cycleTokens: string[]) {
    super(`[ServiceRegistry] Circular dependency detected involving: ${cycleTokens.join(' → ')}`);
    this.name = 'CircularDependencyError';
  }
}

export class HasDependentError extends Error {
  constructor(public readonly tokenName: string, public readonly dependents: string[]) {
    super(`[ServiceRegistry] Cannot unregister "${tokenName}": still has dependents: ${dependents.join(', ')}. Unregister them first.`);
    this.name = 'HasDependentError';
  }
}

export class TokenError extends Error {
  constructor(message: string) {
    super(`[Token] ${message}`);
    this.name = 'TokenError';
  }
}
```

### Anti-Patterns to Avoid
- **重复边缘导致误报循环依赖：** Kahn 算法中如果依赖图中存在重复边，会使入度计数膨胀但只递减一次，触发虚假循环检测。使用 `Set<string>` 而非数组存储依赖关系 [CITED: JasperFx/weasel PR #229]
- **使用 Token 对象 `===` 比较而非字符串名：** 跨 bundle/运行时环境中不同 import 的 Token 对象可能引用不同，应始终使用 `token.name` 字符串作为 Map 键 [CITED: jupyterlab-plugin-playground/#5]
- **参数化 Token 类型丢失：** `Map<string, any>` 存储服务实例会丢失类型信息。始终在公开 API 中使用泛型 `Token<T>` → `T` 的映射
- **同步 API 包裹在 async 函数中忘记返回值：** D-05 要求 async 签名预留，但 register 内部逻辑同步。确保所有 async 方法实际返回或 await Promise.resolve()

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 单元测试框架 | 自定义测试运行器 | vitest 4.x | Vite 原生集成，零配置 TypeScript 支持，与项目现有 Vite 6 一致 |
| 类型级 DI 装饰器 | `@injectable()` / `@inject()` | 显式 `token.register()` + `token.resolve()` | D-01 锁定：无装饰器设计 |
| 拓扑排序 + 循环检测 | `fast-toposort` npm 包 | 手写 Kahn 算法（~30 行） | 零依赖开销，完全受控的错误信息和循环 Token 列表 |
| 运行时 DI 框架 | `tsyringe` / `inversify` | 自建 Token DI | 这些框架依赖 reflect-metadata + 装饰器，违反 D-01，且不支持浏览器 |

**Key insight:** JupyterLab 的 Token DI 模式极其简约——Token 约 20 行，ServiceRegistry 约 150-200 行。引入任何 DI 框架都比完整手写实现更复杂且引入不需要的抽象层。

## Common Pitfalls

### Pitfall 1: typescript-strict-plugin 在 tsc --noEmit 中不生效
**What goes wrong:** 开发者认为加上 `// @ts-strict-ignore` 注释后 `tsc --noEmit`（`npm run lint`）会跳过 strict 检查，但实际上 TypeScript 语言服务插件仅在 IDE 中生效，CLI 编译时 strict 检查不会执行。
**Why it happens:** TypeScript 语言服务插件架构限制——`compilerOptions.plugins` 只在 VS Code/WebStorm 等编辑器中激活，不参与 `tsc` CLI 编译。
**How to avoid:** 在 `lint` 脚本中追加 `tsc-strict` 检查：`"lint": "tsc --noEmit && tsc-strict"`。`tsc-strict` 是 `typescript-strict-plugin` 配套的 CLI 工具，会在编译时应用 strict 规则到被注释排除之外的所有文件。
**Warning signs:** IDE 中显示 strict 错误但 CI 管道通过。

### Pitfall 2: Kahn 算法中的重复边导致虚假循环检测
**What goes wrong:** 当依赖图中有 `A depends on B` 声明两次（如 `requires: ['B', 'B']`），入度计数为 2 但实际只处理一次出边递减，导致 B 看似仍有未解析的依赖。
**Why it happens:** 使用数组而非 Set 存储依赖边时，重复声明的依赖使 in-degree 不准确。
**How to avoid:** 使用 `Set<string>` 存储依赖集合。在注册时去重：`new Set(requires)`。
**Warning signs:** 单元测试中简单依赖链报循环依赖错误。

### Pitfall 3: unregister 后依赖方持有悬挂引用
**What goes wrong:** 虽然有 D-09 阻止注销被依赖的服务，但注销依赖方后，被依赖服务的 dependents 集合中的引用可能残留。
**Why it happens:** 双向依赖图维护不完整——只清除了正向边（requires），忘记清除反向边（dependents）。
**How to avoid:** `unregister` 实现双重清理：(1) 检查 `dependents.size > 0` 阻止注销；(2) 遍历 `requires` 清理被依赖方中的反向引用。`registerOrReplace` 同样需清理旧实例的所有依赖边。
**Warning signs:** 内省 API `dependencies(token)` 返回已被注销的依赖方。

### Pitfall 4: Token 命名中的非法字符导致运行时问题
**What goes wrong:** Token 名称（如 `@openlearn/core:Service Name` 含空格）在后续 Phase 3 作为 URL 或文件路径的一部分时导致解析失败。
**Why it happens:** Token 命名规范在 Phase 1 仅作为字符串键，但 Phase 3 可能将其用作 data: URL 或文件名的一部分。
**How to avoid:** Token 构造函数中立即验证命名格式：`/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/`——仅允许字母数字、下划线、连字符。
**Warning signs:** Token 中包含空格、中文、特殊字符。

## Code Examples

### Token 定义和使用
```typescript
// Source: JupyterLab Token DI 模式 [CITED: jupyterlab-plugin-playground/#5]
// 服务接口定义（Phase 2 会完善，Phase 1 仅需概念验证）
interface ICommandBusService {
  execute(cmd: unknown): Promise<unknown>;
}

// Token 实例（导出为常量，确保跨文件 import 同一引用）
export const ICommandBusServiceToken = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService'
);

// 注册
await registry.register(ICommandBusServiceToken, commandBusInstance);

// 解析（返回类型推导为 ICommandBusService）
const cmdBus = await registry.resolve(ICommandBusServiceToken);
//    ^? const cmdBus: ICommandBusService
```

### ServiceRegistry 完整 API 形态
```typescript
// service-registry.ts
export interface RegisterOptions {
  requires?: string[];  // Token name 字符串数组
  optional?: string[];  // 可选依赖（Phase 1 不强制检查，预留）
}

export class ServiceRegistry {
  // 注册表：Token name → 服务实例 + 元数据
  private registry = new Map<string, {
    instance: unknown;
    options: RegisterOptions;
  }>();

  // 依赖图：Token name → { requires: Set<name>, dependents: Set<name> }
  private depGraph = new Map<string, {
    requires: Set<string>;
    dependents: Set<string>;
  }>();

  async register<T>(token: Token<T>, instance: T, options?: RegisterOptions): Promise<void> { /* ... */ }
  async resolve<T>(token: Token<T>): Promise<T> { /* ... */ }
  async unregister<T>(token: Token<T>): Promise<void> { /* ... */ }
  async registerOrReplace<T>(token: Token<T>, instance: T, options?: RegisterOptions): Promise<void> { /* ... */ }

  // 内省 API
  list(): Array<{ name: string; instance: unknown }> { /* ... */ }
  has<T>(token: Token<T>): boolean { /* ... */ }
  dependencies(tokenName: string): { requires: string[]; dependents: string[] } | undefined { /* ... */ }
}
```

### Kernel 集成点
```typescript
// Source: 现有 Kernel 类模式 [VERIFIED: packages/core/kernel/index.ts]
// 在 packages/core/kernel/index.ts 中：
import { ServiceRegistry } from '../di/index.js';

export class Kernel {
  public readonly eventBus: EventBus;
  public readonly commandBus: CommandBus;
  // ... 现有 6 个子系统
  public readonly serviceRegistry: ServiceRegistry; // 第 7 个子系统

  constructor() {
    this.serviceRegistry = new ServiceRegistry();
    this.eventBus = new EventBus();
    this.commandBus = new CommandBus(this.eventBus);
    // ... 其余初始化
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `kernelContainer.xxx` 直接访问子系统 | Token DI：`registry.resolve(token)` 注入服务 | Phase 2 | 解耦插件与 Kernel 单例，支持测试 mock |
| `vm.createContext` 包装器注入 | Token 标识的服务通过 DI 容器注入 | Phase 4 | 类型安全，声明式依赖 |
| 字符串 `'@openlearn/core:ICommandBusService'` 直接比较 | Token 对象 + `token.name` 字符串比较 | Phase 1 | 类型推导 + 跨 bundle 兼容 |

**Deprecated/outdated:**
- `@lumino/coreutils` Token 类：本项目不引入外部 lumino 依赖，Token 自研实现（与 lumino Token 接口兼容但无其他 15 个 lumino 子包依赖）
- `reflect-metadata` + 装饰器 DI：违反 D-01 决策，不支持浏览器

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | typescript-strict-plugin 的 `// @ts-strict-ignore` 注释和 `tsc-strict` CLI 工具的组合足以满足 D-18 "文件级 TypeScript strict 模式" 需求 | Standard Stack | 低。用户明确要求文件级 strict，且了解需配套工具。可在讨论阶段确认 |

**If this table is empty:** 不适用。

## Open Questions

1. **typescript-strict-plugin "opt-out" vs "opt-in" 模式选择**
   - What we know: v2.0+ 默认 opt-out 模式（所有文件 strict，仅注释排除的文件不 strict）。D-18 要求 Token 和 ServiceRegistry 源码文件使用 strict 模式
   - What's unclear: 用户期望新文件默认 strict（opt-out）还是按文件显式标记（opt-in）
   - Recommendation: 采用 opt-out 模式（插件默认行为）——新文件自动 strict，在 `di/` 目录中的文件无需特殊注释即获得 strict 检查。如果需要，在 tsconfig.json 的 plugins 配置中设置 `"paths": ["./packages/core/di"]` 限定范围

2. **Token 的 `Symbol` vs 字符串唯一性机制**
   - What we know: D-03 已决定使用字符串标识符进行比较。Token 构造时可附加一个内部 Symbol 用于同进程内快速引用比较
   - What's unclear: 是否需要额外存储 Symbol 以支持未来 Phase 6 的 SemVer Token Registry 优化
   - Recommendation: Phase 1 以 `token.name` 字符串作为唯一键（与 D-03 一致）。Symbol 在需要时（Phase 6）可作为 Token 的附加字段引入，不破坏现有接口

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Token/ServiceRegistry 运行时 | Yes | v24.1.0 | — (满足 >=20 要求) |
| pnpm | 包管理器 | Yes | 10.33.0 | npm（备选） |
| vitest | 单元测试 | No | — | 需安装：`pnpm add -D vitest@^4.1.9` |
| typescript-strict-plugin | 文件级 TS strict 模式 | Yes | 2.4.4 | — |
| tsc-strict | CI strict 类型检查 | No | — | 需安装：`pnpm add -D tsc-strict`（typescript-strict-plugin 配套 CLI） |

**Missing dependencies with no fallback:**
- vitest@^4.1.9 — 单元测试运行器，无替代方案（D-17 锁定）

**Missing dependencies with fallback:**
- tsc-strict — 可暂缓安装，IDE strict 检查通过后，后续 Wave 引入 CI strict 检查时再添加

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | `vitest.config.ts`（项目根目录，或 `packages/core/di/vitest.config.ts` — Wave 0 创建） |
| Quick run command | `npx vitest run packages/core/di/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | Token&lt;T&gt; 创建类型安全的服务标识符 | unit | `npx vitest run packages/core/di/__tests__/token.test.ts` | No — Wave 0 |
| SC-2 | register/resolve 基本注册解析 | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | No — Wave 0 |
| SC-3 | 拓扑排序依赖解析（requires） | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | No — Wave 0 |
| SC-4 | 循环依赖检测 + 错误信息含 Token 列表 | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | No — Wave 0 |
| SC-5 | unregister 注销 + resolve 抛 "No provider" | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | No — Wave 0 |

**额外测试覆盖（Claude's Discretion）：**
| Behavior | Test Type | Rationale |
|----------|-----------|-----------|
| 重复注册抛 DuplicateRegistrationError | unit | D-08 要求 |
| registerOrReplace 覆盖旧实例 | unit | D-08 要求 |
| 缺失依赖注册时抛出 MissingDependencyError | unit | D-06 要求 |
| unregister 有依赖方时抛 HasDependentError | unit | D-09 要求 |
| list() 返回所有已注册 Token | unit | D-10 要求 |
| has(token) 返回 boolean | unit | D-10 要求 |
| dependencies(token) 返回依赖子图 | unit | D-10 要求 |
| Token 命名格式验证 | unit | 防御性设计 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/core/di/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `tsc --noEmit` clean

### Wave 0 Gaps
- [ ] `vitest.config.ts` — vitest 配置文件（项目根目录或 di/ 目录下）
- [ ] `packages/core/di/__tests__/token.test.ts` — Token 单元测试
- [ ] `packages/core/di/__tests__/service-registry.test.ts` — ServiceRegistry 单元测试
- [ ] `package.json` — 添加 `"test": "vitest run"` 脚本
- [ ] vitest 框架安装：`pnpm add -D vitest@^4.1.9`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Phase 1 纯逻辑层，无认证需求 |
| V3 Session Management | No | 无会话管理 |
| V4 Access Control | No | Phase 1 纯逻辑层，无权限需求 |
| V5 Input Validation | Yes | Token 命名格式正则验证；`register()` 参数非空检查 |
| V6 Cryptography | No | 无密码学需求 |

### Known Threat Patterns for TypeScript DI Container

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prototype pollution via `register(token, maliciousInstance)` | Tampering | Token 携带类型约束，TypeScript 编译期阻止非接口兼容的实例注册；运行时无额外防护（Phase 5 Worker 隔离提供真正隔离） |
| 资源耗尽 via 大量注册 | Denial of Service | Phase 1 不防范——DI 容器注册量级由基座启动时可控（<100 个 Token） |

## Sources

### Primary (HIGH confidence)
- JupyterLab Plugin System 文档 [CITED: deepwiki.com/jupyterlab/jupyterlab/3.2-plugin-system] — Token DI 设计模式、requires/optional 声明、拓扑排序激活
- JupyterLab Token 比较机制 [CITED: github.com/jupyterlab/jupyterlab-plugin-playground/issues/5] — 字符串名 vs Token 对象引用问题
- 项目现有代码 `packages/core/kernel/index.ts` — Kernel 构造函数模式，子系统初始化顺序，单例导出 [VERIFIED]
- 项目现有代码 `packages/core/plugin-runtime/index.ts` — PluginRegistration 追踪模式，Map 结构 [VERIFIED]
- 项目现有代码 `packages/core/command-bus/index.ts` — Observable 风格 API 设计 [VERIFIED]
- 项目现有代码 `packages/core/event-bus/index.ts` — subscribe/publish 模式 [VERIFIED]
- 项目现有代码 `packages/core/registry/index.ts` — register/unregister 生命周期模式 [VERIFIED]
- vitest 官方文档 [VERIFIED: vitest.dev + npm registry]
- typescript-strict-plugin [VERIFIED: github.com/allegro/typescript-strict-plugin + npm registry]

### Secondary (MEDIUM confidence)
- Kahn 算法标准实现 [CITED: 计算机科学教材 + shikake Rust crate]
- JasperFx/weasel PR #229 [CITED: github.com/JasperFx/weasel/pull/229] — Kahn 算法重复边导致虚假循环检测的经验教训
- Allegro 博客 "How to turn on TypeScript strict mode in specific files" [CITED: blog.allegro.tech]

### Tertiary (LOW confidence)
- 无。所有结论均由至少一个 Primary 或 Secondary 来源支撑。

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 零外部依赖（手写 Token + ServiceRegistry），仅 vitest 和 typescript-strict-plugin 需要外部安装，两者均已确认版本和可用性
- Architecture: HIGH — JupyterLab Token DI 模式 8+ 年生产验证，Kahn 算法是标准图论算法，项目现有代码提供了确切的集成模式
- Pitfalls: HIGH — typescript-strict-plugin CLI vs IDE 差异由官方文档证实，Kahn 重复边问题由真实 PR 案例证实

**Research date:** 2026-06-17
**Valid until:** 2026-08-17（60 天——DI 容器核心接口稳定，后续 Phase 在此基础上构建，变更代价高）
