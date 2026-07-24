# OpenLearn Presence Engine Architecture & Design (课堂状态引擎架构设计)

## 1. Overview (概述)

OpenLearn Presence Engine（课堂状态引擎）是 OpenLearn 教学 OS 中统一的实时状态抽象与表达中枢。

系统确立了**“全员、全实体 Presence 建模”**的核心范式：
- 课堂中任何实体（**Teacher**, **Student**, **Assistant**, **AI**, **Plugin**, **Whiteboard**, **Teaching Object**, **Lesson**, **Stage**, **Group**）均拥有标准的 Presence 模型。
- 未来所有上层业务模块（**AI Agent**, **Teacher Dashboard**, **Collaboration**, **Learning Analytics**, **Assessment**）均统一建立在 Presence Engine 基础之上。

---

## 2. Presence Architecture (Mermaid 架构图)

```mermaid
graph TD
    subgraph CoreEngine ["Presence Engine Core (状态引擎内核)"]
        PEK["Presence Engine Kernel (PresenceEngineKernel)"]
        PM["Presence Manager (PresenceManager API)"]
        PS["Presence Store (In-Memory Indexing Store)"]
        PEB["Presence Event Bus (PresenceEventBus)"]
        AD["Activity Detector (自动行为识别)"]
        HB["Heartbeat Manager (心跳与在线检测)"]
        FE["Focus Engine (专注度模型引擎)"]
        GP["Group Presence Manager (小组状态聚合)"]
        PTL["Presence Timeline Logger (时间序列日志)"]
        PPM["Privacy Manager (隐私与匿名控制)"]
        PSY["Presence Synchronizer (增量 Diff 增步同步)"]
    end

    subgraph Entities ["Classroom Presence Entities (状态实体)"]
        E1["Teacher Presence"]
        E2["Student Presence"]
        E3["AI Presence"]
        E4["Plugin Presence"]
        E5["Whiteboard Presence"]
        E6["Stage & Group Presence"]
    end

    subgraph Dependents ["Future Dependent Modules (未来依赖系统)"]
        D1["AI Agent & AI Tutor"]
        D2["Teacher Dashboard"]
        D3["Real-time Collaboration"]
        D4["Learning Analytics"]
        D5["Assessment System"]
    end

    PEK --> PM
    PEK --> PS
    PEK --> PEB
    PEK --> AD
    PEK --> HB
    PEK --> FE
    PEK --> GP
    PEK --> PTL
    PEK --> PPM
    PEK --> PSY

    Entities <--> PS
    PM <--> Dependents
    PEB <--> Dependents
```

---

## 3. Core System Subsystems (核心子系统职责)

1. **Presence Store**: 支持 1000+Presence 实体的超高性能内存索引存储，具备 Partial Diff 增量计算能力。
2. **Activity Detector**: 自动捕获鼠标移动、键盘输入、代码运行、白板绘制、Quiz 提交与讨论发言，无感自动更新实体活动与状态。
3. **Heartbeat Manager**: 维持师生、AI、插件统一心跳包，30 秒超时自动离线检测与重连处理。
4. **Focus Engine**: 维护 `Focused`, `Distracted`, `Inactive`, `Minimized`, `Background` 窗口专注度模型。
5. **Privacy Manager**: 强力保障数据安全，支持**匿名模式 (Anonymous Mode)**、**关闭采集 (Disable Collection)** 及数据留存周期管理。
6. **Presence Synchronizer**: 生成并应用 `PresenceDiff` 增量补丁，实现低带宽消耗的高频同步。
