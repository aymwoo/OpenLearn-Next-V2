---
phase: 06-eventbus-semver
verified: 2026-06-19T00:08:00Z
status: gaps_found
score: 16/16 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Kernel 构造函数中正确注册 7 个 IService 到 ServiceRegistry（D-14）"
    status: failed
    reason: "Phase 3 commit c50f14d 从 Kernel 构造函数移除了所有 serviceRegistry.register() 调用（Phase 2 新增的 7 个 IService 注册），Phase 4 和 Phase 5 也未能恢复。当前 Kernel 构造函数创建 ServiceRegistry 但未注册任何服务实例。这是 Phase 3 引入的回归，影响了 Phase 4、5、6 所有依赖 ServiceRegistry 解析服务的运行时路径。"
    artifacts:
      - path: "packages/core/kernel/index.ts"
        issue: "缺少 serviceRegistry.register() 调用 — 7 个 IService（IEventBusServiceToken, ICommandBusServiceToken, IActionRegistryServiceToken, ICapabilityServiceToken, IProcessServiceToken, IStorageServiceToken, IAIServiceToken）均未注册到 ServiceRegistry"
    missing:
      - "在 Kernel 构造函数中恢复 7 个 serviceRegistry.register() 调用（在 ServiceRegistry 初始化后、拦截器设置前）"
      - "恢复 StorageService 和 AIService 的创建和注册（storageService, aiService public 属性）"
      - "恢复 import 语句：ICommandBusServiceToken 等 7 个 Token + StorageService + AIService"
deferred:
  - truth: "Phase 6 计划的附加 IEventBusService 功能"
    addressed_in: "Phase 2 (已完成)"
    evidence: "DISCUSSION-LOG.md 确认'保持现有接口不变 — Phase 2 已定义接口、Phase 5 EventForwarder 已验证跨 Worker 事件转发'。IEventBusService 接口、Token、以及 buildContext() 中的 ctx.services.eventBus 已在 Phase 2/4 实现。Phase 6 无需新增 IEventBusService 代码。"
---

# Phase 6: EventBus 服务 + SemVer 兼容 Verification Report

**Phase Goal:** 实现全局事件总线服务 IEventBusService（统一异步事件 API）和 Token 语义化版本兼容系统（插件声明 ICommandBusService@^1.0，基座在激活时检查版本兼容性）

**Verified:** 2026-06-19T00:08:00Z

**Status:** gaps_found

**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Token 实例携带 version 语义化版本号（默认 1.0.0） | VERIFIED | packages/core/di/token.ts:45 — `constructor(name: string, version: string = '1.0.0')` 带 public readonly version 属性 |
| 2 | ServiceRegistry.register() 自动存储 Token 的 version 到 ServiceEntry | VERIFIED | packages/core/di/service-registry.ts:84 — `{ instance, options: options ?? {}, version: token.version }` |
| 3 | ServiceRegistry.getVersion(tokenName) 返回已注册 Token 的版本号 | VERIFIED | packages/core/di/service-registry.ts:140-143 — `getVersion(tokenName): string \| undefined` |
| 4 | ServiceRegistry.resolveByName(tokenName) 通过字符串查询已注册服务 | VERIFIED | packages/core/di/service-registry.ts:123-129 — 已有完整实现 |
| 5 | SemverMismatchError 抛出时包含 pluginId, tokenName, requiredRange, actualVersion, 人类可读 message | VERIFIED | packages/core/plugin-host/errors.ts:85-100 — 5 个 public readonly 字段 + 人类可读 super() message |
| 6 | semver npm 包可正常 import 使用 | VERIFIED | package.json:37 — `"semver": "^7.8.4"`; node -e 验证通过 |
| 7 | manifest.json 的 requires/optional 支持 @scope:IServiceName@^1.0.0 带版本后缀的格式 | VERIFIED | packages/core/esm-loader/manifest-schema.ts:28-31 — requiresItemSchema regex 支持 @[\^~]?version |
| 8 | manifest.json 的 requires/optional 无 @version 后缀时向后兼容 | VERIFIED | packages/core/esm-loader/manifest-schema.ts:28-31 — regex 末尾 `(?:@...)?` 使 @version 可选 |
| 9 | manifestSchemaV3 旧版 schema 导出可用 | VERIFIED | packages/core/esm-loader/manifest-schema.ts:195-204 — manifestSchemaV3 导出，具有严格无 @version regex |
| 10 | parseRequiresEntry() 正确解析 @scope:IName@^1.0.0 为 { tokenName, versionRange } | VERIFIED | packages/core/esm-loader/manifest-utils.ts:36-62 — 第三级 @ 分割策略 |
| 11 | parseRequiresEntry() 处理无 @version 格式时 versionRange 返回 null | VERIFIED | packages/core/esm-loader/manifest-utils.ts:52-57 — 未找到第二 @ 时返回 null |
| 12 | PluginHost.activatePlugin() 在 buildContext 前检查 manifest.requires 的 Token 版本兼容性 | VERIFIED | packages/core/plugin-host/index.ts:482-483 — manifestSchema.parse() 后立即调用 checkSemVerCompatibility |
| 13 | 版本不兼容时抛出 SemverMismatchError，激活被拒绝 | VERIFIED | packages/core/plugin-host/index.ts:190-213 — 对 requires 中不兼容条目抛出 SemverMismatchError |
| 14 | Optional 依赖版本不匹配时跳过注入（ctx.services 中该 key 为 null）+ console.warn | VERIFIED | packages/core/plugin-host/index.ts:217-228 — console.warn + Set 收集; packages/core/plugin-host/context-builder.ts:414-434 — null 注入 |
| 15 | 插件可通过 `if (ctx.services.someService === null)` 做降级处理 | VERIFIED | packages/core/plugin-host/context-builder.ts:430 — `services[serviceKey] = null as never` 在 freeze 前设置 |
| 16 | PluginRuntime.installPlugin() 在安装时做版本预检查 | VERIFIED | packages/core/plugin-host/index.ts:365-367 — installPlugin() 在 DB INSERT 前调用 checkSemVerCompatibility |

**Score:** 16/16 truths verified

### Deferred Items

Items not yet met but explicitly addressed in other phases.

| #   | Item | Addressed In | Evidence |
| --- | ---- | ------------ | -------- |
| 1   | 新增 IEventBusService 功能 | Phase 2 (已完成) | DISCUSSION-LOG.md: 保持现有接口不变，Phase 2 已定义接口、Phase 5 EventForwarder 已验证跨 Worker 事件转发 |
| 2   | Kernel IService 注册 | Phase 3 (需要修复) | Phase 3 引入的回归：c50f14d 移除了 Kernel 中所有 serviceRegistry.register() 调用，Phase 4-6 均未恢复 |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| packages/core/plugin-host/errors.ts | SemverMismatchError | VERIFIED | 类存在，5 个结构化字段，extends PluginHostError，[PluginHost] 前缀 |
| packages/core/di/token.ts | Token 新增 version 参数 | VERIFIED | constructor(name, version='1.0.0')，public readonly version |
| packages/core/di/types.ts | ServiceEntry 新增 version 字段 | VERIFIED | version: string 字段 |
| packages/core/di/service-registry.ts | 版本存储 + getVersion + resolveByName | VERIFIED | register() 存储 version；getVersion() 方法；resolveByName() 已实现 |
| packages/core/esm-loader/manifest-schema.ts | 扩展的 manifest schema | VERIFIED | requiresItemSchema regex；manifestSchema；manifestSchemaV3 |
| packages/core/esm-loader/manifest-utils.ts | parseRequiresEntry 函数 | VERIFIED | 文件存在，导出的函数完整 |
| packages/core/plugin-host/index.ts | checkSemVerCompatibility | VERIFIED | 私有方法，返回 Set<string>，被 installPlugin/activatePlugin 调用 |
| packages/core/plugin-host/context-builder.ts | skipTokens 支持 | VERIFIED | buildContext 第 6 个参数 skipTokens?；TOKEN_TO_SERVICE_KEY 映射；null 注入 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| service-registry.ts | types.ts | register() stores ServiceEntry.version | WIRED | Line 84: `{ ... version: token.version }` |
| plugin-host/index.ts | errors.ts | SemverMismatchError imported | WIRED | Line 35: `SemverMismatchError` in import block |
| plugin-host/index.ts | manifest-utils.ts | parseRequiresEntry imported | WIRED | Line 28: `import { parseRequiresEntry }` |
| plugin-host/index.ts | service-registry.ts | getVersion() called in checkSemVerCompatibility | WIRED | Line 188: `this.serviceRegistry.getVersion(tokenName)` |
| plugin-host/index.ts | context-builder.ts | skipTokens passed to buildContext | WIRED | Line 492: `skipTokens` as 6th arg |
| plugin-host/index.ts | manifest-schema.ts | manifestSchema.parse() called before check | WIRED | Line 480: `manifestSchema.parse(manifest)` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| Token.version | version | Constructor param | ✓ — '1.0.0' default or explicit | FLOWING |
| ServiceEntry.version | version | token.version at register() time | ✓ — flows from Token constructor | FLOWING |
| checkSemVerCompatibility | actualVersion | serviceRegistry.getVersion() | ✗ — Kernel 未注册服务，getVersion() 全部返回 undefined | DISCONNECTED |
| buildContext resolve | commandBusService etc. | serviceRegistry.resolve(Token) | ✗ — Kernel 未注册服务，resolve() 全部抛出 "No provider" | DISCONNECTED |

**Critical finding:** Data-flow is broken at the Kernel level. All Phase 6 code is correctly structured and wired, but the Kernel has not registered any services since Phase 3 (commit c50f14d). This is a pre-existing regression that affects ALL phases from Phase 3 through Phase 6.

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points that can test Phase 6 behaviors in isolation without starting the full server)

### Probe Execution

Step 7c: SKIPPED (no probe scripts declared for this phase)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PLUG-07 | 06-01, 06-03 | 全局事件总线服务 IEventBusService — 插件通过此服务订阅/发布事件 | SATISFIED (pre-existing) | IEventBusService 接口在 Phase 2 定义（interfaces.ts:84），Token 已创建（interfaces.ts:275），buildContext() 提供 ctx.services.eventBus（context-builder.ts:373）。Phase 6 保持现有接口不变。 |
| PLUG-09 | 06-01, 06-02, 06-03 | Token 语义化版本兼容 — 插件声明依赖 Token 的版本范围，基座在激活时检查版本兼容性 | SATISFIED | Token.version (06-01), manifestSchema @version regex (06-02), PluginHost.checkSemVerCompatibility (06-03) 完整实现。所有 106 个相关测试通过。 |

**Orphaned Requirements:** None — PLUG-07 and PLUG-09 are the only requirements mapped to Phase 6, and both are accounted for in the plans.

### Anti-Patterns Found

No anti-patterns (TBD, FIXME, XXX, placeholder, stub, empty implementations) found in any of the Phase 6 modified files.

### Human Verification Required

None.

---

## Gaps Summary

### Gap 1 (CRITICAL — Pre-existing Regression): Kernel Missing IService Registrations

**Truth:** Kernel 构造函数中正确注册 7 个 IService 到 ServiceRegistry

**Status:** FAILED (not a Phase 6 issue, but a pre-existing regression from Phase 3)

**Root Cause:** Phase 3 commit `c50f14d` (ESM 加载 + 包格式) restructured the Kernel constructor and accidentally **removed** all 7 `serviceRegistry.register()` calls that were added in Phase 2 commit `2d41739`. Phase 4 commit `05cccfb` re-added the ServiceRegistry itself but NOT the register calls. Phase 5 commit `112cea4` added WorkerManager but also did not restore the registrations.

**Evidence:**
- `git show c50f14d -- packages/core/kernel/index.ts` shows ALL Phase 2 IService registration lines removed:
  ```
  -import { ICommandBusServiceToken, IEventBusServiceToken, ... } from '../di/interfaces.js';
  -import { StorageService } from '../di/storage-service.js';
  -import { AIService } from '../di/ai-service.js';
  ...
  -this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
  -this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
  ... (7 register calls total)
  ```
- Current `packages/core/kernel/index.ts` has NO `serviceRegistry.register()` calls (confirmed by grep)
- `npx vitest run` shows 5 pre-existing failures in `interfaces.test.ts` — all due to empty ServiceRegistry
- All 7 Tokens (`IEventBusServiceToken`, `ICommandBusServiceToken`, etc.) are defined and exported from `packages/core/di/interfaces.ts` but never registered

**Impact:**
1. `serviceRegistry.resolve(AnyToken)` — throws "No provider" for ALL service tokens
2. `serviceRegistry.getVersion(anyTokenName)` — returns `undefined` for all tokens, causing SemVer check to always fail
3. `PluginHost.activatePlugin()` via `buildContext()` — fails on the first `serviceRegistry.resolve()` call (line 372-378 of context-builder.ts)
4. `ctx.services.eventBus` — cannot be constructed because the resolve call fails
5. ALL Phase 6 functionality is blocked at runtime

**Evidence from test suite:**
```
FAIL  packages/core/di/__tests__/interfaces.test.ts
Error: No provider registered for token: @openlearn/core:IEventBusService
Error: No provider registered for token: @openlearn/core:IAIService
AssertionError: expected 0 to be greater than or equal to 7  (serviceRegistry.list() empty)
```

**Note on scope:** This regression was introduced in Phase 3 and missed by Phases 4 and 5 verification as well. It is NOT a Phase 6 defect. However, it blocks Phase 6's runtime functionality and must be resolved before Phase 6 can be verified as achieving its goal.

**To fix:** Add the following to `packages/core/kernel/index.ts` constructor (between ServiceRegistry initialization and interceptor setup):
```typescript
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../di/interfaces.js';
import { StorageService } from '../di/storage-service.js';
import { AIService } from '../di/ai-service.js';

// In constructor, after creating serviceRegistry:
this.storageService = new StorageService(this.db);
this.aiService = new AIService(this.db);

this.serviceRegistry.register(IEventBusServiceToken, this.eventBus as any);
this.serviceRegistry.register(ICapabilityServiceToken, this.capabilityGuard as any);
this.serviceRegistry.register(IStorageServiceToken, this.storageService);
this.serviceRegistry.register(ICommandBusServiceToken, this.commandBus as any);
this.serviceRegistry.register(IActionRegistryServiceToken, this.actionRegistry as any);
this.serviceRegistry.register(IProcessServiceToken, this.processManager as any);
this.serviceRegistry.register(IAIServiceToken, this.aiService);
```

---

## Summary

### What Phase 6 Delivered Successfully

Phase 6 delivered a complete Token 语义化版本兼容系统 across 3 plans:

1. **Token.version + ServiceRegistry version tracking** (Plan 06-01): Token class got an optional `version` constructor parameter (default '1.0.0'), ServiceEntry got a `version` field, ServiceRegistry got `getVersion()` method, and SemverMismatchError was created.

2. **Manifest schema @version extension** (Plan 06-02): `manifestSchema` requires/optional items support `@scope:IServiceName@^version` format via regex, `manifestSchemaV3` is exported for backward compatibility, and `parseRequiresEntry()` utility converts entry strings to structured `{ tokenName, versionRange }` objects.

3. **PluginHost SemVer compatibility check** (Plan 06-03): `checkSemVerCompatibility()` private method performs dual checking (install-time + activation-time), required deps throw SemverMismatchError on mismatch, optional deps are collected and injected as `null` via buildContext(skipTokens) per D-12.

All 16 must-have truths are verified. All 106 related tests pass. No anti-patterns were found. No regressions were introduced (the 5 pre-existing Kernel IService failures remain unchanged).

### What Blocks Goal Achievement

The **Kernel IService registration regression** (introduced in Phase 3) is a CRITICAL pre-existing issue that prevents ALL Phase 6 functionality from operating at runtime. Without this fix, `serviceRegistry.resolve()` throws for every token, `getVersion()` returns undefined, and `buildContext()` cannot construct the plugin context.

This is NOT a Phase 6 defect, but it must be resolved for Phase 6 to achieve its goal.

### Next Steps

1. Fix the Kernel constructor to restore the 7 `serviceRegistry.register()` calls (restore Phase 2 intent)
2. Run full test suite to verify the fix resolves the 5 pre-existing test failures
3. Verify Phase 6 functionality end-to-end (install plugin with @version requires, check SemVer rejection, verify D-12 null injection)

---

_Verified: 2026-06-19T00:08:00Z_
_Verifier: Claude (gsd-verifier)_
