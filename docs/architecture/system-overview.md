# 平台系统架构全景 (System Overview)

OpenLearn V2 架构遵循“微内核 + 插件化微前端”的设计思想。

---

## 全景架构图

```mermaid
graph TD
    subgraph Client["前端 (React 19 + Vite)"]
        UI["Workspace Shell"]
        TW["Teacher Workspace"]
        SW["Student Workspace"]
        WB["Whiteboard Canvas Engine"]
    end

    subgraph Server["后端 (Express + Socket.IO)"]
        CR["Composition Root (server.ts)"]
        BP["Bootstrap Pipeline (5 Stages)"]
    end

    subgraph Kernel["Platform Kernel (packages/core)"]
        L0["Layer 0: EventBus / ServiceRegistry / Guard / Storage"]
        L1["Layer 1: AIRuntime / CapabilityRuntime / Governance"]
        L2["Layer 2: CommandBus / LessonEngine / Presence / Analytics"]
        L3["Layer 3: PluginHost / WorkerManager / HotReload"]
    end

    UI --> CR
    CR --> BP
    BP --> Kernel
    Kernel --> WB
```

---

## 核心设计标准

1. **绝对组合根原则**: 所有的服务实例与依赖均在组装根中显式解析，零隐式全局依赖。
2. **Worker 沙箱隔离**: 插件运行于 Node.js 独立 Worker Thread 进程，确保宿主应用安全稳定性。
3. **点对点事件与指令**: CQRS 模式下，写指令使用 CommandBus，状态变更通知使用 EventBus。
