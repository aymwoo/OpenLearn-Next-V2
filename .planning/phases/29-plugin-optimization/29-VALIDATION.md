# Phase 29: 插件系统加固与优化 - Validation

## 验证策略

我们使用自动化集成单元测试对加固功能进行校验。测试用例文件将写入为：
`packages/core/plugin-host/__tests__/plugin-hardening.test.ts`

---

## 自动化测试用例定义

### 1. ZIP 安装返回 pluginId 校验
- **输入**：调用 `installPluginFromZip` 安装包含合法 manifest 的 ZIP 包字节流。
- **输出**：返回的 Manifest 对象中包含 `pluginId` 字段，且格式为标准的 UUID。
- **验证点**：`expect(manifest.pluginId).toBeDefined()` 且能通过正则匹配 UUID 格式。

### 2. 别名操作生命周期校验
- **步骤**：
  1. 上传 `ext-memo` 插件，获取其数据库 `pluginId` (UUID) 和 Manifest ID (`ext-memo`)。
  2. 使用 Manifest ID `ext-memo` 调用 `activatePlugin('ext-memo')`，检查其状态变为 `ACTIVE`。
  3. 使用 Manifest ID `ext-memo` 调用 `deactivatePlugin('ext-memo')`，检查其状态变为 `INSTALLED`。
  4. 使用 Manifest ID `ext-memo` 调用 `togglePlugin('ext-memo')`，验证状态来回切换。
  5. 使用 Manifest ID `ext-memo` 调用 `uninstallPlugin('ext-memo')`，验证数据库和文件目录已被彻底删除。
- **验证点**：所有状态转换和物理文件清理均无异常，表明别名自动解析逻辑在全生命周期生效。

### 3. Worker Storage 命名空间隔离校验
- **步骤**：
  1. 在 Worker 模式下激活测试插件，其 Actor ID 为 `plugin:ext-test-worker-storage`。
  2. 在 Worker 内部调用 `storage.set('secret', 'isolated-data')`。
  3. 主线程 RPC 处理完毕后，查询 SQLite 数据库：
     `SELECT value FROM plugin_storage WHERE plugin_id = 'ext-test-worker-storage' AND key = 'secret'`
     以及主系统内核默认存储：
     `SELECT value FROM plugin_storage WHERE plugin_id = '__kernel__' AND key = 'secret'`
- **验证点**：
  - 在 `plugin_id = 'ext-test-worker-storage'` 下成功读取到 `isolated-data`。
  - 在 `plugin_id = '__kernel__'` 下读取为 `null`（确保没有污染全局命名空间）。
  - Worker 中调用 `storage.get('secret')` 能正确返回隔离的值。
