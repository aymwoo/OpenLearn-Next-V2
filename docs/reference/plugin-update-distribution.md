# 插件原地更新与分发 (Plugin In-Place Update & Distribution)

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`；宿主内核 `packages/core/plugin-host`、`packages/core/worker-runtime`、`server/routes/plugins.ts`、前端 `src/components/PluginInstallWizard.tsx`。
> 本页说明插件 **原地更新（in-place update）** 能力：上传新 ZIP 后**保留插件 UUID、配置与业务数据**，仅替换代码与静态资源；并说明 Worker 激活超时的可调环境变量。

---

## 1. 能力概览

- 上传的新 ZIP 若 `manifest.id` 与已安装插件一致，宿主执行**原地更新**而非新建。
- 版本比对（semver）：升级正常；降级需显式 `allowDowngrade`。
- 系统核心插件（`@openlearn/*`）禁止通过插件中心更新。
- 运行中且声明了课堂/教学扩展点的插件，热更新会提示课中 UI 短暂异常确认。

---

## 2. 后端 Service API

### `PluginHost`（`packages/core/plugin-host/index.ts`）

```typescript
async updatePluginFromZip(
  zipBuffer: Buffer,
  options?: PluginUpdateOptions,
): Promise<PluginUpdateResult>;

findByManifestId(manifestId: string): {
  pluginId: string; name: string; version: string; status: string;
  state: string; manifest: Manifest; isSystem: boolean;
} | undefined;
```

### `PluginDistributionManager`（`packages/core/plugin-host/plugin-distribution-manager.ts`）

```typescript
interface PluginUpdateOptions {
  targetPluginId?: string;          // 锁定目标插件（DB UUID 或 manifest.id）
  executionMode?: 'worker' | 'inline';
  allowDowngrade?: boolean;         // 是否允许版本降级
}

interface PluginUpdateResult {
  pluginId: string;
  manifest: Manifest;
  oldVersion: string;
  newVersion: string;
  previousStatus: string;
  wasActive: boolean;               // 更新前是否处于 active 状态（更新后恢复原状）
}

// 新方法
updateFromZip(zipBuffer: Buffer, options?: PluginUpdateOptions): Promise<PluginUpdateResult>;

// 既有方法扩展：现支持指定执行模式
installFromZip(zipBuffer: Buffer, executionMode?: 'worker' | 'inline'): Promise<{ pluginId: string; manifest: Manifest }>;
```

### 命令总线入口（builtin 插件）

| 命令类型            | 权限           | 高危  | 入参                                                                                                            |
| ------------------- | -------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `plugin.update_zip` | `plugin:write` | ✅ 是 | `{ base64Data: string, targetPluginId?: string, executionMode?: 'worker'\|'inline', allowDowngrade?: boolean }` |

该命令将 Base64 ZIP 交给 `distributionManager.updateFromZip`。

### 插件内调用示例

```typescript
import { IPluginDistributionManagerToken } from '@openlearn/plugin-sdk';

const dm = await ctx.resolve(IPluginDistributionManagerToken);
const res = await dm.updateFromZip(zipBuffer, { allowDowngrade: false });
// res.newVersion, res.wasActive ...
```

---

## 3. 服务端 HTTP 接口（`server/routes/plugins.ts`）

### 按 manifest.id 查询已安装插件（升级检测）

```
GET /api/plugins/by-manifest/:manifestId(*)
→ { success: true, installed: boolean,
    pluginId?, name?, version?, status?, state?, manifest?, isSystem? }
```

> 须在 `/api/plugins/:id(*)/...` 之前注册（路由命中顺序）。

### 安装 / 更新（同一入口，靠请求头区分）

```
POST /api/plugins/install            # body: application/octet-stream (zip)
Header: x-install-mode: update        # 缺省为 install
Header: x-execution-mode: worker|inline
Header: x-target-plugin-id: <pluginId>
Header: x-allow-downgrade: true|false
→ 更新模式返回 { success:true, updated:true, pluginId, manifest,
    oldVersion, newVersion, wasActive, filename }
```

### 显式更新端点（卡片「更新」按钮）

```
POST /api/plugins/:id(*)/update-zip-raw   # body: application/octet-stream (zip)
Header: x-execution-mode: worker|inline
Header: x-allow-downgrade: true|false
→ { success:true, updated:true, pluginId, manifest, oldVersion, newVersion, wasActive }
```

### URL 直装与社区市场链路（v0.3.22）

```
POST /api/plugins/install-from-url        # 管理员专属（requireAuth('administrator')）
Body: { downloadUrl: string,
        expectedId?: string,      # 合法插件 id 格式；已在本机安装时自动改走 updateFromZip
        allowDowngrade?: boolean, # 默认关闭
        executionMode?: 'worker'|'inline' }
→ 安装: { success:true, updated:false, pluginId, manifest, filename, bytes }
→ 更新: { success:true, updated:true, pluginId, manifest, oldVersion, newVersion, wasActive, filename, bytes }
→ 下载失败: 400 { success:false, error, fallbackToClient:true }
```

- **出站 SSRF 校验**：`downloadUrl` 先过 `isSafeExternalUrl()`（`server/utils/url-safety.ts`，拒绝 `file:` 协议、回环地址、云元数据端点、私网地址），再由服务端 `downloadPluginPackage()` 代取（`server/services/community-registry.ts`：60 秒超时、200MB 体积上限）。
- **`fallbackToClient` 兜底**：服务端下载失败时，前端改为浏览器下载 ZIP 后直传 `upload-zip-raw`（`express.raw` limit 400MB），与一键热更新同一兜底策略。
- **社区市场只读端点**：`GET /api/plugins/community`（要求有效会话；服务端经 `PLUGIN_COMMUNITY_REGISTRY_URL` 代取注册表并归一化，见 [community-plugin-registry.md](../plugin/community-plugin-registry.md)）与 `GET /api/plugins/market`（本地市场）。
- **更新检测**：`POST /api/plugins/:id(*)/check-update`（要求有效会话）按插件 `updateSource.repo` 触发服务端 git / HTTP 出站请求，未声明 `updateSource` 时回退扫描本地 `v2_plugins/*/manifest.json` 做 semver 比对；`POST /api/plugins/:id(*)/one-click-update` 服务端优先下载、失败回退客户端 ZIP 直传。

---

## 4. 前端安装向导更新模式（`PluginInstallWizard.tsx`）

`PluginInstallWizard` 现接受更新相关 props，并在解析 ZIP 后自动检测同 `manifest.id` 的已安装插件：

```typescript
type ZipInstallOptions = {
  mode: 'install' | 'update';
  targetPluginId?: string;
  allowDowngrade?: boolean;
};

interface PluginInstallWizardProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'zh' | 'en';
  file: File | null;
  lockedTargetPluginId?: string | null; // 卡片「更新」锁定到具体插件行
  installedPlugins?: InstalledPluginSummary[];
  onConfirmInstall: (file: File, executionMode: 'worker' | 'inline', opts?: ZipInstallOptions) => Promise<void>;
}
```

检测优先级：卡片锁定 `lockedTargetPluginId` → 已安装列表 `installedPlugins` → 回退调用 `GET /api/plugins/by-manifest/:id`。检测到后向导切换为「更新」文案，并展示：

- **升级**：正常可继续。
- **降级**：需勾选「确认强制降级」（`allowDowngrade`）。
- **使用中**：插件为 active 且声明课堂/教学扩展点时，需勾选「已知晓课中热更新风险」。

`PluginCenter` / `App` / `PluginView` 负责传入 `installedPlugins` 与 `lockedTargetPluginId`；`PluginType` 新增 `version?` 与 `has_frontend?` 字段。

---

## 5. Worker 激活超时与快速失败机制

全栈插件在 Worker 内需动态 `import`、IPC 解析多个 Token、执行 `schema migrate/建表`；主线程繁忙时 RPC 会排队，固定短超时易误杀。平台提供了完善的超时配置、心跳续期与快速失败机制：

| 环境变量                                              | 默认值                 | 说明                                            |
| ----------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS`                | `60000`                | 初始激活等待窗口（最小 5000ms）                 |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_PROGRESS_SLIDE_MS` | `min(30000, 初始窗口)` | 每次收到进度心跳后重置的滑动窗口（最小 3000ms） |

### 5.1 上下文心跳 API (`ctx.reportProgress`) 与滑动超时

在耗时初始化操作（如大模型加载、复杂 SQL 数据迁移）期间，插件可通过 `PluginContext` 的 `ctx.reportProgress` 主动上报进度并续期超时窗口：

```typescript
export async function activate(ctx: PluginContext) {
  ctx.reportProgress?.('migration', '正在执行数据表结构初始化...');
  await ctx.db.migrate(1, async (db) => {
    // 迁移操作
  });

  ctx.reportProgress?.('model-load', '正在加载本地模型权重...');
  // 耗时加载逻辑，自动滑动续期超时，防止被误判超时熔断
}
```

### 5.2 激活期快速失败机制 (Fail-Fast)

为杜绝“插件语法错误或未捕获异常导致主线程盲等 60 秒”的假超时问题，系统引入了激活期快速失败保障：

- **即时错误捕获**：主线程在 Worker 激活阶段直接监听底层 `exit` 和 `error` 事件；若 Worker 发生未捕获异常或进程退出，主线程在 5ms 内立即拒绝激活 Promise 并抛出精准的 `WorkerActivateError`；
- **状态细分与 Watchdog 防风暴**：Worker 实例在激活期状态标记为 `activating`，仅在成功收到 `'activated'` 协议消息后提升为 `running`；若在 `activating` 阶段崩溃退出，Watchdog 不会触发自动重启循环，防止误触全局熔断器（Circuit Breaker）。

> 最后更新：2026-09-18
