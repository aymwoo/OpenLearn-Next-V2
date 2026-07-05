# Phase 29: 插件系统加固与优化 - Patterns

## 架构变化

### 1. 标识符解析抽象 (UUID vs Manifest ID)

```
External API (e.g. DELETE /api/plugins/ext-memo)
  └─→ commandBus.execute('plugin.uninstall', { pluginId: 'ext-memo' })
        └─→ PluginHost.uninstallPlugin('ext-memo')
              └─→ resolvePluginUuid('ext-memo') 
                    ├─→ Checks if 'ext-memo' is a valid UUID → No
                    ├─→ Queries plugins table, parses manifests
                    └─→ Finds matching UUID: '019f2...'
                          └─→ Proceeds with deactivation & uninstall
```

### 2. Worker Storage RPC 隔离

```
Worker Thread (plugin.activate)
  └─→ ctx.services.storage.set('key', 'value')
        └─→ postMessage({ type: 'invoke', token: 'IStorageService', method: 'set', args: ['key', 'value'] })
              └─→ Main Thread (ServiceHost.handleMessage)
                    ├─→ Intercepts token === 'IStorageService'
                    ├─→ Extracts pluginId from actorId (plugin:ext-memo → ext-memo)
                    └─→ SQLite: INSERT INTO plugin_storage (plugin_id, key, value) VALUES ('ext-memo', ...)
```

---

## 编码规范

1. **别名处理的鲁棒性**：
   在 `PluginHost` 的 `resolvePluginUuid` 方法中，查询所有插件条目的 Manifest 时，需要增加防崩防御：使用 `try-catch` 包裹 `JSON.parse`，以防数据库中残留了损坏的 Manifest JSON。

2. **Actor ID 的解析契约**：
   在 `ServiceHost` 中，绑定的 `this.pluginActorId` 格式为 `plugin:${manifest.id}`（例如 `plugin:ext-memo`）。提取插件 ID 时，使用 `.startsWith('plugin:')` 进行判断，并在满足时调用 `.slice(7)`。

3. **测试可重复性**：
   在单元测试中，确保在测试结束后调用 `uninstallPlugin` 进行物理清理，防止残留的自建表和文件目录影响后续测试运行。
