# RFC-000: Platform Principles (平台核心原则与总则规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-000 |
| **Title** | Platform Principles (平台核心原则与总则规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-000 是 OpenLearn 平台的顶级总则规范，定义了平台的愿景、六大架构原则、模块边界划分、依赖继承规则、命名约定、服务与能力约定、插件与扩展约定、生命周期模型、兼容性方针及 SemVer 版本控制范式。所有平台模块、扩展插件及 AI Agent 均必须严格遵守本总则。

---

## 2. Motivation & Context (背景与动因)

随着 OpenLearn 逐步演进为平台内核级（Platform Kernel）教育操作系统，课堂流程、白板协同、学习分析、插件生态及 AI 能力的规模不断扩大。为防止模块间产生隐式依赖与无序代码膨胀，必须建立长期演进的平台宪章与顶级设计规约。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Platform Vision (平台愿景)
将 OpenLearn 建设为高可靠、可扩展、插件化、AI 原生的下一代教育 OS 内核。平台仅提供基础设施、服务注册中心、能力运行时与事件总线，所有教育业务逻辑与 AI 互动均作为独立模块或插件承载。

### 3.2 Six Architecture Principles (六大架构原则)
1. **Kernel-First (内核优先)**：所有核心通信统一走 Kernel Service Registry 与 Capability Runtime。
2. **Interface-Driven (契约驱动)**：禁止模块间直接依赖具体实现类，必须通过 DI Contracts 进行抽象解耦。
3. **Capability-Oriented (能力导向)**：一切可复用功能（AI生成、白板图表、学情分析）必须封装为标准 Capability。
4. **Sandboxed Ecology (沙箱生态)**：插件只能通过 `@openlearn/plugin-sdk` 交互，绝对禁止访问私有源码。
5. **Event-Driven Pub/Sub (事件驱动)**：状态变更与学情收集统一推送到 EventBus，禁止跨层同步强调用。
6. **Zero Breaking Changes (零破坏性兼容)**：升级核心组件时必须保留旧版 DI Token 与适配门面。

### 3.3 Module Boundary & Dependency Rules (模块边界与依赖规则)
- **Layer 0 (Core Kernel)**: `di/`, `db/`, `event-bus/`, `capability-guard/`（绝对零上层依赖）。
- **Layer 1 (Platform Infrastructure)**: `service-registry/`, `ai/`, `ai-capability/`, `capability/`, `capability-governance/`（仅依赖 Layer 0）。
- **Layer 2 (Domain Runtimes)**: `lesson-engine/`, `presence-engine/`, `collaboration-engine/`, `analytics-engine/`（依赖 Layer 0 & 1）。
- **Layer 3 (Master Orchestrator)**: `classroom-runtime/`, `kernel/`（聚合下层引擎）。
- **Layer 4 (Extension & Plugins)**: `plugin-host/`, `@openlearn/plugin-sdk`, `plugins/`（仅依赖 SDK 暴露接口）。

### 3.4 Conventions (约定规范)
- **Naming Convention (命名规范)**:
  - Component / Class: PascalCase (如 `PlatformServiceRegistry`)
  - Utilities / Methods: camelCase (如 `registerCapability`)
  - Database & Package Directories: kebab-case (如 `service-registry`)
  - Command Type: dot-notation (如 `lesson.create`, `vfs.write_file`)
  - Namespace: dot-notation lowercase (如 `lesson.generate.quiz`)
- **Service Convention**: 所有服务必须暴露 `I<Name>Service` 接口与对应 `I<Name>ServiceToken` DI 令牌。
- **Capability Convention**: 能力必须具备标准 `CapabilityDescriptor` 包含输入输出 JSON Schema。
- **Plugin Convention**: 插件主清单遵循 SemVer 规范，仅通过 `PluginContext` 获取上下文服务。
- **Extension Convention**: 扩展点通过 `ActionRegistry` 与 `CapabilityFrameworkRegistry` 显式导出。

### 3.5 Lifecycle, Compatibility & Versioning (生命周期与版本控制)
- **Lifecycle**: 统一遵循 `Registered` → `Initialized` → `Started` → `Ready` → `Stopped` → `Disposed` 状态机。
- **Compatibility**: 采用 Adapter / Facade 模式维护废弃 API，至少保留 2 个 Minor 版本。
- **Versioning**: 遵循 `Major.Minor.Patch` SemVer 规范：
  - `Major`: 不兼容的平台契约变动
  - `Minor`: 向后兼容的新增 Capability / Service Token
  - `Patch`: 向后兼容的 Bug 修复

---

## 4. Architecture & Design (架构与设计)

```
[ Platform Architecture Hierarchy ]
Layer 0: Kernel Base (EventBus, DB, DI Token Base)
   ↓
Layer 1: Platform Service Registry & Capability Runtime & Governance
   ↓
Layer 2: Domain Engines (Lesson, Presence, Collaboration, Analytics, AI Infrastructure)
   ↓
Layer 3: Master Orchestration Kernel (Classroom Runtime)
   ↓
Layer 4: Plugin Sandbox & SDK Ecosystem (@openlearn/plugin-sdk)
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

本规范为平台永久生效规范。任何对于 RFC-000 的修订或废弃，均须发起公开的 RFC 修订案并通过架构委员会投票决议。
