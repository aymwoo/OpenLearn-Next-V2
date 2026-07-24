# Service Registry 平台服务注册表内核

实现位于 `packages/core/service-registry/`。提供动态服务查找、生命周期状态追踪（`Registered` -> `Resolving` -> `Active` -> `Disposed`）与服务依赖图完整性校验。
