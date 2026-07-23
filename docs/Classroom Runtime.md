# OpenLearn Classroom Runtime Architecture (课堂运行时架构)

## 1. Overview (概述)

OpenLearn Classroom Runtime（课堂运行时）是 OpenLearn 教学 OS 的底层内核控制中枢。

系统确立了**“UI 仅为 View，一切皆运行于 Runtime”** 的底层范式：
- React UI 仅负责渲染 UI 视图与捕捉用户交互。
- 整个课堂的状态、生命周期、服务调度、事件流、资源分配、插件钩子、数据快照与崩溃恢复，**全量由 Classroom Runtime 独立管理与维护**。
- 未来所有模块——**Lesson**, **Whiteboard**, **Plugin**, **Quiz**, **AI**, **Learning Analytics**, **Collaboration** 均无一例外运行在 Classroom Runtime 统一骨干之上。

---

## 2. Runtime Architecture (Mermaid 架构图)

```mermaid
graph TD
    subgraph UI ["UI Rendering Layer (React Views)"]
        ReactShell["React UI Shell / Canvas View"]
        DevMonitor["Runtime Dashboard / Inspector"]
    end

    subgraph Kernel ["Classroom Runtime Kernel (内核中枢)"]
        KM["Kernel Master (ClassroomRuntimeKernel)"]
        SM["Session Manager (ClassroomSessionManager)"]
        ST["State Manager (RuntimeStateManager)"]
        EB["Event Bus (RuntimeEventBus)"]
        SCH["Scheduler (RuntimeScheduler)"]
        SR["Service Registry (RuntimeServiceRegistry)"]
        MR["Module Registry (RuntimeModuleRegistry)"]
        PM["Permission Manager (RuntimePermissionManager)"]
        RM["Resource Manager (RuntimeResourceManager)"]
        SNAP["Snapshot & Recovery Manager"]
        HK["Hooks System (RuntimeHooksManager)"]
    end

    subgraph Modules ["Runtime Subsystems & Modules"]
        M1["Lesson Engine Module"]
        M2["Whiteboard Module"]
        M3["Quiz Module"]
        M4["AI Tutor Module"]
        M5["Plugin Subsystem Module"]
        M6["Analytics Module"]
    end

    ReactShell <--> KM
    DevMonitor <--> ST
    KM --> SM
    KM --> ST
    KM --> EB
    KM --> SCH
    KM --> SR
    KM --> MR
    KM --> PM
    KM --> RM
    KM --> SNAP
    KM --> HK

    MR <--> M1
    MR <--> M2
    MR <--> M3
    MR <--> M4
    MR <--> M5
    MR <--> M6
```

---

## 3. Runtime State Tree (Mermaid 状态树图)

Classroom Runtime 维护全局唯一的不可变状态树 (Unified State Tree)，结构如下：

```mermaid
graph TD
    Root["RuntimeStateTree (Root)"]
    
    Root --> RT["runtime (id, lifecycle, startTime, elapsedTime)"]
    Root --> LES["lesson (activeLessonId, title, subject, status)"]
    Root --> STG["stage (activeStageId, index, title, status)"]
    Root --> ACT["activity (activeActivityId, type, status)"]
    Root --> WB["whiteboard (activeStageViewId, objectCount, isLocked)"]
    Root --> OBJ["teachingObjects (Array of Teaching Objects)"]
    Root --> STU["students (Array of UserParticipants)"]
    Root --> PLG["plugin (Array of Plugin States)"]
    Root --> AI["ai (isGenerating, lastPrompt, lastResponse)"]
    Root --> ANA["analytics (totalInteractions, activeStudentCount, averageScore)"]
```

---

## 4. Key Runtime Concepts (核心概念)

1. **Decoupled Event Pipeline**: 模块间禁止直接硬编码方法调用，一律通过 `RuntimeEventBus` 广播与订阅解耦事件（如 `SessionCreated`, `StudentJoined`, `StageChanged`, `ObjectUpdated`, `AIFinished`）。
2. **Priority Task Scheduler**: 提供 `Immediate`, `High`, `Normal`, `Low`, `Idle` 五级优先度的异步任务队列，保障高优先级课堂事件（如阶段跳转、锁定控制）毫秒级响应。
3. **Unified Security & Permissions**: 针对 `Teacher`, `Assistant`, `Student`, `Observer`, `Plugin`, `AI` 统一执行鉴权校验。
4. **Crash Recovery & Snapshots**: 引擎定时捕捉全量 Snapshot，发生网络中断或浏览器崩溃时可实现零损耗恢复。
