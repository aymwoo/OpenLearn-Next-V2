# Phase 8: 现有插件迁移 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 08-现有插件迁移
**Areas discussed:** Built-in Plugins Execution Mode, Migration & Adapter Strategy, Third-Party Plugins Packaging, Migration Waves & Ordering

---

## 内置插件运行模式 (Execution Mode for Built-in Plugins)

| Option | Description | Selected |
|--------|-------------|----------|
| 优先使用 Inline 模式 | 内置插件为完全信任的特权服务，运行在主线程以获得最低延迟，并能直接访问主机资源（如 VFS 文件系统、Process 进程管理） | ✓ |
| 全量使用 Worker 隔离模式 | 所有插件均在独立 Worker 线程运行，通过跨边界 RPC 代理与主线程交互，对内置特权插件进行强制进程级隔离 | |
| 混合模式 | 开发助手决定哪些内置插件用 Inline（如 VFS），哪些用 Worker（如 AI Planner） | |

**User's choice:** 优先使用 Inline 模式
**Notes:** 内置插件是可信任的，且需要高性能和底层本地资源（FS / Processes）的直接调用。因此首选在主线程中加载和调用，消除复杂的 RPC 封装开销。

***

## 能力权限检查 (Capability Enforcements)

| Option | Description | Selected |
|--------|-------------|----------|
| 严格执行能力权限检查 | Inline 插件的所有 Command 执行和 API 调用都必须经过 CapabilityGuard 校验，确保其行为不超出申明的权限范围 | ✓ |
| 宽松执行 | 内置插件跳过能力校验以提升性能，只对第三方的 Worker 插件进行拦截校验 | |

**User's choice:** 严格执行能力权限检查
**Notes:** 为了保证安全边界的一致性与事件的可审计性，内置 Inline 插件也必须受到 `CapabilityGuard` 控制。

***

## 中间件拦截启用 (Lifecycle Middleware)

| Option | Description | Selected |
|--------|-------------|----------|
| 全量启用中间件拦截 | 内置插件与第三方插件相同，其生命周期激活、停用、执行指令全部无差别通过 Onion Middleware Pipeline | ✓ |
| 仅第三方插件启用 | 内置插件跳过中间件拦截直接执行，以省去洋葱模型组合的微小调用损耗 | |

**User's choice:** 全量启用中间件拦截
**Notes:** 全量启用能使所有的插件行为都能被审计和控制，降低系统一致性设计的复杂度。

***

## 内置插件激活故障处理 (Error Recovery)

| Option | Description | Selected |
|--------|-------------|----------|
| 混合故障处理 | VFS, Process, LMS Management 激活失败则 Hard crash 基座；AI Planner 等应用级激活失败则 Soft fail 跳过并继续 Express 启动 | ✓ |
| 完全容错 (Soft fail) | 所有内置插件激活失败均 Soft fail，仅记录日志，让 Express 基座服务始终能启动成功 | |
| 完全严格 (Hard crash) | 任何一个内置插件激活失败，基座都直接 Hard crash 拒绝启动 | |

**User's choice:** 混合故障处理
**Notes:** 系统底座和核心业务没有 VFS/Process/Management 是完全无法工作的，需要 Hard crash 来提醒运维人员；而 AI 应用级功能故障不应影响整个系统在运行时下的 Express 正常启动。

---

## 适配器过渡策略 (Migration & Adapter Strategy)

| Option | Description | Selected |
|--------|-------------|----------|
| 彻底重写 (Direct Rewrite) | 不开发过度复杂的 Legacy 运行期适配器，直接修改现有的 6 个内置插件源码，改造成干净的 `activate(ctx)` / `deactivate()` 标准接口和 Token DI 依赖获取方式，彻底消除技术债 | ✓ |
| 编写运行期适配器包装类 | 保留旧插件 `bootstrap()` 方式和对全局 `kernelContainer` 的直接 import 依赖，编写一个 `LegacyPluginAdapter` 类将旧接口包装为新生命周期 | |

**User's choice:** 彻底重写 (Direct Rewrite)
**Notes:** 既然要在 Phase 8 对这 6 个文件进行全面改造，直接全量改写可以保证代码库的极简干净，不需要累积无意义的兼容性适配代码。

***

## 内置插件自动加载位置 (Loader Layer)

| Option | Description | Selected |
|--------|-------------|----------|
| Kernel 层自动加载 | 将内置插件的注册和激活逻辑下沉到 Kernel 构造函数或 `kernel.init()` 中，作为 OS 核心启动的一部分，使 `server.ts` 不再直接 import 它们，保持架构的清晰解耦 | ✓ |
| Server 层手动加载 | 在 `server.ts` 启动时，通过 `kernelContainer.pluginHost.installPlugin` 或 `activatePlugin` 手动导入并激活这 6 个内置插件 | |

**User's choice:** Kernel 层自动加载
**Notes:** 保持内置系统级插件属于 Kernel Layer 专属逻辑，彻底消除 Server 层与其强耦合。

***

## 数据库持久化配置记录 (DB Registration)

| Option | Description | Selected |
|--------|-------------|----------|
| 数据库备份系统记录 | 在系统的 `plugins` 数据表中为每个内置插件写入一条记录（如果不存在），标记其 `execution_mode` 为 `'inline'` 且标记为系统级不可卸载。这能让内置插件在前端管理 UI 和 Plugin List 接口中正常内省可见 | ✓ |
| 纯内存态（In-Memory Only） | 内置插件纯粹在 `PluginHost` 的内存 Registry 中管理，不写入任何数据库表 | |

**User's choice:** 数据库备份系统记录
**Notes:** 写入数据库能完美支持前端插件中心对 VFS、Process 等系统级插件的查询和内省。

***

## 内置插件 Manifest 获取方式 (Manifest Retrieval)

| Option | Description | Selected |
|--------|-------------|----------|
| 代码直接导出 | 每个内置插件文件（如 `vfs.ts`）在代码中直接 export 一个具有 `{ manifest, activate, deactivate }` 结构的对象，避免了为每个内置插件去读取独立的 `manifest.json` 磁盘文件，开发和打包更简单 | ✓ |
| 独立 Manifest 文件 | 为每个内置插件创建独立的文件夹和 `manifest.json` 配置文件，启动时从文件系统读取清单 | |

**User's choice:** 代码直接导出
**Notes:** 代码级导出极大简化了内置插件的开发流程与打包体积，不需要为每个内置文件单独在磁盘创建文件夹管理 manifest 文本。

---

## 第三方插件打包与加载 (Third-Party Plugins Packaging)

| Option | Description | Selected |
|--------|-------------|----------|
| 源码管理 + 构建时打包 | 在 `packages/plugins/` 下为它们建立独立的开发目录（如 `quiz/` 和 `rollcall/`），用 TypeScript 开发。通过 package.json 里的构建脚本，在编译时使用 jszip 自动打包为 `.zip` 并输出到 `dist/plugins/` 或 `assets/` 目录。启动时 Kernel 读取这些 zip 文件进行自动安装 | ✓ |
| 直接提交二进制 ZIP | 直接将编译并压缩好的 `.zip` 文件提交到代码仓库中，修改源码时需要手动去外部打包并替换 `.zip` 文件 | |
| 内存动态打包 (In-memory ZIP) | 依然把插件源码作为字符串常量写在代码里，但在系统启动时使用 `jszip` 库在内存中动态将字符串打包成 ZIP 字节流并安装 | |

**User's choice:** 源码管理 + 构建时打包
**Notes:** 用源码目录管理开发极佳，利用构建流水线自动打包，开发链路友好且透明。

***

## 第三方插件沙箱运行模式 (Execution Mode for Third-Party Plugins)

| Option | Description | Selected |
|--------|-------------|----------|
| 强制 Worker 隔离运行 | Quiz 和 Roll Call 均以 `'worker'` 模式运行在独立 Worker Thread 中，所有的服务访问均通过 ServiceProxy RPC 代理。这能全面验证我们在 Phase 5 设计的 Worker 隔离与 RPC 代理层在真实插件下的稳定性与功能正确性 | ✓ |
| Inline 模式运行 | 虽然它们是第三方插件类型，但为了简化调试直接让它们跑在 Inline 主线程模式 | |

**User's choice:** 强制 Worker 隔离运行
**Notes:** 将对我们重构的核心功能（沙箱与跨线程 RPC 代理、Event 转发）做最完备的实战检验。

***

## 插件包生成存放路径 (Output & Git Storage)

| Option | Description | Selected |
|--------|-------------|----------|
| 输出到 dist/plugins/ | ZIP 打包任务作为构建流程的一部分，生成的文件输出到 `dist/plugins/`，此目录被 gitignore。这能保持 Git 仓库完全干净，不提交任何二进制的 `.zip` 压缩文件 | ✓ |
| 提交到 assets/plugins/ | 构建生成的 ZIP 插件包输出到 `assets/plugins/` 并直接提交到 Git 仓库，确保即使开发人员没跑编译插件包也随时存在 | |

**User's choice:** 输出到 dist/plugins/
**Notes:** Git 仓库里不应提交任何构建产物（尤其是二进制 .zip），应采用 `npm run build` 时生成。

***

## 打包实现工具 (Build Package Script)

| Option | Description | Selected |
|--------|-------------|----------|
| 编写 JSZip 独立打包脚本 | 利用项目中已有的 `jszip` 依赖，编写独立的 Node.js 脚本 `scripts/build-plugins.mjs`，在构建中被调用，实现跨平台（Windows/Linux/macOS）无缝打包，不需要系统安装 `zip` 命令 | ✓ |
| 使用 shell zip 命令 | 直接在 package.json 脚本中写 `zip -r ...`，依赖开发机系统自带的 zip 命令行工具 | |

**User's choice:** 编写 JSZip 独立打包脚本
**Notes:** 用 JS 编写跨平台打包脚本最稳固，避开了对主机环境 `zip` 命令安装的要求。

---

## 迁移优先级与波次规划 (Migration Waves & Ordering)

| Option | Description | Selected |
|--------|-------------|----------|
| 推荐波次规划 | 按 VFS/Process -> Core/Management -> AI/LMS -> 第三方 ZIP 的顺序进行，分步重构与测试，确保每个波次代码的原子性与可靠性 | ✓ |
| 自定义顺序 | 采用自定义波次顺序进行重构 | |

**User's choice:** 推荐波次规划
**Notes:** 4 波次递进设计，步骤衔接性强，降低出错率。

***

## 重构验证机制 (Testing Strategy)

| Option | Description | Selected |
|--------|-------------|----------|
| 增加插件层单元测试 | 在重写每个插件时，在 `packages/plugins/__tests__/` 下为它们编写针对性的 vitest 单元测试，直接调用 `serviceRegistry.resolve` 解析插件服务并执行命令进行校验 | ✓ |
| 仅依赖现有的 Kernel/Server 集成测试 | 依靠现有已通过的 246 个集成测试来验证功能，不单独为插件的每个命令增加针对性测试 | |

**User's choice:** 增加插件层单元测试
**Notes:** 独立的插件层单元测试是代码正确性的黄金标准，能确保每个迁移的 Command 响应都精确符合预期。

***

## 旧代码物理清除策略 (Cleanup Scope)

| Option | Description | Selected |
|--------|-------------|----------|
| 彻底清理 | 完全移除 `plugin-runtime/index.ts` 和所有 legacy 路由中支持加载旧单文件 JS 字符串形式插件的代码，不保留任何冗余代码和潜在的安全盲区 | ✓ |
| 保留存根路由 | 移除核心 vm 代码，但保留原有的上传旧单文件 JS 插件的 HTTP 路由，返回 `501 Not Implemented` 以防客户端 404 崩溃 | |

**User's choice:** 彻底清理
**Notes:** 保持基座纯粹干净，坚决不累积“死代码”。

***

## 内置插件版本声明与 SemVer 兼容 (Versioning & SemVer)

| Option | Description | Selected |
|--------|-------------|----------|
| 严格规范版本 | 所有内置插件的 manifest 明确声明 version: "1.0.0"，并在 requires 中显式标明依赖核心 Token 的 SemVer 版本范围（如 `@openlearn/core:ICommandBusService@^1.0.0`） | ✓ |
| 宽松省略 | 内置插件不声明其依赖的 Token 版本，仅对第三方沙箱插件实施严格的版本兼容校验 | |

**User's choice:** 严格规范版本
**Notes:** 内置插件作为第一公民也需要完整体现和跑通系统的 SemVer 版本兼容检验。

---

## Deferred Ideas

- 插件中心 UI 的微前端重构 -> 延期至后续阶段再予实现。
- 数据库多版本 Migration 框架接入 -> 沿用当前的 try/catch ALTER TABLE，本阶段不进行引入。
