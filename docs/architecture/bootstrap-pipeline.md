# Bootstrap Pipeline 引导流水线

> 📌 **本文为唯一真源**：`docs/core/bootstrap-pipeline.md` 旧版（2026-07-24）已废弃删除，内容以本文为准。

## 先读这一节：流水线**不是**平台真正的装配流程

`packages/core/bootstrap/pipeline/` 是一套**阶段编排框架**：它提供阶段契约、串行执行、逐阶段计时、失败回滚与诊断事件。但它的 5 个标准阶段是**空壳** —— 每个 `execute()` 只有一行 `context.setStage(...)`，不碰数据库、不注册 Token、不加载迁移、不启动 WorkerManager。

```typescript
// packages/core/bootstrap/pipeline/stages/standard-stages.ts —— StartupStageImpl
async execute(context: IBootstrapContext): Promise<void> {
  context.setStage(PlatformStage.Configuring);
}
```

**平台真正的装配发生在别处**：`packages/core/kernel/index.ts` 的 `Kernel` 构造函数按分层顺序实例化全部子系统、注册全部 DI Token、装配拦截器、启动系统插件（`Kernel` 的 `ready` Promise）。`server.ts` 的 `startServer()` 随后跑数据库迁移、等 `kernelContainer.ready`、再组装 Express + Socket.IO。

> 因此**不要**把「检查 SQLite 连接 / 注册 Token / 载入迁移 / 启动 Worker 池 / 发就绪事件」理解为这 5 个阶段的职责 —— 这些行为在 `Kernel` 构造函数与 `startServer()` 中，与流水线框架无关。相关装配细节见 [composition-root.md](composition-root.md) 与 `docs/architecture/platform-kernel.md`。

---

## 5 阶段启动模型 (Standard Stages)

`BootstrapPipeline` 的构造函数在未显式传入 `stages` 时，装配这 5 个默认阶段：

```mermaid
graph LR
    S1["StartupStage"] --> S2["RegistrationStage"]
    S2 --> S3["InitializationStage"]
    S3 --> S4["ActivationStage"]
    S4 --> S5["ReadyStage"]
```

各阶段的 `id` / `name` / `description` 与实际行为如下（`description` 描述的是**设计意图**，与 `execute()` 的实际行为不符）：

| 类                    | `id`                  | `name`（`PlatformStage`）| `description`（代码注释原文）                                | `execute()` 实际行为      |
| --------------------- | --------------------- | ------------------------ | ---------------------------------------------------------- | ------------------------- |
| `StartupStageImpl`    | `stage_startup`       | `Created`                | Environment & configuration validation                      | `setStage(Configuring)`   |
| `RegistrationStageImpl` | `stage_registration` | `Registering`            | Core Service Contracts & DI Tokens registration            | `setStage(Registering)`   |
| `InitializationStageImpl` | `stage_initialization` | `Initializing`      | Subsystem Kernels initialization                            | `setStage(Initializing)`  |
| `ActivationStageImpl` | `stage_activation`    | `Activating`             | Plugin Host discovery & ESM plugins activation              | `setStage(Activating)`    |
| `ReadyStageImpl`      | `stage_ready`         | `Ready`                  | HTTP & Socket.IO server readiness                           | `setStage(Ready)`         |

> `PlatformStage` 枚举（`packages/core/bootstrap/types/index.ts`）实为 8 值：`Created` / `Configuring` / `Registering` / `Initializing` / `Activating` / `Ready` / `ShuttingDown` / `Disposed`。上表的 `name` 是各阶段**声明的起始名**，而 `execute()` 设置的是下一阶段的 `Configuring`…`Ready` —— 即阶段在推进时状态前进一格。

> ❗ **`platform.ready` 事件不存在**。`ReadyStageImpl` 不发布任何事件，`platform.ready` 这个字符串在 `packages/` 与 `server.ts` 中**零命中**。`IBootstrapStage` 契约（`packages/core/bootstrap/types/index.ts`）也没有事件钩子字段，只有 `id` / `name` / `description` / 可选的 `timeoutMs` / `rollback` / `execute`。

---

## Pipeline 执行与诊断接口

### 执行流程 (`PipelineExecutor.execute`)

实现在 `packages/core/bootstrap/pipeline/pipeline-executor.ts`：

1. 发出 `PipelineStarted` 诊断事件；
2. 逐个阶段执行；每个阶段前发 `StageStarted`、成功后发 `StageCompleted`、失败后发 `StageFailed`；
3. 若 `stage.timeoutMs` 存在且 `> 0`，走 `executeWithTimeout`，超时抛 `StartupTimeoutError`；
4. 任一阶段失败 → 按**逆序**调用已执行阶段的 `rollback`（`rollbackExecutedStages`），随后返回 `status: 'Failed'` 并带 `failedStage`（值为 `stage.id`）与 `error`；
5. 每阶段开始前检查 `context.isCancelled`，为真则返回 `status: 'Aborted'`；
6. 全部成功 → 返回 `status: 'Success'` 与 `totalDurationMs`。

### 类型定义

`IBootstrapPipeline`（`packages/core/bootstrap/types/index.ts`）只有 2 个成员：

```typescript
export interface IBootstrapPipeline {
  readonly stages: ReadonlyArray<IBootstrapStage>;
  run(context: IBootstrapContext): Promise<void>;
}
```

`BootstrapPipeline` **类**（`packages/core/bootstrap/pipeline/bootstrap-pipeline.ts`）在此之上额外提供 3 个公共方法：

```typescript
class BootstrapPipeline implements IBootstrapPipeline {
  constructor(stages?: ReadonlyArray<IBootstrapStage>); // 不传则装配 5 个标准阶段
  get stages(): ReadonlyArray<IBootstrapStage>;        // Object.freeze 返回
  addStage(stage: IBootstrapStage): this;
  addListener(listener: PipelineDiagnosticListener): () => void; // 返回取消订阅函数
  run(context: IBootstrapContext): Promise<void>;       // status === 'Failed' 时抛 result.error
  execute(context: IBootstrapContext): Promise<PipelineResult>; // 委托给 PipelineExecutor
}
```

`PipelineResult` / `PipelineDiagnosticEvent` 等类型定义在 `packages/core/bootstrap/pipeline/pipeline-types.ts`：

```typescript
export type PipelineStatus = 'Success' | 'Failed' | 'Aborted';

export interface StageExecutionResult {
  readonly stageId: string;
  readonly stageName: string;
  readonly durationMs: number;
  readonly status: 'Success' | 'Failed' | 'Skipped';
  readonly error?: Error;
}

export interface PipelineResult {
  readonly totalDurationMs: number;   // 注意：不是 durationMs
  readonly status: PipelineStatus;    // 注意：不是 'Completed' | 'Failed'
  readonly stageResults: ReadonlyArray<StageExecutionResult>;
  readonly failedStage?: string;      // 值是 stage.id
  readonly error?: Error;
}

export type PipelineDiagnosticEventType =
  'PipelineStarted' | 'StageStarted' | 'StageCompleted' | 'StageFailed' | 'PipelineCompleted';
```

### 诊断事件监听

`addListener` 实际委托给 `PipelineExecutor.addListener`，返回取消订阅函数：

```typescript
const unsubscribe = pipeline.addListener((event) => {
  console.log(`[Bootstrap Diagnostic] ${event.type}: ${event.stageName ?? '-'}`);
});
// ...
unsubscribe();
```

监听器抛错不会中断流水线 —— `PipelineExecutor.emit` 对每个监听器单独 `try/catch`，错误记到 `console.error('[PipelineExecutor] Listener error:')`。

---

## 与启动流程的接线 (`ServerBootstrapAdapter`)

`server.ts` 的 `startServer()` **第一句**就是调用 `ServerBootstrapAdapter.bootstrap(...)`，这是全套 bootstrap 子系统唯一的生产消费者。它做的事：

```typescript
await ServerBootstrapAdapter.bootstrap({
  kernelContainer,
  environment: process.env.NODE_ENV || 'development',
  config: { port: Number(process.env.PORT) || 9000 },
});
```

`ServerBootstrapAdapter`（`packages/core/bootstrap/adapter/server-bootstrap-adapter.ts`）把已有的 `kernelContainer` 通过 `PlatformBuilder.addService` 注入，再同步构造一个 `IBootstrapContext` 字面量调用 `pipeline.execute(...)`。

> ⚠️ 该 context 是**手写字面量**，其中 `setStage: () => {}` 是**空实现** —— 也就是说，即便流水线跑完 5 个阶段，`currentStage` 也不会被真正更新。`BootstrapRegistration.registerExistingBootstrapStages()` 同样是空实现（注释写明「自定义阶段可在此注册」）。流水线的诊断日志会照常输出到控制台（`[Platform] Starting Bootstrap Pipeline execution...` / `[Platform] Ready. Total startup duration: N ms.`），但它对平台实际状态**没有影响**。

流水线之后，`startServer()` 才做真正的工作：跑 `migrations/` 目录迁移与 `runStartupMigrations`、`await kernelContainer.ready`（等 `Kernel.bootstrapSystemPlugins()` 完成）、注册活动生态 Token、组装 Express 与 Socket.IO。详见 [composition-root.md](composition-root.md)。

---

## 其余子系统（本文不展开）

`packages/core/bootstrap/` 下还有 `builder/`（`PlatformBuilder` 流式装配）、`composition/`（`PlatformCompositionRoot` + 各 `CompositionModule`）、`integration/`、`module-registry/`、`domain-registry/`、`lesson-session/`、`permission/` 等子目录。`PlatformCompositionRoot` 在 `Kernel` 构造函数中被调用一次（注册 `PluginCompositionModule`），失败仅告警不阻断启动。
