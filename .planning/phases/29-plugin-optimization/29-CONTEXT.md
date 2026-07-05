# Phase 29: 插件系统加固与优化 - Context

**Gathered:** 2026-07-05  
**Status:** Ready for implementation  

<domain>
## Phase Boundary

本阶段的目标是对 OpenLearnV2 的插件系统进行安全性加固与开发者体验（DX）优化，具体涵盖以下两个主要边界：
1. **开发者体验 (DX) 优化：**
   - ZIP 插件包安装完成后，返回数据结构中需明确包含数据库新生成的插件 `pluginId`（UUIDv7）。
   - 插件生命周期管理（启用、禁用、卸载、状态查询）全面支持使用 `manifest.id`（如 `ext-memo`）作为别名进行调用，摆脱必须使用 UUID 的限制。
2. **沙箱与数据安全性加固：**
   - 修复 Worker 模式下的 `IStorageService` 越权访问缺陷。主线程 RPC 服务宿主 `ServiceHost` 需对 `@openlearn/core:IStorageService` 进行定制拦截，使用插件的 `manifest.id` 作为命名空间隔离键，杜绝不同 Worker 插件共享或篡改宿主 `__kernel__` 存储空间的风险。
   - 编写自动化单元测试，确保上述安全隔离与别名解析逻辑稳定可靠，且现有内置插件回归测试通过。

</domain>

<decisions>
## Implementation Decisions

### 别名自动解析 D-29-01
- 在 `PluginHost` 中实现私有方法 `resolvePluginUuid(idOrManifestId: string): string`。
- 该方法会先查询数据库 `id`（UUID），若不存在，则检索数据库内所有插件条目的 `manifest` 字段，解析 JSON 匹配 `manifest.id`。若匹配成功则返回该条目的 UUID。
- 在 `activatePlugin`、`deactivatePlugin`、`togglePlugin`、`uninstallPlugin`、`getPluginState` 等方法入口调用此解析逻辑，对外部使用者完全透明。

### ZIP 安装返回 UUID D-29-02
- 调整 `installPluginFromZip` 的返回结果，将生成的 UUID 挂载在 Manifest 返回对象的 `pluginId` 属性上，由于 Manifest 启用了 `.passthrough()`，此改动不会破坏类型校验且能被 REST 接口直接返回。

### Worker Storage 沙箱隔离 D-29-03
- 在 `packages/core/worker-runtime/service-host.ts` 中拦截 `msg.token === '@openlearn/core:IStorageService'` 的 RPC 请求。
- 根据当前 Worker 的 `pluginActorId` 提取出插件 ID，执行独立的 SQL 操作，保证只读写 `plugin_storage` 表中 `plugin_id = manifestId` 的部分，切断对 `__kernel__` 的直接访问。

</decisions>

<canonical_refs>
## Canonical References

- `packages/core/plugin-host/index.ts` — 插件总控核心
- `packages/core/plugin-host/context-builder.ts` — 插件上下文构造器
- `packages/core/worker-runtime/service-host.ts` — Worker RPC 调用宿主
- `packages/plugins/builtin.ts` — 核心系统插件（含插件管理指令）
- `server.ts` — 插件相关 REST API

</canonical_refs>

<code_context>
## Existing Code Insights

- `listPlugins` 会读取所有插件的 `manifest` 字段并转换为对象，可以在内存中进行匹配查找。
- `ServiceHost` 的构造函数中接收 `pluginActorId` 形式为 `plugin:<manifest.id>`，可直接截取。
- 原有的 `StorageService` 使用 `__kernel__` 作为写入的 `plugin_id` 区分。

</code_context>

---
*Phase: 29-plugin-optimization*
*Context gathered: 2026-07-05*
