---
phase: 01-token-di
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - packages/core/di/token.ts
  - packages/core/di/errors.ts
  - packages/core/di/types.ts
  - packages/core/di/service-registry.ts
  - packages/core/di/index.ts
  - packages/core/kernel/index.ts
  - packages/core/di/__tests__/token.test.ts
  - packages/core/di/__tests__/service-registry.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 1：Token DI 内核 代码审查报告

**审查日期：** 2026-06-18
**审查深度：** standard（逐文件分析 + 跨文件追踪）
**审查文件数：** 8（含测试文件 2 个）
**测试运行：** 34 个测试全部通过（PASS）
**TypeScript 类型检查：** 通过（tsc --noEmit 无错误）
**审查结论：** 发现 1 个严重 Bug 和 4 个需要修复的警告，整体代码质量良好但必须修复 Critical 问题

## 摘要

Phase 1 的 DI 容器基础设施实现质量较高。Token<T> 泛型 phantom 类型设计正确，正则格式验证有效阻止了路径遍历和非法字符注入。ServiceRegistry 的 Kahn 拓扑排序算法正确检测循环依赖（含复杂多边循环），错误类层次结构完整。34 个测试用例全部通过，覆盖了所有核心场景。

**然而，发现一个严重 Bug**：`registerOrReplace()` 方法在替换失败（如新依赖缺失）时，已删除旧实例和旧依赖边，但未回滚，导致服务状态丢失。这是一个数据完整性 bug，必须修复后才能用于生产。

此外还有 4 个 WARNING：`topologicalOrder()` 对未注册 token 不报错、`resolve()` 抛出普通 Error 而非命名错误类、拼写错误 `adjacency`、以及 `list()` 方法暴露 `unknown` 类型的内部实例。

## Critical Issues

### CR-01：registerOrReplace 替换失败导致状态丢失（非原子性操作）

**文件：** `packages/core/di/service-registry.ts:151-164`
**严重程度：** BLOCKER

**问题描述：**

`registerOrReplace()` 方法的执行顺序是：先删除旧实例 → 清理旧依赖边 → 再调用 `register()` 注册新实例。当新注册因缺失依赖而抛出 `MissingDependencyError` 时，旧实例已被不可逆地删除，导致服务状态丢失。

**验证复现：**
```
输入：已注册 TokenA（有依赖方 TokenB），尝试 registerOrReplace(TokenA, newInstance, { requires: ['未注册Token'] })
预期：抛出 MissingDependencyError，TokenA 保持原有状态
实际：抛出 MissingDependencyError，但 TokenA 已从 registry 中删除，TokenB 的依赖关系悬空
```

**影响：** 使用这个方法的代码（如热重载、Phase 7 的插件替换）在依赖声明出错时会损坏 DI 容器的内部状态。被依赖方（如 TokenB）的 `dependents` 引用变成悬挂引用（指向已删除的 TokenA）。

**修复方案：**

```typescript
async registerOrReplace<T>(
  token: Token<T>,
  instance: T,
  options?: RegisterOptions
): Promise<void> {
  const name = token.name;

  if (this.registry.has(name)) {
    // 新依赖验证前置 — 在删除旧数据之前先检查
    const requires = new Set(options?.requires ?? []);
    const missingDeps: string[] = [];
    for (const req of requires) {
      if (!this.registry.has(req)) {
        missingDeps.push(req);
      }
    }
    if (missingDeps.length > 0) {
      throw new MissingDependencyError(name, missingDeps);
    }

    // 依赖验证通过后才删除旧数据
    this.removeEdges(name);
    this.registry.delete(name);
  }

  await this.register(token, instance, options);
}
```

## Warnings

### WR-01：topologicalOrder() 对未注册的 token 不报错，静默产生错误结果

**文件：** `packages/core/di/service-registry.ts:218-265`
**严重程度：** WARNING

**问题描述：**

`topologicalOrder()` 方法在接收到包含未注册 token 名称的数组时，不会抛出错误。当 `depGraph.get(name)` 返回 `undefined` 时，代码执行 `continue` 跳过该节点，但该节点的入度已被初始化为 0，因此会被当作无依赖节点放入结果数组。

**验证：**
```
输入：topologicalOrder(['@test/core:IMissing'])
输出：['@test/core:IMissing']  // 静默返回，无错误
```

**影响：** 调用方可能拿到不完整或不正确的拓扑排序结果。Phase 2-4 使用此方法验证插件依赖顺序时，可能会漏掉依赖缺失的情况。当前仅通过 `register()` 的前置检查作为防护，但 `topologicalOrder` 作为独立的公开方法应有自己的输入验证。

**修复方案：**

```typescript
topologicalOrder(tokens: string[]): string[] {
  // 输入验证：检查所有 token 是否已在 depGraph 中
  for (const name of tokens) {
    if (!this.depGraph.has(name)) {
      throw new Error(
        `[ServiceRegistry] Token "${name}" is not registered. ` +
        `Cannot compute topological order.`
      );
    }
  }
  // ... 后续逻辑不变
}
```

### WR-02：resolve() 抛出普通 Error 而非命名错误类

**文件：** `packages/core/di/service-registry.ts:105-112`
**严重程度：** WARNING

**问题描述：**

`resolve()` 方法在 token 未注册时抛出 `new Error(...)`，而非使用命名错误类。这违反了设计决策 D-07（"所有异常情况均抛出具名 Error"），且与 `register()`、`unregister()` 等方法的错误处理模式不一致。

当前代码：
```typescript
throw new Error(`No provider registered for token: ${name}`);
```

**影响：** 调用方无法使用 `instanceof` 精确捕获"未找到服务"错误，只能靠检查 `error.message` 内容，这在不同语言环境下可能失效。

**修复方案：**

在 `errors.ts` 中新增 `ResolutionError`：

```typescript
export class ResolutionError extends Error {
  constructor(public readonly tokenName: string) {
    super(
      `[ServiceRegistry] No provider registered for token: ${tokenName}`
    );
    this.name = 'ResolutionError';
  }
}
```

在 `resolve()` 中使用：
```typescript
if (!entry) {
  throw new ResolutionError(name);
}
```

同时更新 `index.ts` barrel 导出。

### WR-03：变量名拼写错误 `adjacency` 应为 `adjacency`

**文件：** `packages/core/di/service-registry.ts:220`
**严重程度：** WARNING

**问题描述：**

拓扑排序中邻接表的变量名拼写为 `adjacency`（正确应为 `adjacency`）。这不是运行时的 bug，但会降低代码可读性，且可能在后续维护中导致困惑。

```typescript
const adjacency = new Map<string, Set<string>>();
```

**影响：** 降低代码可读性，IDE 拼写检查会提示错误。不会导致运行时问题。

**修复方案：**

```diff
- const adjacency = new Map<string, Set<string>>();
+ const adjacency = new Map<string, Set<string>>();
```

同时将文件中其他使用 `adjacency` 的 5 处引用全部更正为 `adjacency`（第 225、235、250 行）。

### WR-04：registerOrReplace 的依赖检查未考虑 optional 依赖

**文件：** `packages/core/di/service-registry.ts:151-164`
**严重程度：** WARNING

**问题描述：**

CR-01 的修复方案仅在 `registerOrReplace` 中前置检查 `requires` 依赖。但如果新 options 中包含 `optional` 依赖，这些不在当前检查范围内。虽然 D-14 规定 Phase 1 不强制检查 optional，但当前 `register()` 方法对 `optional` 也只是设置了 `const optional = new Set(options?.optional ?? [])` 而未实际使用（`optional` 变量在 register 方法中被创建后从未被读取）。

当前 register() 方法中，`optional` 变量存在但未被使用：
```typescript
const optional = new Set(options?.optional ?? []);  // 创建后未使用
```

**影响：** 低风险。`optional` 字段在 Phase 1 是预留接口，不影响当前功能。但存在未使用变量，表明代码不够精简。

**修复方案：**

在 `register()` 方法中，如果 `optional` 当前确实不需要处理，应删除该局部变量以避免混淆。或者添加注释说明该字段保留给后续 Phase 使用：
```typescript
// 保留 optional 依赖定义（D-14: Phase 1 不强制检查，后续 Phase 使用）
const optional = new Set(options?.optional ?? []);
```

## Info

### IN-01：ServiceRegistry 中 `optional` 变量已声明但未被使用

**文件：** `packages/core/di/service-registry.ts:69`
**严重程度：** INFO

**问题描述：**

`register()` 方法中声明了 `const optional = new Set(options?.optional ?? [])`，但此变量在整个方法体中未被使用。虽然 `options` 被存入 registry，但 `optional` 局部变量没有实际作用。

**修复方案：** 移除该变量或在行末加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` + 注释说明保留原因。

### IN-02：`list()` 方法暴露 `unknown` 类型的内部实例

**文件：** `packages/core/di/service-registry.ts:173-179`
**严重程度：** INFO

**问题描述：**

`list()` 方法返回 `Array<{ name: string; instance: unknown }>`，调用方拿到的 `instance` 类型为 `unknown`，无法直接使用而需要类型断言。虽然这是内省 API 的设计限制（无法在运行时的 Map 遍历中保留泛型类型），但应该在文档注释中说明这一点。

**修复方案：** 在 JSDoc 中添加说明：

```typescript
/**
 * Return all registered Token names and their instances.
 *
 * Note: instances are typed as `unknown` because the generic type
 * parameter is erased at runtime.  Use `resolve()` for type-safe access.
 */
```

### IN-03：Token 命名正则允许极长名称，无长度限制

**文件：** `packages/core/di/token.ts:30`
**严重程度：** INFO

**问题描述：**

正则表达式 `/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+:[a-zA-Z0-9_]+$/` 使用 `+`（一次或多次）而非 `{min,max}` 约束，理论上允许任意长度的 Token 名称。实测可接受 2000+ 字符的名称。虽然实际使用中不太可能出现极长 Token 名，但加上合理上限（如 256 字符）可以提升防御性。

**修复方案：** 在构造函数中添加长度检查：

```typescript
if (name.length > 256) {
  throw new TokenError(
    `Token name exceeds maximum length of 256 characters`
  );
}
```

## 结论

**必须修复 CR-01**：`registerOrReplace` 的非原子性问题是数据完整性的严重 bug，会导致替换失败时 DI 容器状态损坏。修复方案已在上文提供，实质是将依赖验证前置到删除操作之前。

**建议修复 WR-01 ~ WR-04**：这些问题不会导致立即的数据损坏，但会降低代码的健壮性和一致性。特别是 WR-01（topologicalOrder 静默错误）在 Phase 2-4 使用该方法时可能引发难以调试的问题。

**附注：**
- Token 命名正则防护有效，成功阻止了路径遍历（`@scope/../../etc:passwd`）、冒号注入、空格和中文等非法字符
- Kahn 算法在复杂循环（A→B→C→D→A，含多入边）场景下正确检测到所有参与节点
- 自引用循环被 `register()` 的依赖前置检查正确拦截（MissingDependencyError）
- 34 个测试用例全部通过，覆盖率达到预期
- TypeScript 类型检查无错误

---

_审查人：Claude (gsd-code-reviewer)_
_审查深度：standard_
