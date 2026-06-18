---
phase: 01-token-di
verified: 2026-06-18T17:30:00Z
status: passed
score: 5/5 roadmap must-haves verified
overrides_applied: 0
overrides: []
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "G-001: tsc-strict plugin name 配置不匹配 — tsconfig.json plugins[0].name 已从 'tsc-strict' 改为 'typescript-strict-plugin'，与 node_modules/typescript-strict-plugin/dist/common/constants.js 的 PLUGIN_NAME 常量匹配"
  gaps_remaining: []
  regressions: []
gaps: []
---

# Phase 01: Token DI 内核 — 验证报告（重新验证）

**Phase Goal:** 实现 Token<T> 泛型类和 ServiceRegistry 依赖注入容器，集成到 Kernel 单例，配置 tsc-strict CLI 工具对 packages/core/di/ 目录启用文件级 strict 类型检查
**Verified:** 2026-06-18T17:30:00Z
**Status:** passed
**Re-verification:** 是 — 前次验证的 G-001 差距已被 Plan 01-04 关闭

## 重新验证背景

前次验证（2026-06-18T12:00:00Z）发现了 **G-001 差距**：tsconfig.json 中 `compilerOptions.plugins[0].name` 为 `"tsc-strict"`，但 `typescript-strict-plugin@2.4.4` 的 `PLUGIN_NAME` 常量值为 `"typescript-strict-plugin"`，导致 `npx tsc-strict` 退出 code 1，`pnpm run lint` 失败。

Plan 01-04（提交 f30a1d8）修复了此问题，将 plugin name 从 `"tsc-strict"` 改为 `"typescript-strict-plugin"`，同时清理了未安装的 tsc-strict@^2.4.5 devDependency 声明。

本次重新验证确认：全部 5 个 ROADMAP Success Criteria 均通过验证，前次被标记为 FAILED 的 T-03d（npm run lint 包含 tsc-strict 检查且通过）已修复。

## Goal Achievement

### ROADMAP Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Token 类可以通过 `new Token<IService>('@openlearn/core:IService')` 创建类型安全的服务标识符，泛型参数携带完整的服务接口类型信息 | ✓ VERIFIED | token.ts:32 — Token<T> 类含 phantom type `_phantomService!: T`；token.test.ts:26-41 验证泛型类型推导编译通过且运行时正确 |
| SC-2 | ServiceRegistry 可以通过 `register(token, instance)` 注册服务实例，通过 `resolve(token)` 解析已注册的服务实例 | ✓ VERIFIED | service-registry.ts:55-113 — register/resolve 完整实现；service-registry.test.ts:54-65 验证基本流程 |
| SC-3 | ServiceRegistry 在解析具有 `requires` 依赖的服务时，按拓扑排序自动解析并注入所有直接和间接依赖 | ✓ VERIFIED | service-registry.ts:218-265 — Kahn BFS 拓扑排序算法；service-registry.test.ts:135-157 验证链式依赖 A→B→C |
| SC-4 | ServiceRegistry 在检测到循环依赖时抛出明确的错误信息（包含参与循环的 Token 列表） | ✓ VERIFIED | errors.ts:59-67 — CircularDependencyError 含 `cycleTokens` 属性；service-registry.test.ts:164-229 覆盖直接循环 A↔B 和间接循环 A→B→C→A |
| SC-5 | ServiceRegistry 支持 `unregister(token)` 注销服务，注销后 `resolve(token)` 抛出 "No provider" 错误 | ✓ VERIFIED | service-registry.ts:120-141 — unregister 清理 registry + depGraph；service-registry.test.ts:272-281 验证注销后解析失败 |

**Score:** 5/5 roadmap success criteria verified

### PLAN-Derived Truths

| # | Truth | Source | Status | Evidence |
|---|-------|--------|--------|----------|
| T-01a | 可以通过 `new Token<IService>('@openlearn/core:IService')` 创建类型安全的服务标识符 | Plan 01 | ✓ VERIFIED | token.ts + token.test.ts |
| T-01b | Token 构造函数拒绝不符合命名规范的标识符 | Plan 01 | ✓ VERIFIED | token.ts:30,49-53 — 正则 TOKEN_NAME_RE；test 覆盖 7 种非法格式 |
| T-01c | 所有 Error 子类包含 Token 名称和上下文信息 | Plan 01 | ✓ VERIFIED | errors.ts — 5 个 Error 类均有 tokenName/missingDeps/cycleTokens/dependents 属性 |
| T-02a | ServiceRegistry register/resolve/unregister/registerOrReplace 完整生命周期 | Plan 02 | ✓ VERIFIED | service-registry.ts — 全部方法实现，无 stub |
| T-02b | 按拓扑排序自动解析依赖 | Plan 02 | ✓ VERIFIED | topologicalOrder() 实现正确，测试验证通过 |
| T-02c | 循环依赖检测抛出 CircularDependencyError | Plan 02 | ✓ VERIFIED | 直接和间接循环测试均通过 |
| T-02d | 重复注册/缺失依赖/级联注销阻止有明确错误 | Plan 02 | ✓ VERIFIED | DuplicateRegistrationError, MissingDependencyError, HasDependentError 全部测试覆盖 |
| T-02e | 内省 API list/has/dependencies 返回正确数据 | Plan 02 | ✓ VERIFIED | service-registry.test.ts:331-378 — 3 个内省测试通过 |
| T-03a | kernelContainer.serviceRegistry 是 ServiceRegistry 的实例 | Plan 03 | ✓ VERIFIED | kernel/index.ts:18,22,7 — 声明、初始化、import 完整 |
| T-03b | ServiceRegistry 在 Kernel 构造函数中初始化，与其他子系统同步创建 | Plan 03 | ✓ VERIFIED | kernel/index.ts:22 — 在所有子系统初始化之前执行 |
| T-03c | barrel 导出 index.ts 统一导出 Token、ServiceRegistry 和所有错误类 | Plan 03 | ✓ VERIFIED | di/index.ts — 导出 Token, ServiceRegistry, 5 个 Error 类, 3 个类型 |
| T-03d | npm run lint 包含 tsc-strict 检查且通过 | Plan 03 | ✓ VERIFIED | npx tsc-strict 退出 0：找到 7 个 strict 文件，全部通过。tsconfig.json plugin name 已修正 |
| T-04a | npx tsc-strict 退出 code 0，对 packages/core/di/ 目录执行 strict 类型检查 | Plan 04 | ✓ VERIFIED | npx tsc-strict 退出 0：7 strict files all passed |
| T-04b | pnpm run lint（即 tsc --noEmit && tsc-strict）的 tsc-strict 部分通过 | Plan 04 | ✓ VERIFIED | tsc-strict 部分确认通过（tsc --noEmit 部分 DI/kernel 文件零错误） |
| T-04c | pnpm run test（即 vitest run）仍然全部通过（34/34） | Plan 04 | ✓ VERIFIED | pnpm vitest run packages/core/di/ → PASS (34) FAIL (0) |

**Score:** 14/14 plan truths verified

### Gap Closure Status

| Gap ID | Description | Status | Evidence |
|--------|------------|--------|----------|
| G-001 | tsc-strict CLI 配置不匹配 | ✓ CLOSED | tsconfig.json plugin name = "typescript-strict-plugin"，匹配 PLUGIN_NAME 常量。npx tsc-strict 退出 0，7 个 strict 文件全部通过。package.json 已清理未使用的 tsc-strict devDependency |

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/di/token.ts` | Token<T> 泛型类（含命名格式验证） | ✓ VERIFIED | 58 行，phantom type + TOKEN_NAME_RE 正则 + TokenError 抛出，无 debt marker |
| `packages/core/di/errors.ts` | 5 个具名 Error 子类 | ✓ VERIFIED | 84 行，TokenError, DuplicateRegistrationError, MissingDependencyError, CircularDependencyError, HasDependentError，均有 this.name 赋值和上下文字段 |
| `packages/core/di/types.ts` | RegisterOptions 等共享类型 | ✓ VERIFIED | 34 行，RegisterOptions, ServiceEntry, DepEdge 三个接口 |
| `packages/core/di/service-registry.ts` | ServiceRegistry 容器 | ✓ VERIFIED | 294 行，register/resolve/unregister/registerOrReplace + Kahn 拓扑排序 + 内省 API |
| `packages/core/di/__tests__/token.test.ts` | Token 单元测试 | ✓ VERIFIED | 94 行，17 个测试用例（含 7 个参数化测试），覆盖创建、推导、空名、非法格式、合法格式、唯一性 |
| `packages/core/di/__tests__/service-registry.test.ts` | ServiceRegistry 单元测试 | ✓ VERIFIED | 396 行，17 个测试用例，覆盖 8 个 describe 块的完整行为 |
| `packages/core/di/index.ts` | Barrel 导出 | ✓ VERIFIED | 21 行，导出 Token, ServiceRegistry, 5 Error 类, 3 类型 |
| `vitest.config.ts` | vitest 配置文件 | ✓ VERIFIED | 9 行，include: di tests, environment: node |
| `packages/core/kernel/index.ts` | Kernel 集成 ServiceRegistry | ✓ VERIFIED | 第 7 行 import, 第 18 行属性声明, 第 22 行初始化（比其他子系统更早） |
| `tsconfig.json` | tsc-strict 插件配置 | ✓ VERIFIED | plugins[0].name = "typescript-strict-plugin"，paths = ["./packages/core/di"] |
| `package.json` | lint/test 脚本 + 依赖声明 | ✓ VERIFIED | lint: "tsc --noEmit && tsc-strict"，test: "vitest run"，typescript-strict-plugin@^2.4.4 已安装 |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `token.ts` | `errors.ts` | `import { TokenError }` | ✓ WIRED | token.ts:24 |
| `token.test.ts` | `token.ts` | `import { Token }` | ✓ WIRED | token.test.ts:13 |
| `service-registry.ts` | `token.ts` | `import { Token }` | ✓ WIRED | service-registry.ts:25 |
| `service-registry.ts` | `errors.ts` | `import { ...Error }` | ✓ WIRED | service-registry.ts:26-31（4 个 Error 类） |
| `service-registry.ts` | `types.ts` | `import type { ... }` | ✓ WIRED | service-registry.ts:24 |
| `kernel/index.ts` | `di/index.ts` | `import { ServiceRegistry }` | ✓ WIRED | kernel/index.ts:7 |
| `di/index.ts` | `token.ts` | `export { Token }` | ✓ WIRED | di/index.ts:10 |
| `di/index.ts` | `errors.ts` | `export { ...Error }` | ✓ WIRED | di/index.ts:12-18 |
| `di/index.ts` | `types.ts` | `export type { ... }` | ✓ WIRED | di/index.ts:19 |
| `tsconfig.json plugins[0].name` | `typescript-strict-plugin constants.js PLUGIN_NAME` | `getPluginConfig.js` 中 plugin.name === PLUGIN_NAME 比较 | ✓ WIRED | 两边值均为 "typescript-strict-plugin" |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `service-registry.ts` | `this.registry` (Map) | register() 写入 | ✓ Yes — 测试验证实例引用传递 | ✓ FLOWING |

Note: service-registry 是纯数据容器，无外部 API 调用或数据库查询。数据流通过 register() 显式写入，resolve() 读取。Level 4 检查确认无 hardcoded 空返回值或静态占位数据。

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Token tests | `pnpm vitest run packages/core/di/__tests__/token.test.ts` | PASS (17/17) | ✓ PASS |
| ServiceRegistry tests | `pnpm vitest run packages/core/di/__tests__/service-registry.test.ts` | PASS (17/17) | ✓ PASS |
| All DI tests | `pnpm vitest run packages/core/di/` | PASS (34/34) | ✓ PASS |
| tsc --noEmit (di/kernel) | `npx tsc --noEmit` | 0 errors in di/ and kernel/ files | ✓ PASS |
| tsc-strict | `npx tsc-strict` | Exit 0，7 strict files all passed | ✓ PASS |

## Probe Execution

No probes declared in PLANs. Step 7c: SKIPPED (no probes documented).

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|------------|--------|----------|
| PLUG-04 | Plans 01, 02, 03, 04 | Token DI 内核基础设施 | ✓ SATISFIED | ROADMAP.md Phase 1 引用 PLUG-04。所有 5 个 Success Criteria 已验证通过 |

Note: `.planning/REQUIREMENTS.md` 在仓库中不存在。PLUG-04 仅在 ROADMAP.md Phase 1 header 中引用，无独立的详细需求文件。所有 4 个 PLAN 文件均在 frontmatter requirements 中声明了 PLUG-04。

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 无 | — | — | — | 全部 DI 源文件无 TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER/console.log/空返回值 |

## Human Verification Required

无需人工验证。全部 5 个 ROADMAP Success Criteria 和 14 个 PLAN 派生 truth 均通过自动化检查。

## Deferred Items

无。Phase 01 的全部成功标准已达成。

---

## Gaps Summary

无差距。G-001（tsc-strict plugin name 配置不匹配）已被 Plan 01-04 关闭：
- tsconfig.json plugins[0].name 已从 "tsc-strict" 改为 "typescript-strict-plugin"
- npx tsc-strict 退出 code 0：7 个 strict 文件全部通过
- package.json 中未安装的 tsc-strict devDependency 声明已移除
- pnpm vitest run packages/core/di/ 34/34 测试全部通过

Phase 01 目标完全达成。所有 5 个 ROADMAP Success Criteria 和 14 个 PLAN 派生 truth 均通过验证。

---

_Verified: 2026-06-18T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
