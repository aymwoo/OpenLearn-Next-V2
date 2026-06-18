# Phase 3: ESM 加载 + 包格式 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 03-esm
**Areas discussed:** 加载器架构, 包格式定义, 多文件策略, 过渡策略, Schema 校验, 跨运行时抽象, 包存储策略, 错误处理, 数据库表结构, 测试策略, 外部依赖策略

---

## 加载器架构

| Option | Description | Selected |
|--------|-------------|----------|
| 独立 EsmLoader 类 | 新建 packages/core/esm-loader/，PluginRuntime 调用 loader.load() 获取模块导出 | |
| PluginRuntime 内部方法 | 在 PluginRuntime 中新增 private async loadViaEsm() 方法 | |
| 双模式策略 | EsmLoader 作为独立类（可测试、可跨运行时），PluginRuntime 通过依赖注入接收 EsmLoader 实例 | ✓ |

**User's choice:** 双模式策略（推荐）
**Notes:** Node.js 端用 data: URL，浏览器端用 Blob URL。加载器返回原始模块导出，PluginRuntime 负责安全包装。

---

## 包格式定义

| Option | Description | Selected |
|--------|-------------|----------|
| 最小 manifest | id, name, version, main。requires/optional 为字符串数组。capabilitiesProposed 为字符串数组 | ✓ |
| 丰富 manifest | 增加 description, author, license 等元数据。requires 支持版本范围声明 | |
| 与现有格式兼容 | 保持现有 exports.default 格式不变，ZIP 只是容器 | |

**User's choice:** 最小 manifest（推荐）
**Notes:** 字符串比较与 Phase 1 D-03 一致。简洁、易校验。

---

## 多文件策略

| Option | Description | Selected |
|--------|-------------|----------|
| esbuild 安装时打包 | 上传 ZIP → 安装时 esbuild 打包入口+相对导入 → 单个 ESM bundle | ✓ |
| 开发者预打包 | 插件开发者上传前自行打包为单文件 | |
| data: URL 链式导入 | ZIP 中每个文件转为独立 data: URL，通过 importmap 解析相对导入 | |

**User's choice:** esbuild 安装时打包（推荐）
**Notes:** esbuild 已在项目依赖中，零额外依赖。支持 .ts 直接编译。

---

## 过渡策略

| Option | Description | Selected |
|--------|-------------|----------|
| 加载器选择标记 | plugins 表新增 loader_version 字段 ('vm'|'esm')。Phase 8 完成迁移后移除 vm 代码 | ✓ |
| 立即替换 | Phase 3 直接替换 vm.createContext → ESM import() | |
| 格式自动检测 | PluginRuntime 尝试 import()，失败则回退 vm.createContext | |

**User's choice:** 加载器选择标记（推荐）
**Notes:** 渐进式，旧插件无需立即迁移。

---

## Schema 校验

| Option | Description | Selected |
|--------|-------------|----------|
| schema 文件 + 安装时校验 | 新建 manifest-schema.ts，导出 zod schema + TS 类型。安装时校验，不合法拒绝并返回 ZodError | ✓ |
| 内联在 PluginRuntime 中 | zod schema 定义在 PluginRuntime 内部 | |
| 仅类型定义 | TypeScript interface 定义 + 运行时简单 if 检查 | |

**User's choice:** schema 文件 + 安装时校验（推荐）
**Notes:** 类型和运行时可共用。错误信息精确到字段路径。

---

## 跨运行时抽象

| Option | Description | Selected |
|--------|-------------|----------|
| 抽象基类 + 平台实现 | abstract class EsmLoader。NodeEsmLoader (data: URL) / BrowserEsmLoader (Blob URL) | ✓ |
| 运行时检测分支 | 单个 EsmLoader 类，内部 typeof window 判断 | |
| 仅 Node.js 实现 | Phase 3 只实现 Node.js 端，浏览器推迟到 Phase 9 | |

**User's choice:** 抽象基类 + 平台实现（推荐）
**Notes:** 类型安全，各平台可独立测试。

---

## 包存储策略

| Option | Description | Selected |
|--------|-------------|----------|
| SQLite blob + 文件系统缓存 | plugins 表新增 zip_package BLOB。bundle 存 source_code。热重载时从 BLOB 重新解压 | ✓ |
| 纯文件系统存储 | storage/plugins/<id>/ 目录保存完整内容 | |
| 仅存打包产物 | 只保存 esbuild 打包后的单文件 bundle，不保留原始 ZIP | |

**User's choice:** SQLite blob + 文件系统缓存（推荐）
**Notes:** 发挥 SQLite 单文件优势，备份/迁移简单。

---

## 错误处理

| Option | Description | Selected |
|--------|-------------|----------|
| 结构化错误类 | EsmLoaderError 基类 + 子类：SyntaxError/ModuleNotFoundError/LoadTimeoutError/ActivationError | ✓ |
| 统一错误 + 原始堆栈 | 所有加载失败抛 PluginLoadError，附原始 Error message | |
| 回调式错误处理 | load() 返回 { success, module, error } | |

**User's choice:** 结构化错误类（推荐）
**Notes:** 每类携带上下文信息（文件路径、行号等），适合前端展示。

---

## 数据库表结构

| Option | Description | Selected |
|--------|-------------|----------|
| 最小字段新增 | 新增 loader_version TEXT ('vm'|'esm') 和 zip_package BLOB。source_code 在 esm 模式下存 bundle 文本 | ✓ |
| 大幅重构表结构 | 新增 plugin_files 子表，废弃 source_code 单文本字段 | |
| 仅加 loader_version | 只加字段区分新旧，ZIP 存文件系统 | |

**User's choice:** 最小字段新增（推荐）
**Notes:** 现有行 loader_version 默认 'vm'，向下兼容。

---

## 测试策略

| Option | Description | Selected |
|--------|-------------|----------|
| Node.js 全测试 + 浏览器 smoke | vitest 完整测试 NodeEsmLoader。BrowserEsmLoader 用 happy-dom/jsdom 模拟 Blob URL | ✓ |
| 仅 Node.js 测试 | 只测 data: URL 路径，浏览器测试推迟到 Phase 9 | |
| 通用测试接口 | 定义 EsmLoaderTestSuite 共享测试套件，两种实现运行相同用例 | |

**User's choice:** Node.js 全测试 + 浏览器 smoke（推荐）
**Notes:** Phase 9 补充真浏览器 E2E。

---

## 外部依赖策略

| Option | Description | Selected |
|--------|-------------|----------|
| 仅允许相对导入 + Token 服务 | esbuild external: ['@openlearn/*']。禁止 import npm 包 | ✓ |
| 允许有限白名单 npm 包 | 允许 date-fns, zod 等白名单包 | |
| 完全开放 | 不做限制，esbuild 自动解析所有 import | |

**User's choice:** 仅允许相对导入 + Token 服务（推荐）
**Notes:** 插件隔离性和安全性最大化。Token import 由宿主环境注入。

---

## Claude's Discretion

- EsmLoader 类的具体文件拆分方式
- manifest-schema.ts 中 zod schema 的具体字段定义
- esbuild 打包的具体配置
- data: URL 的具体编码方式
- Blob URL 生命周期管理
- 错误类的继承层次
- 测试用例的具体组织和 mock 策略

## Deferred Ideas

无。讨论始终聚焦在 Phase 3 范围内。
