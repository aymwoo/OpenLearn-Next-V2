# Phase 3: ESM 加载 + 包格式 - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 16 新文件 / 4 修改文件
**Analogs found:** 20 / 20

## File Classification

| 新/改文件 | 角色 | 数据流 | 最接近模拟文件 | 匹配质量 |
|-----------|------|--------|----------------|-----------|
| `packages/core/esm-loader/esm-loader.ts` | model (abstract class) | request-response | `packages/core/di/interfaces.ts` | role-match |
| `packages/core/esm-loader/node-loader.ts` | service (impl) | request-response | `packages/core/di/storage-service.ts` | role-match |
| `packages/core/esm-loader/browser-loader.ts` | service (impl) | request-response | `packages/core/di/ai-service.ts` | role-match |
| `packages/core/esm-loader/manifest-schema.ts` | utility (schema) | transform | `packages/core/di/token.ts` (regex validation) | partial |
| `packages/core/esm-loader/errors.ts` | utility (error) | request-response | `packages/core/di/errors.ts` | exact |
| `packages/core/esm-loader/index.ts` | config (barrel) | -- | `packages/core/di/index.ts` | exact |
| `packages/core/esm-loader/__tests__/node-loader.test.ts` | test | request-response | `packages/core/di/__tests__/service-registry.test.ts` | exact |
| `packages/core/esm-loader/__tests__/browser-loader.test.ts` | test | request-response | `packages/core/di/__tests__/token.test.ts` | exact |
| `packages/core/esm-loader/__tests__/manifest-schema.test.ts` | test | transform | `packages/core/di/__tests__/token.test.ts` | role-match |
| `packages/core/esm-loader/__tests__/fixtures/valid-plugin.js` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/syntax-error.js` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/no-default.js` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/timeout-plugin.js` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/manifest-valid.json` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/manifest-invalid.json` | fixture | -- | 无 (新建) | n/a |
| `packages/core/esm-loader/__tests__/fixtures/sample.zip` | fixture | -- | 无 (新建) | n/a |
| **修改文件:** | | | | |
| `packages/core/plugin-runtime/index.ts` | service (修改) | request-response | 自身 (现有 evaluateAndActivate) | exact |
| `packages/core/kernel/index.ts` | controller (修改) | request-response | 自身 (现有 ServiceRegistry 注入) | exact |
| `packages/core/db/index.ts` | model (修改) | CRUD | 自身 (现有 ALTER TABLE 模式) | exact |
| `vitest.config.ts` | config (修改) | -- | 自身 | exact |

## Pattern Assignments

---

### `packages/core/esm-loader/esm-loader.ts` (model, abstract class)

**模拟文件:** `packages/core/di/interfaces.ts`

**导入模式** (从 di/interfaces.ts 和 di/token.ts 推断):
```typescript
// packages/core/esm-loader/esm-loader.ts
// 遵循 ESM .js 扩展导入规范
```

**核心模式** — 基于 RESEARCH.md D-02/D-03 决策的抽象类定义:
```typescript
// 参考 di/interfaces.ts 的接口/类型定义方式：集中定义类型契约
// 参考 di/token.ts 的泛型参数 pattern（phantom type）

/**
 * PluginModule — import() 返回的模块命名空间对象。
 *
 * 支持两种插件导出格式（D-06）：
 * 1. export default { manifest, activate }
 * 2. export function activate(ctx) {}
 */
export interface PluginModule {
  default?: {
    manifest?: Record<string, unknown>;
    activate?: (ctx: unknown) => Promise<void>;
  };
  activate?: (ctx: unknown) => Promise<void>;
  manifest?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * EsmLoader — 跨运行时 ESM 动态加载器抽象基类。
 *
 * D-02: 抽象基类 + 平台实现
 * D-03: 返回原始模块导出，不构建安全上下文
 */
export abstract class EsmLoader {
  abstract load(code: string): Promise<PluginModule>;
}
```

**相同角色/数据流的已有模式:**
- DI 子系统的接口定义 (`di/interfaces.ts`): 纯类型契约，无实现
- Token 类的泛型 phantom type (`di/token.ts`): `class Token<T> { ... }`
- 注释风格: JSDoc `/**...*/` + 设计决策引用 (如 `D-02`)

---

### `packages/core/esm-loader/node-loader.ts` (service, request-response)

**模拟文件:** `packages/core/di/storage-service.ts`

**导入模式** (从 storage-service.ts 推断):
```typescript
// packages/core/esm-loader/node-loader.ts
import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmSyntaxError, EsmModuleNotFoundError, EsmLoadTimeoutError, EsmLoaderError } from './errors.js';
// 遵循 ESM .js 扩展导入规范（项目约定）
```

**具体类实现模式** — 从 di/storage-service.ts 和 di/ai-service.ts 提取:
```typescript
// 参考 storage-service.ts:7-17 — 独立类，构造函数接收 db 实例
// 参考 di/errors.ts:4-7 — 命名错误类，set this.name

// 示例 — storage-service.ts 的模式：
// export class StorageService {
//   constructor(private db: Database.Database) {}
//   async get(key: string, pluginId: string): Promise<any> { ... }
// }
// 关键点: 作为独立服务类，无继承（除了抽象基类），通过 DI 注入到 Kernel
```

**核心 load() 模式** — 基于 RESEARCH.md Pattern 2:
```typescript
export class NodeEsmLoader extends EsmLoader {
  async load(code: string): Promise<PluginModule> {
    const base64 = Buffer.from(code, 'utf-8').toString('base64');
    const dataUrl = `data:text/javascript;base64,${base64}`;

    try {
      return await import(dataUrl);
    } catch (err: any) {
      throw this.classifyError(err);
    }
  }

  private classifyError(err: Error): EsmLoaderError {
    const msg = err.message;
    if (msg.includes('Unexpected token') || msg.includes('SyntaxError')) {
      return new EsmSyntaxError(msg, { cause: err });
    }
    if (msg.includes('Failed to resolve module specifier') || msg.includes('Cannot find module')) {
      return new EsmModuleNotFoundError(msg, { cause: err });
    }
    return new EsmLoaderError(msg, { cause: err });
  }
}
```

**错误处理模式** — 从 plugin-runtime/index.ts:428-447 提取:
```typescript
// 参考现有 plugin-runtime evaluateAndActivate 的错误模式：
// } catch (err) {
//   this.deactivatePlugin(pluginId);
//   ... cleanup ...
//   throw err;
// }
// EsmLoader 层负责错误分类（D-03），激活层错误由 PluginRuntime 处理
```

---

### `packages/core/esm-loader/browser-loader.ts` (service, request-response)

**模拟文件:** `packages/core/di/ai-service.ts`

**导入模式** (与 node-loader.ts 相同):
```typescript
import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmLoaderError, EsmSyntaxError } from './errors.js';
```

**核心模式** — 基于 RESEARCH.md Pattern 3:
```typescript
export class BrowserEsmLoader extends EsmLoader {
  async load(code: string): Promise<PluginModule> {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);

    try {
      const mod = await import(url);
      return mod;
    } catch (err: any) {
      throw this.classifyError(err);
    } finally {
      URL.revokeObjectURL(url);  // Pitfall 2 防范
    }
  }

  private classifyError(err: Error): EsmLoaderError {
    const msg = err.message;
    if (msg.includes('SyntaxError') || msg.includes('Unexpected token')) {
      return new EsmSyntaxError(msg, { cause: err });
    }
    return new EsmLoaderError(msg, { cause: err });
  }
}
```

**与 node-loader 的关键差异:**
- Blob URL 需要 `finally` 块 `URL.revokeObjectURL()` (Pitfall 2)
- 浏览器错误消息格式与 Node.js 不同，classifyError 需适配

---

### `packages/core/esm-loader/manifest-schema.ts` (utility, schema validation)

**模拟文件:** `packages/core/di/token.ts` (部分 — 仅字符串验证逻辑)

**导入模式:**
```typescript
// packages/core/esm-loader/manifest-schema.ts
import { z } from 'zod';

// 参考 di/token.ts:24-30 — 使用 const RE = /.../ 集中定义验证规则
// Token 格式验证: TOKEN_NAME_RE 正则 + 构造函数检查
```

**核心模式** — 基于 RESEARCH.md Pattern 5:
```typescript
export const manifestSchema = z.object({
  id: z.string().min(1, { error: 'manifest.id 不能为空' }),
  name: z.string().min(1, { error: 'manifest.name 不能为空' }),
  version: z.string().min(1, { error: 'manifest.version 不能为空' }),
  main: z.string().min(1, { error: 'manifest.main 必须指定入口文件路径' }),
  requires: z.array(z.string()).optional(),
  optional: z.array(z.string()).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
```

**使用模式** (在 PluginRuntime 中调用):
```typescript
// 参考 plugin-runtime/index.ts:164-166 的现有 manifest 验证：
// if (!manifest.id || !manifest.name) {
//   throw new Error('Invalid plugin manifest: id and name are required.');
// }
// D-10: 替换为 zod schema 校验：
// const manifest = manifestSchema.parse(JSON.parse(manifestJsonString));
// 或者 safeParse 方式：
// const result = manifestSchema.safeParse(JSON.parse(rawJson));
// if (!result.success) { throw new ZodValidationError(result.error); }
```

---

### `packages/core/esm-loader/errors.ts` (utility, error hierarchy)

**模拟文件:** `packages/core/di/errors.ts`

**导入模式** — 参考 di/errors.ts:1-7 的注释头部:
```typescript
// packages/core/esm-loader/errors.ts
/**
 * Named error classes for the EsmLoader subsystem.
 *
 * Each error carries contextual information to aid debugging.
 * Error messages follow the project logging convention
 * (`[EsmLoader]` prefix tags).
 */
```

**核心模式** — 从 di/errors.ts:13-18 精确提取:
```typescript
// di/errors.ts 每个错误类的固定模式：
// 1. extends Error（或上级错误类）
// 2. constructor 中 super(message)
// 3. 设置 this.name = 'ErrorClassName'
// 4. public readonly 属性携带上下文

// 具体示例 — di/errors.ts:13-18：
// export class TokenError extends Error {
//   constructor(message: string) {
//     super(`[Token] ${message}`);
//     this.name = 'TokenError';
//   }
// }

// Phase 3 对应实现（基于 RESEARCH.md Artifact Pattern）:
export class EsmLoaderError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`[EsmLoader] ${message}`, options);
    this.name = 'EsmLoaderError';
  }
}

export class EsmSyntaxError extends EsmLoaderError {
  constructor(message: string, options?: { cause?: Error; line?: number; column?: number }) {
    super(message, options);
    this.name = 'EsmSyntaxError';
  }
}

export class EsmModuleNotFoundError extends EsmLoaderError {
  constructor(
    public readonly specifier: string,
    options?: { cause?: Error }
  ) {
    super(`Module not found: "${specifier}"`, options);
    this.name = 'EsmModuleNotFoundError';
  }
}

export class EsmLoadTimeoutError extends EsmLoaderError {
  constructor(timeoutMs: number, options?: { cause?: Error }) {
    super(`Module load timed out after ${timeoutMs}ms`, options);
    this.name = 'EsmLoadTimeoutError';
  }
}

export class EsmActivationError extends EsmLoaderError {
  constructor(
    public readonly pluginId: string,
    message: string,
    options?: { cause?: Error }
  ) {
    super(`Plugin "${pluginId}" activation failed: ${message}`, options);
    this.name = 'EsmActivationError';
  }
}
```

**关键差异说明:**
- di/errors.ts 使用 `[Subsystem]` 前缀 (如 `[Token]`, `[ServiceRegistry]`)，esm-loader 使用 `[EsmLoader]`
- di/errors.ts 使用 `public readonly` 属性携带上下文的模式（如 `DuplicateRegistrationError.tokenName`、`MissingDependencyError.missingDeps`），esm-loader 保持一致
- `EsmActivationError` 携带 `pluginId` 上下文，与 `DuplicateRegistrationError` (含 `tokenName`) 模式一致

---

### `packages/core/esm-loader/index.ts` (barrel export)

**模拟文件:** `packages/core/di/index.ts`

**核心模式** — 从 di/index.ts:1-52 精确提取:
```typescript
// packages/core/esm-loader/index.ts
/**
 * EsmLoader subsystem barrel export.
 *
 * Provides:
 * - EsmLoader — abstract base class for ESM dynamic loading
 * - NodeEsmLoader — Node.js data: URL implementation
 * - BrowserEsmLoader — browser Blob URL implementation
 * - PluginModule — module namespace shape
 * - Error classes — named error hierarchy for all loading failure paths
 * - manifestSchema / Manifest — zod runtime validation + type inference
 */
export { EsmLoader } from './esm-loader.js';
export type { PluginModule } from './esm-loader.js';
export { NodeEsmLoader } from './node-loader.js';
export { BrowserEsmLoader } from './browser-loader.js';
export { manifestSchema } from './manifest-schema.js';
export type { Manifest } from './manifest-schema.js';
export {
  EsmLoaderError,
  EsmSyntaxError,
  EsmModuleNotFoundError,
  EsmLoadTimeoutError,
  EsmActivationError,
} from './errors.js';
```

**参考 di/index.ts 的 barrel 模式:**
- 使用 JSDoc 注释说明每个导出模块
- `export { Class } from './file.js'` 格式（ESM .js 扩展）
- `export type { Interface }` 分离类型导出
- 注释组用 `// ── ... ──` 分隔符（可选）

---

### `packages/core/esm-loader/__tests__/node-loader.test.ts` (test)

**模拟文件:** `packages/core/di/__tests__/service-registry.test.ts`

**导入和测试结构模式** — 从 service-registry.test.ts:1-49 + token.test.ts:1-14 提取:
```typescript
/**
 * Unit tests for NodeEsmLoader — data: URL + import().
 *
 * Covers:
 * - Successful load of valid ESM code
 * - EsmSyntaxError on syntax-invalid code
 * - EsmModuleNotFoundError on missing relative import
 * - EsmLoadTimeoutError on infinite-loop code
 * - PluginModule namespace shape verification
 * - default export shape
 * - named export shape (activate function)
 */
import { describe, it, expect } from 'vitest';
import { NodeEsmLoader } from '../node-loader.js';
import {
  EsmLoaderError,
  EsmSyntaxError,
  EsmModuleNotFoundError,
  EsmLoadTimeoutError,
} from '../errors.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('NodeEsmLoader', () => {
  let loader: NodeEsmLoader;

  beforeEach(() => {
    loader = new NodeEsmLoader();
  });

  // --- 成功加载 ---------------------------------------------------------
  // 参考 service-registry.test.ts:53-72 的 "基本 register + resolve" 模式

  it('should load valid ESM code and return PluginModule', async () => {
    const code = fixture('valid-plugin.js');
    const mod = await loader.load(code);
    expect(mod.default).toBeDefined();
    expect(mod.default.manifest).toBeDefined();
    expect(mod.default.manifest.id).toBe('test-plugin');
    expect(typeof mod.default.activate).toBe('function');
  });

  // --- 语法错误 → EsmSyntaxError -----------------------------------------
  // 参考 token.test.ts:44-50 的 throw error 断言模式

  it('should throw EsmSyntaxError for syntax-invalid code', async () => {
    const code = fixture('syntax-error.js');
    await expect(loader.load(code)).rejects.toThrow(EsmSyntaxError);
  });

  // --- 超时 → EsmLoadTimeoutError -----------------------------------------
  // 超时保护 — 使用 Promise.race 模式

  it('should throw EsmLoadTimeoutError on timeout', async () => {
    const code = fixture('timeout-plugin.js');
    await expect(loader.load(code)).rejects.toThrow(EsmLoadTimeoutError);
  });
});
```

**关键测试模式:**
- `describe('ClassName', () => {})` + `it('should ...', async () => {})` 结构
- `beforeEach` 初始化被测实例
- 使用 `fixture()` helper 函数加载测试数据文件
- 异步测试使用 `await expect(...).rejects.toThrow(ErrorClass)`

---

### `packages/core/esm-loader/__tests__/browser-loader.test.ts` (test)

**模拟文件:** `packages/core/di/__tests__/token.test.ts` (结构)

**核心模式:**
```typescript
/**
 * Smoke tests for BrowserEsmLoader — Blob URL + import().
 *
 * Phase 3 scope: basic Blob URL creation + revoke verification.
 * Full browser integration tests deferred to Phase 9.
 *
 * Covers:
 * - Blob URL created and revoked
 * - ESM code loaded via Blob URL import()
 * - Error classification (EsmSyntaxError)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserEsmLoader } from '../browser-loader.js';
import { EsmSyntaxError } from '../errors.js';

describe('BrowserEsmLoader', () => {
  let loader: BrowserEsmLoader;

  beforeEach(() => {
    loader = new BrowserEsmLoader();
  });

  // --- Blob URL lifecycle -------------------------------------------------
  // 参考 token.test.ts:85-93 的基本验证模式

  it('should revoke object URL after load', async () => {
    // 验证 URL.revokeObjectURL 在 finally 中被调用
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    await loader.load('export const x = 1;');
    expect(revokeSpy).toHaveBeenCalled();
    revokeSpy.mockRestore();
  });

  it('should load valid ESM code successfully', async () => {
    const mod = await loader.load('export const hello = "world";');
    expect(mod.hello).toBe('world');
  });
});
```

**测试环境配置:** vitest.config.ts 中为该文件指定 `environment: 'jsdom'` 或在文件顶部添加 `// @vitest-environment jsdom`

---

### `packages/core/esm-loader/__tests__/manifest-schema.test.ts` (test)

**模拟文件:** `packages/core/di/__tests__/token.test.ts` (格式验证测试)

**核心模式** — 从 token.test.ts:58-69 提取 `it.each` 模式:
```typescript
/**
 * Unit tests for manifestSchema — zod runtime validation.
 *
 * Covers:
 * - Valid manifest.json passes parse()
 * - Rejects missing id/name/version/main
 * - Optional fields accept valid arrays
 * - Empty arrays for requires/optional/capabilitiesProposed accepted
 * - Non-string array values rejected
 */
import { describe, it, expect } from 'vitest';
import { manifestSchema } from '../manifest-schema.js';

describe('manifestSchema', () => {
  // --- 合法 manifest 通过 ------------------------------------------------
  // 参考 token.test.ts:73-83 的 it.each 接受模式

  it('should accept valid manifest', () => {
    const manifest = {
      id: 'ext-countdown-timer',
      name: 'Countdown Timer',
      version: '1.0.0',
      main: 'index.js',
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 非法 manifest 被拒绝 ------------------------------------------------
  // 参考 token.test.ts:58-69 的 it.each 拒绝模式

  it.each([
    { missing: 'id', data: { name: 'X', version: '1.0.0', main: 'index.js' } },
    { missing: 'name', data: { id: 'x', version: '1.0.0', main: 'index.js' } },
    { missing: 'version', data: { id: 'x', name: 'X', main: 'index.js' } },
    { missing: 'main', data: { id: 'x', name: 'X', version: '1.0.0' } },
  ])('should reject manifest missing $missing', ({ data }) => {
    expect(() => manifestSchema.parse(data)).toThrow();
  });

  // --- 可选字段 ----------------------------------------------------------

  it('should accept manifest with optional fields filled', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
      optional: ['@openlearn/core:IAIService'],
      capabilitiesProposed: ['lesson:write'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 类型推导 (compile-time check) ------------------------------------
  // 参考 token.test.ts:26-41 的 phantom type 编译验证

  it('should support type inference via z.infer', () => {
    const manifest = manifestSchema.parse({
      id: 'test', name: 'Test', version: '1.0.0', main: 'index.js'
    });
    // TypeScript 编译时类型应为 Manifest (z.infer)
    expect(manifest.id).toBe('test');
  });
});
```

---

### `packages/core/plugin-runtime/index.ts` (修改 — 分支逻辑)

**模拟文件:** `packages/core/plugin-runtime/index.ts` 自身 (现有 evaluateAndActivate 为 'vm' 分支)

**需要添加的修改点** (D-09 — 加载器选择标记):

**(1) 构造函数修改** — 参考 kernel/index.ts:51 的 DI 注入模式:
```typescript
// 现有: constructor(private kernel: Kernel) {}
// 新增: 接收 EsmLoader 实例

// 参考 kernel/index.ts:51 — PluginRuntime 在 Kernel 构造函数中初始化
// this.pluginRuntime = new PluginRuntime(this);
// D-01: 通过构造函数接收 EsmLoader 实例
// 修改后: this.pluginRuntime = new PluginRuntime(this, esmLoader);
```

**(2) evaluateAndActivate 分支** — 在 plugin-runtime/index.ts:150 附近:
```typescript
// 现有逻辑在 150-449 行，全部是 vm.createContext 路径
// D-09: 根据 loader_version 分支

// 在方法开头添加：
// if (loaderVersion === 'esm') {
//   return this.evaluateAndActivateEsm(sourceCode, pluginId);
// }
// // 原有 vm 分支保持不变 (150-449行，标记为 legacy path)
```

**(3) ESM 加载路径 — 新方法 evaluateAndActivateEsm:**
```typescript
private async evaluateAndActivateEsm(sourceCode: string, pluginId: string) {
  this.deactivatePlugin(pluginId);

  // Step 1: import() 获取模块导出（D-03: 返回原始导出）
  const mod = await this.esmLoader.load(sourceCode);

  // Step 2: 提取 manifest 和 activate（D-06: 支持两种导出格式）
  const plugin = mod.default ?? mod;
  const manifest = plugin.manifest ?? mod.manifest;
  const activate = plugin.activate ?? mod.activate;

  if (!manifest || !activate) {
    throw new EsmActivationError(pluginId, 'missing manifest or activate function');
  }
  if (!manifest.id || !manifest.name) {
    throw new EsmActivationError(pluginId, 'manifest.id and name are required');
  }
  if (typeof activate !== 'function') {
    throw new EsmActivationError(pluginId, 'activate must be a function');
  }

  // Step 3: 复用现有的安全包装器构建逻辑（evaluateAndActivate 的 175-405 行）
  // 包括: actorId 创建、capability 授予、wrappedEventBus/CommandBus/ProcessManager/
  // ActionRegistry/Storage/AI 构建、createSafeFunction、原型链冻结等
  // 全部保持不变

  // Step 4: 执行 activate (5 秒超时保护)
  const activatePromise = activate(context.ctx);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new EsmLoadTimeoutError(5000)), 5000)
  );
  await Promise.race([activatePromise, timeoutPromise]);

  this.activePluginRegistrations.set(pluginId, registration);
  return plugin;
}
```

**关键原则:**
- 安全包装器逻辑（createSafeFunction、wrapped* 对象、原型链冻结）完全复用，不重复编写
- vm 分支保留不动，标记为 `// [legacy vm path — remove in Phase 8]`
- ESM 分支只有 load() + 提取导出 + 构建 context + activate() 四步

---

### `packages/core/kernel/index.ts` (修改 — EsmLoader 注入)

**模拟文件:** `packages/core/kernel/index.ts` 自身 (现有 ServiceRegistry/AIService 初始化模式)

**需要添加的修改点** — 参考 kernel/index.ts:34-51:
```typescript
// 现有构造函数结构（kernel/index.ts:34-51）:
// constructor() {
//   this.serviceRegistry = new ServiceRegistry();
//   this.eventBus = new EventBus();
//   ...
//   this.pluginRuntime = new PluginRuntime(this);
//   ...
// }

// D-01: 新增 EsmLoader 创建 + 注入
// 参考 Line 35 的 new ServiceRegistry() 模式

// 新增导入:
import { NodeEsmLoader } from '../esm-loader/index.js';
// 或按环境条件导入（D-02: 通过 DI 注入正确平台实现）

// 在 constructor 中添加（Layer 0 — 无依赖）:
// this.esmLoader = new NodeEsmLoader();

// 修改 PluginRuntime 初始化（Line 51）:
// this.pluginRuntime = new PluginRuntime(this, this.esmLoader);
```

---

### `packages/core/db/index.ts` (修改 — ALTER TABLE)

**模拟文件:** `packages/core/db/index.ts:318-395` 现有 ALTER TABLE 模式

**核心模式** — 从 db/index.ts:318-322 精确提取:
```typescript
// 现有 ALTER TABLE 模式（每段 try/catch 包裹，注释 "column already exists"）:
try {
  db.prepare('ALTER TABLE classes ADD COLUMN lab_id TEXT').run();
} catch (e) {
  // column already exists
}

// D-13: 新增两个字段，遵循相同模式:
try {
  db.prepare("ALTER TABLE plugins ADD COLUMN loader_version TEXT DEFAULT 'vm'").run();
} catch (e) {
  // column already exists
}

try {
  db.prepare('ALTER TABLE plugins ADD COLUMN zip_package BLOB').run();
} catch (e) {
  // column already exists
}
```

**注意:** 无需修改 CREATE TABLE IF NOT EXISTS 的 DDL 部分（db/index.ts:57-64），因为现有表可能已存在。现有行 loader_version 默认 'vm'（向下兼容，D-13）。

---

### `vitest.config.ts` (修改 — 测试 include)

**模拟文件:** `vitest.config.ts` 自身

**当前 include 模式** (vitest.config.ts:5):
```typescript
include: ['packages/core/di/__tests__/**/*.test.ts'],
```

**修改为** (追加 esm-loader 测试):
```typescript
include: [
  'packages/core/di/__tests__/**/*.test.ts',
  'packages/core/esm-loader/__tests__/**/*.test.ts',
],
```

---

### 测试 Fixture 文件

**模拟文件:** 无现有 fixtures 目录 — 新建。但测试使用 fixture 的模式参考 token.test.ts 的 `it.each` 数据驱动测试。

| Fixture 文件 | 内容要求 | 用途 |
|-------------|---------|------|
| `fixtures/valid-plugin.js` | 合法 ESM 模块，export default { manifest: { id: 'test-plugin', ... }, activate: async (ctx) => {} } | 成功加载测试 |
| `fixtures/syntax-error.js` | 代码包含 `const x =`（未完成语句） | EsmSyntaxError 测试 |
| `fixtures/no-default.js` | `export const hello = 'world';`（具名导出，无 default） | PluginModule 形状测试 |
| `fixtures/timeout-plugin.js` | `while(true) {}` 无限循环 | 超时测试 |
| `fixtures/manifest-valid.json` | `{"id":"test","name":"Test","version":"1.0.0","main":"index.js"}` | 校验通过测试 |
| `fixtures/manifest-invalid.json` | `{"id":"test"}` 缺少 name/version/main | 校验拒绝测试 |
| `fixtures/sample.zip` | 最小合法 ZIP（manifest.json + index.js） | jszip + esbuild 集成测试 |

---

## Shared Patterns

### ESM 导入规范 (.js 扩展)

**来源:** 项目级约定（所有 packages/ 下的 .ts 文件）
**应用范围:** 所有 esm-loader/ 新建文件

```typescript
// 所有后端代码的导入必须使用 .js 扩展名（ESM 兼容性要求）
// 正确:
import { Kernel } from '../kernel/index.js';
import { Token } from './token.js';
// 错误:
import { Kernel } from '../kernel';        // 缺少 .js
import { Token } from './token';           // 缺少 .js
```

### 命名错误类层次

**来源:** `packages/core/di/errors.ts`
**应用范围:** `packages/core/esm-loader/errors.ts`

固定模式:
1. `extends Error`（或上级错误类）
2. 构造函数 `super(message)` 带 `[Subsystem]` 前缀
3. 设置 `this.name = 'ErrorClassName'`
4. 可选 `public readonly` 属性携带上下文（如 `specifier`, `pluginId`）

### 数据库 ALTER TABLE 迁移

**来源:** `packages/core/db/index.ts:318-395`
**应用范围:** `packages/core/db/index.ts` 新增字段

```typescript
// 每个 ALTER TABLE 独立 try/catch:
try {
  db.prepare('ALTER TABLE <table> ADD COLUMN <name> <type>').run();
} catch (e) {
  // column already exists
}
```

### Kernel 构造函数 DI 注入

**来源:** `packages/core/kernel/index.ts:34-51`
**应用范围:** `packages/core/kernel/index.ts` 新增 EsmLoader

```typescript
// 分层初始化模式:
// Layer 0 — 无依赖
this.eventBus = new EventBus();
this.esmLoader = new NodeEsmLoader();  // PHASE 3 新增
// Layer 1 — 依赖 Layer 0
...
// PluginRuntime 在所有子系统之后初始化，接收 EsmLoader
this.pluginRuntime = new PluginRuntime(this, this.esmLoader);
```

### Barrel 导出

**来源:** `packages/core/di/index.ts`
**应用范围:** `packages/core/esm-loader/index.ts`

```typescript
// 每个子目录的 index.ts 集中重新导出:
export { ClassName } from './file.js';
export type { InterfaceName } from './file.js';
```

### 安全包装器保留

**来源:** `packages/core/plugin-runtime/index.ts:194-405`
**应用范围:** `packages/core/plugin-runtime/index.ts` ESM 分支

D-03: 安全包装器逻辑完全保留在 PluginRuntime 侧，EsmLoader 不参与。ESM 分支复用现有的 `createSafeFunction`、`wrappedEventBus`、`wrappedCommandBus`、`wrappedProcessManager`、`wrappedActionRegistry`、`safeConsole`、`wrappedStorage`、`wrappedAI` 全部构造代码。

### 安装流程模式

**来源:** `packages/core/plugin-runtime/index.ts:36-51` (现有 installPlugin)
**应用范围:** ESM 安装流程

```typescript
// 现有模式: installPlugin → evaluateAndActivate → 写入 DB → 返回 manifest
// ESM 安装流程扩展:
// 1. jszip.loadAsync(zipBuffer) — ZIP 解压
// 2. manifestSchema.parse(json) — zod 校验 (D-10)
// 3. esbuild.build({ stdin, bundle, write: false, external, ... }) — 打包 (D-07/D-08)
// 4. 存储: source_code = bundle, zip_package = rawBytes, loader_version = 'esm' (D-09/D-12)
// 5. evaluateAndActivate(bundle, id) — 激活
```

### jszip 使用模式

**来源:** `server.ts` 现有课件解压流程 + RESEARCH.md Code Examples

```typescript
// 从 zipBuffer 解压并读取文件的模式:
import JSZip from 'jszip';

const zip = await JSZip.loadAsync(zipBuffer);
const manifestJson = await zip.file('manifest.json')?.async('string');
const entryCode = await zip.file('index.js')?.async('string');

// 路径穿越检查 (Security — 验证无 .. 路径):
for (const name of Object.keys(zip.files)) {
  if (name.includes('..')) {
    throw new Error(`Security: path traversal detected in ZIP: ${name}`);
  }
}
```

### esbuild 打包模式

**来源:** RESEARCH.md Pattern 4 (已验证 esbuild 0.25.12)

```typescript
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  stdin: {
    contents: entryCode,
    resolveDir: '/tmp/plugin-extract',  // 临时解压目录
    loader: 'ts',  // 支持 TypeScript
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',  // D-08: 跨运行时
  target: 'es2022',
  external: ['@openlearn/*'],  // 保留 Token 导入
});
const bundledCode: string = result.outputFiles[0].text;
```

### 超时保护模式

**来源:** `packages/core/plugin-runtime/index.ts:419-424`

```typescript
// 现有 activate 超时 Pattern（5 秒）:
const activatePromise = plugin.activate(context.ctx);
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`Plugin ${manifest.name} activation timed out after 5s`)), 5000)
);
await Promise.race([activatePromise, timeoutPromise]);

// ESM 分支使用相同模式 + EsmLoadTimeoutError:
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new EsmLoadTimeoutError(5000)), 5000)
);
```

## No Analog Found

所有文件都有对应的模拟文件。fixture 文件（.js/.json/.zip）是新建的测试数据文件，无现有代码对应，但其结构直接来自模板定义。

## Metadata

**模拟搜索范围:**
- `packages/core/di/` — 全部文件（errors.ts, token.ts, service-registry.ts, interfaces.ts, index.ts, storage-service.ts, ai-service.ts, types.ts）
- `packages/core/di/__tests__/` — 全部测试文件
- `packages/core/kernel/index.ts` — Kernel 构造函数
- `packages/core/plugin-runtime/index.ts` — 插件运行时（完整 evaluateAndActivate）
- `packages/core/db/index.ts` — 数据库 schema + ALTER TABLE 模式
- `vitest.config.ts` — 测试配置

**扫描文件数:** 16
**模式提取日期:** 2026-06-18
**模式有效期:** 稳定 — 模拟文件均为现有架构核心文件，近期无变更计划
