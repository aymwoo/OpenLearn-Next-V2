# 插件注册表与分发管理 (Plugin Registry & Distribution)

OpenLearn V2 的插件注册表由 **SQLite 数据库持久化层** 与 **`PluginDistributionManager` 分发管理层** 共同构成，负责插件元数据管理、版本控制、本地与远程仓库包安装及动态热更新。

---

## 1. 数据库存储 Schema (`plugins` 表)

物理实现：SQLite 数据库文件位于 `packages/core/db/educational_os.db`。

在平台初始化时（定义于 `packages/core/plugin-host/index.ts`），创建 `plugins` 表结构：

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,             -- 插件数据库内部 UUIDv7 实例标识
  name TEXT NOT NULL,              -- 插件显示名称
  manifest TEXT NOT NULL,          -- 原始 manifest.json 的 JSON 字符串
  source_code TEXT,                -- 源码字符串（历史遗留兼容，新版为空）
  file_path TEXT,                  -- 物理入口文件绝对路径
  status TEXT NOT NULL,            -- 'installed' | 'active' | 'inactive' | 'error'
  execution_mode TEXT DEFAULT 'inline', -- 'inline' | 'worker'
  loader_version TEXT DEFAULT 'esm',    -- 'esm' | 'vm'
  created_at INTEGER NOT NULL      -- 安装时间戳 (Unix ms)
);
```

---

## 2. 插件分发管理器 (`PluginDistributionManager`)

实现在 [`packages/core/plugin-host/plugin-distribution-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/plugin-distribution-manager.ts#L95)。

`PluginDistributionManager` 解耦了前端市场 UI 与底层的安装逻辑，支持多仓库适配器（`IPluginRepositoryAdapter`）：

```typescript
export interface IPluginRepositoryAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'official' | 'private' | 'local' | 'offline';
  listPackages(): Promise<ReadonlyArray<PluginPackageMetadata>>;
  getPackage(pluginId: string): Promise<PluginPackageMetadata | undefined>;
  fetchZipBuffer(pluginId: string): Promise<Buffer>;
}
```

### 核心 API

1. **`listAvailablePackages()`**: 汇总所有已注册仓库（官方在线市场、私有仓库、本地离线包）中的可用插件包。
2. **`installFromZip(zipBuffer, executionMode)`**: 直接解析并安装 ZIP 格式的插件安装包。
3. **`installFromRepository(repoId, pluginId)`**: 从指定仓库下载 ZIP 并完成安装。
4. **`updateFromZip(zipBuffer, options)`**: 升级插件。若插件处于 `ACTIVE` 状态，会自动完成 `停用 → 覆盖物理文件与 DB 记录 → 重新激活` 的无缝升级序列。

---

## 3. 服务器端 REST API 端点

主进程 Express 路由位于 [`server/routes/plugins.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/plugins.ts)：

| HTTP 方法 | 路径 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/plugins` | 获取当前已安装插件列表及其实时状态。 |
| `POST` | `/api/plugins/upload` | 上传 ZIP 插件包并执行安装。 |
| `POST` | `/api/plugins/:id/toggle` | 切换插件的激活/停用状态。 |
| `DELETE` | `/api/plugins/:id` | 停用并彻底卸载指定插件。 |
| `GET` | `/api/plugins/:id/config` | 读取指定插件的运行时配置声明与当前值。 |
| `POST` | `/api/plugins/:id/config` | 更新指定插件的运行时配置项。 |
| `GET` | `/api/plugins/store` | 检索插件市场中的离线 ZIP 资源与可安装列表。 |

---

## 4. 插件别名与 UUID 解析机制 (`resolvePluginUuid`)

为了方便 API 调用与控制台管理，`PluginHost` 提供了优雅的标识符解析机制（定义于 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts#L630)）：

```typescript
const realUuid = pluginHost.resolvePluginUuid("@openlearn/plugin-vfs");
```

- **第一优先级**：直接匹配 `plugins.id` 主键 UUID（$O(1)$ 复杂度）。
- **第二优先级**：若传入的是 `manifest.id`（如 `"ext-homework-hub"`），使用 SQLite 原生 `json_extract(manifest, '$.id')` 高效索引查找对应的数据库主键 UUID。
