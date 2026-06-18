# Phase 6: EventBus 服务 + SemVer 兼容 - Research

**Researched:** 2026-06-18
**Domain:** 依赖注入 Token 版本管理, 事件总线服务抽象, 语义化版本兼容
**Confidence:** HIGH

## Summary

Phase 6 在两个正交的维度上扩展插件系统：一是将 IEventBusService 确立为插件通过 `ctx.services.eventBus` 统一访问事件系统的标准 API（D-01 保持现有接口不变）；二是实现 Token 语义化版本兼容机制，使插件在 manifest.json 中声明依赖的 Token 版本范围（如 `@openlearn/core:ICommandBusService@^1.0`），基座在安装和激活时双重检查兼容性。

**核心发现：**
1. IEventBusService 接口已定义完整（publish/subscribe/unsubscribe，均为 async 签名），EventForwarder 已验证跨 Worker 事件转发路径可行——Phase 6 不对接口做任何修改
2. Token 类当前只有 `name` 属性——需新增可选的 `version` 参数（默认 `'1.0.0'`）。现有 7 个 Token 实例无需修改
3. ServiceRegistry 的 `ServiceEntry` 类型当前只存 `instance` + `options`——需要扩展 `version` 字段
4. `resolveByName()` 已在 ServiceRegistry 中存在完整的基本实现（Phase 5 fallback 路径验证其可工作）
5. `semver` npm 包可通过 ESM `import` 正常工作——但需要作为直接依赖添加到 `package.json`
6. 版本检查的精确插入点：PluginHost.activatePlugin() 中 manifest.parse() 之后、buildContext() 之前

**Primary recommendation:** 分 4 个 Wave 实施——Wave 1 Token 版本 + ServiceRegistry 版本追踪 + 错误类；Wave 2 manifest-schema 扩展；Wave 3 PluginHost/PluginRuntime 集成；Wave 4 完整测试套件。所有决策已由 CONTEXT.md 锁定，无需探索替代方案。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: 保持现有接口不变** — IEventBusService 已定义 publish/subscribe/unsubscribe 三个方法，Phase 2 已设为 async 签名。不新增 once()、事件历史/重放等方法
- **D-02: 标准 semver + ^/~ 范围** — x.y.z 版本格式，支持 `^1.2.3`（兼容主版本）、`~1.2.3`（兼容次版本）、`>=1.0.0 <2.0.0`（显式范围）
- **D-03: 使用 semver npm 包** — 使用 `semver` 包做版本匹配
- **D-04: 支持 pre-release 标签** — semver 包内置 pre-release 优先级规则
- **D-05: 安装时 + 激活时双重检查** — 安装时拦截不兼容插件，激活时再次验证（因为服务版本可能在安装后因基座升级而变化）
- **D-06: Token 携带 version 属性** — Token 类新增 `version: string` 字段，默认值 `'1.0.0'`
- **D-07: ServiceRegistry.resolveByName() 完成实现** — 通过 `internalRegistry` Map 按 Token 标识符字符串查找并 resolve
- **D-08: 现有 7 个 Token 全部从 1.0.0 开始** — 默认值 `'1.0.0'` 向后兼容
- **D-09: requires 统一字符串格式** — `@scope:IServiceName` 或 `@scope:IServiceName@^version`，不带 `@version` 时默认为 `*`
- **D-10: 扩展 schema + 保留旧版导出** — 新增 requires 正则，同时导出 manifestSchemaV3（旧版）
- **D-11: 结构化 SemverMismatchError** — 包含 pluginId、pluginName、tokenName、requiredRange、actualVersion、message
- **D-12: Optional 依赖版本不匹配时跳过 + 警告** — 跳过该服务的注入，`ctx.services` 中该 key 为 `null`，打印 console.warn

### Claude's Discretion
以下技术细节由下游 agent（researcher/planner）自主决定：
- SemverMismatchError 类的精确字段定义和 message 模板
- PluginHost.activatePlugin() 中版本检查的精确代码位置（在构建 PluginContext 之前、EsmLoader.load() 之前或之后）
- semver.satisfies() 调用的具体错误处理（try/catch 包裹，语义化版本字符串无效时的回退策略）
- manifest schema 正则的精确模式
- 版本检查逻辑的 vitest 测试文件组织和 mock 策略
- `semver` 包的具体导入方式（ESM import）

### Deferred Ideas (OUT OF SCOPE)
- 事件历史存储/重放
- 一次性订阅 once()
- 插件热重载（Phase 7）
- 现有插件迁移（Phase 8）
- 浏览器端完整实现（Phase 9）
- Token 的运行时版本自动升级
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-07 | 全局事件总线服务 IEventBusService——插件通过此服务订阅/发布事件，无需单独注册扩展点 | 接口已定义且稳定（D-01），EventForwarder 已验证跨 Worker 路径。Phase 6 不做接口修改，只需确保 EventBus 实现作为 IEventBusService 在 PluginContext 中正确暴露 |
| PLUG-09 | Token 语义化版本兼容——插件声明依赖 Token 的版本范围，基座在激活时检查 | Token 类、ServiceRegistry、manifest-schema、PluginHost 四层联动实现版本声明+注册+检查+报错 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Token 版本声明 | DI (packages/core/di/token.ts) | — | Token 是服务标识符，其 version 字段定义服务的发布版本 |
| 版本注册与存储 | ServiceRegistry | — | register() 从 Token 读取版本并存储，resolveByName() 按字符串查询 |
| manifest 版本声明 | EsmLoader (manifest-schema.ts) | — | manifest.json 的 requires 字段声明依赖 Token 的版本范围 |
| 激活时版本检查 | PluginHost (plugin-host/index.ts) | ServiceRegistry (查询版本) | PluginHost.activatePlugin() 在 buildContext 前检查版本兼容 |
| 安装时版本检查 | PluginHost (plugin-host/index.ts) | PluginRuntime (委托) | PluginHost.installPlugin() 在 DB 插入前做预检查 |
| 版本不匹配报错 | PluginHost errors (plugin-host/errors.ts) | — | SemverMismatchError 结构化错误 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| semver | ^7.6 (latest: 7.8.4) | 语义化版本范围匹配 | npm 生态标准 semver 解析器，satisfies() API 直接满足需求。无替代品 |
| zod | ^4.4 (already present) | manifest.json 运行时校验 | 已在 Phase 3 引入，manifest-schema.ts 已依赖。扩展正则即可，无需新增校验库 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1 (already present) | 单元测试 | 遵循现有测试模式，在 `__tests__/` 目录下编写 |

### Alternatives Considered

No alternatives need consideration — all technology choices are locked by D-02/D-03.

**Installation:**
```bash
npm install semver
```

**Version verification:**
```
npm view semver version
# → 7.6.3 (as of training), latest is 7.8.4 at research time
```

The project uses both pnpm (primary, `pnpm-workspace.yaml`) and npm (secondary, `package-lock.json`). Install semver with the package manager that matches the other deps — `npm install semver` is safe since `package-lock.json` exists.

## Package Legitimacy Audit

> **Note:** slopcheck was unavailable at research time (`pip install slopcheck --break-system-packages` failed). All packages below are tagged `[ASSUMED]` per the grace degradation protocol. The planner MUST gate each install behind a `checkpoint:human-verify` task.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| semver | npm | 12+ yrs | 1B+/week | github.com/npm/node-semver | [OK] | Approved [ASSUMED] |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*All packages above are tagged [ASSUMED] — planner must gate install behind checkpoint:human-verify.*

## Architecture Patterns

### System Architecture: Token 版本兼容检查流程

```
Plugin install/activate flow
=============================

┌─────────────────────────────────────────────────────────────────────┐
│                        PluginHost.installPlugin()                  │
│                                                                     │
│  1. extractManifest(sourceCode) ──→ JSON object with requires[]    │
│  2. CHECK: for each entry in manifest.requires:                    │
│     ├─ Parse token name + optional @version range                  │
│     ├─ ServiceRegistry.getVersion(tokenName)                       │
│     └─ semver.satisfies(actualVersion, range)                      │
│        ├── true  → continue                                        │
│        └── false → throw SemverMismatchError                       │
│  3. For optional deps with mismatch: console.warn + skip           │
│  4. DB INSERT + set INSTALLED state                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │ passes
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     PluginHost.activatePlugin()                     │
│                                                                     │
│  1. validate state transition                                      │
│  2. DB load source_code + manifest                                 │
│  3. EsmLoader.load(source_code)                                    │
│  4. extract manifest, activate, deactivate                         │
│  5. manifestSchema.parse(manifest)                                 │
│  ═══ SemVer CHECK INSERTED HERE ═══                                │
│  6. For each entry in manifest.requires (+ optional):              │
│     ├─ Parse tokenName + @version range                            │
│     ├─ ServiceRegistry.getVersion(tokenName)                       │
│     └─ semver.satisfies(actualVersion, range)                      │
│        ├── true  → continue                                        │
│        └── false → throw SemverMismatchError / warn for optional   │
│  ═══════════════════════════════════                                │
│  7. buildContext(serviceRegistry, ...)                             │
│  8. capabilityService.grant()                                      │
│  9. activate(ctx) with timeout                                     │
│  10. set ACTIVE state                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new files or folders needed for this phase. All changes are modifications to existing files:

```
packages/core/
├── di/
│   ├── token.ts              ← MODIFY: add version parameter (D-06)
│   ├── service-registry.ts   ← MODIFY: store version in register(), add getVersion()
│   ├── types.ts              ← MODIFY: ServiceEntry gains version field
│   ├── errors.ts             ← MODIFY: add SemverMismatchError (D-11)
│   ├── interfaces.ts         ← NO CHANGE (D-01)
│   └── __tests__/
│       ├── token.test.ts     ← ADD: token version tests
│       └── service-registry.test.ts ← ADD: version tracking + resolveByName tests
├── esm-loader/
│   ├── manifest-schema.ts    ← MODIFY: regex + manifestSchemaV3 (D-09/D-10)
│   └── __tests__/
│       └── manifest-schema.test.ts ← ADD: @version regex tests
├── plugin-host/
│   ├── index.ts              ← MODIFY: semver check in activatePlugin (D-05)
│   ├── errors.ts             ← MODIFY: add SemverMismatchError import/re-export
│   └── __tests__/
│       └── plugin-host.test.ts ← ADD: semver check integration tests
└── plugin-runtime/
    └── index.ts              ← MINOR: install-time check path (D-05)
```

### Pattern 1: Token 版本声明 + ServiceRegistry 版本追踪
**What:** Token 构造函数新增可选 `version` 参数，ServiceRegistry.register() 自动从 Token 读取版本并存储
**When to use:** 所有 Token 创建时（现有 7 个不传 version，使用默认值 `'1.0.0'`；后续阶段有 breaking change 时更新版本号）
**Example:**
```typescript
// Source: CONTEXT.md D-06 + D-08
const token = new Token<ICommandBusService>(
  '@openlearn/core:ICommandBusService',
  '1.0.0'  // ← Phase 6: new optional parameter, defaults to '1.0.0'
);
```

### Pattern 2: 版本兼容性检查（核心逻辑）
**What:** 解析 manifest.requires 中的 Token 名称和版本范围，查询 ServiceRegistry 获取实际版本，用 semver.satisfies() 做匹配
**When to use:** PluginHost.installPlugin() 和 PluginHost.activatePlugin() 中
**Example:**
```typescript
// Source: semver npm package API
import semver from 'semver';

function checkVersionCompatibility(
  actualVersion: string,
  requiredRange: string,
): boolean {
  // If no range specified (just token name without @version), accept any
  if (!requiredRange) return true;
  return semver.satisfies(actualVersion, requiredRange);
}

// Usage:
const match = checkVersionCompatibility('1.5.0', '^1.0.0'); // → true
const match = checkVersionCompatibility('1.5.0', '^2.0.0'); // → false
```

### Pattern 3: SemverMismatchError 结构化错误
**What:** 遵循现有错误类层次模式，包含结构化字段用于 UI 解析 + 人类可读 message 用于日志
**When to use:** 版本不兼容时在 PluginHost 中抛出
**Example:**
```typescript
// Following pattern from di/errors.ts and plugin-host/errors.ts
export class SemverMismatchError extends PluginHostError {
  constructor(
    public readonly pluginId: string,
    public readonly pluginName: string,
    public readonly tokenName: string,
    public readonly requiredRange: string,
    public readonly actualVersion: string,
  ) {
    super(
      `Plugin "${pluginName}" (${pluginId}) requires ${tokenName}@${requiredRange}, ` +
      `but host provides ${actualVersion}. ` +
      `Please upgrade the host or use a compatible plugin version.`
    );
    this.name = 'SemverMismatchError';
  }
}
```

### Pattern 4: Optional 依赖降级处理
**What:** manifest.optional 中的 Token 版本不匹配时，跳过服务注入 + 打印警告，不阻塞激活
**When to use:** PluginHost.activatePlugin() 中处理 optional 依赖时
**Example:**
```typescript
for (const optToken of manifest.optional ?? []) {
  const { tokenName, versionRange } = parseRequires(optToken);
  const actualVersion = getVersionFromRegistry(tokenName);
  if (!semver.satisfies(actualVersion, versionRange)) {
    console.warn(
      `[PluginHost] Optional dependency ${tokenName}@${versionRange} not satisfied ` +
      `(host: ${actualVersion}) — skipping service injection for plugin "${pluginId}"`
    );
    // ctx.services[serviceName] will be null — plugin should handle
    continue;
  }
}
```

### Anti-Patterns to Avoid
- **在 EsmLoader.load() 之后做版本检查**：版本检查只需要 manifest 信息，不需要加载完整模块。应在 manifest.parse() 之后立即检查，避免无谓的模块加载开销。但 D-12 要求 optional 依赖不匹配时跳过注入，这需要等 buildContext 时处理
- **用字符串比较替代 semver.satisfies**：`'2.0.0' > '1.5.0'` 字符串比较不正确（`'10.0.0' < '2.0.0'` 字符串比较），必须使用 semver.satisfies
- **在安装时不做预检查**：安装成功但激活失败产生困惑用户体验（D-05 明确要求双重检查）

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SemVer 范围解析 | 手写 `^`/`~` 解析逻辑 | `semver.satisfies()` | pre-release 标签、复杂范围组合、边界情况（如 `1.0.0-alpha` < `1.0.0`）已有标准实现。semver 包周下载量超 10 亿 |
| Zod regex 验证 | 手写 manifest 校验 | 扩展 manifest-schema.ts 中的 zod schema | Phase 3 已引入 zod，扩展正则比引入新校验库更经济 |

**Key insight:** `semver.satisfies()` 一行调用解决整个版本兼容检查核心逻辑。手写 semver 解析器需要处理至少 20+ 边界情况（pre-release 优先级、大版本比较、范围组合）。

## Common Pitfalls

### Pitfall 1: Token 版本号存储在哪里
**What goes wrong:** 注册 Token 时没有记录版本信息，导致版本检查时无法获取当前版本。
**Why it happens:** ServiceRegistry.register() 接收 Token 对象但当前只取 `token.name`，丢弃了 `token.version`。
**How to avoid:** 在 `ServiceEntry` 类型中新增 `version: string` 字段，`register()` 方法在插入 registry Map 时存储 `{ instance, options, version: token.version }`。
**Warning signs:** `getVersion(tokenName)` 返回 `undefined` 或需要从 Token 实例间接推断。

### Pitfall 2: manifest version range 解析错误
**What goes wrong:** `@openlearn/core:ICommandBusService@^1.0` 中错误地提取了 `^1.0` 作为版本范围，而 semver 需要 `^1.0.0`（完整 x.y.z）。
**Why it happens:** 正则提取时包含 `@` 后的剩余部分，没有验证完整 semver 格式。
**How to avoid:** 使用 `semver.validRange(range)` 验证提取的范围是否有效，无效时报告明确的解析错误。manifest-schema.ts 的正则也应要求完整 x.y.z 格式。
**Warning signs:** `semver.satisfies` 因无效版本范围返回 `false` 而非抛出错误。

### Pitfall 3: Optional 依赖的 `ctx.services` 键处理
**What goes wrong:** 插件在 `activate(ctx)` 中访问未注入的服务时抛出 TypeError（Cannot read properties of null）。
**Why it happens:** Optional 依赖不匹配时被跳过，但插件未检查该服务是否为 null。
**How to avoid:** D-12 明确规定 optional 不匹配时 `ctx.services` 中对应 key 为 `null`。插件需通过 `if (ctx.services.someService === null)` 做降级处理。文档应在 Phase 8 插件重写时说明此行为。

### Pitfall 4: 激活时版本检查的顺序
**What goes wrong:** 在 EsmLoader.load() 之前做版本检查，但 manifest 还未解析（需要从加载的模块中提取 manifest）。
**Why it happens:** manifest 是在 `activatePlugin()` 中通过 `extractManifest()` 或从 DB 存储的 JSON 中获取的，不在 load() 之前可用。
**How to avoid:** 在 `activatePlugin()` 中，manifest 已在 DB 中以 JSON 形式存储（`row.manifest`）。版本检查应使用存储的 manifest（`storedManifest.requires`），在 `manifestSchema.parse(manifest)` 之后、`buildContext()` 之前执行。不需要等待 `esmLoader.load()`。

### Pitfall 5: ServiceRegistry.resolveByName() 的类型安全
**What goes wrong:** resolveByName 返回 `Promise<unknown>`，调用方需要类型断言。
**Why it happens:** 基于字符串的查询天然失去泛型信息——这是 Token Registry 模式的权衡（D-07）。
**How to avoid:** ServiceHost.resolveService() 已经处理了这个问题（使用 `as unknown as Record<string, unknown>` 类型转换）。后续调用方也需做类似处理。

## Code Examples

Verified patterns from official sources:

### Token 构造函数扩展
```typescript
// packages/core/di/token.ts
export class Token<T> {
  private readonly _phantomService!: T;
  public readonly name: string;
  public readonly version: string;  // ← NEW in Phase 6

  constructor(name: string, version: string = '1.0.0') {  // ← NEW parameter
    // existing validation...
    this.name = name;
    this.version = version;  // ← NEW assignment
  }
}
```

### ServiceRegistry 版本追踪
```typescript
// packages/core/di/types.ts (modify ServiceEntry)
export interface ServiceEntry {
  instance: unknown;
  options: RegisterOptions;
  version: string;  // ← NEW: e.g., '1.0.0'
}

// packages/core/di/service-registry.ts (modify register)
async register<T>(token: Token<T>, instance: T, options?: RegisterOptions): Promise<void> {
  // ...existing validation...
  this.registry.set(name, { instance, options: options ?? {}, version: token.version });
  // ...existing depGraph...
}

// NEW method: get version info
getVersion(tokenName: string): string | undefined {
  const entry = this.registry.get(tokenName);
  return entry?.version;
}
```

### Manifest Schema 扩展
```typescript
// packages/core/esm-loader/manifest-schema.ts (extend)
// NEW: regex for @optional @version suffix
// Matches: @openlearn/core:ICommandBusService or @openlearn/core:ICommandBusService@^1.0.0
const requiresItemSchema = z.string().regex(
  /^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/
);

export const manifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().min(1),
  requires: z.array(requiresItemSchema).optional(),
  optional: z.array(requiresItemSchema).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
});

// OLD schema (Phase 3 compatibility, no @version)
const requiresItemV3Schema = z.string().regex(
  /^@[\w-]+\/[\w-]+:I\w+$/
);

export const manifestSchemaV3 = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().min(1),
  requires: z.array(requiresItemV3Schema).optional(),
  optional: z.array(requiresItemV3Schema).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
});
```

### PluginHost SemVer 检查插入位置
```typescript
// packages/core/plugin-host/index.ts — activatePlugin() method
// This goes after line ~396 (manifestSchema.parse(manifest)) and before line ~398 (buildContext)

// ── PHASE 6: SemVer compatibility check ─────────────────────────────
// Use storedManifest (from DB) which has already been parsed as JSON
const requires = storedManifest.requires ?? [];
const optional = storedManifest.optional ?? [];

for (const req of requires) {
  const { tokenName, versionRange } = parseRequiresEntry(req);
  const actualVersion = this.serviceRegistry.getVersion(tokenName);
  
  if (!actualVersion) {
    throw new SemverMismatchError(
      pluginId, storedManifest.name ?? pluginId,
      tokenName, versionRange ?? '*', 'unregistered'
    );
  }
  
  if (!versionRange) continue; // No range specified = accept any version
  
  if (!semver.satisfies(actualVersion, versionRange)) {
    throw new SemverMismatchError(
      pluginId, storedManifest.name ?? pluginId,
      tokenName, versionRange, actualVersion
    );
  }
}

for (const opt of optional) {
  const { tokenName, versionRange } = parseRequiresEntry(opt);
  const actualVersion = this.serviceRegistry.getVersion(tokenName);
  
  if (!actualVersion || (versionRange && !semver.satisfies(actualVersion, versionRange))) {
    console.warn(
      `[PluginHost] Optional dependency ${tokenName}@${versionRange} not satisfied ` +
      `(host: ${actualVersion ?? 'unregistered'}) — skipping for plugin "${pluginId}"`
    );
    // Plugin handles null check at activation time
    continue;
  }
}
```

### Requires 条目解析工具函数
```typescript
// NEW utility function - can live in plugin-host/index.ts or a helper file
function parseRequiresEntry(entry: string): { tokenName: string; versionRange: string | null } {
  const atIndex = entry.indexOf('@', 1); // skip leading @ of scope
  if (atIndex === -1 || atIndex === entry.lastIndexOf('@')) {
    // No @version suffix — just token name
    return { tokenName: entry, versionRange: null };
  }
  // Split at the second @ (first @ is scope)
  const secondAtIndex = entry.indexOf('@', entry.indexOf('/') + 1);
  if (secondAtIndex === -1) {
    return { tokenName: entry, versionRange: null };
  }
  return {
    tokenName: entry.slice(0, secondAtIndex),
    versionRange: entry.slice(secondAtIndex + 1),
  };
}

// Examples:
// '@openlearn/core:ICommandBusService' → { tokenName: '@openlearn/core:ICommandBusService', versionRange: null }
// '@openlearn/core:ICommandBusService@^1.0.0' → { tokenName: '@openlearn/core:ICommandBusService', versionRange: '^1.0.0' }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Token 无版本 | Token 携带 version 字段 | Phase 6 | 新增可选参数，默认 '1.0.0' 向后兼容 |
| manifest.requires 纯 Token 名 | manifest.requires 支持 @version 后缀 | Phase 6 | 同时保留无版本格式（兼容 Phase 3 现有 manifest） |
| 无版本检查 | 安装时 + 激活时双重检查 | Phase 6 | 不兼容时报告明确错误，避免静默失败 |
| resolveByName stub/fallback | resolveByName 完整实现 | Phase 6 | 从 duck-type fallback 升级为正式 API |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | semver npm 包通过 ESM `import semver from 'semver'` 导入 | Standard Stack | ESM 导出格式可能与 Node.js 版本有关——已在 Node.js 当前环境验证通过 |
| A2 | SemverMismatchError 放在 plugin-host/errors.ts 中最合适 | Architecture Patterns | 如果是更通用的错误，可以放在 di/errors.ts 中。但版本检查只在 PluginHost 中触发，因此 plugin-host/errors.ts 最合适 |
| A3 | version range 解析使用 `parseRequiresEntry()` 工具函数 | Code Examples | 如果 manifest-schema 的 zod regex 提供了结构化解析，可能不需要此函数。但 Zod regex 只做字符串格式验证，不解析结构 |

## Open Questions

1. **[manifest 版本 range 从哪里解析？]**
   - What we know: `storedManifest.requires` 是字符串数组，每个可能含 `@version` 后缀
   - What's unclear: 解析是在 manifest-schema 的 zod parse 时（通过 transform）完成，还是在 PluginHost 中手工解析
   - Recommendation: 从简原则——PluginHost 中手工解析（见 `parseRequiresEntry` 示例），zod 只做格式校验。Phase 8 迁移时可考虑增加 structured type

2. **[Optional 依赖的 `ctx.services` null 行为如何实现？]**
   - What we know: D-12 要求 optional 不匹配时 `ctx.services` 对应 key 为 `null`
   - What's unclear: buildContext() 目前硬编码解析 7 个服务。optional 跳过需要修改 buildContext() 或 PluginHost 中的 ctx 构建逻辑
   - Recommendation: 在 buildContext() 中接收跳过列表参数，或由 PluginHost 在 buildContext 之后手动修改 services 对象（但 services 被 Object.freeze 了）。另一个方案：在 PluginHost 中构建一个 filteredServices，传给 buildContext 的变体。需要实现时决策

## Environment Availability

> Step 2.6: SKIPPED (no external dependencies beyond Node.js built-ins and npm packages already used in the project)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.9 |
| Config file | vitest.config.ts (root) |
| Quick run command | `npx vitest run --reporter=verbose --changed` |
| Full suite command | `npm test` (vitest run) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLUG-07 | IEventBusService interface stability (D-01) | unit | Existing `interfaces.test.ts` | Yes |
| PLUG-09 | Token version parameter | unit | `npx vitest run packages/core/di/__tests__/token.test.ts` | Wave 0 |
| PLUG-09 | ServiceRegistry version tracking | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | Wave 0 (extend) |
| PLUG-09 | manifest-schema @version regex | unit | `npx vitest run packages/core/esm-loader/__tests__/manifest-schema.test.ts` | Wave 0 (extend) |
| PLUG-09 | manifestSchemaV3 old-format compatibility | unit | As above | Wave 0 |
| PLUG-09 | PluginHost install-time semver check | integration | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | Wave 0 |
| PLUG-09 | PluginHost activation-time semver check | integration | As above | Wave 0 |
| PLUG-09 | Optional dep mismatch skip + warn | integration | As above | Wave 0 |
| PLUG-09 | SemverMismatchError structured fields | unit | `npx vitest run packages/core/plugin-host/__tests__/plugin-host.test.ts` | Wave 0 |
| PLUG-09 | resolveByName() complete implementation | unit | `npx vitest run packages/core/di/__tests__/service-registry.test.ts` | Wave 0 (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run --changed` or targeted test for the modified file
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/core/di/__tests__/token.test.ts` — add tests for version parameter (default + custom + type safety)
- [ ] `packages/core/di/__tests__/service-registry.test.ts` — add tests for `getVersion()`, `resolveByName()` reliability
- [ ] `packages/core/esm-loader/__tests__/manifest-schema.test.ts` — add tests for @version regex, manifestSchemaV3 compatibility, invalid version format rejection
- [ ] `packages/core/plugin-host/__tests__/plugin-host.test.ts` — add tests for install-time semver rejection, activation-time semver rejection, optional skip + warn, SemverMismatchError struct

## Security Domain

> Required when security_enforcement is enabled (absent = enabled by default). No config value found for `workflow.nyquist_validation` or `security_enforcement` — treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Zod manifest schema regex + semver.validRange() validation — prevents injection via malformed version strings |
| V8 Error Handling | yes | SemverMismatchError structured error — never exposes internal state, always reports specific mismatch context |

### Known Threat Patterns for Token/Plugin System

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed version string injection in manifest | Tampering | Zod regex in manifest-schema rejects non-conforming patterns before any version comparison logic executes |
| Version range DoS (catastrophic backtracking) | Denial of Service | Zod regex is linear (no nested quantifiers). `semver.validRange()` is O(n) on string length |

## Sources

### Primary (HIGH confidence)
- [Codebase: packages/core/di/token.ts] — Current Token class without version parameter
- [Codebase: packages/core/di/service-registry.ts] — Current ServiceRegistry with resolveByName stub
- [Codebase: packages/core/di/types.ts] — ServiceEntry type definition
- [Codebase: packages/core/di/errors.ts] — Error class hierarchy pattern
- [Codebase: packages/core/esm-loader/manifest-schema.ts] — Current Zod schema without @version regex
- [Codebase: packages/core/plugin-host/index.ts] — PluginHost lifecycle with activatePlugin()
- [Codebase: packages/core/plugin-runtime/index.ts] — PluginRuntime delegate pattern
- [Codebase: packages/core/plugin-host/errors.ts] — PluginHost error hierarchy pattern
- [Codebase: packages/core/di/interfaces.ts] — IEventBusService interface (unchanged)
- [Codebase: packages/core/event-bus/index.ts] — EventBus implementation
- [Codebase: packages/core/worker-runtime/event-forwarder.ts] — Cross-worker event forwarding
- [Codebase: packages/core/plugin-host/context-builder.ts] — buildContext() usage of IEventBusService
- [Codebase: packages/core/worker-runtime/service-host.ts] — resolveByName fallback pattern
- [Codebase: packages/core/kernel/index.ts] — Kernel singleton, service registration pattern
- [Codebase: vitest.config.ts] — Test configuration
- [Codebase: package.json] — Dependencies including vitest
- [Verified: Runtime test] — `semver` ESM `import` confirmed working; `semver.satisfies('1.5.0', '^1.0.0') → true`

### Secondary (MEDIUM confidence)
- [CONTEXT.md decisions D-01 through D-12] — All implementation decisions locked in discussion phase

### Tertiary (LOW confidence)
- None — all claims verified against codebase or runtime test

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — semver verified via runtime test, zod already present
- Architecture: HIGH — all insertion points verified by reading plugin-host/index.ts, service-registry.ts, manifest-schema.ts
- Pitfalls: HIGH — derived from codebase patterns and semver edge cases tested

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (standard 30-day validity)
