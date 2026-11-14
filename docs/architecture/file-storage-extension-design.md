# 文件存储统一持久化与可扩展架构设计

> 状态：已实现 · 对应迁移 `048_file_storage_extension.sql`
>
> 本文档定义 OpenLearn V2 中**二进制文件持久化层**的统一数据模型、三大可扩展插槽（存储布局、存储后端、文件处理器）、安全读取网关，以及各类单文件与目录包的路径治理方案。

---

## 1. 背景与设计目标

在架构统一前，平台存在多套互相独立的本地磁盘写入路径，且访问 URL 直接绑定物理文件路径：

- `POST /api/upload`（`server/routes/os.ts`）直接将上传文件平铺写入 `uploads/` 并返回 `/uploads/<uuid>-<name>`；
- `course-package-assets.ts` 直接向 `uploads/` 写入并在导出时扫盘读取；
- `assignment-service.ts` 自主拼接 `assignments` 子目录并直接管理文件落盘；
- `roster.ts` 直接管理头像写入 `uploads/avatars/`；
- `builtin.ts`、`ai-submit-injector.ts`、`bridge.ts`、`resource-service.ts` 等课件目录包入口硬编码 `process.cwd()/storage/courseware`，在设置 `OPENLEARN_DATA_DIR` / `OPENLEARN_DB_PATH` 时与主数据目录分离；
- `site-backup.mjs` 仅归档 `storage`、`plugins`、`uploads`，未包含独立物理文件根目录。

本次重构聚焦四个核心目标：

1. **逻辑资产与物理存储解耦**：所有单文件对业务层统一暴露逻辑访问地址 `/api/files/:assetId` 与逻辑资产表 `file_assets`，物理键（`storage_key`）与后端（`backend_id`）可变而不破坏既有引用与课程内容链接。
2. **三大可扩展插槽**：通过内核 DI 扩展注册表 `IFileStorageExtensionRegistryToken`，支持在不修改核心服务的前提下扩展目录命名策略（LayoutPolicy）、物理存储后端（StorageBackend）与文件生命周期处理器（FileProcessor）。
3. **安全与隔离内建**：修复公开静态目录裸露 `uploads/` 带来的权限绕过与 HTML/SVG XSS 风险；保护作业提交等受限资源；阻止第三方插件通过 SQL 守卫直连核心文件表。
4. **单文件与目录包分类治理**：单文件全面收口至 `FileStorageService`（根目录 `<dataDir>/files/`），交互式 H5/SCORM 等多文件相对路径课件目录统一收口至 `resolveDataDir()` / `getStorageDir()` 下的 `courseware/`，保持相对资源引用零破坏。

### 适用边界（与 VFS 及插件进程模型的关系）

- **与 VFS 的边界**：`packages/plugins/vfs.ts` 面向课程/实验虚拟工作区内的代码与文本目录树（存入 SQLite `vfs_nodes`），`FileStorageService` 面向真实二进制上传文件与导出制品，二者互补、互不替代。
- **与第三方 Worker 插件的边界**：`StorageBackend` 与 `FileProcessor` 接口包含字节流（`Buffer` / `Readable`）传输。第三方 `process` 模式插件运行在受限子进程与 `IPCCommandBus` 之上，当前**不跨 IPC 代理二进制流插槽**；自定义存储后端与流式处理器仅面向内核宿主代码及同进程受信任扩展注册使用。

---

## 2. 总体分层架构

```text
+-----------------------------------------------------------------------+
|                       HTTP / 业务调用入口                             |
|  POST /api/upload · CoursePackage · AssignmentService · UserAvatar    |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                        FileStorageService                             |
|  - store() / openReadStream() / readBuffer() / softDelete() / purge() |
|  - 内容寻址去重 (sha256 + ref_count) · 旧路径别名表 (file_aliases)     |
|  - 配置管理 (site_settings.file_storage_config) · 存量重整 reorgAssets |
+---------+--------------------------+------------------------+---------+
          |                          |                        |
          v                          v                        v
+-------------------+    +-----------------------+    +-----------------+
| Slot 1            |    | Slot 2                |    | Slot 3          |
| LayoutPolicy      |    | StorageBackend        |    | FileProcessor   |
| - flat / by-date  |    | - LocalFileStorage    |    | - before-store  |
| - by-course       |    | - (扩展: S3/OSS/...)  |    | - after-store   |
| - by-author       |    +-----------------------+    | - before-serve  |
| - custom + tokens |                                 | (含 PDF 页数)   |
+-------------------+                                 +-----------------+
          ^                          ^                        ^
          +--------------------------+------------------------+
                                     |
                 Kernel DI: IFileStorageExtensionRegistryToken
```

---

## 3. 数据库设计（`migrations/048_file_storage_extension.sql`）

为解决同后端 SHA-256 去重与独立业务元数据之间的冲突，采用 **物理 Blob（`file_blobs`）与逻辑资产（`file_assets`）分离** 的三表模型：

### 3.1 `file_blobs`（物理对象与去重引用计数）

- `id TEXT PRIMARY KEY`
- `backend_id TEXT NOT NULL`（如 `local`、`s3-main`）
- `storage_key TEXT NOT NULL`（相对根目录或 Bucket Key）
- `sha256 TEXT NOT NULL`、`size_bytes INTEGER NOT NULL`
- `ref_count INTEGER NOT NULL DEFAULT 1`（逻辑资产引用计数，仅归零时允许删除物理对象）
- `UNIQUE(backend_id, storage_key)`，配合 `(backend_id, sha256)` 索引支持同后端内容去重。

### 3.2 `file_assets`（逻辑资产主表）

- `id TEXT PRIMARY KEY`（对外 `/api/files/:assetId` 标识）
- `blob_id TEXT NOT NULL REFERENCES file_blobs(id)`
- `original_name TEXT NOT NULL`、`mime TEXT NOT NULL`
- 上下文字段：`author_id`、`course_id`、`lesson_id`、`purpose`（`avatar` / `courseware-asset` / `assignment` / `attachment` / `export`）
- `access_scope TEXT NOT NULL DEFAULT 'authenticated'`（`public` | `authenticated` | `assignment`）
- `metadata_json TEXT`、`deleted_at TEXT`、`created_at TEXT NOT NULL`

### 3.3 `file_aliases`（旧路径别名映射）

- `alias TEXT PRIMARY KEY`（例如 `legacy-uuid-photo.png`）
- `asset_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE`

### 3.4 配置与关联列扩展

- `site_settings.file_storage_config TEXT`：存储全局布局方案、默认后端与去重开关 JSON；**严禁**包含凭证密钥，且公开 `GET /api/site-settings` 显式忽略该字段，仅管理员接口 `/api/admin/file-storage/*` 可读写。
- `plugin_assignment_files.asset_id TEXT`：作业附件表补充关联 `file_assets.id`，实现统一读取鉴权与双根兼容清理。

### 3.5 核心表访问守卫

`packages/core/plugin-host/sql-guard.ts` 将 `file_blobs`、`file_assets`、`file_aliases` 加入 `FORBIDDEN_CORE_TABLES`，禁止插件通过 SQLite 代理绕过 `FileStorageService` 直接查询或篡改文件记录。

---

## 4. 三大可扩展插槽与 DI 注册机制

在 `packages/core/di/interfaces.ts` 定义 `IFileStorageExtensionRegistryToken`，由 `packages/core/di/file-storage-extension-registry.ts` 实现，并在 `Kernel` 启动时注册到 `kernelContainer.serviceRegistry`：

- 注册项以 `{ owner, backend }` / `{ owner, processor }` 包装对象存储，**保留类实例原型链与私有状态**（不做浅拷贝对象展开）。
- 同一扩展 `id` 重复注册将直接抛出明确冲突错误；`registerLayoutToken()` 允许业务扩展自定义路径变量（如 `{school}`）。

### 4.1 Slot 1 — `LayoutPolicy`（目录布局与命名策略）

内置 5 种模式：

| 方案              | 生成规则示例                                 |
| :---------------- | :------------------------------------------- |
| `by-date`（默认） | `{yyyy}/{MM}/{dd}/{purpose}/{safeName}`      |
| `by-course`       | `{courseId}/{lessonId}/{purpose}/{safeName}` |
| `by-author`       | `{authorId}/{yyyy}/{MM}/{safeName}`          |
| `flat`            | `{safeName}`                                 |
| `custom`          | 使用自定义模板与扩展 Token                   |

安全与正确性约束：

- `validateLayoutTemplate()` 禁止 `/`、`\\`、Windows 盘符前缀以及 `..` 路径逃逸段，且**强制要求包含 `{safeName}`、`{hash8}`、`{uuid}` 或 `{id}`**，防止相同原始文件名互相覆盖；
- `sanitizeFilenameKeepExt()` 支持中英文安全字符清洗并保留扩展名；
- 每个自定义上下文段值均经过清洗，杜绝通过 `courseId` / `purpose` 注入目录穿越。

### 4.2 Slot 2 — `StorageBackend`（物理存储抽象）

内建 `LocalFileStorage` 实现（根目录默认 `path.join(resolveDataDir(), 'files')`）：

- 路径解析严格执行 `isPathInsideRoot()`，越界立即拒绝；
- 写入采用“先写入临时文件再原子 `rename`”模式，防止并发读写看到半截文件；
- 通过 `FileStorageCapabilities` 声明 `supportsRange`、`supportsPresignedUrl`、`externalBacked`；
- 在服务层与 `Site` 备份文档中明确标注：启用非本地远程后端时，仅元数据包含在站点 SQLite 备份内，远程对象需由对应存储桶生命周期/快照机制保护。

### 4.3 Slot 3 — `FileProcessor`（生命周期钩子与流水线）

`FileProcessorRunner` 负责按声明顺序驱动三类阶段：

- `before-store`（fail-closed）：可在落盘前拒绝非法上传、修订文件名/MIME 或注入元数据；任一处理器抛出异常即中止本次存储。
- `after-store`（fail-open + 后台有界并发池）：同步处理器异常不破坏已写入资产；标记 `background: true` 的耗时任务进入默认并发上限为 `2` 且带阶段超时的队列，完成后安全合并 `metadata_json`。系统内建 `createBuiltinPdfPageCountProcessor()`，自动复用 `countPdfPages()` 识别 PDF 页数。
- `before-serve`（fail-open）：允许扩展响应头，但网关通过禁止覆写集合强力锁死 `Content-Type`、`Content-Disposition`、`Content-Security-Policy`、`X-Content-Type-Options` 与 `Cache-Control`。

---

## 5. HTTP 安全读取网关与接口收口

由 `server/routes/files.ts` 提供统一路由并在 `server.ts` 挂载：

### 5.1 统一资产读取 `GET /api/files/:assetId`

1. **分级鉴权**：
   - `public`：允许未登录读取（头像、站点资源等）；
   - `authenticated`：要求有效会话；
   - `assignment`：校验会话，并复用 `assignment-service.ts` 的 `canUserAccessAssignmentFile()` 逻辑（允许管理员、所属作业或授课教师、以及对应上传学生本人；其余用户返回 `403`）。
2. **安全响应头与 XSS 防护**：
   - `X-Content-Type-Options: nosniff`；
   - `Content-Security-Policy: sandbox`；
   - 基于服务端数据库 `asset.mime`（按 `file-preview-policy.ts` 安全降级策略）输出，拒绝客户端声称 MIME 欺骗：`.html` / `.htm` 降级为 `text/plain; charset=utf-8` 防止脚本解释，`.svg` 强制 `Content-Disposition: attachment`；
   - `assignment` 作用域强制 `Cache-Control: private, no-store`；公开与普通登录资产支持 `ETag` / `If-None-Match`（`304 Not Modified`）。
3. **异常兜底**：逻辑记录存在但物理文件失踪时返回干净 `404`，不泄漏底层堆栈。

### 5.2 旧 `/uploads/*` 兼容性与收口

- `server.ts` 中 `/uploads` 静态中间件启用 `fallthrough: true`：磁盘旧文件可直接兼容返回，未命中磁盘路径时自动查询 `file_aliases` 表并委托同一安全网关 `serveFileAsset()` 输出（遵守同样权限与安全头），查无别名则返回 `404`；
- `POST /api/upload`（`server/routes/os.ts`）改为调用 `getFileStorageService().store()`，支持透传 `context: { courseId, lessonId, purpose }`；
- `course-package-assets.ts`、`course-package-export.ts`、`assignment-service.ts`（含 `skipDedup: true` 确保作业提交不跨学生复用物理 Blob）、`roster.ts` 头像管理均已完成统一接入；
- `builtin.ts`、`ai-submit-injector.ts`、`bridge.ts`、`resource-service.ts` 对多文件交互课件目录均改为基于 `resolveDataDir()` / `getStorageDir()` 定位（关于作业模型请参阅 [assignment.md](./assignment.md)）。

### 5.3 管理员存储策略接口与界面

- 接口：
  - `GET /api/admin/file-storage/config`（返回当前配置、已注册后端及其 `capabilities`、内置模板方案）
  - `PUT /api/admin/file-storage/config`（管理员 `requireScopedAuth('admin')` + 模板与后端有效性校验）
  - `POST /api/admin/file-storage/preview`（实时预览给定布局方案将生成的相对物理 Key）
  - `GET /api/admin/file-storage/stats`（返回资产数、物理去重后占用空间、节省空间、别名映射数）
- 前端管理界面：`src/features/admin/FileStoragePanel.tsx` 挂载于管理员「站点设置」页面，支持切换布局方案、自定义模板即时校验与路径预览、切换默认后端及启用/关闭 SHA-256 去重。

---

## 6. 存量重整与站点备份

- **存量物理布局重整（`scripts/file-reorg.ts` / `pnpm file:reorg`）**：
  - 按 `file_blobs` 分组选取规范源资产计算目标布局与目标后端 Key，执行「复制至目标后端 -> 事务更新 `file_blobs` -> 删除旧物理对象」的安全迁移；
  - 支持 `--dry-run`、`--scheme`、`--template`、`--backend`、`--limit` 参数；
  - 全程保持 `file_assets.id` 与 `file_aliases` 恒定不变，业务数据库文本链接零修改。
- **站点备份与恢复（`scripts/site-backup.mjs` / `scripts/site-restore.mjs`）**：
  - `site-backup.mjs` 已将 `files` 目录纳入归档清单（`['files', 'storage', 'plugins', 'uploads']`），确保本地默认存储后端物理资产随站点备份完整留存与恢复；
  - 若站点切换至远程对象存储后端，远程物理对象不在本地 tar 归档范围内，需由对应云端对象存储的多版本或跨区快照策略单独保障。
