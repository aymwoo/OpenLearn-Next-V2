# OpenLearn Bootstrap Pipeline Specification (平台启动管道规范)

## 1. Executive Summary (概述)

`BootstrapPipeline` 是 Platform Composition Root 的核心执行引擎，负责按严格顺控关系执行平台启动、服务注册、能力装配、插件激活、就绪监听与优雅关机。

---

## 2. Platform Bootstrap Pipeline (Mermaid 启动管道流程图)

```mermaid
sequenceDiagram
    autonumber
    actor CLI as main / server.ts
    participant Builder as PlatformBuilder
    participant Pipeline as BootstrapPipeline
    participant Context as BootstrapContext
    participant Registry as ServiceRegistry
    participant Plugins as PluginHost
    participant Server as HTTP/Socket.IO

    CLI->>Builder: PlatformBuilder.create().buildAndStart()
    Builder->>Pipeline: execute(context)

    rect rgb(240, 248, 255)
        note right of Pipeline: Stage 1: StartupStage
        Pipeline->>Context: validateEnvironment()
    end

    rect rgb(240, 255, 240)
        note right of Pipeline: Stage 2: RegistrationStage
        Pipeline->>Registry: registerCoreServices(DI Tokens)
    end

    rect rgb(255, 245, 238)
        note right of Pipeline: Stage 3: InitializationStage
        Pipeline->>Pipeline: initializeSubsystemKernels()
    end

    rect rgb(255, 250, 205)
        note right of Pipeline: Stage 4: ActivationStage
        Pipeline->>Plugins: discoverAndActivatePlugins()
    end

    rect rgb(230, 230, 250)
        note right of Pipeline: Stage 5: ReadyStage
        Pipeline->>Server: startListening(port)
        Pipeline-->>CLI: return PlatformKernel
    end
```

---

## 3. Pipeline Stage Execution Rules (阶段执行准则)

1. **强顺序依赖**: 任阶段抛出致命异常，立即终止后续阶段，触发 `ShutdownStage` 释放前置资源。
2. **状态只读保护**: 启动上下文 `BootstrapContext` 在进入 `ReadyStage` 后自动冻结，防止运行期随意突变配置。
