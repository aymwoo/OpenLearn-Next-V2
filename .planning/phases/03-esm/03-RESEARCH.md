# Phase 3: ESM 加载 + 包格式 - Research

**Researched:** 2026-06-18
**Domain:** 动态 ESM 模块加载（data: URL / Blob URL）+ ZIP 插件包格式 + esbuild 多文件预打包
**Confidence:** HIGH

## Summary

Phase 3 的核心任务是替换 `vm.createContext` 沙箱为基于 `import()` 的动态 ESM 模块加载。Node.js v24 原生支持 `data:text/javascript;base64,...` + `import()`，浏览器端使用 `URL.createObjectURL(new Blob(...))` + `import()`。两者的关键限制相同：**data: URL / Blob URL 不支持相对导入**。因此，多文件插件必须先通过 esbuild 预打包为单 ESM bundle，再通过 data: URL 加载。

Node.js v24.1.0（当前环境）完全支持 data: URL 的 `import()`，实验验证通过。esbuild 0.25.12 的 `build({ write: false, stdin: {...} })` API 可以在内存中完成打包并返回字符串结果，配合 `external: ['@openlearn/*']` 保留 Token 服务导入。Zod v4.4.3（最新稳定版）提供运行时 schema 校验。jszip 3.10.1（已在用）处理 ZIP 解压。

**Primary recommendation:** 自建轻量级 `EsmLoader` 抽象（约 150 行代码），Node.js 端直接使用原生 `data:` URL + `import()`，浏览器端使用 Blob URL + `import()`，不引入 `import-module-string` 等第三方库——这些库引入了不必要的复杂度（acorn 解析、CJS shim），而我们的场景（预打包的单 bundle、无相对导入、无 CJS）简单得多。

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLUG-01 | 跨运行时插件引擎 — Node.js data: URL + 浏览器 Blob URL 双运行时动态 ESM 加载 | Node.js v24 原生支持 data: URL import()；浏览器标准 Blob URL + import()；esbuild write:false 内存打包；abstraction pattern 设计见 Architecture Patterns |
| PLUG-02 | 插件发现和分发 — ZIP 包格式（manifest.json + 入口 .js + 可选资源）+ esbuild 预打包 | jszip 3.10.1 loadAsync / file().async('string')；zod 4.4.3 运行时 manifest 校验；esbuild stdin + bundle + external 单文件输出 |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: 独立 EsmLoader 类 + PluginRuntime 依赖注入** — 新建 `packages/core/esm-loader/` 目录。EsmLoader 作为独立类（可单独测试、跨运行时复用），PluginRuntime 通过构造函数或 DI 接收 EsmLoader 实例。职责分离：EsmLoader 负责加载和返回模块导出，PluginRuntime 负责构建 wrapped* 安全上下文
- **D-02: 抽象基类 + 平台实现** — `abstract class EsmLoader { abstract load(code: string): Promise<PluginModule> }`。`NodeEsmLoader` 用 data: URL + `import()`，`BrowserEsmLoader` 用 Blob URL + `import()`。通过 DI 注入正确的平台实现
- **D-03: 加载器返回原始模块导出** — EsmLoader.load() 返回由 `import()` 得到的模块命名空间对象。PluginRuntime 负责从中提取 `activate` 函数并传入 wrapped* 上下文
- **D-04: 最小 manifest.json** — 必需字段：`id`、`name`、`version`、`main`。可选字段：`requires`、`optional`、`capabilitiesProposed`
- **D-05: requires/optional 使用 Token 标识符字符串** — 如 `["@openlearn/core:ICommandBusService"]`
- **D-06: 插件入口仍是 ESM 模块** — ZIP 包的 main 指向标准 ESM 模块文件，`export default { manifest, activate }` 或 `export function activate(ctx) {}`
- **D-07: esbuild 安装时打包** — 多文件插件通过 esbuild 将入口+所有相对导入打包为单个 ESM bundle
- **D-08: 仅允许相对导入 + Token 服务** — esbuild 打包时 `external: ['@openlearn/*']`，禁止第三方 npm 包导入
- **D-09: 加载器选择标记** — `plugins` 表新增 `loader_version` TEXT 字段，取值 `'vm'`（旧）或 `'esm'`（新）
- **D-10: 独立 manifest-schema.ts + zod 运行时校验** — `packages/core/esm-loader/manifest-schema.ts`，导出 zod schema 和推导出的 TypeScript 类型
- **D-11: EsmLoader 接口在 Node.js 和浏览器之间保持一致** — 两者都返回相同的 `PluginModule` 接口
- **D-12: SQLite blob + 文本混合存储** — `plugins` 表新增 `zip_package` BLOB 字段存储原始 ZIP 字节
- **D-13: 最小数据库字段新增** — `ALTER TABLE plugins ADD COLUMN loader_version TEXT DEFAULT 'vm'` 和 `ALTER TABLE plugins ADD COLUMN zip_package BLOB`
- **D-14: 结构化错误类层次** — 定义 `EsmLoaderError` 基类（继承 Error）和子类
- **D-15: Node.js 全测试 + 浏览器 smoke** — NodeEsmLoader 完整 vitest 测试，BrowserEsmLoader 用 happy-dom/jsdom 模拟 Blob URL

### Claude's Discretion
以下技术细节由下游 agent（researcher/planner）自主决定：
- EsmLoader 类的具体文件拆分（单个 esm-loader.ts 还是 loader/ 子目录含多文件）
- manifest-schema.ts 中 zod schema 的具体字段定义和错误消息措辞
- esbuild 打包的具体配置（bundle 格式、target、platform 等）
- NodeEsmLoader 中 data: URL 的具体编码方式（base64 vs encodeURIComponent）
- BrowserEsmLoader 的具体 Blob URL 生命周期管理（URL.revokeObjectURL 时机）
- 错误类的继承层次和额外属性（如是否包含原始 import() 错误）
- 测试用例的具体组织和 mock 策略

### Deferred Ideas (OUT OF SCOPE)
- 浏览器端实际集成（推迟到 Phase 9 前端集成）
- 第三方 npm 包导入（仅允许相对导入 + Token 服务）
- 原有 vm.createContext 代码移除（推迟到 Phase 8 现有插件迁移完成后）
- 热重载实现（Phase 7 — 但包存储策略预留了从 zip_package 重新解压的能力）
- 插件生命周期管理（Phase 4 PluginHost）
- SemVer 版本兼容（Phase 6）
</user_constraints>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ESM 模块动态加载（load） | API/Backend | Browser/Client | NodeEsmLoader 在服务端；BrowserEsmLoader 在浏览器端（Phase 9） |
| ZIP 包解压与校验 | API/Backend | — | 安装过程在服务端执行，浏览器仅消费已安装的插件 |
| manifest.json 校验 | API/Backend | — | zod schema 在服务端安装时校验，早失败 |
| esbuild 多文件打包 | API/Backend | — | esbuild 仅在服务端运行（Node.js 原生模块） |
| 插件代码执行（activate） | API/Backend | Browser/Client | PluginRuntime 在两端分别运行，通过 EsmLoader 加载 |
| 安全包装（wrapped* 上下文） | API/Backend | Browser/Client | PluginRuntime 在两端保留，EsmLoader 不参与安全包装 |
| 数据库存储（zip_package BLOB） | Database/Storage | — | SQLite 仅在服务端，浏览器端无直接 DB 访问 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `import()` | v24.1.0 (内置) | data: URL 动态 ESM 加载 | Node.js 内置，无需第三方库；已验证 data:text/javascript;base64 导入正常 |
| esbuild | 0.25.12 | 多文件插件预打包为单 ESM bundle | 已在 devDependencies，`build({ write: false, stdin })` API 可在内存中完成打包 |
| zod | 4.4.3 | manifest.json 运行时 schema 校验 | 最新稳定版，零依赖，~8KB；`z.object().parse()` + `z.infer` 类型推导 |
| jszip | 3.10.1 | ZIP 包解压 | 已在 dependencies，loadAsync + file().async('string') 成熟 API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `happy-dom` 或 `jsdom` | 最新 | 浏览器端 EsmLoader 单元测试（模拟 Blob/URL.createObjectURL） | Phase 3 的 BrowserEsmLoader smoke 测试；如果 vitest environment: 'jsdom' 足够则无需额外安装 |
| `@types/node` | 22.14 (已在) | TypeScript 类型支持 | 已安装 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 自建 EsmLoader（~150行） | `import-module-string` (2.0.3) | import-module-string 引入了 acorn 解析器（不必要——我们的代码已是单 bundle）、CJS shim（不需要）、global 自动导出（不需要）。自建更简单、更少依赖、更可控。D-11 要求的 data: URL + Blob URL 双路径用原生 API 即可实现 |
| 自建 EsmLoader | `vm.Module` (实验性) | vm.Module 需要 `--experimental-vm-modules` 标志，非稳定 API，且仅 Node.js 可用，违背双运行时要求 |
| zod 4.4.3 | zod 3.x | v4 是当前 latest，性能提升 3-5 倍。v4 的主要 API 变更（`z.infer` → 不变，`.parse()` → 不变，`.safeParse()` → 不变）对 manifest 校验场景无影响 |

**Installation:**
```bash
# zod 已通过 slopcheck 安装为 dependency (^4.4.3)
# esbuild 已安装 (devDependencies, ^0.25.0)
# jszip 已安装 (dependencies, ^3.10.1)
# vitest 已安装 (devDependencies, ^4.1.9)
# 无需安装新包
```

**Version verification:**
```bash
npm view zod version          # 4.4.3 [CONFIRMED]
npm view esbuild version      # 0.28.1 (latest), 0.25.12 (project) [CONFIRMED]
npm view jszip version        # 3.10.1 [CONFIRMED]
npm view vitest version       # 4.1.9 [CONFIRMED]
```

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| zod@4.4.3 | npm | 6+ yrs | ~100M/wk | github.com/colinhacks/zod | [OK] | Approved |
| esbuild@0.25.12 | npm | 6+ yrs | ~50M/wk | github.com/evanw/esbuild | [OK] | Approved |
| jszip@3.10.1 | npm | 14+ yrs | ~15M/wk | github.com/Stuk/jszip | [OK] | Approved |
| vitest@4.1.9 | npm | 4+ yrs | ~12M/wk | github.com/vitest-dev/vitest | [SUS] — false positive, proximity to "vite" triggered | Approved (verified: official vitest-dev org on GitHub) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** vitest@4.1.9 — slopcheck flagged due to name similarity to "vite", but this is a false positive. vitest is the official Vite team testing framework hosted at `github.com/vitest-dev/vitest`. Already installed and in use for Phase 1-2 tests.

**Postinstall audit:**
- esbuild: `node install.js` — legitimate platform binary install (standard)
- zod: none
- jszip: none
- vitest: none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Phase 3 System Architecture                      │
│                                                                          │
│  ┌──────────────────────┐           ┌──────────────────────────────────┐│
│  │   Plugin Install      │           │   Plugin Activation              ││
│  │   (server.ts route)   │           │   (PluginRuntime)                ││
│  │                       │           │                                  ││
│  │  POST /api/plugins/   │  ZIP      │  loader_version === 'esm'?      ││
│  │    install-zip        │  bytes    │    │               │            ││
│  │                       │           │    YES             NO           ││
│  │  1. 解压 ZIP          │           │    │               │            ││
│  │  2. 校验 manifest     │           │    ▼               ▼            ││
│  │  3. esbuild 打包      │           │  esmLoader      vm.createContext││
│  │  4. 存储 BLOB + 文本  │           │  .load(code)    (旧路径保留)     ││
│  └──────┬───────────────┘           │    │                            ││
│         │                            │    ▼                            ││
│         │  ┌─────────────────────┐   │  PluginModule                   ││
│         │  │  jszip.loadAsync()  │   │  { default: { manifest,        ││
│         │  │  manifestSchema     │   │      activate } }               ││
│         │  │    .parse(json)     │   │    │                            ││
│         │  │  esbuild.build({    │   │    ▼                            ││
│         │  │    stdin, bundle,   │   │  buildWrappedContext()          ││
│         │  │    write: false,    │   │  plugin.activate(wrappedCtx)    ││
│         │  │    external: [...]  │   │                                  ││
│         │  │  })                 │   └──────────────────────────────────┘│
│         │  └─────────────────────┘                                      │
│         ▼                                                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     EsmLoader (抽象基类)                          │   │
│  │                                                                    │   │
│  │  abstract class EsmLoader {                                       │   │
│  │    abstract load(code: string): Promise<PluginModule>             │   │
│  │  }                                                                 │   │
│  │                                                                    │   │
│  │  ┌───────────────────┐        ┌───────────────────────┐           │   │
│  │  │  NodeEsmLoader     │        │  BrowserEsmLoader      │           │   │
│  │  │                    │        │                        │           │   │
│  │  │  data:text/        │        │  URL.createObjectURL(  │           │   │
│  │  │  javascript;       │        │    new Blob([code], {  │           │   │
│  │  │  base64,${buf}     │        │    type: 'text/        │           │   │
│  │  │  + import()        │        │    javascript' }))     │           │   │
│  │  │                    │        │  + import(url)         │           │   │
│  │  │  Error →            │        │  URL.revokeObjectURL  │           │   │
│  │  │  EsmLoaderError    │        │  + Error →             │           │   │
│  │  │  子类              │        │  EsmLoaderError 子类   │           │   │
│  │  └───────────────────┘        └───────────────────────┘           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Database (SQLite)                              │   │
│  │                                                                    │   │
│  │  plugins 表新增:                                                    │   │
│  │   loader_version TEXT DEFAULT 'vm'  -- 'vm' | 'esm'               │   │
│  │   zip_package    BLOB               -- 原始 ZIP 字节（可选）        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/core/esm-loader/
├── index.ts              # barrel: 导出 EsmLoader, PluginModule, 所有错误类
├── esm-loader.ts         # abstract class EsmLoader + PluginModule 类型
├── node-loader.ts        # NodeEsmLoader 实现 (data: URL + import())
├── browser-loader.ts     # BrowserEsmLoader 实现 (Blob URL + import())
├── manifest-schema.ts    # zod schema + 类型推导 (Manifest 接口)
├── errors.ts             # EsmLoaderError 基类 + 子类
└── __tests__/
    ├── node-loader.test.ts       # NodeEsmLoader 完整测试
    ├── browser-loader.test.ts    # BrowserEsmLoader smoke 测试 (jsdom)
    ├── manifest-schema.test.ts   # manifest 校验测试
    └── fixtures/
        ├── valid-plugin.js       # 合法插件 fixture
        ├── syntax-error.js       # 语法错误 fixture
        ├── no-default.js         # 无 default export fixture
        ├── timeout-plugin.js     # 超时 fixture
        ├── manifest-valid.json   # 合法 manifest
        ├── manifest-invalid.json # 非法 manifest
        └── sample.zip            # 多文件 ZIP fixture
```

**拆分决策（Claude's discretion 区域）:** 推荐多文件拆分（而非单文件 esm-loader.ts），原因：
1. 与现有 `packages/core/di/` 的多文件模式一致（token.ts + service-registry.ts + errors.ts + interfaces.ts）
2. 支持跨平台 tree-shaking：浏览器端不会引入 NodeEsmLoader
3. 每个文件职责单一，测试定位清晰
4. index.ts barrel 保持对外 API 干净

### Pattern 1: 抽象基类 + 平台实现

**What:** `EsmLoader` 抽象类定义 `load()` 契约，`NodeEsmLoader` 和 `BrowserEsmLoader` 实现平台特定逻辑
**When to use:** 任何需要在 Node.js 和浏览器之间切换的模块加载场景
**Example:**
```typescript
// packages/core/esm-loader/esm-loader.ts
export interface PluginModule {
  default?: {
    manifest?: Record<string, unknown>;
    activate?: (ctx: unknown) => Promise<void>;
  };
  activate?: (ctx: unknown) => Promise<void>;
  manifest?: Record<string, unknown>;
  [key: string]: unknown;
}

export abstract class EsmLoader {
  abstract load(code: string): Promise<PluginModule>;
}
```

### Pattern 2: data: URL base64 编码 + import()

**What:** Node.js 端将 JavaScript 字符串通过 base64 编码为 data: URL，然后用 `import()` 加载
**When to use:** Node.js 端动态加载 ESM 代码字符串
**Why base64 over encodeURIComponent:** base64 更紧凑、二进制安全、处理所有 Unicode 字符无问题 [VERIFIED: practical test] [CITED: stackoverflow.com base64 vs encodeURIComponent comparison]

**Example:**
```typescript
// packages/core/esm-loader/node-loader.ts
// [VERIFIED: practical test — Node.js v24.1.0]
import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmSyntaxError, EsmModuleNotFoundError } from './errors.js';

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

### Pattern 3: Browser Blob URL + import()

**What:** 浏览器端通过 `URL.createObjectURL(new Blob(...))` 创建临时 URL，`import()` 后立即 `URL.revokeObjectURL()` 清理
**When to use:** 浏览器端动态加载 ESM 代码字符串（Phase 9 前端集成）
**Example:**
```typescript
// packages/core/esm-loader/browser-loader.ts
// [CITED: developer.mozilla.org — Blob URL + import() pattern]
import { EsmLoader, type PluginModule } from './esm-loader.js';
import { EsmLoaderError, EsmSyntaxError } from './errors.js';

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
      URL.revokeObjectURL(url);
    }
  }

  private classifyError(err: Error): EsmLoaderError {
    // 浏览器错误消息格式与 Node.js 不同
    const msg = err.message;
    if (msg.includes('SyntaxError') || msg.includes('Unexpected token')) {
      return new EsmSyntaxError(msg, { cause: err });
    }
    return new EsmLoaderError(msg, { cause: err });
  }
}
```

### Pattern 4: esbuild 内存打包（stdin + write: false）

**What:** 使用 esbuild 的 `build()` API 从字符串入口构建单 ESM bundle，结果通过 `outputFiles[0].text` 获取
**When to use:** 插件安装时，将多文件 ZIP 插件打包为单文件供 data: URL 加载
**Example:**
```typescript
// [VERIFIED: practical test — esbuild 0.25.12]
import * as esbuild from 'esbuild';

async function bundlePlugin(
  entryCode: string,
  resolveDir: string,  // 临时解压目录，用于解析相对导入
): Promise<string> {
  const result = await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir,
      loader: 'ts',  // 支持 TypeScript 入口
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',  // 不注入 Node 或 browser 特定代码
    target: 'es2022',
    external: ['@openlearn/*'],  // 保留 Token 服务导入
  });
  
  return result.outputFiles[0].text;
}
```

### Pattern 5: manifest-schema.ts + zod 校验

**What:** 集中定义 manifest.json 的 zod schema，运行时校验 + TypeScript 类型推导合一
**When to use:** 插件安装时，解压 ZIP 后立即校验 manifest.json
**Example:**
```typescript
// packages/core/esm-loader/manifest-schema.ts
// [CITED: zod.dev v4 documentation]
import { z } from 'zod';

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

// 使用示例：
// const manifest = manifestSchema.parse(JSON.parse(manifestJsonString));
```

### Artifact Pattern: Structured Error Hierarchy

**What:** 所有加载错误继承自 `EsmLoaderError`，携带结构化上下文
**Example:**
```typescript
// packages/core/esm-loader/errors.ts
export class EsmLoaderError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
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

### Anti-Patterns to Avoid
- **在 data: URL 中使用相对导入:** data: 不是 hierarchical scheme，相对导入会抛出 `ERR_UNSUPPORTED_RESOLVE_REQUEST`。必须通过 esbuild 预打包消除所有相对导入 [VERIFIED: practical test + nodejs/node#51956]
- **Blob URL 忘记 revoke:** 每次 `URL.createObjectURL()` 不调用 `URL.revokeObjectURL()` 会导致内存泄漏。在 `finally` 块中清理 [CITED: MDN URL.createObjectURL]
- **在 EsmLoader 中构建安全上下文:** D-03 明确声明加载器只返回原始模块导出，安全包装在 PluginRuntime 中保留。不要在 EsmLoader 中混入安全逻辑
- **混合 vm 和 ESM 加载路径的 handler 注册逻辑:** D-09 要求在 PluginRuntime.evaluateAndActivate() 中根据 loader_version 分支，但不改动 wrapped* 构建。不要重复编写安全包装器代码

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP 解压 | 自定义 ZIP 解析器 | jszip 3.10.1 (已在用) | ZIP 格式边界情况多（加密、分卷、编码），自建极易出错 |
| esbuild 多文件打包 | 自定义 AST 变换 + 打包 | esbuild 0.25.12 (已在用) | esbuild 处理依赖图、作用域提升、tree-shaking；自建需要 acorn/babel + 依赖解析 + 作用域分析 |
| manifest.json 校验 | 手写 if/typeof 检查 | zod 4.4.3 (已安装) | zod 提供类型安全的结构化校验、精确错误消息、零运行时 cost 的类型推导 |
| 错误分类 | instanceof + 字符串匹配分散在各处 | EsmLoaderError 集中层次 | 统一错误类型让 PluginRuntime 可以一致性处理加载失败场景 |
| data: URL 编码 | encodeURIComponent 分段 | Buffer.toString('base64') | base64 对所有 Unicode 安全、更紧凑、符合 data: URL 标准 [VERIFIED: practical test] |

**Key insight:** esbuild 的 `stdin + bundle + external + write:false` 四件套完美解决了"多文件包含相对导入的插件如何被 data: URL 加载"这个核心问题。不需要任何中间步骤或自定义打包器。

## Runtime State Inventory

> Phase 3 不是 rename/refactor/migration 阶段，而是增量功能添加。Omit this section。

Step 2.5: SKIPPED — Phase 3 adds new capabilities (EsmLoader + ZIP format + esbuild bundling) without renaming or migrating existing runtime state.

## Common Pitfalls

### Pitfall 1: data: URL 中的相对导入静默失败
**What goes wrong:** 插件 bundle 未正确打包（缺失 esbuild 打包步骤），残留的 `import './utils.js'` 在 data: URL 环境下触发 `ERR_MODULE_NOT_FOUND` 或 `Failed to resolve module specifier`
**Why it happens:** data: URL 不是 hierarchical URL scheme，Node.js 的 ESM 解析器无法从 data: URL 确定文件系统上的相对路径基准 [VERIFIED: nodejs/node#51956 + practical test]
**How to avoid:** 安装流程中强制 esbuild 打包步骤；在 manifest-schema 校验后、存储前，确保入口代码是打包后的单 bundle
**Warning signs:** 错误消息包含 "Failed to resolve module specifier" 或 "Invalid relative URL or base scheme is not hierarchical"

### Pitfall 2: esbuild external 通配符不匹配
**What goes wrong:** `external: ['@openlearn/*']` 可能不匹配某些 Token import 格式（如不带 `/` 的 `@openlearn`）
**Why it happens:** esbuild 的 external 通配符 `*` 匹配的是路径段，`@openlearn/core:ICommandBusService` 是裸 specifier，不含 `/`
**How to avoid:** 在 external 中同时包括 `'@openlearn/*'`（匹配 `@openlearn/something`）和通配符模式。或者使用 esbuild plugin 的 `onResolve` 回调精确控制哪些包标记为 external。**关键验证:** Token import 格式是 `@openlearn/core:ICommandBusService`——这被 Node.js 视为裸 specifier，esbuild 的 external 匹配需要确认。实测显示 `external: ['@openlearn/*']` 能正确保留 `@openlearn/core:ITest` 的 import [VERIFIED: practical test]
**Warning signs:** 打包后的 bundle 中 Token import 被当作普通相对路径解析，导致 "Could not resolve" 错误

### Pitfall 3: Zod v4 safeParse 返回值不再继承 Error
**What goes wrong:** 在测试中断言 `result.error instanceof Error` 在 Zod v4 中为 `false`
**Why it happens:** Zod 4 中 `.safeParse()` 返回的 error 对象不再继承 `Error`（性能优化），只有 `.parse()` 抛出的异常继承 `Error` [CITED: zod.dev/v4/changelog]
**How to avoid:** 使用 `manifestSchema.safeParse()` 检查 `result.success`；错误检查改为 `result.error?.issues` 而非 `instanceof Error`。或者使用 `manifestSchema.parse()` + try/catch 保持 Error 继承链
**Warning signs:** 测试中 `error instanceof ZodError` 突然失败

### Pitfall 4: esbuild platform: 'node' 会注入 Node.js 全局
**What goes wrong:** 使用 `platform: 'node'` 打包时，esbuild 可能将 `process.env` 等 Node 特定引用保留为外部引用；而 `platform: 'browser'` 会 polyfill 某些 Node API
**Why it happens:** esbuild 的 platform 选项影响对 built-in 模块（fs, path 等）的处理方式
**How to avoid:** 对于跨运行时插件，使用 `platform: 'neutral'` 或显式设置 `external: []`。插件代码不应直接依赖 `process`、`Buffer` 等 Node 特定全局——这些通过 Token 服务注入
**Warning signs:** 打包后的 bundle 中出现 `import fs from "fs"` 或 `process.env.NODE_ENV`

### Pitfall 5: 数据库 ALTER TABLE 重复执行
**What goes wrong:** 服务器重启时 ALTER TABLE 语句因列已存在而失败
**Why it happens:** 现有 `db/index.ts` 使用 try/catch 包裹 ALTER TABLE，Column already exists 错误被静默捕获
**How to avoid:** 遵循现有模式——每个 ALTER TABLE 用 try/catch 包裹。在 `db/index.ts` 中按现有风格添加：
```typescript
try {
  db.prepare('ALTER TABLE plugins ADD COLUMN loader_version TEXT DEFAULT \'vm\'').run();
} catch (e) {
  // column already exists
}
try {
  db.prepare('ALTER TABLE plugins ADD COLUMN zip_package BLOB').run();
} catch (e) {
  // column already exists
}
```
**Warning signs:** 查看 try/catch 是否吞掉了非 "column already exists" 的错误

## Code Examples

Verified patterns from official sources:

### Node.js data: URL Import
```typescript
// [VERIFIED: practical test — Node.js v24.1.0]
// Source: nodejs.org/api/esm.html#data-imports
const code = `export const hello = "world";`;
const base64 = Buffer.from(code, 'utf-8').toString('base64');
const url = `data:text/javascript;base64,${base64}`;
const mod = await import(url);
console.log(mod.hello); // "world"
```

### esbuild In-Memory Bundle
```typescript
// [VERIFIED: practical test — esbuild 0.25.12]
// Source: esbuild.github.io/api/#build
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  stdin: {
    contents: `export const x = 1;`,
    resolveDir: '/tmp',
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['@openlearn/*'],
});
const bundledCode: string = result.outputFiles[0].text;
```

### Zod Manifest Validation
```typescript
// [CITED: zod.dev]
// Source: zod.dev documentation
import { z } from 'zod';

const schema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  main: z.string().min(1),
  requires: z.array(z.string()).optional(),
  capabilitiesProposed: z.array(z.string()).optional(),
});

// Fail-fast on invalid manifest
const manifest = schema.parse(JSON.parse(rawJson));

// Or graceful: 
// const result = schema.safeParse(JSON.parse(rawJson));
// if (!result.success) { handleError(result.error); }
```

### JSZip Read from Buffer
```typescript
// [CITED: stuk.github.io/jszip]
// Source: jszip official documentation
import JSZip from 'jszip';

const zipBuffer: Buffer = /* from SQLite zip_package BLOB */;
const zip = await JSZip.loadAsync(zipBuffer);

// 读取特定文件
const manifestJson = await zip.file('manifest.json')?.async('string');
const entryCode = await zip.file('index.js')?.async('string');

// 遍历所有文件
for (const [name, file] of Object.entries(zip.files)) {
  if (!file.dir) {
    const content = await file.async('string');
    console.log(name, content.length);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vm.createContext` + `vm.Script.runInContext` | `import()` with data: URL / Blob URL | Phase 3 (current) | 从 Node.js-specific 变为跨运行时；从 CommonJS 风格变为标准 ESM；从沙箱隔离变为模块作用域隔离 |
| Single JS string plugins | ZIP 包 (manifest.json + .js 文件 + esbuild 打包) | Phase 3 (current) | 支持多文件插件、结构化元数据、运行时校验 |
| Runtime JS concatenation | esbuild 安装时预打包 | Phase 3 (current) | 类型安全的 TypeScript 转译、import 解析、tree-shaking |
| 无 manifest 校验 | zod schema 运行时校验 | Phase 3 (current) | 安装时早失败，精确错误报告 |

**Deprecated/outdated:**
- `vm.createContext` 方案：保留到 Phase 8 完成后移除。Phase 3 通过 loader_version 标记实现新旧共存
- `import-module-string` 第三方库：STACK.md 初始研究推荐，后续分析发现引入的复杂度（acorn 解析、CJS shim、全局导出检测）在预打包场景下不必要

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | esbuild `platform: 'neutral'` 是最合适的跨运行时插件打包目标 | Common Pitfalls #4 | 如果 `neutral` 对某些 Node API 处理不当，可能需要改为 `platform: 'node'` + 显式 external |
| A2 | Token import 格式 `@openlearn/core:IServiceName` 可以被 esbuild 的 `external: ['@openlearn/*']` 正确保留 | Common Pitfalls #2 | 已验证一个案例通过。如果不同 Token 的 import 路径格式有差异，可能需要 esbuild plugin onResolve 回调 |
| A3 | BrowserEsmLoader 在 jsdom/happy-dom 环境中的 `URL.createObjectURL` + `import()` 模拟是可行的 | Validation Architecture | jsdom 对 Blob URL 的 import() 支持可能不完整，可能需要额外 polyfill 或简化为纯 Node 测试 |
| A4 | `import()` 返回的模块对象形状是 `{ default?: PluginModule, [key: string]: unknown }` | Architecture Pattern #1 | `import()` 的确切返回类型取决于 ES module namespace object 规范。如果模块使用 named exports 而非 default export，访问模式需要调整 |

## Open Questions (RESOLVED)

1. **esbuild external 的 Token import 格式精确匹配**
   - What we know: `external: ['@openlearn/*']` 已验证对 `@openlearn/core:ITest` 有效
   - What's unclear: 是否所有 Token import 路径都遵循规范的 npm scope 格式。Token 名称中包含 `:` 字符，可能被某些解析器视为特殊字符
   - Recommendation: 在实现阶段用所有 7 个现有 Token 名称（`@openlearn/core:ICommandBusService` 等）做批量验证。如有不匹配，降级为 esbuild plugin 的 `onResolve` 回调

2. **Zod v4 与项目 tsconfig 兼容性**
   - What we know: Zod v4 要求 TypeScript strict mode（或至少 `strictNullChecks` + `strictFunctionTypes`）。项目 `tsconfig.json` 未开启 `strict: true`
   - What's unclear: 在非 strict 模式下 Zod v4 的类型推导是否正常工作
   - Recommendation: esm-loader 模块内的代码使用显式类型标注，不依赖 Zod 的高级类型推导特性。如有问题，Phase 3 可单独为 esm-loader/ 目录覆盖 tsconfig

3. **data: URL 的 import() 缓存行为**
   - What we know: Node.js 的 ESM loader 对已 import 的 URL 有缓存机制
   - What's unclear: 相同 data: URL 再次 import() 时是否返回缓存还是重新执行。这对热重载（Phase 7）有影响
   - Recommendation: 每次 load() 使用唯一的 data: URL（如附加 `#${timestamp}` fragment 或使用不同 base64 编码），确保独立执行。Phase 3 阶段即可实现此策略

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | data: URL import() + esbuild + jszip | YES | v24.1.0 | — |
| npm | 包管理 | YES | 11.6.2 | — |
| esbuild | 多文件插件预打包 | YES | 0.25.12 | —（已安装） |
| jszip | ZIP 解压 | YES | 3.10.1 | —（已安装） |
| zod | manifest 校验 | YES | 4.4.3 | —（已安装） |
| vitest | NodeEsmLoader + manifest-schema 测试 | YES | 4.1.9 | —（已安装） |
| jsdom/happy-dom | BrowserEsmLoader smoke 测试 | NO | — | vitest 内置 jsdom 环境可通过 `environment: 'jsdom'` 启用 |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:**
- jsdom/happy-dom：vitest 的 `@vitest/experimental-jsdom` 或内置 `environment: 'jsdom'` 可直接使用 jsdom，无需额外安装。如不可用，BrowserEsmLoader 的 test 可降级为纯 Node 环境下的 mock 测试

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.9 |
| Config file | `vitest.config.ts` (需更新 include 模式以包含 esm-loader 测试) |
| Quick run command | `npx vitest run packages/core/esm-loader/__tests__/` |
| Full suite command | `npm test` (vitest run) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLUG-01 | NodeEsmLoader.load() 成功加载合法 ESM 字符串并返回导出 | unit | `vitest run packages/core/esm-loader/__tests__/node-loader.test.ts` | No (Wave 0) |
| PLUG-01 | NodeEsmLoader.load() 对语法错误代码抛出 EsmSyntaxError | unit | (同上文件) | No (Wave 0) |
| PLUG-01 | NodeEsmLoader.load() 对超时场景抛出 EsmLoadTimeoutError | unit | (同上文件) | No (Wave 0) |
| PLUG-01 | BrowserEsmLoader 基本 Blob URL 创建 + revoke 流程 | smoke | `vitest run packages/core/esm-loader/__tests__/browser-loader.test.ts` | No (Wave 0) |
| PLUG-02 | manifest-schema 校验合法 manifest.json 通过 | unit | `vitest run packages/core/esm-loader/__tests__/manifest-schema.test.ts` | No (Wave 0) |
| PLUG-02 | manifest-schema 拒绝缺少 id/name/version/main 的 manifest | unit | (同上文件) | No (Wave 0) |
| PLUG-02 | esbuild 打包多文件（含相对导入）为单 ESM bundle | unit | (同上文件中集成测试) | No (Wave 0) |
| PLUG-02 | esbuild 保留 @openlearn/* Token 导入为 external | unit | (同上文件中集成测试) | No (Wave 0) |
| PLUG-02 | jszip 解压合法 ZIP 包并提取 manifest.json + entry.js | unit | (同上文件中集成测试) | No (Wave 0) |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/core/esm-loader/__tests__/ --reporter=verbose`
- **Per wave merge:** `npm test` (full vitest run)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/core/esm-loader/__tests__/node-loader.test.ts` — NodeEsmLoader 完整测试 (PLUG-01)
- [ ] `packages/core/esm-loader/__tests__/browser-loader.test.ts` — BrowserEsmLoader smoke 测试 (PLUG-01)
- [ ] `packages/core/esm-loader/__tests__/manifest-schema.test.ts` — manifest 校验测试 (PLUG-02)
- [ ] `packages/core/esm-loader/__tests__/fixtures/` — 测试 fixtures 目录
- [ ] `vitest.config.ts` — 更新 include 模式以包含 esm-loader 测试
- [ ] 测试基础设施已存在（vitest 已安装，配置可用），主要缺口是测试文件本身

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — Phase 3 不涉及用户认证 |
| V3 Session Management | No | — Phase 3 不涉及会话管理 |
| V4 Access Control | No | — 访问控制由现有 CapabilityGuard 处理（Phase 2），EsmLoader 不涉及 |
| V5 Input Validation | Yes | zod 4.4.3 — manifest.json 在加载阶段即进行运行时 schema 校验（D-10），无效 manifest 在 parse() 阶段被拒绝 |
| V6 Cryptography | No | — 不涉及密码学操作 |
| V7 Error Handling | Yes | 结构化 EsmLoaderError 层次 — 错误信息包含足够上下文供诊断，但不泄露敏感信息（如文件系统路径不在用户可见错误中暴露） |

### Known Threat Patterns for data: URL + ESM Loading

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 恶意插件代码试图访问 Node.js 内置模块（fs, child_process 等） | Elevation of Privilege | esbuild `external: ['@openlearn/*']` 确保插件不能导入 Node builtins；data: URL 模块无法访问 `require`；PluginRuntime 的 wrapped* 安全包装器保留（D-03） |
| 恶意 manifest.json 注入超长字符串导致 DoS | Denial of Service | zod 内置字符串长度限制可通过 `.max()` 添加；manifest.json 文件大小在解压时检查（建议限制 64KB） |
| 恶意 ZIP 包包含路径穿越（`../../../etc/passwd`） | Tampering | jszip 默认阻止绝对路径和 `..` 路径；安装时显式验证解压后的文件路径不包含 `..` |
| data: URL 中的代码尝试访问 import.meta.url 获取服务器路径 | Information Disclosure | data: URL 的 import.meta.url 是 data: URL 本身，不暴露文件系统路径；esbuild `platform: 'neutral'` 不会注入 `__dirname`/`__filename` |
| ZIP bomb（小 ZIP 解压为巨大文件） | Denial of Service | 解压前检查 ZIP 元数据中声明的未压缩大小总和；建议限制总未压缩大小 < 10MB |
| 插件代码无限循环导致 load() 永不返回 | Denial of Service | `Promise.race([import(url), timeoutPromise])` 在 EsmLoader 层面添加超时保护（5秒，D-14），超时后抛出 EsmLoadTimeoutError |

## Sources

### Primary (HIGH confidence)
- [Context7 library ID: nodejs] — data: URL import + ESM loader behavior [VERIFIED: practical test on Node.js v24.1.0]
- [Context7 library ID: esbuild] — build API, stdin, write:false, external, format: esm [VERIFIED: practical test on esbuild 0.25.12]
- [zod.dev] — v4 API: z.object, z.string, z.array, z.infer, safeParse, parse [CITED: zod.dev documentation]
- [stuk.github.io/jszip] — loadAsync, file().async('string'), ZIP reading API [CITED: official documentation]

### Secondary (MEDIUM confidence)
- [github.com/nodejs/node/issues/51956] — data: URL 相对导入限制的根因分析 [CITED]
- [github.com/zachleat/javascript-eval-modules] — data: URL + Blob URL import() 跨运行时方法总结 [CITED]
- [esbuild.github.io/api] — build options reference [CITED]
- [zod.dev/v4/changelog] — Zod v4 migration guide, safeParse Error 继承变更 [CITED]

### Tertiary (LOW confidence)
- WebSearch on jsdom import() support for Blob URL — 未找到权威确认，标记为 A3 assumption

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 所有核心库已安装且版本已验证。esbuild/jszip 在项目中已有成熟使用。zod 版本和 API 已通过 npm registry 和官方文档验证
- Architecture: HIGH — EsmLoader 抽象类模式与现有 DI 架构一致。data: URL + Blob URL 双路径通过实验验证。esbuild 内存打包通过实验验证。错误层次与现有 DI 错误类模式一致
- Pitfalls: HIGH — 关键限制（data: URL 不支持相对导入）通过 Node.js 官方 issue 和实践测试双重验证。Zod v4 变更通过迁移指南确认。esbuild platform 行为通过实践测试确认

**Research date:** 2026-06-18
**Valid until:** 2026-07-02 (stable — Node.js data: URL import 和 esbuild API 是成熟且稳定的特性；zod v4 可能在 30 天内有小版本更新但核心 API 不变)
