# OpenLearn Platform Dependency Graph Specification (平台依赖拓扑图规范)

## 1. Executive Summary (概述)

本图表详细梳理了 OpenLearn 内核、服务注册中心、能力运行时、能力治理、插件 SDK 及底层业务引擎之间的单向依赖关系，确认全库**无循环依赖**。

---

## 2. Platform Dependency Graph (Mermaid 依赖拓扑图)

```mermaid
graph TD
    subgraph CoreDI ["Layer 0 & 1: DI & Registry"]
        Interfaces["di/interfaces.ts"]
        ServiceRegistry["service-registry/"]
    end

    subgraph CapabilitySubsystem ["Layer 2: Capability & Governance"]
        Capability["capability/"]
        CapabilityGov["capability-governance/"]
        AICapability["ai-capability/"]
    end

    subgraph BusinessSubsystems ["Layer 3: Domain Engines"]
        LessonEngine["lesson-engine/"]
        PresenceEngine["presence-engine/"]
        CollaborationEngine["collaboration-engine/"]
        AnalyticsEngine["analytics-engine/"]
        AIRuntime["ai/"]
    end

    subgraph MasterKernels ["Layer 4: Master Orchestrators"]
        ClassroomRuntime["classroom-runtime/"]
        Kernel["kernel/index.ts"]
    end

    Interfaces --> ServiceRegistry
    ServiceRegistry --> Capability
    Capability --> CapabilityGov
    Capability --> AICapability
    AICapability --> AIRuntime
    ClassroomRuntime --> LessonEngine & PresenceEngine & CollaborationEngine & AnalyticsEngine
    Kernel --> MasterKernels & BusinessSubsystems & CapabilitySubsystem & CoreDI
```
