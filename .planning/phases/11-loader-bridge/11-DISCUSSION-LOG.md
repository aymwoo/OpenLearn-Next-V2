# Phase 11: 动态加载器与宿主桥接 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-19
**Phase:** 11-loader-bridge
**Areas discussed:** MfeLoader 组件 API 设计, 远程应用生命周期契约, 错误边界与加载策略, 内存管理与卸载清理, Entry URL 加载与解析, Module Federation Runtime 初始化, 远程模块预加载/预取, MfeLoader 嵌套加载

---

## MfeLoader 组件 API 设计

### 远程应用指定方式

| Option | Description | Selected |
|--------|-------------|----------|
| 仅 name，URL 由 Provider/DB 管理 | MfeLoader 只接受 remote name，URL 由全局 MfeConfigProvider 或数据库管理 | |
| { name, url } 配置对象 | 显式传入 name 和 url | |
| 完整 RemoteConfig 对象 | 接受完整的对象类型：name, url, fallback, retryCount, timeout 等 | ✓ |

**User's choice:** 完整 RemoteConfig 对象 — 最灵活，所有配置在一个对象中。

### 数据与服务传递方式

| Option | Description | Selected |
|--------|-------------|----------|
| Props 透传 | 额外 props 透传给远程组件 | |
| Context 注入 | 通过 Context 注入宿主服务 | |
| Props + Context 双通道 | 业务数据用 props，平台能力用 Context | ✓ |

**User's choice:** Props + Context 双通道 — 业务数据和平台能力职责分离。

### Loading/Error UI 定制方式

| Option | Description | Selected |
|--------|-------------|----------|
| Per-instance 定制（RemoteConfig 中） | 每个远程实例独立配置 | |
| Provider 全局默认 + Props 覆盖 | MfeConfigProvider 设置默认 + RemoteConfig 覆盖 | ✓ |

**User's choice:** Provider 全局默认 + Props 覆盖 — 减少重复配置，灵活覆盖。

### 渲染策略

| Option | Description | Selected |
|--------|-------------|----------|
| 容器模式（内部 createRoot） | 内部创建 React root，完全控制生命周期 | ✓ |
| 包裹模式（直接渲染为 children） | 直接渲染远程组件为子节点 | |
| 混合模式 | 根据 children 存在与否自动切换 | |

**User's choice:** 容器模式（内部 createRoot）— 完全控制挂载/卸载时机。

---

## 远程应用生命周期契约

### 标准导出格式

| Option | Description | Selected |
|--------|-------------|----------|
| { bootstrap, mount, unmount } 对象 | Single-SPA Parcel 风格 | |
| 工厂函数 createMfeApp(ctx) | 返回 { mount, unmount }，初始化逻辑在工厂函数中 | ✓ |

**User's choice:** 工厂函数 createMfeApp(ctx) — 更接近 Module Federation 原生模式。

### mount/unmount 参数签名

| Option | Description | Selected |
|--------|-------------|----------|
| (container, props?) → void | 简单直接 | |
| mount 返回 cleanup 函数 | React 18+ idiomatic | |
| mount 返回 { unmount, update } | 支持热更新 props 而无需 remount | ✓ |

**User's choice:** mount 返回 { unmount, update } — update 用于无销毁重渲染。

### createMfeApp ctx 参数内容

| Option | Description | Selected |
|--------|-------------|----------|
| 宿主服务引用（eventBus, DI, store） | 提供平台能力 | ✓ |
| 最小化 ctx（仅挂载元信息） | ctx 职责最小化 | |
| 分层的 { host, app } 结构 | host 提供平台能力，app 提供自省信息 | |

**User's choice:** 宿主服务引用 — eventBus, DI, store 全部可用。

### createMfeApp 调用时机

| Option | Description | Selected |
|--------|-------------|----------|
| 单次初始化（首次加载调用） | 初始化代码只执行一次 | ✓ |
| 每次挂载重新调用 | 确保每次挂载全新状态 | |
| 可配置 | RemoteConfig 中 strategy: 'singleton' | 'fresh' | |

**User's choice:** 单次初始化 — 首次加载调用一次，后续 mount/unmount 复用。

### update() 语义

| Option | Description | Selected |
|--------|-------------|----------|
| props 更新（无销毁重渲染） | 传递新 props 触发 re-render | ✓ |
| 多维度更新 | Update props + locale + theme | |
| 不提供 update | 通过 Context/Store 同步 | |

**User's choice:** props 更新（无销毁重渲染）。

### 向后兼容过渡

| Option | Description | Selected |
|--------|-------------|----------|
| 双模式兼容（自动检测） | 检测 createMfeApp 或默认组件 | ✓ |
| 仅支持新契约（强制迁移） | 所有远程必须迁移 | |

**User's choice:** 双模式兼容（自动检测）。

### TypeScript 类型定义位置

| Option | Description | Selected |
|--------|-------------|----------|
| 宿主侧定义 + 远程 import type | 宿主是契约的真相来源 | ✓ |
| 独立共享类型包 | 新增 workspace 包 | |
| 通过 MF shared API 共享 | 运行时类型注入 | |

**User's choice:** 宿主侧定义 + 远程 import type。

### Async 支持

| Option | Description | Selected |
|--------|-------------|----------|
| 全异步 | createMfeApp 和 mount 均可 async | ✓ |
| 同步 | 简化契约 | |

**User's choice:** 全异步支持。

### 第三方 CSS 生命周期管理

| Option | Description | Selected |
|--------|-------------|----------|
| 远程自行管理（约定） | 远程在 mount/unmount 中处理 | |
| 宿主自动管理 styles | createMfeApp 返回 styles，宿主注入/移除 | ✓ |

**User's choice:** 宿主自动管理 styles — 减少远程应用重复代码。

### 元数据导出

| Option | Description | Selected |
|--------|-------------|----------|
| 包含 manifest 元数据 | 远程导出 manifest 对象 | |
| 元数据由后端管理即可 | 数据库统一管理 | ✓ |

**User's choice:** 元数据由后端管理 — 避免客户端和服务端数据重复。

---

## 错误边界与加载策略

### Error Boundary 粒度

| Option | Description | Selected |
|--------|-------------|----------|
| Per-instance（每个 MfeLoader 独立） | 单个远程崩溃不影响其他 | ✓ |
| 全局 Error Boundary | 一个包裹所有 MfeLoader | |

**User's choice:** Per-instance — 隔离性最好。

### 默认加载态 UI

| Option | Description | Selected |
|--------|-------------|----------|
| 默认骨架屏（可自定义） | 内容区域风格 | |
| 默认 Spinner（可自定义） | 居中加载动画 | ✓ |
| 无默认（必须指定） | 强制产品化决策 | |

**User's choice:** 默认 Spinner — 轻量通用，可通过 Provider 覆盖。

### 错误展示 UI

| Option | Description | Selected |
|--------|-------------|----------|
| 错误描述 + 重试按钮 + 忽略 | 友好提示和操作入口 | ✓ |
| 开发友好（含技术详情） | stack trace 折叠在 details 中 | |
| 按环境分层 | dev 详细 / prod 友好 | |

**User's choice:** 错误描述 + 重试按钮 + 忽略。

### 重试策略

| Option | Description | Selected |
|--------|-------------|----------|
| 自动重试后显示错误 | 3 次指数退避后显示 | |
| 立即显示错误 + 手动重试 | 用户主动触发重试 | ✓ |

**User's choice:** 立即显示错误 + 手动重试 — 避免不可靠网络下漫长的自动等待。

### 加载超时

| Option | Description | Selected |
|--------|-------------|----------|
| 可配置 timeout（默认 30s） | RemoteConfig 中设置 | ✓ |
| 无 timeout | 依赖网络自身超时 | |

**User's choice:** 可配置 timeout（默认 30s）。

---

## 内存管理与卸载清理

### unmount 触发时机

| Option | Description | Selected |
|--------|-------------|----------|
| React 树卸载触发 | useEffect cleanup | |
| 显式 ref/controller API | ref.unmount() | |
| 两者都支持 | 自动 + 手动 | ✓ |

**User's choice:** 两者都支持 — React 卸载自动触发 + 可选 imperative ref API。

### 泄漏检测

| Option | Description | Selected |
|--------|-------------|----------|
| 开发模式 console 确认日志 | 清理确认信息 | |
| 泄漏检测 + 警告 | 检查常见泄漏源并 warn | ✓ |
| 仅清理，无额外检测 | 最小化代码 | |

**User's choice:** 泄漏检测 + 警告 — 主动检测未清理的 interval/listener/observer。

### 清理职责边界

| Option | Description | Selected |
|--------|-------------|----------|
| 远程自行清理 + 宿主检测 | 职责边界清晰 | |
| 宿主主动清理宿主侧资源 | 清理 EventBus/Store 订阅 | |
| 宿主全面清理 | 调用 unmount + 清理资源 + 检测警告 | ✓ |

**User's choice:** 宿主全面清理 — 提供最强的安全网。

### unmount 超时

| Option | Description | Selected |
|--------|-------------|----------|
| 超时强制销毁（默认 5s） | 防止异步操作无限期阻塞 | ✓ |
| 无限等待 | 信任远程应用 | |

**User's choice:** 超时强制销毁（默认 5s）— 确保清理完成。

---

## Entry URL 加载与解析

### 解析机制

| Option | Description | Selected |
|--------|-------------|----------|
| REST API 动态查询 | /api/mfe/remotes?name=... | ✓ |
| Provider 静态映射表 | 全局注册映射 | |
| 调用者传入 URL | MfeLoader 不做解析 | |

**User's choice:** REST API 动态查询 — 与 Phase 10 D-10（SQLite 注册运行时 entry 地址）对齐。

### 查询结果缓存

| Option | Description | Selected |
|--------|-------------|----------|
| 内存缓存（Map） | 首次查询后缓存 | ✓ |
| 不缓存 | 每次挂载重新查询 | |
| TTL 缓存 + 手动刷新 | 平衡新鲜度和性能 | |

**User's choice:** 内存缓存（Map）— 简单有效。

---

## Module Federation Runtime 初始化

### init() 调用时机

| Option | Description | Selected |
|--------|-------------|----------|
| 全局初始化（应用启动时） | 在 main.tsx 入口调用 | ✓ |
| 惰性初始化（首次加载时） | 首个 MfeLoader 挂载时调用 | |

**User's choice:** 全局初始化（应用启动时）— 确保 sharedScope 只解析一次。

---

## 远程模块预加载/预取

### 预加载支持

| Option | Description | Selected |
|--------|-------------|----------|
| 手动 preload() API | 调用者在 hover/路由预加载时触发 | ✓ |
| 自动空闲预取 | requestIdleCallback 自动预取 | |
| 不预加载 | 按需加载 | |

**User's choice:** 手动 preload() API — 调用者精确控制预取时机。

---

## MfeLoader 嵌套加载支持

### 嵌套策略

| Option | Description | Selected |
|--------|-------------|----------|
| 支持嵌套 | 远程内部可用 MfeLoader | ✓ |
| 不支持嵌套 | MfeLoader 仅在宿主中使用 | |

**User's choice:** 支持嵌套 — 保持架构的可组合性，每层独立 Error Boundary 隔离。

---

## Claude's Discretion

无 — 所有决策均与用户对齐。

## Deferred Ideas

- Shadow DOM 样式隔离（MFE-SEC-01）— Out of Scope
- 第三方 iframe 沙箱（MFE-SEC-02）— 独立安全里程碑
- 远程版本不匹配自动降级（MFE-SEC-03）— 简单 Error Boundary 已足够
