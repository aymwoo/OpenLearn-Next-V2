# Phase 6: EventBus 服务 + SemVer 兼容 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 6-EventBus 服务 + SemVer 兼容
**Areas discussed:** IEventBusService API, SemVer 版本格式, 版本注册方式, 检查时机, Token Registry, Pre-release 支持, Manifest Schema, 初始版本, 错误格式, Optional 依赖, Schema 变更策略

---

## IEventBusService API

| Option | Description | Selected |
|--------|-------------|----------|
| 保持现有接口不变 | publish + subscribe + unsubscribe 已足够 | ✓ |
| 新增一次性订阅 once() | 添加 eventBus.once(type, handler) — 触发一次后自动取消 | |
| 新增事件历史/重放 | 插件 activate 后回溯错过的关键事件 | |

**User's choice:** 保持现有接口不变
**Notes:** Phase 2 已定义接口、Phase 5 EventForwarder 已验证跨 Worker 事件转发

---

## SemVer 版本格式

| Option | Description | Selected |
|--------|-------------|----------|
| 标准 semver + ^/~ 范围 | x.y.z + ^1.2.3/~1.2.3/>= 显式范围 | ✓ |
| 仅主版本匹配 | 只匹配 major version | |
| 完全自由格式 | 不预定义格式，字符串前缀匹配 | |

**User's choice:** 标准 semver + ^/~ 范围
**Notes:** npm 生态标准，零学习成本

---

## 版本注册方式

| Option | Description | Selected |
|--------|-------------|----------|
| Token 携带 version 属性 | `new Token<T>(name, '1.0.0')` — ServiceRegistry.register() 自动读取 | ✓ |
| ServiceRegistry 注册时显式声明 | register(token, impl, { version: '1.0.0' }) | |
| 独立版本映射表 | TokenVersionRegistry 独立管理版本 | |

**User's choice:** Token 携带 version 属性
**Notes:** 版本与 Token 不可分割，默认值 '1.0.0' 向后兼容

---

## 检查时机

| Option | Description | Selected |
|--------|-------------|----------|
| 安装时 + 激活时都检查 | 安装拦截 + 激活再验证 | ✓ |
| 仅在激活时检查 | 安装时不检查 | |
| 仅在安装时检查 | 安装时一次检查 | |

**User's choice:** 安装时 + 激活时都检查
**Notes:** 最安全策略——ROADMAP SC5 要求安装拦截

---

## Token Registry

| Option | Description | Selected |
|--------|-------------|----------|
| ServiceRegistry.resolveByName() 扩展 | 完成 Phase 5 预留的实现 | ✓ |
| 独立 TokenRegistry 类 | 新建类，与 ServiceRegistry 分离 | |
| manifest.requires 直接字符串匹配 | 不引入新注册表，O(N) 查找 | |

**User's choice:** ServiceRegistry.resolveByName() 扩展
**Notes:** Phase 5 ServiceHost 已使用 fallback 调用，Phase 6 正式实现

---

## Pre-release 支持

| Option | Description | Selected |
|--------|-------------|----------|
| 支持 pre-release + 使用 semver 包 | semver 包内置 pre-release 支持 | ✓ |
| 不支持 pre-release，自己实现 | ~50 行简化规则 | |
| 使用 semver 包但禁用 pre-release | 正则限制 x.y.z 格式 | |

**User's choice:** 支持 pre-release + 使用 semver 包
**Notes:** 零额外成本，semver 包内置优先级规则

---

## Manifest Schema 变更

| Option | Description | Selected |
|--------|-------------|----------|
| 统一字符串格式 | requires 统一为 `@scope:Name` 或 `@scope:Name@^version` | ✓ |
| 拆分为两个字段 | requires_versioned + requires 分离 | |
| 全部强制带版本 | requires 必须包含 @version | |

**User's choice:** 统一字符串格式
**Notes:** 不带 @version 时默认为 `*`——向后兼容

---

## 初始版本

| Option | Description | Selected |
|--------|-------------|----------|
| 全部 1.0.0 | 默认值——无需修改现有代码 | ✓ |
| 由 Token 定义者指定 | 强制显式指定，无默认值 | |
| 不设置初始版本 | version 可选，不设置则跳过检查 | |

**User's choice:** 全部 1.0.0
**Notes:** Token 构造函数 version 参数默认 '1.0.0'

---

## 错误格式

| Option | Description | Selected |
|--------|-------------|----------|
| 结构化错误 + 人类可读消息 | SemverMismatchError 含字段 + message | ✓ |
| 仅简单字符串消息 | 纯字符串错误 | |
| 错误码 + 结构化 JSON | 纯 JSON 错误 | |

**User's choice:** 结构化错误 + 人类可读消息
**Notes:** 结构化字段供 UI 解析，人类可读字符串供日志

---

## Optional 依赖

| Option | Description | Selected |
|--------|-------------|----------|
| 跳过 + 警告 | optional 不匹配时跳过注入 + console.warn | ✓ |
| 严格拒绝 | optional 不匹配也拒绝 | |
| 静默跳过 | 不做任何日志 | |

**User's choice:** 跳过 + 警告
**Notes:** 与 JupyterLab optional token 行为一致

---

## Schema 变更策略

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展正则 + 保留旧 schema 导出 | 新增正则，导出 manifestSchemaV3 | ✓ |
| 原地替换 schema | 直接修改正则 | |
| 新建 manifest-schema-v2.ts | 新文件，旧文件不变 | |

**User's choice:** 扩展正则 + 保留旧 schema 导出
**Notes:** Phase 8 迁移完成后废弃旧版

---

## Claude's Discretion

以下技术细节由下游 agent 自主决定：
- SemverMismatchError 类的精确字段定义和 message 模板
- PluginHost.activatePlugin() 中版本检查的精确代码位置
- semver.satisfies() 调用的错误处理策略
- Manifest schema 正则的精确模式
- 版本检查逻辑的测试文件组织

## Deferred Ideas

无——讨论始终聚焦在 Phase 6 范围内。
