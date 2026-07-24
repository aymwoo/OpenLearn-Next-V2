# OpenLearn Startup Lifecycle Specification (平台启动生命周期规范)

## 1. Executive Summary (概述)

本规范详尽定义了平台从进程启动（Startup）到关机回收（Shutdown）的完整生命周期状态机与时序控制图。

---

## 2. Platform Lifecycle State Machine (Mermaid 平台生命周期状态机图)

```mermaid
stateDiagram-v2
    [*] --> Startup: 进程启动 & 配置读取
    Startup --> Registration: 服务注册 (Service Tokens)
    Registration --> Initialization: 核心引擎初始化 (Subsystem Kernels)
    Initialization --> Activation: 插件扫描与激活 (Plugin Host)
    Activation --> Ready: HTTP/Socket.IO 就绪监听
    Ready --> Shutdown: 收到 SIGTERM / SIGINT 信号
    Shutdown --> [*]: 优雅退出 & 资源清理完成
```

---

## 3. Detailed Startup Sequence (Mermaid 启动时序图)

```mermaid
sequenceDiagram
    autonumber
    participant CLI as Node.js Runtime
    participant Builder as PlatformBuilder
    participant Context as BootstrapContext
    participant Kernel as PlatformKernel

    CLI->>Builder: PlatformBuilder.create().buildAndStart()
    Builder->>Context: 初始化 BootstrapContext
    Builder->>Kernel: 实例化 PlatformKernel
    Kernel->>Kernel: 1. 挂载 StorageService & AIService
    Kernel->>Kernel: 2. 挂载 AIRuntime & AICapability
    Kernel->>Kernel: 3. 挂载 CapabilityFramework & Governance
    Kernel->>Kernel: 4. 挂载 ServiceRegistryKernel
    Kernel->>Kernel: 5. 挂载 Lesson, Presence, Collaboration, Analytics
    Kernel->>Kernel: 6. 激活 PluginHost & WorkerManager
    Kernel-->>CLI: PlatformKernel 完全 Ready
```
