# OpenLearn Capability Invocation Specification (能力调用与管道规范)

## 1. Overview (概述)

`InvocationEngine` 与 `CapabilityPipeline` 负责处理 Capability 的 7 阶段标准执行管道（Request → Validation → Permission → Context Injection → Capability → Result Transform → Publish），并提供 `invoke`, `batch`, `retry`, `schedule`, `cancel` 等丰富调用语义。

---

## 2. Invocation Pipeline (Mermaid 7 阶段管道图)

```mermaid
graph TD
    subgraph Step1 ["Step 1: Request Event"]
        R1["发布 CapabilityRequested 事件"]
    end

    subgraph Step2 ["Step 2: Validation"]
        R2["校验 Request Payload 与 Payload 完整性"]
    end

    subgraph Step3 ["Step 3: Permission Check"]
        R3["PermissionChecker 校验角色权限 (Teacher / Student / Plugin / System)"]
    end

    subgraph Step4 ["Step 4: Context Injection"]
        R4["自动注入环境 Context (__injectedContext)"]
    end

    subgraph Step5 ["Step 5: Capability Execution"]
        R5["发布 CapabilityStarted 事件 & 执行能力代码"]
    end

    subgraph Step6 ["Step 6: Result Transform"]
        R6["将数据封装为标准 Result (Teaching Object / Markdown / Quiz 等)"]
    end

    subgraph Step7 ["Step 7: Publish"]
        R7["发布 CapabilityFinished 与 CapabilityPublished 事件"]
    end

    R1 --> R2 --> R3 --> R4 --> R5 --> R6 --> R7
```

---

## 3. Capability Lifecycle (Mermaid 生命周期图)

```mermaid
stateDiagram-v2
    [*] --> Requested: Client Calls invoke()
    Requested --> Validated: Validation Passes
    Validated --> PermissionChecked: Role Allowed
    PermissionChecked --> ContextInjected: Context Injected
    ContextInjected --> Running: Handler.execute()
    Running --> Finished: Execution Succeeds
    Running --> Failed: Execution Throws Error
    Requested --> Cancelled: Invocation Cancelled
    Finished --> Published: Event Published to Bus
    Failed --> [*]
    Published --> [*]
    Cancelled --> [*]
```
