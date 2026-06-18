# Phase 3: ESM 加载 + 包格式 - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

实现跨运行时（Node.js data: URL / 浏览器 Blob URL）的动态 ESM 模块加载器，替代 `vm.createContext` 作为新的代码加载机制。同时定义 ZIP 插件包格式（manifest.json + 多文件 + esbuild 预打包）支持第三方插件分发。

**In scope:**
- 独立 EsmLoader 抽象类 + NodeEsmLoader (data: URL) / BrowserEsmLoader (Blob URL) 双平台实现
- ZIP 插件包格式：manifest.json (id/name/version/main/requires/optional/capabilitiesProposed) + 入口 .js/.ts + 可选资源文件
- zod schema 运行时校验 manifest.json
- esbuild 安装时打包：入口 + 所有相对导入 → 单个 ESM bundle
- 结构化错误类层次：EsmLoaderError + 子类（SyntaxError/ModuleNotFoundError/LoadTimeoutError/ActivationError）
- plugins 表新增 loader_version 和 zip_package 字段
- Node.js 完整测试 + 浏览器 smoke 测试

**Out of scope:**
- 浏览器端实际集成（推迟到 Phase 9 前端集成）
- 第三方 npm 包导入（仅允许相对导入 + Token 服务）
- 原有 vm.createContext 代码移除（推迟到 Phase 8 现有插件迁移完成后）
- 热重载实现（Phase 7 — 但包存储策略预留了从 zip_package 重新解压的能力）
- 插件生命周期管理（Phase 4 PluginHost）
- SemVer 版本兼容（Phase 6）
</domain>

<decisions>
## Implementation Decisions

### 加载器架构（D-01 ~ D-03）
- **D-01: 独立 EsmLoader 类 + PluginRuntime 依赖注入** — 新建 `packages/core/esm-loader/` 目录。EsmLoader 作为独立类（可单独测试、跨运行时复用），PluginRuntime 通过构造函数或 DI 接收 EsmLoader 实例。职责分离：EsmLoader 负责加载和返回模块导出，PluginRuntime 负责构建 wrapped* 安全上下文
- **D-02: 抽象基类 + 平台实现** — `abstract class EsmLoader { abstract load(code: string): Promise<PluginModule> }`。`NodeEsmLoader` 用 data: URL + `import()`，`BrowserEsmLoader` 用 Blob URL + `import()`。通过 DI 注入正确的平台实现。类型安全，各平台可独立测试
- **D-03: 加载器返回原始模块导出** — EsmLoader.load() 返回由 `import()` 得到的模块命名空间对象。PluginRuntime 负责从中提取 `activate` 函数并传入 wrapped* 上下文。安全包装层（createSafeFunction）在 PluginRuntime 侧保留

### 包格式定义（D-04 ~ D-06）
- **D-04: 最小 manifest.json** — 必需字段：`id`（string）、`name`（string）、`version`（string）、`main`（入口文件路径，相对于 ZIP 根目录）。可选字段：`requires`（Token 标识符字符串数组）、`optional`（Token 标识符字符串数组）、`capabilitiesProposed`（字符串数组）。与 Phase 1 D-03 的字符串比较策略一致
- **D-05: requires/optional 使用 Token 标识符字符串** — 如 `["@openlearn/core:ICommandBusService"]`。字符串比较避免跨 bundle Token 对象 `===` 不匹配问题。Phase 6 可扩展为 `@openlearn/core:ICommandBusService@^1.0` 带版本范围
- **D-06: 插件入口仍是 ESM 模块** — ZIP 包的 main 指向一个标准的 ESM 模块文件（如 `index.js`），该文件 `export default { manifest, activate }` 或 `export function activate(ctx) {}`。与现有 JS 字符串格式在逻辑上等价，只是加载方式从 vm.createContext 变为 import()

### 多文件策略（D-07 ~ D-08）
- **D-07: esbuild 安装时打包** — 插件开发者上传 ZIP 包（含多个 .js/.ts 文件 + manifest.json）。安装时用 esbuild 将 main 入口 + 所有相对导入打包为单个 ESM bundle。esbuild 已在项目 devDependencies 中，零额外依赖。支持 .ts 直接编译（esbuild 内置 TS 转译）
- **D-08: 仅允许相对导入 + Token 服务** — esbuild 打包时 `external: ['@openlearn/*']`，保留 Token import 由宿主环境（运行时 importmap 或 data: URL 内联）注入。禁止 import 第三方 npm 包（如 lodash）——打包时无法解析的外部包报错拒绝安装。保障插件隔离性和安全性

### 过渡策略（D-09）
- **D-09: 加载器选择标记** — `plugins` 表新增 `loader_version` TEXT 字段，取值 `'vm'`（旧）或 `'esm'`（新）。安装时根据源格式自动设置：单 JS 字符串（现有格式）→ `'vm'` legacy；ZIP 包 → `'esm'`。PluginRuntime 根据标记选择加载路径。旧 vm 代码保留到 Phase 8 完成后移除

### Schema 校验（D-10）
- **D-10: 独立 manifest-schema.ts + zod 运行时校验** — 新建 `packages/core/esm-loader/manifest-schema.ts`，导出 zod schema 和推导出的 TypeScript 类型（`z.infer<typeof manifestSchema>`）。PluginRuntime.installPlugin() 在解压 ZIP 后立即用 `manifestSchema.parse()` 校验，不合法则拒绝安装并返回 ZodError（包含精确的字段路径和错误描述）

### 跨运行时抽象（D-11）
- **D-11: EsmLoader 接口在 Node.js 和浏览器之间保持一致** — NodeEsmLoader 用 `data:text/javascript;base64,${Buffer.from(code).toString('base64')}` + `import()`。BrowserEsmLoader 用 `URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))` + `import()`。两者都返回相同的 `PluginModule` 接口

### 包存储策略（D-12）
- **D-12: SQLite blob + 文本混合存储** — `plugins` 表新增 `zip_package` BLOB 字段存储原始 ZIP 字节。esbuild 打包后的 bundle 文本继续存储在 `source_code` 字段。热重载（Phase 7）时从 zip_package BLOB 重新解压并重新打包。备份只需复制 .db 单文件

### 数据库表结构（D-13）
- **D-13: 最小字段新增** — `plugins` 表执行 `ALTER TABLE plugins ADD COLUMN loader_version TEXT DEFAULT 'vm'` 和 `ALTER TABLE plugins ADD COLUMN zip_package BLOB`。现有行 loader_version 默认 'vm'，向下兼容。无需新建子表或重构现有字段

### 错误处理（D-14）
- **D-14: 结构化错误类层次** — 定义 `EsmLoaderError` 基类（继承 Error）和子类：`EsmSyntaxError`（JS 语法错误）、`EsmModuleNotFoundError`（相对导入未找到）、`EsmLoadTimeoutError`（5 秒超时）、`EsmActivationError`（activate 抛异常）。每类携带上下文信息（文件路径、行号等）。PluginRuntime 捕获并转换为用户友好消息

### 测试策略（D-15）
- **D-15: Node.js 全测试 + 浏览器 smoke** — NodeEsmLoader 完整 vitest 测试（data: URL 路径，覆盖加载成功/语法错误/超时/相对导入等场景）。BrowserEsmLoader 用 vitest + happy-dom/jsdom 模拟 Blob URL 覆盖核心逻辑。Phase 9 前端集成时补充真浏览器 E2E

### Claude's Discretion
以下技术细节由下游 agent（researcher/planner）自主决定：
- EsmLoader 类的具体文件拆分（单个 esm-loader.ts 还是 loader/ 子目录含多文件）
- manifest-schema.ts 中 zod schema 的具体字段定义和错误消息措辞
- esbuild 打包的具体配置（bundle 格式、target、platform 等）
- NodeEsmLoader 中 data: URL 的具体编码方式（base64 vs encodeURIComponent）
- BrowserEsmLoader 的具体 Blob URL 生命周期管理（URL.revokeObjectURL 时机）
- 错误类的继承层次和额外属性（如是否包含原始 import() 错误）
- 测试用例的具体组织和 mock 策略
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目级文档
- `.planning/ROADMAP.md` — Phase 3 目标、成功标准（5 项）、依赖关系（Phase 2）、需求映射（PLUG-01, PLUG-02）
- `.planning/PROJECT.md` — 项目核心价值、约束条件（兼容性、双运行时、安全性、类型安全、渐进式）
- `.planning/STATE.md` — 当前项目状态（Phase 02 完成，Phase 03 准备讨论）
- `.planning/REQUIREMENTS.md` — 需求追踪：PLUG-01（跨运行时插件引擎）、PLUG-02（插件发现和分发）

### 先前阶段上下文
- `.planning/phases/01-token-di/01-CONTEXT.md` — Phase 1 锁定决策：Token 命名规范（D-02）、字符串依赖声明（D-03）、同步 register + async 接口预留（D-05）
- `.planning/phases/02-token/02-CONTEXT.md` — Phase 2 锁定决策：7 个 IService 接口（D-01~D-05）、async 统一签名（D-10）、安全包装器保留（D-07）

### 代码库参考（必须阅读）
- `packages/core/plugin-runtime/index.ts` — 现有 evaluateAndActivate() 完整实现（vm.createContext + vm.Script），Phase 3 需理解其两阶段执行（pre-context 提取 manifest → 完整 context 执行 activate）和 wrapped* 安全包装器构建逻辑
- `packages/core/kernel/index.ts` — Kernel 构造函数，PluginRuntime 的初始化位置。Phase 3 新增 EsmLoader 可能在此注入
- `packages/core/di/service-registry.ts` — ServiceRegistry API（register/resolve/unregister）。EsmLoader 作为服务注册到此容器
- `packages/core/db/index.ts` — plugins 表 DDL，需要新增 loader_version 和 zip_package 列
- `server.ts` — 插件安装相关的 REST 端点（`POST /api/plugins/install-zip` 等），esbuild 打包调用入口

### 外部依赖
- `jszip` 3.10 — 已安装，用于 ZIP 解压。Phase 3 使用 jszip 读取上传的 ZIP 包
- `esbuild` 0.25 — 已安装（生产构建用），用于安装时打包多文件插件为单 ESM bundle
- `zod` — 需安装（Phase 3 新增依赖），用于 manifest.json 运行时校验
- `vitest` — 已安装（Phase 1），用于 EsmLoader 测试
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **jszip 3.10** — 已在 `server.ts` 的课件上传/解压流程中使用。Phase 3 复用 jszip 读取 ZIP 插件包
- **esbuild 0.25** — 已在 `package.json` scripts 中用于生产构建（`esbuild server.ts --bundle --platform=node --format=cjs --packages=external`）。Phase 3 复用 esbuild 的 `build()` API 打包多文件插件
- **ServiceRegistry** — Phase 1-2 建立的 DI 容器。EsmLoader 实例可注册到此容器，PluginRuntime 通过 `resolve(IEsmLoaderToken)` 获取
- **现有 PluginRuntime.deactivatePlugin()** — 完整的资源追踪和清理逻辑（actions, commandTypes, eventSubscriptions, processHandlers, spawnedProcessIds, capabilities）。Phase 3 不改动此逻辑——只替换加载方式
- **现有 wrapped* 安全包装器** — createSafeFunction + 原型链冻结 + Object.defineProperty。Phase 3 完全保留此安全层

### Established Patterns
- **ESM 导入规范** — 后端代码使用 `.js` 扩展名相对导入。新建 esm-loader/ 遵循相同规范
- **packages/core/ 目录结构** — 每个子系统一个目录 + index.ts barrel。EsmLoader 遵循相同结构
- **Kernel 全局单例 + 构造函数注入** — ServiceRegistry、PluginRuntime 等均通过 Kernel 构造函数初始化。EsmLoader 同样在 Kernel 中创建并注入到 PluginRuntime
- **两阶段插件加载模式** — 现有 evaluateAndActivate 先 pre-context 提取 manifest，再完整 context 执行 activate。ESM 加载器可参考此模式：import() 第一次获取 manifest → 构建 context → 调用 activate

### Integration Points
- **PluginRuntime.evaluateAndActivate()** (packages/core/plugin-runtime/index.ts:150) — 这是需要修改的核心方法。根据 loader_version 分支：`'vm'` → vm.createContext（现有代码不变），`'esm'` → esmLoader.load() + activate
- **PluginRuntime.installPlugin()** (packages/core/plugin-runtime/index.ts:36) — 安装入口。新增 ZIP 解压 + manifest 校验 + esbuild 打包逻辑
- **Kernel 构造函数** (packages/core/kernel/index.ts) — Phase 3 在此创建 EsmLoader 实例并注入到 PluginRuntime
- **DB schema** (packages/core/db/index.ts) — 新增 ALTER TABLE 语句添加 loader_version 和 zip_package 列
- **server.ts 插件 API 端点** — 新增 `POST /api/plugins/install-zip`（接收 multipart/form-data ZIP 文件）或扩展现有 `POST /api/plugins/install` 端点
</code_context>

<specifics>
## Specific Ideas

用户未引用具体的外部文档或设计规范。所有决策基于：
- 项目现有架构（vm.createContext → ESM import() 替换）
- Phase 1-2 锁定的 DI/Token 基础设施（ServiceRegistry、Token 命名规范）
- ROADMAP 成功标准（5 项 must-have truths）
- 项目已安装的依赖（jszip、esbuild、vitest）

标准方法即可，无需特殊约束。

具体参考：JupyterLab 的插件加载机制（`import()` 动态加载 + Token Registry 字符串比较）作为架构参考，但不要求在实现中逐行复刻。
</specifics>

<deferred>
## Deferred Ideas

无。讨论始终聚焦在 Phase 3 的 ESM 加载和包格式设计决策上，未出现超出范围的想法。

### Reviewed Todos (not folded)
无。
</deferred>

---

*Phase: 3-ESM 加载 + 包格式*
*Context gathered: 2026-06-18*
