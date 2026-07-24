# Platform Service Registry 平台服务注册表

`ServiceRegistryKernel` 位于 `packages/core/service-registry/`，为平台内部与插件之间提供服务暴露、动态查找、作用域生命周期管理及依赖检查功能。

---

## 服务描述符 (ServiceDescriptor)

平台中的每一个注册服务均对应一个服务描述符：

```typescript
export interface ServiceDescriptor {
  id: string;
  name: string;
  version: string;
  scope: ServiceScope; // 'Singleton' | 'Transient' | 'Scoped'
  state: ServiceLifecycleState; // 'Registered' | 'Initializing' | 'Active' | 'Disposed'
  dependencies: string[];
}
```

---

## 核心接口契约 (`service-registry/index.ts`)

`ServiceRegistryKernel` 支持服务契约检验：
- `IAIServiceContract`
- `ILessonServiceContract`
- `IWhiteboardServiceContract`
- `IAnalyticsServiceContract`
- `IStorageServiceContract`
- `IPluginServiceContract`
- `IRuntimeServiceContract`

### 检查与状态诊断

```typescript
const registryKernel = kernel.platformServiceRegistryKernel;

// 查询所有已注册服务信息
const servicesInfo: ServiceInspectionInfo[] = registryKernel.inspectAllServices();

// 校验依赖完整性
const missingDeps = registryKernel.validateDependencies('my-service-id');
```
