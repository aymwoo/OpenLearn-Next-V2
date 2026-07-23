# OpenLearn Platform Assembly Specification (平台组装规范)

## 1. Executive Summary (概述)

本文档规范了平台基础设施组装的唯一入口与规则，确保没有任何业务模块或外部插件能直接绕过 Composition Root 创建强硬依赖。

---

## 2. Infrastructure Assembly Flow (Mermaid 组装流程图)

```mermaid
sequenceDiagram
    autonumber
    actor Host as Host Platform / Builder
    participant Root as PlatformCompositionRoot
    participant Validator as CompositionValidator
    participant Pipeline as BootstrapPipeline

    Host->>Root: compose(options)
    Root->>Validator: validate(options, pipeline, modules)
    Validator-->>Root: CompositionValidation (isValid)
    Root->>Root: 循环调用 registered modules.compose(options)
    Root-->>Host: CompositionResult (context, pipeline, durationMs)
```
