# Platform Kernel 内核规范

`packages/core/kernel/index.ts` 导出了全局唯一的 `Kernel` 单例与 DI 容器：

```typescript
export class Kernel {
  public readonly eventBus: EventBus;
  public readonly commandBus: CommandBus;
  public readonly actionRegistry: ActionRegistry;
  public readonly capabilityGuard: CapabilityGuard;
  public readonly processManager: ProcessManager;
  public readonly esmLoader: NodeEsmLoader;
  public readonly db: Database;
  public readonly serviceRegistry: ServiceRegistry;
  public readonly storageService: StorageService;
  public readonly aiService: AIService;
  public readonly pluginHost: PluginHost;
  public readonly workerManager: WorkerManager;
  public readonly lessonRuntime: LessonRuntime;
  public readonly classroomRuntime: ClassroomRuntimeKernel;
  public readonly presenceEngine: PresenceEngineKernel;
  public readonly collaborationEngine: CollaborationEngineKernel;
  public readonly analyticsEngine: AnalyticsEngineKernel;
  public readonly aiRuntime: AIRuntimeKernel;
  public readonly aiCapability: AICapabilityKernel;
  public readonly capabilityFrameworkRuntime: CapabilityRuntimeKernel;
  public readonly capabilityGovernance: CapabilityGovernanceKernel;
  public readonly platformServiceRegistryKernel: ServiceRegistryKernel;
  public readonly ready: Promise<void>;
}

export const kernel = new Kernel();
export const kernelContainer = kernel.serviceRegistry;
```
