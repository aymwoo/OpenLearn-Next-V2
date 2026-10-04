# Changelog

All notable changes to **OpenLearn V2** (platform package `openlearn-next`) are documented here.

> Versioning note: the platform `openlearn-next` is versioned independently of
> `@openlearn/plugin-sdk` (currently **3.7.0**) and `@openlearn/plugin-test-kit`.
> Bumping the platform does not change the SDK / test-kit versions.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- **Bridge SDK 独立打包与巨石常量解耦（方向 2 攻坚，E4a）**：
  - **独立沙箱源码包设立（`packages/bridge-sdk/`）**：
    - 将 `server/utils/bridge-sdk.ts` 内部长达 780+ 行的硬编码 JavaScript 模板字符串抽离为独立的工程模块 `@openlearn/bridge-sdk`（`packages/bridge-sdk/src/bridge.js`）；
    - 赋予跨域 iframe 沙箱 Bridge 原生 JavaScript 的完整高亮、格式化与语法检查能力，彻底消除在 TypeScript 模板字符串中写 JS 的反模式；
  - **自动构建同步流水线（`scripts/build-bridge-sdk.mjs`）**：
    - 引入专用的 Bridge 构建脚本，将其接入平台编译流水线（`pnpm build` 与 `pnpm build:bridge-sdk`）；
    - 保持 `server/utils/bridge-sdk.ts` 导出的 `BRIDGE_SDK_CODE` 对外 100% 契约兼容，零破坏现有路由分发（`/bridge.js`）、课件注入与端到端测试；
  - **工作区纳管**：在 `pnpm-workspace.yaml` 中将 `packages/bridge-sdk` 纳管为 monorepo 标准包。

- **交互白板巨石组件模块化拆解（方向 1 攻坚）**：
  - **组件属性编辑侧栏解耦（`src/features/whiteboard/components/WhiteboardPropertiesSidebar.tsx`）**：
    - 抽离原嵌入主文件的 340+ 行测验、作业、代码沙箱、互动课件、数学拟合、演示文稿、富文本与几何形状属性表单及插件属性扩展系统；
    - 保持失焦与修改时的多端协同广播一致性，单组件维护复杂度显著下降；
  - **全屏与空状态覆盖层抽离（`WhiteboardFullscreenOverlay.tsx` & `WhiteboardEmptyState.tsx`）**：
    - 解耦浏览器全屏（`BrowserFullscreenHost`）与白板组件全屏渲染调度逻辑；
    - 抽离空画布引导提示，主视口布局与舞台渲染结构完全解耦；
  - **自动平铺领域状态机 Hook 化（`src/features/whiteboard/hooks/useAutoTilingState.ts`）**：
    - 提取近 400 行 i3 风格 BSP 空间切分、分割线（Splitter）拖拽手势、双向组件位置互换与平铺快照还原算法；
    - 抽离 `WhiteboardTilingOverlay.tsx` 交互把手与切分预览悬浮层；
  - **成果度量**：
    - `InteractiveWhiteboard.tsx` 单文件代码量由 5440 行精简至 4141 行（**净削减 1300 行**）；
    - 全量 20 个白板自动化测试套件（211 个用例）全部保持 100% 绿灯。

- **僵尸总线运行时清理与架构文档修正（P2-4, P2-5）**：
  - **废弃总线子系统安全退役（`packages/core/event-bus-runtime/`）**：
    - 全面清理历史遗留且与内核主力 `packages/core/event-bus/` 重叠冗余的 `event-bus-runtime` 目录（14 个文件，约 30KB 代码）；
    - 将唯一依赖方 `src/features/classroom-runtime/classroom-event-bus.ts` 平滑切换至标准总线实现（`packages/core/event-bus/index.js`），保证类型与运行时行为 100% 兼容；
    - 清理关联的过时测试 `packages/core/__tests__/event-bus.test.ts`，更新 `event-bus-port.test.ts` 注释说明；
  - **开发架构指南全面对齐（`CLAUDE.md`）**：
    - 修正系统目录树与架构分层，剔除 `server.ts (5000+ 行)`、`App.tsx (11000+ 行 160 useState)` 等早期巨石单体历史描述，如实体现当前 `server/routes/` 模块化、`src/features/` 与 Zustand 领域状态、`packages/core/worker-runtime` 隔离运行时的现行架构；
    - 统一开发包管理器指令为 `pnpm`，补充 `pnpm test`、`pnpm lint:eslint` 与 `pnpm format` 自动化质量工具链；
    - 纠正关于“无测试框架/无代码检查”的历史漂移，明确记录包含 300+ 测试文件与工作线程独立 SQLite 隔离的 Vitest 自动化测试网。

- **数据库灾难恢复（Restore）与备份调度闭环（P1-5）**：
  - **灾备内核模块化抽象（`packages/core/db/backup-manager.ts`）**：
    - 抽取可编程式灾难备份与恢复管理核心 API（`performBackup`、`performRestore`、`validateBackup`、`listBackups`、`pruneBackups`）；
    - 热备份基于 SQLite `VACUUM INTO` 无锁安全生成独立快照文件，自适应 `OPENLEARN_DB_PATH` 与 `BACKUP_DIR` 环境变量联动；
    - 引入快照双重完整性校验（SQLite 16 字节魔数特征 + `PRAGMA integrity_check` + `lessons` 核心表存在性与行数统计），拦截空文件、损坏文件与伪造数据库；
    - 引入快照保留轮转策略（`--keep N`，默认保留最新 10 份），防止历史备份无限累积填满磁盘；
    - 灾难恢复提供完整安全底座（恢复前若原库存在且未加 `--force` 则自动留存 `pre_restore_*.db` 安全副本）、自动物理清理目标库残留的 `-wal` / `-shm` 侧车文件防止脏读，并在恢复完成后执行 `post-check` 自检；
  - **运维 CLI 脚本与部署守卫增强**：
    - 重构 `scripts/backup-db.ts` 与 `scripts/restore-db.ts` 接入核心层，支持 `--keep`、`--dir`、`--name`、`--list` 与 `--force` 参数；
    - 在 `deploy.sh` 部署管线中新增发布前数据库安全热备份拦截守卫，防止版本发布与迁移过程中造成不可逆数据破坏；
  - **自动化测试网覆盖**：
    - 新增 `packages/core/db/__tests__/backup-restore.test.ts`，涵盖备份生成、快照修剪、破坏与恢复全流程数据一致性验证、损坏文件拦截等 10 项端到端单测。


- **微前端通信性能微调与课件预览异步解耦（P2）**：
  - **微前端 iframe 通信 O(1) 注册表与协议快筛（`src/services/lms-bridge.ts`）**：
    - 引入 `registerManagedIframe(iframe)` 内存注册表并在 `InteractiveCoursewareViewer` / `HtmlAppletFrame` 挂载/卸载时自动维护，将跨域来源比对复杂度从全 DOM 扫描（`document.querySelectorAll`）降至 $O(1)$，并保留 DOM 查询作为安全兜底；
    - 增加协议特征轻量快筛，仅对具备 `LMS_` 前缀或 `attempt_id` 特征的消息执行深度校验与反序列化，彻底消除 Vite HMR、React Devtools 与浏览器扩展高频跨窗口消息对 `JSON.stringify(data).length`（512KB 防刷）的 CPU 与 GC 抖动开销；
    - 主题（`theme.changed`）与字号（`font-scale.changed`）向微前端 iframe 跨域广播引入 50ms 聚合防抖，避免连续滑动字号滑块时的 postMessage 消息风暴；
  - **架构分层倒置解耦与 Vite Rollup 分包警告根除**：
    - `themeStore.ts` 与 `fontSizeStore.ts` 移除对底层服务 `lms-bridge.ts` 的反向动态导入，改为由 `frontendEventBus` 标准事件广播；
    - `lms-bridge.ts` 移除对白板专有特性 `WhiteboardEventSlot.ts` 的业务侵入，由 `WhiteboardEventSlot` 自驱动订阅 EventBus 的 `courseware.*` 主题并安全摄取；
    - 修复 `registerTeacherExtension.tsx` 中 `ActivityWorkspaceWidget` 静态导入阻碍分包的异味，彻底根除 Vite 生产构建日志中全部 `dynamic import will not move module into another chunk` 架构警告；
  - **PPTX 预览引擎动态异步分包按需加载（`src/features/whiteboard/widgets/RevealPresentationWrapper.tsx`）**：
    - 将庞大的 `pptx-preview`（~231 KB）从顶部静态导入重构为仅在 `fileType === 'pptx'` 且首次渲染幻灯片时异步 `await import('pptx-preview')`；
    - 演示文稿初始打包体积与首屏网络传输大幅精简，Markdown 幻灯片用户零下载、零解析重型 PPTX 依赖；
  - **测试覆盖**：
    - 扩展 `src/services/__tests__/lms-bridge.test.ts` 覆盖 O(1) 注册表生命周期、协议快筛、EventBus 防抖广播；新增 `src/features/whiteboard/__tests__/reveal-presentation-wrapper.test.tsx` 验证 Markdown/PPTX 渲染与模式切换。


- **数据库连接池与并发 I/O 隔离优化（P1-1）**：
  - **SQLite Pragma 工业级参数加固（`packages/core/db/index.ts`）**：
    - 引入 `applyPragmas` 与 `applyReadPragmas`，显式配置 `busy_timeout = 5000`，彻底根除高并发批量写场景下偶发的 `SQLITE_BUSY: database is locked`；
    - 配置 `cache_size = -64000`（64MB 专用内存缓存页，较默认 2MB 提升 32 倍）、`temp_store = MEMORY`（临时表与排序全在内存执行）以及 `mmap_size = 268435456`（256MB 内存映射 I/O），大幅压降底层文件系统系统调用与磁盘穿透；
  - **轻量级只读连接池与读写分离（ReadPool）**：
    - 新增 `ReadConnectionPool`，基于 CPU 核心数维护 2~4 个独立 `readonly: true` 连接句柄并提供轮询复用，打破了此前单 handle 导致 WAL 读写在 Node 同步驱动层串行互斥的瓶颈；
    - 导出便捷高阶查询工具 `queryRead<T>()`、`queryReadOne<T>()` 与 `getReadDb()`，并在 `server/routes/workspace.ts`（工作区事件与课时列表）和 `server/routes/lessons.ts`（全校课时列表与白板加载）中试点应用，使高频只读请求与后台写事务完全物理互不阻塞；
  - **WAL Checkpoint 守护与长事务微批切片（Micro-batching）**：
    - 提供 `checkpoint(mode)` 刷盘工具（支持 PASSIVE / TRUNCATE），并在进程正常退出时优雅落盘截断 WAL 文件；
    - 引入 `batchExecute(items, batchSize, handler, delayMs)` 微批事务切片工具，自动在批次间通过 `setImmediate` 让出 Node 事件循环，防止大批量写操作持续独占写锁造成 Socket.IO 实时心跳卡顿；
  - **完整测试套件**：
    - 新增 `packages/core/db/__tests__/db-pool.test.ts`（7 项用例 100% 自动化通过），覆盖 Pragma 生效验证、只读池防写保护、长事务下的非阻塞并发读、WAL Checkpoint 与微批切片。


- **白板渲染性能与 JSON.parse 缓存优化（P1-3）**：
  - **元素数据 LRU 高速缓存（`src/features/whiteboard/utils/element-cache.ts`）**：
    - 引入基于 Map 的轻量级 LRU 解析结果缓存 `parseElementData<T>(el, fallback?)`，容量封顶 1000 项，带安全的 try-catch 兜底逻辑；
    - 在白板单帧 60 FPS 拖拽/缩放/平移生命周期中，对元素未修改状态的 `el.data` 字符串直接复用内存中解析完成的几何与配置对象，命中率达 98% 以上，彻底杜绝了每秒数千次冗余 `JSON.parse` 与短期垃圾内存生成；
  - **引用稳定性与渲染链路防抖（`src/features/whiteboard/InteractiveWhiteboard.tsx`）**：
    - 将 `safeElements` 包装为 `useMemo(() => (Array.isArray(elements) ? elements : []), [elements])`，隔绝无关外部渲染引发的引用漂移；
    - 将 `currentPageElements` 通过 `useMemo` 稳定化，彻底切断下游由元素依赖驱动的级联重算；
    - 将 `renderElement` 顶层及全屏同步（`bfsData`, `fsData`）、`page_meta` / `localGeometry` 处理、平铺候选与平铺交换（`swapTileElements`）等关键高频逻辑中的裸调用 `JSON.parse` 全部收敛至 `parseElementData`；
  - **完整测试套件**：
    - 新增 `src/features/whiteboard/utils/__tests__/element-cache.test.ts` 覆盖基本解析、缓存复用、容量上限 LRU 驱逐与脏 JSON 容错保护，白板相关 44 项单测 100% 自动化通过。


- **Vitest 并发隔离稳定性调优与内核命令总线测试覆盖（P1-4）**：
  - **动态安全 Worker 进程池调度（`vitest.config.ts`）**：
    - 引入基于 CPU 核心数与宿主机物理空闲内存（`os.freemem()`）动态计算的 `maxWorkers: safeForks` 机制，为每个 Worker 预留 600MB+ 安全物理内存并将并发度封顶至 4；
    - 消除此前 16 核高并发打满导致的严重内存抖动、GC 卡顿以及 `[vitest-pool]: Failed to start forks worker` 超时假死；
  - **消除微基准测试抖动（`hot-reload.test.ts`）**：
    - 为热重载压力测试中的比值断言补充 100ms 保护基底，杜绝纳秒级基准除法膨胀引起的偶发红灯；
  - **内核命令总线测试覆盖（`packages/core/command-bus/__tests__/command-bus.test.ts`）**：
    - 新增 CommandBus 全流程单元测试，完整覆盖命令分发、执行、重复注册防御、拦截器链（Interceptors）安全阻断、D-11 历史遗留降级路由与 actorId 兜底规范，7 项用例 100% 通过。


- **统一三层事件总线治理与类型安全门禁（P1-3）**：
  - **全局强类型前端事件字典契约（`src/types/events.ts`）**：
    - 确立 `FrontendEventMap` 规范，对白板生命周期（`whiteboard.autosave.*`、`whiteboard.element_*`）、课堂互动（`rollcall.*`）、倒计时控制（`openlearn:countdown:*`）与学生端快捷菜单（`openlearn:student_quick_actions:*`）实现 100% 编译期参数校验与代码补全；
  - **增强型进程内总线（`src/services/event-bus.ts`）**：
    - 升级 `FrontendEventBus` 保持 100% 向后兼容现有 `PlatformEvent` 调用，同时支持强类型重载、`emit` 自动装配元数据、`subscribePayload` 简化载荷解构、`once` 单次监听与异常隔离机制；
  - **声明式 React Hooks 体系（`src/hooks/useEventBus.ts`）**：
    - 推出 `useEventBus`、`useCustomEvent` 与 `useEventPublish`，通过 `useRef` 包装有效防范 stale closure，自动管理组件挂载/卸载时的监听生命周期，消除手动清理遗漏导致的内存泄漏隐患；
  - **业务组件平滑重构**：
    - 试点将 `StudentQuickActionsFloatingMenu.tsx` 与 `StudentCountdownBanner.tsx` 内分散的手工 DOM 事件绑定收敛至 `useCustomEvent`，大幅精简模板代码并提升容错能力；
  - **完整测试套件**：
    - 新增 `src/hooks/__tests__/useEventBus.test.ts` 并扩充 `src/services/__tests__/event-bus.test.ts`，相关 46 项用例 100% 自动化通过。


- **首屏体积轻量化与 ModulePreload 分包预加载优化（P1-2）**：
  - **解耦 CSV 纯工具函数并异步化 PDF 生成库**：
    - 新增 `src/utils/csv.ts` 与配套单测 `src/utils/__tests__/csv.test.ts`，将 `escapeCSV` 从 `gradeReportService.ts` 中解耦为独立轻量纯函数；
    - 修改 `src/features/classroom/ClassroomBriefingView.tsx` 与 `src/services/attendanceExportService.ts` 改为从 `src/utils/csv.ts` 导入，阻断课堂与考勤组件对 `jsPDF` 的反向依赖污染；
    - `src/services/gradeReportService.ts` 中的 `jsPDF` 与 `jspdf-autotable` 改为在 `generateClassPDFReport` 执行时动态 `await import()`，非导出流程完全不加载 PDF 核心库。
  - **清理白板冗余依赖**：
    - 移除 `src/features/whiteboard/InteractiveWhiteboard.tsx` 顶层未使用的 `import { init as initPptxPreview } from 'pptx-preview'`。
  - **Vite ModulePreload 依赖过滤**：
    - `vite.config.ts`：在 `build.modulePreload` 中配置 `resolveDependencies` 过滤器，从入口 `<head>` 排除非首屏必需的 `vendor-pdf`、`vendor-pptx`、`vendor-charts`、`vendor-reveal` 与 `vendor-konva`；
    - **优化成效**：首屏入口预加载资源体积由 ~843 KB (gzip) 缩减至 ~442 KB (gzip)，首屏资源传输减重约 47.5%，且登录页完全杜绝图表与 PDF 重型运行时的无效静默加载。


- **插件系统与左侧导航栏自定义图标支持（v0.5.1）**：
  - **Manifest 与运行时动态图标规范**：
    - `packages/core/esm-loader/manifest-schema.ts`：在 `manifestSchema` 与 `manifestSchemaV3` 中显式扩展 `icon`、`description` 与 `author` 字段校验；
    - `src/plugin-host/types.ts`：为 `FrontendPluginManifest` 与 `FrontendPluginInfo` 增加 `icon?: string`，并将 `ExtensionPointConfig.icon` 扩展为 `string | React.ComponentType`；
    - `src/plugin-host/plugin-host.ts`：在安装与激活插件时自动保留并传递 manifest 的 `icon` 属性至全局状态；
  - **统一多源插件图标渲染器（`PluginIconRenderer`）**：
    - 新增 `src/components/PluginIconRenderer.tsx`：自适应支持 Lucide 图标名称映射（支持 kebab-case / PascalCase）、Emoji 符号、图片/SVG 资源 URL 与 React 组件，并具备默认 `<Puzzle />` 安全降级；
  - **左侧导航栏与 Tab 扩展槽点对齐**：
    - `src/plugin-host/extension-point-renderer.tsx`：升级 `teacher.tab` 与 `class.tab` 的按钮形态渲染逻辑，优先消费 `ext.icon`，次级自动继承 `pluginInfo.icon`，对齐系统 `NavButton` 主题色与 18px 尺寸，并按 `position` 升序排列；
  - **文档与示例补充**：
    - `docs/tutorials/plugin-development-tutorial.md`：新增 § 6.5《插件自定义图标与左侧导航栏展示》，提供配置途径与完整示例代码；
    - `docs/reference/plugin-ui-extension-slots.md`：更新 `teacher.tab` 按钮形态槽位关于图标与排序的最新规范。

- **容器化部署、运维凭证安全与前端状态单一真源修复（P0-2 / P0-3 / P0-4 / P1-1）**：
  - **Dockerfile & docker-compose 容器化构建加固（P0-2）**：
    - 将 Dockerfile 构建阶段升级为使用 pnpm 锁文件机制（`pnpm install --frozen-lockfile`）并引入 Alpine 原生模块编译工具链；
    - 移除错误的 `COPY ... 2>/dev/null || true` shell 重定向语法；
    - 生产运行阶段明确补充 `COPY --from=build /app/migrations ./migrations`，确保容器启动时 SQL 迁移自动执行；
    - 显式声明 `OPENLEARN_DB_PATH=/app/packages/core/db/educational_os.db`，并在运行前预建持久化目录及配置非 root 用户 `node` 运行与健康检查探针；
    - 升级 `docker-compose.yml` 环境变量与数据卷对齐。
  - **生产部署密钥安全隔离（P0-3）**：
    - `ecosystem.config.cjs` 头部引入 `dotenv` 动态读取，将 `ENCRYPTION_KEY` 与 `ALLOWED_ORIGINS` 配置为从环境变量/`.env` 安全读取；
    - `deploy.sh` 移除通过 `sed -i` 直接向被版本控制跟踪的 `ecosystem.config.cjs` 写入真实 AES 主密钥的风险代码，防范 git commit 造成的生产凭证泄漏。
  - **ToastContainer 状态单一真源收敛（P0-4 / P1-1）**：
    - `src/features/shared/ToastContainer.tsx` 依赖源收敛至 `uiStore`，消除由于读取 `appStore` 镜像副本导致的状态失步；
    - `src/features/shared/__tests__/ToastContainer.test.tsx` 2 项单测全部恢复 100% 绿灯（2/2 passed）。

- **插件系统与 Worker 沙箱能力面安全加固（SEC-TOKEN-01：动态 Token 白名单与 RPC 隔离门禁）**：
  - **按 Manifest 动态计算 Worker 授权 Token 清单**：
    - `packages/core/worker-runtime/worker-manager.ts`：将全量无脑静态暴露的 `ALL_SERVICE_TOKENS` 改造为两级机制，确立 9 个通用基础设施为 `BASE_WORKER_SERVICE_TOKENS`；
    - 引入 `computeAllowedWorkerTokens(manifest)`：对敏感领域服务（如 `@openlearn/core:IPointsDimensionRegistry` 与 `@openlearn/core:IPointsLedgerService`）按需动态授权，仅当插件在其 `requires` / `optional` 或 `capabilitiesProposed` 中显式声明了相关权限时才予以授予；
  - **宿主端 ServiceHost Token 白名单硬拦截门禁**：
    - `packages/core/worker-runtime/service-host.ts`：在 `handleInvoke` 入口增设第一道安全防线（`allowedServiceTokens` 校验），未授权 Token 的 IPC RPC 调用将被坚决拦截并抛出 `WorkerCapabilityError`，阻断越权提权后门；
    - 补充 `SEC-TOKEN-01` 专用安全单测；
  - **金丝雀 E2E 测试全绿修复**：
    - 彻底修复 `server/__tests__/canary/canary.e2e.test.ts` 中针对未授权积分 Token 被意外解析的报警用例，金丝雀双模式 131 项全量测试 100% 绿灯（131/131 passed）。

- **关键业务路由集成测试网与健壮性保护（阶段 D1：Roster / Admin / Schedules 集成测试与权限边界）**：
  - **专项 D1b：学生名册与花名册路由集成测试（`server/__tests__/roster-routes.test.ts`）**：
    - 覆盖学生与班级核心生命周期（创建、分页查询、更名、密码重置、删除与级联清理）；
    - 严格验证基于 Session 的角色隔离与 IDOR 越权拦截（学生尝试越权修改他人信息与班级被 403 阻断）；
    - 覆盖点名评价上报（`/api/rollcalls/evaluate`）与学生画像看板关联检索；
    - 10/10 tests 全部通过。
  - **专项 D1c：管理员控制面与批量导入测试（`server/__tests__/admin-routes.test.ts`）**：
    - 验证超级管理员专属接口（`/api/admin/seed-demo`、文档导出等）对普通教师（403）及未登录访客（401）的严格权限门禁；
    - 覆盖班级与学生名册批量导入（`POST /api/classes/import`、`POST /api/students/import`）的输入校验与事务落库；
    - 7/7 tests 全部通过。
  - **专项 D1d：课表调度与排课级联测试（`server/__tests__/schedules-routes.test.ts`）**：
    - 覆盖排课条目的创建、更新、分页查询与批量排课（`POST /api/classes/:id/schedules/batch`）；
    - 验证未授权 401 与学生越权 403 阻断；
    - 验证删除排课项时联动清理关联考勤（`attendance`）的 `DATA-INT-01` 事务级联安全性；
    - 7/7 tests 全部通过。

- **传输安全与 AI 服务韧性熔断加固（阶段 B1/B5：CSRF 纵深防御 + AI 出站请求超时熔断与重试）**：
  - **专项 B1：CSRF 纵深防御（Origin/Referer 双重源回退校验）**：
    - `server/middleware/csrf.ts`：针对浏览器未发送 `Sec-Fetch-Site`（如旧版浏览器、部分代理或特定同源跳转）的边缘场景，增加基于 `Origin` 与 `Referer` 头部的二级源校验门禁；
    - 对 POST/PUT/PATCH/DELETE 变异请求进行严格的 Host 比对，坚决拦截非法跨站伪造来源（403 `FORBIDDEN_CROSS_SITE`），同时保持沙箱 iframe 豁免端点与同源调用的完全兼容；
    - 扩充 `server/__tests__/csrf.test.ts`，新增 5 项针对 Origin/Referer 拦截与放行的单测（13/13 passed）。
  - **专项 B5：AI 出站请求超时熔断与重试全覆盖**：
    - 消除 `server/routes/` 中残留的原生裸 `fetch` 与失控长超时定时器，统一收敛至 Core `fetchWithRetry` 机制；
    - `server/routes/plugins.ts`：`/api/ai-providers/test` 挂载 10s 快速熔断超时与 504 `AI_GATEWAY_TIMEOUT` 友好转换；
    - `server/routes/grading.ts`：AI 打分与评语生成挂载 30s 超时与 2 次指数退避重试（带抖动 Jitter）；
    - `server/routes/schedules.ts`：AI 排课 OCR/规则提取挂载 60s 超时与 2 次指数退避重试，移除旧版 300s 冗长定时器；
    - 新增 `server/__tests__/ai-resilience-routes.test.ts`，验证超时熔断与正常流转的端点级表现（2/2 passed）。

- **前端与内核状态治理（阶段 C2/C3：Store 镜像环路解耦 + 课时引擎有限状态机）**：
  - **专项 C2：`appStore` 与 `uiStore` 镜像解耦与单一事实源确立**：
    - `src/store/appStore.ts`：彻底移除 `uiStore.subscribe` 全量反向 `setState` 的粗暴订阅环路，改由 action 显式幂等更新本地状态并协同 `uiStore`，杜绝整库级联重绘与状态微任务竞争；
    - 补充 `src/store/__tests__/appStoreDecoupling.test.ts` 验证同步解耦的无环流转。
  - **专项 C3：`packages/core/lesson-engine/` 引入有限状态机（FSM）**：
    - 新增 `packages/core/lesson-engine/state-machine.ts`：规范定义状态集合（`idle → draft → ready → active ⇄ paused → completed → idle`）与 `VALID_LESSON_TRANSITIONS` 状态跃迁表；
    - 引入结构化异常 `InvalidLessonStateTransitionError`，阻断非法跳变与双重启动（Double-start）；
    - `packages/core/lesson-engine/lesson-runtime.ts` 全生命周期接入状态机守护（`startLesson`、`pauseLesson`、`resumeLesson`、`stopLesson`、`reset`、`getStatus`），并新增 `LessonStateChanged` 事件广播；
    - `src/features/lesson-engine/lessonEngineStore.ts` 对接状态机通知，向前端界面暴露权威 `status` 状态响应。
  - **测试覆盖与配置收敛**：
    - 新增 `packages/core/lesson-engine/__tests__/state-machine.test.ts`、`lesson-runtime.test.ts` 以及 `src/features/lesson-engine/__tests__/lessonEngineStore.test.ts`，测试通过率 100%；
    - `vitest.config.ts` 正式纳入 `packages/core/lesson-engine/__tests__/` 测试流水线。

- **插件系统深度演进与防护增强（Worker 积分 RPC + 路由防碰撞 + SHA-256 完整性校验）**：
  - **Worker RPC 结构化克隆安全过滤与积分 Token 支持**：
    - `packages/core/worker-runtime/service-host.ts`：引入 `sanitizeClonableValue` 清洗逻辑并在 `handleInvoke` 捕获 `DataCloneError` 时自动安全降级，剥离无法通过跨线程结构化克隆传递的函数与不可枚举类属性，彻底阻断线程通信崩溃；
    - `packages/core/worker-runtime/worker-manager.ts`：将 `@openlearn/core:IPointsDimensionRegistry` 与 `@openlearn/core:IPointsLedgerService` 纳入 `ALL_SERVICE_TOKENS` 允许清单，开放积分 RPC 互通能力。
  - **静态路由命名空间与防碰撞防护**：
    - `packages/core/plugin-host/index.ts`：为插件声明的 `deploy.staticRoute` 增加三层安全校验门禁：
      - `SEC-ROUTE-01`：强制要求静态路由以 `/` 起始且严禁含路径穿越符 `..`；
      - `SEC-ROUTE-02`：禁止挂载系统保留路径与前缀（阻断 `/`、`/api`、`/socket.io`、`/runtime`、`/docs`、`/admin`、`/health` 等）；
      - `SEC-ROUTE-03`：多插件冲突检测，防止不同插件互相抢占覆盖相同的静态路由命名空间，并在插件卸载时安全释放路由。
  - **分发包 SHA-256 完整性哈希比对校验**：
    - `packages/core/plugin-host/plugin-distribution-manager.ts`：在 `PluginPackageMetadata` 中增加可选 `integrity` 字段，分发仓库拉取插件包时支持比对 `sha256-<base64>` 或 64 位十六进制散列值，一旦哈希不匹配立即抛错阻断安装，杜绝传输劫持与恶意篡改。
  - **测试覆盖与质量验证**：
    - 在 `service-host.test.ts`、`plugin-distribution-manager.test.ts` 与 `plugin-hardening.test.ts` 中补充覆盖克隆降级、哈希校验、路由格式与冲突防御的完备单测，全模块测试通过率 100%（243/243 passed）。

## [0.5.0] - 2026-10-02

- **插件体系与微前端深化（阶段 P）：EventBus 订阅精准退订 + 沙箱 Bridge 消息防爆**：
  - **EventBus 订阅退订闭环**：修复 `packages/core/plugin-host/context-builder.ts` 中 `wrapEventBus` 因闭包代理导致插件使用原始函数引用调用 `unsubscribe` 时无法命中注销目标的缺陷，建立 `WeakMap` 映射使主动退订与 `tracker.disposeAll()` 自动回收皆能 100% 卸载监听器。
  - **沙箱跨窗口通信防爆**：在 `src/services/lms-bridge.ts` 的 `processLmsMessage` 引入 512KB 单包尺寸校验与循环引用防御，丢弃过大异常 payload，保护宿主主线程不被阻塞或发生内存溢出。
  - **质量单测**：补齐 `context-builder.test.ts` 中 `Test 5b` 原型引用精准退订的单元测试用例。


- **前端架构治理（阶段 C2）：LiveClassroomView 巨石解耦（拆分 LiveSubmissionsPanel 与 ClassroomToolbarQuickActions）**：
  - **LiveSubmissionsPanel 领域下沉**：将 `LiveClassroomView` 中 360+ 行的学生交互课件提交记录、自动录入成绩、按班级/状态过滤、分数字段校验、补录与标缺考功能整体下沉至 `src/features/classroom/LiveSubmissionsPanel.tsx`，保持 Props 契约与单元测试 100% 兼容。
  - **ClassroomToolbarQuickActions 抽取**：将 7 个流程扩展按钮（异常告警、AI 学情预测、随堂协作、投屏对比、家校通知、宏动作编排、硬件网关）与倒计时组件收敛为 `ClassroomToolbarQuickActions.tsx`。
  - **组件精简**：`LiveClassroomView.tsx` 净减少 404 行代码，大幅提升虚拟 DOM 渲染效率与模块可维护性。


- **运行时可靠性与安全收口（阶段 B）：B3 安全随机标识 + B4 内存治理 + B2 统一错误响应 + B5 AI端点防护**：
  - **B3 业务 ID 安全随机化**：彻底淘汰非安全随机数生成（`Math.random().toString(36)`）。
    - `server/presence.ts` 与 `server/routes/workspace.ts`：错误事件 ID 统一采用 `randomId('evt_err_')` 强随机生成器；
    - `packages/core/worker-runtime/service-host.ts`：Worker 连接响应 ID 采用 `crypto.randomUUID()`；
    - `packages/plugins/builtin.ts`：系统资产与资源生成 ID 采用 `crypto.randomBytes(6).toString('hex')`；
    - `packages/plugins/management.ts`：课表与日程编排采用有序安全主键 `uuidv7()`；
    - `packages/core/event-bus/index.ts`：随机事件 ID 优先采用 `node:crypto.randomUUID()`，并在浏览器无 WebCrypto 环境下安全回退。
  - **B4 课时生命周期与内存防爆**：
    - `server/shared-state.ts`：封装 `setActiveSegment(lessonId, segmentId)`，引入 FIFO 500 容量上限与防溢出淘汰机制，杜绝长周期运行内存泄漏；
    - `server/presence.ts`：统一由 `setActiveSegment` 驱动广播段位同步；`DELETE /api/lessons/:id` 联动清理对应课时驻留状态。
  - **B2 错误响应统一与脱敏**：
    - `server/routes/courseware.ts` 与 `server/routes/resources.ts`：收敛遗留的 3 处裸写 500 响应，统一接入 `sendSafeError()`，实现生产环境敏感栈脱敏与开发环境错误透明。
  - **B5 AI 端点限流与稳健保护**：
    - `server/routes/plugins.ts`：为 `/api/ai-providers/test` 挂载 `safeAiLimiter` 限流中间件（带单元测试优雅降级兼容），防止针对大模型探测端点的暴力枚举与连击耗尽资源。


- **前端架构治理（路线图 C1-R4b 终态）：App.tsx 极简入口蜕变（1764 行 → 130 行），下沉业务浮层与数据编排 Hook**：
  - **AppHeader 35 props → 0**：`AppHeader` 升级为 `useOptionalAppData()` 双模取数，并内置 `StudentLiveHeader` 自动路由，支持 0 props 挂载。
  - **独立浮层下沉**：抽取 `ClassroomOverlays`（整合抽问横幅、学生抽中回答模态框、学生端实时互动浮层）与 `ImpersonationBanner`（学生模拟提示条），全面经 Context 消费。
  - **编排逻辑彻底解耦（`useAppComposer`）**：将 App.tsx 内部 10 个 Hook 的依赖组合、信道（ClassroomSyncChannel）、Socket 与长轮询调度、以及 `appData` 对象拼装整体下沉至 `src/hooks/useAppComposer.ts`。
  - **极简入口达成**：`src/App.tsx` 蜕变为纯粹的 Provider 包裹 + 根布局容器（Root View Shell），行数从 1764 行压缩至 **130 行**（压缩率达 92.6%），完全达成 C1 终态 `<500 行` 目标。


- **前端架构治理（路线图 C1-R4a）：RightSidebar 与 AppModals 迁移 AppDataContext（95 props → 0）**：
  - RightSidebar 25 props → 0、AppModals 70 props → 0：两组件全面接入 `useOptionalAppData()` 双模取数，并保留原 Props 接口与默认解构，既支持 0 props 全局挂载，又保持已有孤立单元测试 100% 兼容。
  - AppDataContext 补齐 `AppExtras` 中缺失的模态框与侧边栏局部交互状态（`showRightSidebar`、`rightSidebarTab`、`agentProviderId`、`isTourOpen`、`handleSeedSuccess` 等）；`App.tsx` 注入相应状态上下文。
  - `src/App.tsx` 顶层调用点直接替换为 `<RightSidebar />` 与 `<AppModals />`，消除 95 行重复 props 传参样板代码。


- **前端架构治理（路线图 C1-R3j）：迁移剩余 4 个次级 tab 与 NavigationSidebar，TeacherView 蜕变为 0 props 纯路由分发容器**：
  - NavigationSidebar、TimetableView、ComputerLabView、HelpView、PluginView 全部改经 `useAppData()` / `useOptionalAppData()` 取数，保留 Props 契约兼容孤立测试。
  - TeacherView 内部全部 10 个业务 Tab 以及导航侧栏均以 0 props 挂载；TeacherViewProps 接口收窄为空，TeacherView 蜕变为纯粹的布局与路由分发容器。
  - AppShellProps 收缩为仅 `{ activeRole: 'teacher' | 'student' }`；App.tsx 向 AppShell 装配实参彻底收敛（25 props → 1 prop: `activeRole`）；App.tsx 从 1817 行下降至 1752 行。

- **前端架构治理（路线图 C1-R3i）：清理 TeacherViewProps 与 AppShell 残留死 props**：
  - AppDataContext 与 TeacherViewProps 解耦：AppExtras 从 `Pick<TeacherViewProps, ...>` 改为直接显式定义独立类型，消除循环类型寄生。
  - TeacherViewProps 深度净化：删除 LessonEditorView、LiveClassroomView 与已迁 tab 的 40+ 个残留死字段（selectedLesson/elements/paletteEdit/liveClassFeed/liveClassStudentProgress 等）；TeacherView 仅保留自身直接渲染所需的 24 个导航与次级 tab 属性。
  - App→AppShell 装配瘦身：清除 App.tsx 向 AppShell 传递的全部死属性（实参行数 68 → 25）；TimetableView 统一传 onSchedulesUpdated，PluginView 明确属性传参。

- **前端架构治理（路线图 C1-R3 第二轮）：剩余全部 tab 迁移 AppData**：
  - LiveClassroomView 33 props → 1（仅 initialPortalOpen；students 改为组件内按 classStudentsMap 派生，fetchStudents 组合闭包随迁，onPingStudent 经 context 的 socketRef）
  - CourseManagement 20 props → 0、LessonEditorView 27 props → 0、StudentView 40 props → 0、ClassesView 98 props → 0（保留 ClassesViewProps 作为依赖契约类型，组件内重绑 props = useAppData()）
  - AppExtras 补齐 ClassesView 所需 App 局部字段（roster/batch/expanded/selected 组、classSubmissionFilters、classActiveTabs、assignmentSortOrder、isGrading、studentActiveTabs、setStudents、fetchStudents、setImportError/Success/ShowImportModal）与语义别名（onDeleteCourse/onCopyCourse）
  - AppShellProps 收敛为 TeacherViewProps & { activeRole }；App→AppShell 装配删除全部已迁实参
  - 至此 TeacherView/StudentView 全部 tab 均经 AppDataContext 取数；App.tsx 2341 → 1829 行

- **前端架构治理（路线图 C1-R3 第一轮）：AppContext 地基 + Dashboard/Admin 迁移**：
  - 新增 `src/context/AppDataContext.tsx`：`AppDataProvider` + `useAppData()`。App 仍为唯一数据源（显式构造 AppDataValue 传入，不移动 state 位置）；类型由 9 个 R2 hooks 与既有 hooks 的 `ReturnType` 交集 ∪ AppExtras（Pick 自 TeacherViewProps）推导，零漂移。
  - Dashboard 27 props → 0、AdminDirectoryView 9 props → 0：全部经 `useAppData()` 取用；TeacherViewProps 删除对应字段段（保留 t/lessons/classes/students/addToast 等多 tab 共享字段）。
  - `useAppData` 无 Provider 时抛错防漏接；vitest include 补 `src/context/**`。
  - 后续批次：LessonEditor/LiveClassroom/CourseManagement/ClassesView/StudentView 逐 tab 迁移。
  - 已知取舍：context value 为每渲染新对象（无 memo 受害者，已评估）；onLogout/onAIProvidersChanged 为语义别名。

- **前端架构治理（路线图 C1-R2）：App.tsx 局部函数下沉 9 个自定义 hooks**：
  - `useToast` / `useSystemData` / `useResourceLibrary`（叶子：系统数据、资源库、CSV 与批量导入）
  - `useLessonCrud` / `useClassOps`（课时 CRUD、班级学情五 Map、快捷排课/生成作业）
  - `useStudentViewState`（学生视图状态机：锁定收口 setStudentViewStatus）/ `useStudentOps`（看板/进度/作业提交）
  - `useSessionBootstrap`（DB 心跳、站点设置、登录/登出/语言切换）/ `useClassroomLive`（抽问横幅、提示音、动态流、在线名册）
  - 前置死代码清理：8 个仅写 ref、7 个同步 effect、死函数 fetchAssignmentSubmissions、死 state expandedAssignmentId
  - App.tsx 2341 → 1878 行；hook 间单向依赖（App 冒泡注入）、useAppPolling/useClassroomSocket 签名逐字不变；ClassroomSyncChannel 三处实例与惰性补挂语义保留（红线）
  - 后续：R3 AppShell 227 props 收敛、R4 App.tsx 终态 <500 行

- **前端架构治理（路线图 C1-R1）：App.tsx 内联 fetch 全部服务化**：
  - 29 个内联 fetch 迁入 7 个纯 fetch 封装 service：`sessionService`（resources/db-status/auth session/site-settings/logout）、`lessonService`（lessons CRUD/clone/whiteboard）、`rosterService`（classes/students/class students）、`dashboardService`（class progress/dashboard、student dashboard）、`progressService`（student progress、live progress、read_notifications）、`assignmentService`（submissions、generate）、`systemService`（commands/vfs/processes/logs/schedules POST）。
  - appStore 新增 `loadLessons/loadClasses/loadStudents` action，App.tsx 三个列表拉取改为 action 薄封装（签名不变，useAppPolling/TeacherView props 契约不受影响）。
  - 纯搬移不改行为：各端点响应包裹差异（裸数组/信封/{success,result}）原样保留在 service 层；分支、setState、toast 留在调用方。为 C1-R2（局部函数下沉 hooks）与 R3（AppShell 227 props 收敛）铺路。

- **CSRF 门控 + 错误处理统一 + ID 安全化 + 内存泄漏治理 + AI Provider 可靠性（路线图 Phase B1-B5）**：
  - **B1 CSRF**：新增全局写请求门控 `server/middleware/csrf.ts`（复用 bridge.ts Sec-Fetch-Site/Dest 判定模式）—— cross-site 写请求 403；豁免沙箱课件直连端点（attempts log/submit/adopt，Origin:null）与 /api/auth/login；头缺失放行由 SameSite=Lax 兜底。cookie 原有 HttpOnly+SameSite=Lax 不变。
  - **B2 错误处理**：classroom.ts 32 处裸泄 `e.message` 改 `sendSafeError`；roster.ts 6 处非标准 550 改 500（前端无依赖）；server.ts 新增四参全局 error handler 兜底，生产 500 不泄露内部信息。
  - **B3 ID 安全化**：新增 `server/utils/id.ts` randomId（crypto.randomBytes 8B hex），替换 roster/admin/classroom/grading/resources/schedules/peer-review/runtime-service 共 18 处可预测的 `Math.random().toString(36)` 主键；randomHex 同步改 crypto 源。
  - **B4 内存泄漏**：MF_REMOTE_CACHE 5 分钟 TTL 惰性过期 + 100 条容量淘汰；lessonActiveSegments 在课时结课（stage→ARCHIVED_REPORT）与课时删除时清理；event-bus subscribe 返回取消函数（向后兼容）+ 同类型 >50 订阅告警（index 与 EventRegistry 双实现）。
  - **B5 AI 可靠性**：新增 `packages/core/ai/utils/fetch-with-retry.ts`（30s AbortController 超时 + 429/5xx/网络错误指数退避最多 3 次），接入 ai-agent agent loop 与 provider-gateway。
  - **测试**：csrf.test.ts 8 例、pagination 相关、memory-hygiene 5 例、event-bus-port 2 例、fetch-with-retry 5 例。

- **Breaking Changes**：
  - **列表端点分页信封（A7）**：`GET /api/lessons`、`/api/students`、`/api/classes`、`/api/schedules`、`/api/courseware/attempts` 响应从裸数组改为 `{ data, total, page, pageSize }` 信封。新增 `?page=`（默认 1）与 `?pageSize=`（默认 50，上限 500，`all` 返回全量）参数。需要全量数据的消费方传 `pageSize=all`；前端 10 处消费点已同步追平。子资源端点（如 `/api/classes/:classId/schedules`）本轮维持裸数组。

- **性能：eval-grades 与 assignment.list N+1 查询消除 (`server/routes/lessons.ts`, `packages/plugins/assignment-eval.ts`)**：
  - **问题**（路线图 A5-a/b）：eval-grades 循环内对每条提交各查一次互评与评分（1+2N，200 条提交 = 401 次查询）；assignment.list 的 studentId 分支同样 1+2N。
  - **整改**：改为按 id 分批 500（SQLite 参数上限保护）的 `IN (...)` 批量查询 + Map 归并，聚合语义不变。
  - **测试**：eval-grades 等价性用例（两条提交的互评均分/评分/空值分支）。

- **GET 幂等：attendance-summary 移除假考勤播种 (`server/routes/grading.ts`)**：
  - **问题**（路线图 A4-1，2026-10-01 核实仍在）：`GET /api/classes/:classId/attendance-summary` 会在无课表时随机生成 7 个假课表（sch-auto- 前缀）并按 80/12/8% 比例写入全班假考勤；GET 请求产生写副作用，破坏幂等性，且假数据对教师具有欺骗性。
  - **整改**：两段播种逻辑整体删除，GET 变纯读。真实考勤由课堂流程 / 教师点名写入；前端图表对空数据已有优雅空态；存量 sch-auto- 假数据保留读取，随图表 30 天时间窗自然过滤。
  - **测试**：grading-calculation.test.ts 新增「纯读断言」（GET 前后 schedules 与 sch-auto- 考勤行数不变）。

- **随堂练习并发竞态根治：白板测验计数改事件驱动，新增 quiz-counts 轻量端点 (`server/routes/lessons.ts`, `InteractiveWhiteboard.tsx`, `QuizFullscreenView.tsx`)**：
  - **问题**（路线图 A2 残留）：quiz-submit 仍保留白板元素 data JSON 的读-改-写 —— 同题多名学生并发提交时互相覆盖丢成绩；此前已把权威数据迁入 `lesson_quiz_submissions` 原子 upsert，但 JSON 写入路径未摘除。
  - **后端**：彻底移除 JSON 读改写与降级 catch，关系表为唯一权威；新增 `GET /api/lessons/:id/quiz-counts`（所有登录角色可访问，仅返回各测验元素提交计数，不含答案与学生明细，防学生越权读答案）；删除无人消费的 `whiteboard-sync element-updated` 广播。
  - **前端**：白板测验卡片「N 人已交」计数改为 quiz-counts 拉初始值 + `quiz.answered` 事件实时递增（data.submissions 保留一个版本周期作存量兜底）；QuizFullscreenView 教师成绩明细改从 /quiz-submissions 关系表合并。
  - **行为变更**：全屏测验成绩明细表收窄为教师/管理员可见（明细含他人答案与学生身份，学生可见属越权）；学生提交反馈不变。
  - **测试**：quiz-answered-e2e 新增 2 例（JSON 不再写入 + quiz-counts 无泄露）；quiz-fullscreen 新增 2 例（教师合并、学生不请求明细）。

- **数据完整性：七处多步写操作事务化 + 补五个高频查询索引 (`roster.ts`, `lessons.ts`, `schedules.ts`, `admin.ts`, `migrations/014`)**：
  - **问题**（v0.4.0 路线图 A1/A6，2026-10-01 核实仍未整改）：学生删除（12 条 DELETE）、GDPR 删除、白板 reset、Lab 删除、座位表保存、课表删除、班级导入共七处多步写操作无事务保护 —— 中途失败留下半截数据（如删学生删到一半失败，剩余表残留孤儿行）。
  - **事务化**：全部包裹 better-sqlite3 `db.transaction`；学生删除与 GDPR 删除抽公共 `deleteStudentCascade`（消灭两份 12 条 DELETE 的重复实现，防止口径漂移）。
  - **索引**：migration 014 补 vfs_nodes(parent_id)、plugin_submissions(lesson_id)、student_point_logs(student_id)、student_rollcalls(class_id/student_id)。
  - **测试**：新增 `transactions.test.ts` 3 例（级联删除 12 表无残留、班级导入 UNIQUE 冲突整批回滚、正常导入不受影响）。

- **SSRF 字面量增强 + Socket 层默认密码握手全拒 (`server/utils/url-safety.ts`, `server/middleware/auth.ts`, `server.ts`)**：
  - **SSRF（2026-09-30 审计低危遗留 2）**：`isSafeExternalUrl` 原先只识别点分十进制 IPv4，`[::ffff:127.0.0.1]`（IPv4 映射）、`[fd00::1]`（ULA）、纯十进制整数 `2130706433`、十六进制/八进制编码（`0x7f.0.0.1`、`0177.0.0.1`）等字面量全部放行。补齐：IPv6 括号字面量解析（loopback/未指定/::ffff: 映射/ULA fc00::/7/链路本地 fe80::/10/组播）；inet_aton 语义的整段与四段数值编码归一化（含八进制显式选进制 —— `Number('0177')===177` 的十进制陷阱）。同步签名不变，7 处调用方零改动；普通含数字域名（abc123.com、1x.dev）不误伤。
  - **Socket 改密兜底（2026-09-30 审计低危遗留 3）**：Socket.IO 握手鉴权抽为 `socketAuthMiddleware`（server.ts 与测试共用），带 `mustChangePassword` 标记的会话握手直接拒绝（错误码 FORBIDDEN_DEFAULT_PASSWORD，与 HTTP 层 enforcePasswordChanged 同码）；改密/登出走 HTTP 豁免路径不受影响；test 环境无 token 放行口径原样保留。
  - **测试**：`community-registry.test.ts` isSafeExternalUrl 新增 15 例；`force-password-change.test.ts` 新增 socket 握手 describe 3 例（标记会话拒绝、正常会话/test 放行、改密后恢复连接）。

- **路径安全：抽公共 path-guard 守卫，修复 4 处裸前缀哨兵 (`server/utils/path-guard.ts`, `resources.ts`, `bridge.ts`, `assignment-hub.ts`)**：
  - **漏洞**（2026-09-30 审计低危遗留 1）：`target.startsWith(storageDir)` 裸前缀判断可被同级目录逃逸 —— root=`storage/courseware/res` 时 `storage/courseware/res2/evil.txt` 同样通过校验，可越界写/读文件。
  - **整改**：新增 `server/utils/path-guard.ts`（`isPathInsideRoot` root 补尾分隔符严格前缀 + `safeJoin` 越界返回 null），替换 resources.ts:123 / bridge.ts:127（解包自愈路径，越界条目由静默跳过升级为告警跳过，不阻塞出课）、bridge.ts:152（读路径保持 403）、assignment-hub.ts:450（读路径 404，原尾分隔符哨兵语义等价收敛）。
  - **测试**：新增 `path-guard.test.ts` 13 例（同级前缀逃逸为核心回归）；security_hardening / bridge 既有断言全过。

- **缺考语义与考勤联动：手动标缺考 + 批量补录自动生成 (`server/utils/auto-record-score.ts`, `server/routes/courseware.ts`, `server/routes/grading.ts`, `LiveClassroomView.tsx`)**：
  - **问题**（2026-09-30 审计教学缺口 2c）：成绩体系完全没有缺考语义 —— 教师无法把缺席学生标为缺考，自动录入也不会为缺考学生留痕，结算前只能靠人工记忆。
  - **手动标缺考**：新增 `markStudentAbsent` + `POST /api/courseware/attempts/mark-absent`，写入 `status='absent'`、`score=NULL`、`source='manual'` 的成绩行（幂等）；课堂页「学生提交数据」每行新增「标缺考」按钮。
  - **考勤联动**：批量补录时对「本课节考勤缺考（attendance.status='absent'）且无任何成绩行」的学生自动生成缺考成绩行（`report.absentGenerated` 计数）。
  - **保护链**：自动路径遇 absent 行跳过（absent-protected）—— 学生补交不会冲掉缺考标记；教师改判走手动「录入成绩」显式覆盖。学期结算对 absent 行按 0 分计（与「缺考计 0 分」口径一致，防 NULL 进 reduce 产生 NaN）。
  - **测试**：`auto-record-score.test.ts` 新增 4 例（标缺考写入与幂等、入参校验、考勤联动生成与去重、补交后 absent 保护）。

- **成绩录入来源保护与更新策略：manual/auto 分流 + 最新/最高策略 (`migrations/013`, `server/utils/auto-record-score.ts`, `packages/plugins/courseware-score.ts`, `LiveClassroomView.tsx`)**：
  - **问题**（2026-09-30 审计教学缺口 2a/2b）：实时自动录入无条件 upsert 覆盖 → 教师手改分会被课件分冲掉；批量补录只要已有成绩行就跳过 → 学生重做课件后自动录入的旧分永不更新。根因是成绩行无法区分手动/自动来源。
  - **来源分流**：新增 `assignment_submissions.source` 列（'manual'/'auto'，按 feedback 前缀回填存量）。自动路径遇 manual 行跳过（manual-protected）——手改分永远受保护；手动路径总是覆盖并写 manual（教师显式改判优先）。
  - **更新策略**：新增 `courseware_score_config.auto_record_strategy`（默认 'latest'）。auto 行在学生重做后按策略刷新：'latest' 取最新一次提交分；'highest' 仅新分更高才覆盖（鼓励重做）。教师可在课堂页自动录入规则条上切换。批量补录对同一 (学生, 课件) 只处理最新一条 attempt；skip 分支整体不落库（进度也不推进）。
  - **测试**：`auto-record-score.test.ts` 新增 7 例（来源写入、manual 保护、latest 刷新、highest 保持/覆盖、多 attempt 取最新、skip 不推进进度），1 例改写为新语义。

- **修复：抽人弹窗重复 —— `student-picked` 广播收敛单次投递 (`server/presence.ts`, `src/hooks/useClassroomSocket.ts`)**：
  - **问题**（2026-09-30 审计教学缺口 1）：`teacher-pick-student` 对同一事件做 lesson 房间 + class 房间 + 全局三重投递，学生 socket 同时命中多房间时收到 2-3 次相同事件 → 被抽中学生全屏弹窗/Toast 重复弹出。
  - **服务端**：删除两个房间定向 emit，仅保留 `io.emit`（全局广播本就是前两者的超集，语义等价、每端恰好一次）。白板 rollcall 的独立 emit 保留（独立触发源，已有 DB 幂等）。
  - **客户端兜底**：`useClassroomSocket` 按 `(studentId, pickedTime)` 做 10s 短窗去重，防 rollcall 双发与未来回归；live feed 不去重（条目 id 天然含 pickedTime）。
  - **测试**：`presence.test.ts` 改断言为恰 1 次投递；`useClassroomSocket.test.tsx` 新增 2 例（三连投递只弹一次 + 不同 pickedTime 不误伤连续抽人）。

- **架构分层修复：logger 下沉至 core，消灭 core→server 反向依赖 (`packages/core/observability/logger.ts`, `server/utils/logger.ts`, `layering.test.ts`)**：
  - **问题**（2026-09-25 审计 H-7，2026-09-30 审计架构高危 1，拖逾一版）：`packages/core/worker-runtime/worker-manager.ts` 与 `plugin-host/context-builder.ts` 反向 import `server/utils/logger.js` —— 依赖方向必须是「应用 → 内核」，绝不能反向。
  - **整改**：logger 实现下沉至 `packages/core/observability/logger.ts`（pino multistream，无应用层特有逻辑），`server/utils/logger.ts` 改为兼容 re-export（server 侧当前无生产消费者，仅存量路径保留）。顺带修正 dev pino-pretty `translateTime` 缺失分钟段的笔误（`SYS:HH:ss.l` → `SYS:HH:mm:ss.l`）。
  - **防回归**：新增 `packages/core/__tests__/layering.test.ts` 分层守卫 —— 扫描 core 全部生产源码，任何 `import server/**` 即失败（core 的 `__tests__` 集成测试豁免）。

- **学生默认口令 123456 治理（SEC-AUTH-06b）(`server/routes/roster.ts`, `ClassStudentsPanel.tsx`)**：
  - **漏洞**：`POST /api/students` 在教师未提供密码（或仍填 123456）时硬编码默认口令 `123456` —— 全校通吃的可猜测口令，配合公开学号即可冒充任意学生。
  - **创建侧**：未提供密码时改为生成 12 位随机初始密码（排除易混淆字符），bcrypt 落库，明文**仅在创建响应中返回一次**；前端注册成功弹窗追加「初始密码（仅显示这一次，请立即分发给学生）」提示，并把提示语从「默认 123456」改为「留空将自动生成」。教师显式提供的非 123456 密码行为不变。
  - **登录侧（存量账号）**：学生以个人密码 `123456` 登录成功 → 会话打 `mustChangePassword` 标记，复用 SEC-AUTH-06 全套管线（前端全屏改密门 + `enforcePasswordChanged` 写操作拦截 + 改密清标）。**班级口令登录不打标**（与个人密码无关，且学生可能从未持有个人密码）。
  - **测试**：`force-password-change.test.ts` 新增 2 例（创建即随机口令 + 123456 失效 + 随机口令登录不打标；存量 123456 登录打标 + 写拦截 + 口令登录不打标 + 改密恢复）。

- **默认密码强制改密（SEC-AUTH-06）(`server/routes/roster.ts`, `server/middleware/auth.ts`, `server.ts`, `ForcedPasswordChangeGate.tsx`)**：
  - **漏洞**：种子账号 admin/admin、teacher/teacher 初始化后仅有 console 警告，登录与前端均无强制改密流程，弱口令可被无限期沿用。
  - **打标**：教师/管理员入口登录成功时检测「密码 = 用户名」（默认种子的精确特征）→ 会话写入 `mustChangePassword` 标记，登录响应与 `/api/auth/session` 均暴露（页面刷新后依然强制）。
  - **前端强制**：App 外壳在 `session.mustChangePassword` 时不渲染任何应用内容，改为全屏 `ForcedPasswordChangeGate`（旧密码 + 新密码 + 确认，本地强度/一致性校验，走既有 `POST /api/auth/change-password`）。
  - **服务端兜底**：新增 `enforcePasswordChanged` 中间件 —— 带标记会话发起非 GET 请求（豁免 `/api/auth/change-password`、`logout`、`session`、`me`）一律 403 `FORBIDDEN_DEFAULT_PASSWORD`，防止绕过前端直接调写接口；GET 保持可用（会话恢复需要）。改密成功后当前会话标记清除、其余设备会话删除，写操作即时恢复。
  - **范围界定**：仅覆盖 users 表（teacher/administrator 种子默认密码）；学生默认口令 '123456'（roster.ts 建号）属另一议题。旧存量会话无标记 → 下次登录后生效。
  - **测试**：`force-password-change.test.ts` 4 例（打标、写拦截 + GET 放行 + 非默认账号不受影响、session 暴露标记、改密后恢复）；`ForcedPasswordChangeGate.test.tsx` 5 例（本地校验、提交流程、服务端拒绝）。

- **CSP 收紧：生产 scriptSrc 去 'unsafe-inline'、connectSrc 去任意出站 (`server.ts`, `server/routes/shared.ts`, `bridge.ts`, `courseware.ts`, `resources.ts`, `HtmlAppletFrame.tsx`)**：
  - **收紧内容**：全局 helmet CSP —— ① 生产 `scriptSrc` 移除 `'unsafe-inline'`（SPA 构建产物无内联脚本，已验证 dist/index.html）；② `connectSrc` 移除 `'http: https:'`（等于无出站限制，前端可外传任意数据；前端所有 API 调用均走同源相对路径，已验证）。开发态保留 `unsafe-inline`/`unsafe-eval`（Vite HMR 与 React Refresh 需要）。
  - **为什么此前收不了（CSP 继承）**：`<iframe srcdoc>` 文档与未设自有 CSP 头的 HTML 路由都会**继承父页面（helmet）CSP** —— 直接删 `unsafe-inline` 会拦掉所有第三方课件的内联脚本。整改为此补齐了课件文档的自有宽松 CSP：
    - `shared.ts` 新增 `COURSEWARE_DOCUMENT_CSP` + `setCoursewareDocumentCsp()`（sandbox + frame-ancestors 'self' + 内联放行），bridge.ts / resources.ts / courseware.ts 六处 HTML 直出点统一使用（原先只有 2 处有、且互不一致）；
    - **手写 HTML 课件改造**：HtmlAppletFrame 原用 `<iframe srcdoc>` 承载 `data.code` —— srcdoc 继承父页面 CSP，是全局 CSP 无法收紧的根因。现改为 `POST /api/courseware/inline`（任意登录角色，按内容 sha256 幂等去重，512KB 上限）落库 `system_resources`，经 `/runtime/inline-<hash>/` 加载（自有宽松 CSP + Bridge SDK + 已有的 SEC-AUTH 门控）。落库失败降级回 srcDoc 渲染（HTML 可见、脚本受限于全局 CSP）。
  - **测试**：`courseware-access-token.test.ts` 新增 2 例（inline 幂等落库 + 经 /runtime 加载的 CSP 断言、401/400/413 校验），并在完整链路用例中断言课件响应 CSP 含 `frame-ancestors 'self'`。

- **Socket 层房间归属与白板信令权限校验 (`server/presence.ts`, `server.ts`, `presence.test.ts`)**：
  - **漏洞**：`join-room` 无任何归属校验，任意已登录 socket 可加入任意 `class-<id>` / 课节房间，跨班收听锁屏、全屏、随机点名等课堂广播；`whiteboard-update` / `whiteboard-event` 无角色校验，**学生可向任意课节房间注入绘制与 refresh 事件**（HTTP 侧 `whiteboard.update` 命令有校验，socket 侧裸奔）；`student-acknowledge-pick` 可伪造他人 studentId 确认答到；`enter-lesson` 只校验身份伪造不校验班级归属。
  - **`join-room` 放行规则**：常驻广播房间（`whiteboard-broadcast` / `classroom-broadcast`）对所有人开放；教师/管理员任意房间；学生仅可加入①绑定自己的作业伪课节 `assignment-*-student-<自己>`，②自己所属的班级房间（经 `lookupStudentClassIds`），③开课班级为自己班级的课节房间（经新增 `lookupLessonClassId`，映射查 `classroom_sessions`；未开课的课节返回 null 不设限，自学场景不受影响）。
  - **白板信令同口径**：教师可写任意房间；学生仅可写自己伪课节房间（作业工作区学生作画的合法路径保留）。`whiteboard-event` 被拒时连 EventBus 审计也不写。
  - **`enter-lesson` 补班级归属校验**（同 join-room 口径）；**`student-acknowledge-pick` 补本人校验**（复用既有 `session.userId !== data.studentId` 口径，静默丢弃）。
  - **测试环境兼容**：握手鉴权在 `NODE_ENV=test` 豁免时 socket 无 session，所有新校验遵循既有 `if (session && ...)` 口径直接放行，e2e 流程零影响。
  - **测试**：`presence.test.ts` 新增 10 例（广播房间放行、跨班班级房间拒绝、开课/未开课课节房间、伪课节归属、白板信令角色矩阵、答到伪造拒绝、无会话放行口径）。

- **课件内容路由鉴权：短时签名 token + Sec-Fetch 元数据门控 (`server/utils/courseware-access.ts`, `server/routes/courseware.ts`, `server/routes/bridge.ts`, `InteractiveCoursewareViewer.tsx`, `HtmlAppletFrame.tsx`)**：
  - **漏洞**：`GET /api/courseware/:id` 与 `/runtime/:uuid/*` 完全无鉴权 —— 未认证者可读取任意课件 HTML/文件，且 `/runtime` 的自动登记（INSERT courseware 行）与磁盘自愈写可被未认证 GET 触发（未认证写原语）。两条路由均为课件 iframe 的 src，而沙箱 iframe（无 `allow-same-origin` + `credentialless`）的请求**不带会话 cookie**，无法直接 `requireAuth`（会把所有课件加载打成 401）。
  - **两步 token 鉴权**：已认证父页面经 `GET /api/courseware/:id/access-token`（`requireAuth()`）铸造 `<exp>.<hmac(id,exp)>` 短时 token（HMAC-SHA256 + timing-safe 验签，密钥每进程启动随机生成，默认 30 分钟有效），iframe src 以 `?ct=` 携带，路由验签（与 id/uuid 绑定 + 有效期）后放行。`/api/courseware/:id` 的 401 判定位于 courseware 行自动登记**之前**。
  - **`/runtime` 的放行规则更宽**（需服务子资源与多页导航）：有效 token｜`Sec-Fetch-Site: same-origin`（父应用同源上下文）｜`Sec-Fetch-Dest` 存在且非 `document`（沙箱 iframe 内发起的子资源/子框架请求——opaque initiator 的 Site 恒为 cross-site，只能以「浏览器自动添加了 Dest 元数据且非顶级文档导航」判定）。地址栏直连与 curl（无元数据）→ 401；`HtmlAppletFrame` 挂载时铸造 token 作为旧浏览器兜底。
  - **`frame-ancestors 'self'`**：`/runtime` HTML 响应的自有 CSP 原先不含 frame-ancestors（覆盖了 Helmet 全局头），外部站点可任意 iframe 嵌入课件内容，已补上。
  - **已知残余风险**：非浏览器客户端可伪造 Sec-Fetch 头绕过元数据判定（但无法伪造 HMAC token）——课件资源本身非机密数据，接受。
  - **测试**：`courseware-access-token.test.ts` 9 例（签名工具 + 路由门控，含无 token 不产生写副作用）；`bridge.test.ts` 补 2 例（无 token/伪造/绑错 id 401、Sec-Fetch 放行与 Dest=document 拒绝）并断言 CSP 含 `frame-ancestors 'self'`。

- **LMS Bridge 仅信任受管辖课件 iframe (`src/services/lms-bridge.ts`, `InteractiveCoursewareViewer.tsx`, `HtmlAppletFrame.tsx`, `SystemResourceLibraryModal.tsx`)**：
  - **漏洞**：`processLmsMessage` 顶层来源校验只要求「`event.source` 是文档中的任意 iframe」—— LTI 外链、插件 blob、资源预览等第三方 iframe 同样能通过，可伪造 `LMS_SUBMIT` 以任意 `attempt_id` 提交分数（后端 attempt 归属校验限制了越权范围，故为中危而非高危）。
  - **为何不用 origin 白名单**：沙箱课件运行在不透明 origin（`event.origin === 'null'`）中，没有可白名单的具体 origin 值。改用更严格的 **source → 受管辖 iframe 绑定**：新增 `isFromManagedIframe()`，顶层校验、`attemptId` 回读、`LMS_GET_PROGRESS` 定向响应三处均只信任带 `data-lms-bridge` 标记的 iframe（或同窗口自身）。
  - **标记宿主**：`data-lms-bridge="true"` 加在三处合法发送方—— `InteractiveCoursewareViewer`（`/api/courseware/:id`）、`HtmlAppletFrame`（`/runtime/:uuid/` 与 `srcDoc` + Bridge SDK）、`SystemResourceLibraryModal` 资源预览（`/api/resources/` 路由同样注入 `injectLmsSdk`）。新增课件 iframe 宿主时**必须**带此标记，否则课件上报会被静默丢弃。
  - **测试**：新增 `src/services/__tests__/lms-bridge.test.ts` 5 例（未标记 iframe / 未知外部窗口的消息丢弃且不触发任何请求、合法 iframe 的 adopt+submit 链路、`LMS_GET_PROGRESS` 仅响应受管辖 iframe）。

- **课堂事件投递口径统一为「课节房间 + 常驻课堂广播房间」，并接上点名评价消费端 (`server/presence.ts`, `server/routes/classroom.ts`, `server/routes/roster.ts`, `server/services/classroom-*-service.ts`, `useClassroomSocket.ts`, `docs/classroom-time-flow-audit.md`)**：
  - **幽灵房间（13 处，已修）**：客户端加入的课节房间是**裸 lessonId**（`presence.ts` `socket.join(data.lessonId)`、`InteractiveWhiteboard` `join-room(lessonId)`），但服务端 13 处投到带前缀的 `lesson-${lessonId}` —— 无人加入的房间。其中 11 处后面紧跟 `io.emit(...)` 全局广播把失效**掩盖**了，功能看似正常、代价是全平台串流量。
  - **实现**：`presence.ts` 成为房间口径唯一真源，新增 `CLASSROOM_BROADCAST_ROOM`（与 `WHITEBOARD_BROADCAST_ROOM` 同构，连接即加入，停在仪表盘的学生也能收到并预热）、`classroomEventRooms()` / `emitClassroomEvent()`。13 处投递全部改走统一入口。
  - **⚠️ 避开的关键陷阱**：11 处原本是「幽灵房间 + 紧跟的全局 `io.emit`」，**只改房间名而不处理 `io.emit` 会让同一事件推送两次**。因此做的是替换而非新增 —— 删掉那 11 行，由 `emitClassroomEvent` 一次性投两房间；`server/__tests__/classroom-event-rooms.test.ts` 把「只发一次」钉死。
  - **`classroom:exit_ticket_submitted` 从完全失效到可用**：此前是唯一「只投幽灵房间、无全局兜底」的课堂事件，学生交结课通票后教师大屏永远收不到，只能刷新页面。
  - **收敛同概念双事件名**：`classroom:stage_event` 全平台零监听（含插件目录），删除该重复投递，只保留 `classroom:stage_changed`。
  - **修正一处「测试锁死了 bug」**：`classroom-runtime-service.test.ts` 原先把错误房间名 `lesson-les_101:classroom:stage_changed` 当作正确行为断言，已改为断言正确房间（`les_101` + 广播房间 + `class-cls_1`）。
  - **点名评价 / 金币接上消费端**：`POST /api/rollcalls/evaluate` 一直在发 `rollcall:evaluated` 与 `student:coins_awarded`，但前端**零监听** —— 教师给学生评价并发金币，学生端一条提示都收不到。现由 `useClassroomSocket` 消费：被评价者收到「徽章 + 评价 + N 金币到账」并刷新学情，全班其他学生收到轻量播报，两者都进课堂动态流；文案复用 `fair-picker-engine` 的 `EVALUATION_CONFIGS` 不另抄一份。**刻意只订阅 `rollcall:evaluated`** —— `student:coins_awarded` 与它同源同动作，同时订阅会双重提示。
  - **`ClassroomSyncChannel` 改为订阅 socket 就绪（跨机监听恢复）**：原先在构造函数里 `getOptionalSocket()` 抓 socket 注册 `classroom:sync_message` 监听，而 socket 在 `useClassroomSocket` 的 effect 里才注入，React passive effect **子先于父**执行 → `StudentCountdownBanner` / `LiveClassroomView` / `LessonEditorView` 三处构造的 channel **跨机监听永久缺失且不报错**。因 `postMessage` 每次都重新取 socket，症状是「发正常、收静默失效」的不对称故障；同机多标签页因 BroadcastChannel 是独立通路而完全看不出来。新增 `socket-service.onSocketInstance()`（订阅 socket 就绪、已就绪则立即同步调用）作为共享原语，channel 改由它驱动绑定，并保留 `onMessage`/`postMessage` 的换绑以覆盖重连换实例。**实施中自我修正一次**：最初写成「收发前惰性补挂」不完整 —— 纯接收方（学生端只收不发）永不调 `postMessage`，补挂必须由「socket 出现」驱动。
  - **学生端倒计时直连服务端权威事件**：`StudentCountdownBanner` 新增 `classroom:countdown_updated` 订阅（此前它只有同机 BroadcastChannel / 同文档 window 事件 / 挂载瞬间 GET 三个弱数据源，而该 socket 事件只有教师端大屏在监听 —— 教师中途启动的倒计时远程学生永远看不到），并按 `payload.lessonId` 过滤。
  - **`hasFinishedAlerted` 按 `endsAt` 复位**：此前置 true 后无复位路径，第二次倒计时结束不再响提示音、横幅永久停在「时间已截止」。用 `endsAt` 而非时间戳判定新一轮：暂停/恢复不改 `endsAt`，而 `start` / `add_time` 一定给出新的 `endsAt`。
  - **删除 `spotlight:*` 空路由**：冒号/点号双拼写两条路由**全仓无 producer、无 consumer**（含插件目录），注释所称「双轨兼容」保护的是一个不存在的两端，留着只会让后来者误以为聚焦已打通。已在原位留下说明注释。
  - **`classroom:points_awarded` 接上消费端**：该事件此前全平台零监听，具体症状是教师在**已打开的**「学生成长档案 / 积分榜」弹窗里加分后，弹窗 toast「成长积分已发放」但**界面数字不刷新**（提示说成功、数字却还是旧的），被加分的学生端也收不到提示。新增 `store/pointsLedgerStore.ts`（zustand vanilla，与 `whiteboardViewStore` 同构）作为跨层信号 —— 消费端分处 `useClassroomSocket`（socket 生命周期所在）与深层弹窗之间，后者拿不到前者的返回值。`useClassroomSocket` 消费该事件：因是全局广播（积分是账户级事实、不隶属课节），**只有被加分的那个学生**收到 toast（否则全平台弹窗即噪音），扣分走 warning；所有人写入 store 供已打开的积分类 UI 自行 refetch。`StudentGrowthProfileModal` 把 `pointsVersion` 纳入取数 effect 依赖，积分一变即重拉。**更正此前的去重提醒**：查证后确认与 `student:coins_awarded` 当前不重叠（点名评价只写 `student_rollcalls.reward_coins`，不写 `points_ledger`），已在 store 注释写明「若将来把点名金币迁到台账需加去重」。
  - **`classroom:icebreaker_updated` 接上消费端，并修掉一个本轮自己引入的回归**：破冰心情统计的展示面 `PreClassDiagnosticHub` 位于 `PreClassReadyView` → `LiveClassroomView` → **`TeacherView`**（纯教师端 UI，学生只打卡不看统计）。但**班级房间此前只有学生在 `register-student` 时加入**（服务端 `presence.ts`），教师只 join 两个常驻广播房间 —— 也就是说上一轮把该事件从全局 `io.emit` 收窄为投班级房间时，等于**把它对唯一消费方屏蔽掉了**。收窄方向对，但漏了投递对象：现教师端也 join 当前所教班级房间（用既有通用 `join-room`，服务端无需为教师新增分支；班级 id 取自 app store 的 `liveClassSelectedClassId`，属「当前视图」而非会话属性）。随后 `PreClassDiagnosticHub` 组件内直接订阅该事件（经 `onSocketInstance` 等待 socket 就绪）—— 事件 payload **自带 stats**，直接采用而不必重拉诊断接口。已知取舍：服务端无通用 `leave-room`，教师切换班级会累积旧班级房间，因消费端一律按 `classId` 过滤故功能无影响，未为此新增服务端接口。
  - **`classroom:groups_changed` 数据源统一后接线**（`ClassroomLeaderboardModal`）：查证发现一个决定性事实 —— **`students.group_name` 全仓从未被写入**（服务端无 UPDATE、前端无赋值），故小组联赛虽按它分组，实际**始终只渲染出一个「未分组」桶**。这不是实时层问题而是**数据源分叉叠加「其中一条链是空的」**。现改读 `GET /api/classes/:id/groups`（`class_groups`）：真实分组数据（`name`/`name_en`/`color`/`leader_id`/`memberIds`）接入，成员按 `memberIds` 与花名册**按学生 id 求交集**（分组方案可能引用已转学学生，静默忽略）；`groups_changed` 顺带可接（此前接了也没用，那个 UI 读不到 `class_groups`），组件内订阅 + 按 `classId` 过滤 + 变更即重拉。**零回归风险** —— 旧数据源本来就是空的。个人英雄榜的小组标签也改为同一真源。**保留原有「不编造」原则**：无分组数据时展示明确空态，不回退到 `students.groupName` 也不编造队名（回退正是这次歧义的来源），接口失败同样落到空态 + `console.warn` 而非静默切回旧源。
  - **测试**：`ClassroomLeaderboardModalGroups.test.tsx` 8 例（该组件**首份**测试覆盖：真实分组与成员、请求路径、空态不编造、接口失败不抛错、已转学成员被忽略、`groups_changed` 重拉、跨班级事件忽略、个人榜标签同源）；`PreClassDiagnosticHubIcebreaker.test.tsx` 4 例（socket 晚到仍可达、按 classId 过滤、畸形 payload 忽略、卸载解绑）；`useClassroomSocket.test.tsx` 新增 4 例（教师 join 班级房间 / 学生不走这条路径 / 未选班级不 join / 常驻广播房间始终在）—— **这组正是上述回归的护栏**。
  - **`exambank-*` 保留并补注释**：这两条路由是**平台为外部插件预留的契约**（考试银行插件不在本仓），不是悬空代码 —— 与被删的 `spotlight:*` 性质不同（后者是「曾经有过、现在两端都空了」，前者是「插件还没进这个仓」）。已在路由表原位写明：consumer 在插件侧、后续会继续扩展、请勿删除，避免下一个走查的人误判并删掉。

- **白板实时同步：按元素类型声明广播策略 + 删除永不生效的 socket 桥 (`server/event-routing.ts`, `server/presence.ts`, `src/services/event-bus.ts`, `MathGraphWrapper.tsx`, `CodeSandboxWrapper.tsx`, `docs/whiteboard-realtime-sync-audit.md`)**：
  - **P0 广播策略（服务端）**：`whiteboard.element_updated` 原是纯 effect-only 路由（`rooms: () => []`），但它同时承载拖拽/缩放等高频几何更新与改题面/改代码/翻幻灯片等语义型内容更新 —— 后者必须让学生看到。现改为按元素类型的**声明式**策略：落在 `LAYOUT_ONLY_ELEMENT_TYPES`（`text`/`rectangle`/`rect`/`circle`/`shape`/`pen`/`highlighter`/`page_meta`）里的静默，其余一律广播。**默认方向是 fail-safe** —— 未登记的新类型最多多刷一次，不会静默不同步。
  - **落点与初稿不同（走查后修正）**：原计划在 `LiveClassroomView` / `LessonEditorView` 两个前端宿主判断，实施时发现两条持久化路径形态不同（前者直接 PUT，后者走 800ms 防抖 autosave），但**都汇聚到 `whiteboard.update` 命令**。判定因此下移到服务端路由：元素 `type` 本就在 `whiteboard_elements` 行里，一次覆盖两条路径且判定逻辑只有一份。点名不走默认策略 —— `persistRollcallPick` 返回「本次是否新抽中」，只有真正抽中新学生才补广播，拖拽/缩放不触发。
  - **P0.5 顺带修掉两处「服务端在广播、组件却读不到」的同类 bug**：`code-sandbox`（`code`）与 `math-graph`（`equation`）同样把 `data` 语义字段缓存进 `useState` 且无回填。只做 P0 会让它们**看起来**修好了却依然不同步，故按 `RevealPresentationWrapper` 的既有范式补上回填 effect。
  - **P3 删除死代码桥**：`frontendEventBus` 的 `setSocketBridge` / `hasSocketBridge` / `SOCKET_FORWARD_PREFIXES` 从未生效（全仓库零注入点），却让读代码者误以为 `whiteboard.*` / `rollcall.*` 等事件会跨端传播 —— 随机点名的排查正是被它误导的先例。已删除并在 `event-bus.ts` 顶部写明「仅限当前浏览器进程内」，同时指向两条真正接线的跨端通路。新增测试断言这三个成员不存在，防止被重新伪装。
  - **影响面界定（更正上一轮的过宽判断）**：第三方插件**不受**该死通道影响 —— `FrontendPluginContext.services` 只有 `frontendApi`/`socketService`/`uiService`/`storageService`，**没有 `eventBus`**，误用会被 TypeScript 拦下；SDK 中带 `eventBus` 的两处上下文均属服务端且已接线。
  - **`whiteboard-event` 通道房间口径对齐 + 修掉一处「即使接线也失效」的缺陷**（`server/presence.ts`）：改为投 `lessonId + whiteboard-broadcast`（原先只投课节房间，停在仪表盘/作业工作区/课件标签页的学生收不到）；并补上原 payload 缺失的 `roomId` —— `useClassroomSocket` 的处理函数是 `if (type === 'refresh' && roomId)`，缺 `roomId` 会静默丢弃。`WHITEBOARD_BROADCAST_ROOM` 上移到 `presence.ts`，`event-routing.ts` 改为 re-export，房间名收敛到单一来源。
  - **`html-applet` / `plugin` 经查实不在范围内**：`html-applet` 渲染时不传 `onElementUpdate`，状态不落白板元素，走 `courseware-attempt-updated` 专用事件 + 自行重拉（目标形态样本）；`plugin` 的 `PluginCardRenderer` 不接收 `data`，以 `elementId` 为键持有自有状态。
  - **测试**：`realtime-bridge` 新增 15 个用例（布局型×6 静默、语义型×6 广播、未登记类型默认广播、缺 elementId、元素已不存在）；新增 `widget-data-sync.test.tsx` 与 `event-bus.test.ts`；`presence.test.ts` 行为契约断言同步更新。
  - **P1 房间口径全量对齐 + 堵掉伪课节隐患**（`server/event-routing.ts`）：`element_deleted` / `cleared` / `batch_drawn` 与 `whiteboard-event` 均改投 `lessonId + whiteboard-broadcast`，四条白板刷新通路口径就此一致 —— 停在仪表盘的学生不再收不到删除/清空通知。同时补 `isRealLessonRoom()` 守卫：作业工作区的伪课节 id `assignment-<id>-student-<studentId>` 只投自己的房间，不进广播房间。否则全平台客户端会无意义重拉，且客户端处理器会把「当前没有选中课节」的学生拉进一个并不存在的课节视图（`setSelectedLesson(roomId)` + `setStudentViewStatus('lesson')`）—— 该隐患原本已存在于 `element_drawn`，本次扩大范围会放大它。
  - **仍待处理**：无。P0 / P0.5 / P1 / P2 / P3 均已实施。

- **白板实时同步通路审计：两条死通道定性，语义型组件同步缺口成册 (`docs/whiteboard-realtime-sync-audit.md`)**：
  - **发现一：前端事件总线的 socket 桥从未接线。** `frontendEventBus.setSocketBridge()` 全仓库零调用点，导致 `InteractiveWhiteboard` 中 30+ 处 `frontendEventBus.publish({ type: 'whiteboard.element_updated' })` 全部是空操作 —— 既无本地订阅者，也不上行服务端。`SOCKET_FORWARD_PREFIXES` 这段为跨端转发准备的白名单从未生效，`rollcall.picked` / `rollcall.evaluated` 同样没有上行。
  - **发现二：服务端有一个功能完整但零调用方的广播通道。** `server/presence.ts:130` 的 `whiteboard-event` 处理器已实现「写入 EventBus 审计 + 广播 `refresh`」，payload 类型甚至带 `elementId` / `elementType`，但只有测试代码触发过它 —— 一条写好却从未接线的通路。
  - **唯一活着的同步通路**：教师端任何图元写入必须走 `onElementUpdate` → `PUT` → `whiteboard.update` 命令 → DB → 服务端 EventBus。绕过它的广播一律无效。学生端另有 2 秒轮询兜底（`useAppPolling`），故「最终一致」成立、「实时」不成立；而把 `data` 缓存进 `useState` 且不回填的组件连兜底都失效。
  - **确认另有两处「点名同款 bug」**：`MathGraphWrapper`（`equation`）与 `CodeSandboxWrapper`（`code`）同样把 `data` 语义字段复制进 `useState` 且无回填 effect，教师改公式/改代码后学生端不更新。`RevealPresentationWrapper` 走查后确认**已有**回填 effect（是正面对照样本，本次点名修法与它同构），非 bug。
  - **房间口径不一致**：`element_deleted` / `cleared` / `batch_drawn` 只投课节房间，而 `element_drawn` 同时投 `whiteboard-broadcast`；不在课节视图的学生（停在仪表盘）收不到删除/清空通知。
  - **`whiteboard-event` 通道房间口径对齐 + 修掉一处「即使接线也失效」的缺陷**（`server/presence.ts`）：该处理器原先只投课节房间，现改为 `lessonId + whiteboard-broadcast`，与 `element_drawn` 一致；同时补上原 payload 缺失的 `roomId` —— `useClassroomSocket` 的处理函数是 `if (type === 'refresh' && roomId)`，缺 `roomId` 会静默丢弃这条刷新。`WHITEBOARD_BROADCAST_ROOM` 常量上移到 `presence.ts`（低层模块），`event-routing.ts` 改为 re-export，房间名收敛到单一来源。同步更新 `presence.test.ts` 的行为契约断言。
  - **原「待确认」三项已全部查实，无阻塞项**：
    - `html-applet`（互动课件）**不在问题范围内** —— `InteractiveWhiteboard` 渲染它时根本不传 `onElementUpdate`，状态不落白板元素；成绩浮层自行 `GET /api/courseware/attempts` 并主动订阅 `courseware-attempt-updated` 自动重拉，权威生产者在服务端。这是「专用事件 + 专用重拉」的目标形态样本。
    - `plugin` / `hello-world` **不在问题范围内** —— `PluginCardRenderer` 不接收 `data`（props 只有 `pluginId/slot/widgetId/elementId/lessonId`），插件以 `elementId` 为键持有自有状态，跨端同步由插件自行负责。
    - 死通道**不影响第三方插件** —— `FrontendPluginContext.services` 只有 `frontendApi`/`socketService`/`uiService`/`storageService`，**没有 `eventBus`**，插件误用会被 TypeScript 拦下；SDK 中带 `eventBus` 的两处上下文均属服务端且已接线。影响面仅限一方前端代码。
  - **产出**：审计文档给出「哪些图元更新需要广播」的三条判定准则、15 类元素的逐项结论（已验证 / 待确认分列）、P0–P3 建议与风险表。P0 建议接线已有的 `whiteboard-event` 通道而非继续在路由表里逐类型开洞。

- **备课随机点名：学生端与教师端状态同步 + 点名提醒改为屏幕级强提示 (`event-routing.ts`, `RollCallWrapper.tsx`, `useStudentNotifications.ts`, `useClassroomSocket.ts`, `App.tsx`)**：
  - **同步断链根因（两处，缺一不可）**：
    - **服务端从未广播**：`whiteboard.element_updated` 是 effect-only 路由（`rooms: () => []`），拖拽/缩放等高频更新刻意不广播以避免学生端反复全量重拉。教师抽中后该事件虽被 `handleRollcallElement` 消费（落库 + `student-picked`），但**没有任何 socket 投递**，学生白板因此永远不重拉元素。现在在**真正抽中一名新学生**（`rollcallId` 未落库）时补发一次 `whiteboard-sync` refresh 到课节房间 + `whiteboard-broadcast` 房间；拖拽等无谓更新仍不触发，全量重拉开销为零。`element_drawn` 路径本身已广播 refresh，不重复补发。
    - **组件从不回读 `data`**：`RollCallWrapper` 用 `useState(data.selectedStudent)` 初始化，抽中结果只写本地 state，学生端（`readOnly`）没有任何回填路径，即使 `data` 变了也渲染上一次的学生。新增以 `pickedTime + selectedStudent.id + evaluation` 为签名的反向同步 effect，并用签名去重避免教师端自己的写回把正在播放的滚轮动画打断。持久化改用 `dataRef` 读取最新 `data`，消除异步回调用闭包旧值覆盖服务端状态的可能。
  - **点名提醒不再进入通知消息**：`useStudentNotifications` 移除 `rollcall_picked` 条目，铃铛下拉与未读角标只保留作业类消息；被抽中提醒继续走既有的屏幕级通道——全屏聚焦弹窗（呼吸光环 + Web Audio 上升和弦 + 强提醒 Toast + 一键答到）与仪表盘点名警报区。同时补全答到闭环：在全屏弹窗确认答到时按 `rollcallId` 标记已读并落库，避免同一次点名在弹窗与仪表盘两处重复提醒。
  - **测试**：新增 `useStudentNotifications` 测试锁定「点名不得出现在通知列表」；`RollCallWrapper` 新增 3 个用例（学生端跟随教师换人、跟随教师评价、教师端乐观更新不被旧 `data` 打回）并补上该文件缺失的 RTL `cleanup`；`realtime-bridge` 新增 2 个用例（抽中补发刷新、非抽中更新不刷新）。

- **课堂互动随机抽问：全网双轨广播信令打通与全班/被抽中学生强弱分层提示 (`presence.ts`, `classroom-sync-channel.ts`, `useClassroomSocket.ts`, `App.tsx`, `LiveClassroomView.tsx`)**：
  - **信令全网双轨广播**：在教师端「学生专注力监控」控制台点击「抽问」时，由 `ClassroomSyncChannel` 结合 Socket.IO 向全网派发 `teacher-pick-student` 事件；服务端 `server/presence.ts` 增加角色鉴权与全局/房间分发（`student-picked`），打通跨机远程真实学生端。
  - **被抽中学生端着重提示**：
    - 弹出全屏强交互聚焦模态框，设计金黄呼吸光环（`border-4 border-amber-500 shadow-2xl ring-8 ring-amber-500/20`）、动态波纹图标与专属姓名高亮徽章；
    - 触发 Web Audio API 专属上升和弦提示音（Chime），防止学生分心漏听；
    - 弹出高优先级强提醒警告 Toast（“⚡️ 闪电抽问：老师抽中了你！请立即集中注意力参与课堂回答”）；
    - 提供一键交互「🙋‍♂️ 我已准备好 / 确认答到 (反馈给老师)」按钮，点击后向教师中控台回发 `student-acknowledge-pick` 举手答到信号。
  - **全班其他学生端同步提示**：
    - 全班其他学生端同步弹出友好通知 Toast（“🎯 课堂随机抽问：老师在课堂中随机抽中了【XXX】同学回答问题！”）；
    - 顶部居中渲染带呼吸光效的浮动播报胶囊横幅（8 秒自动淡出或手动关闭），让全班第一时间获知发言同学姓名。
  - **回归与单元测试**：在 `server/__tests__/presence.test.ts`、`src/hooks/__tests__/useClassroomSocket.test.tsx`、`src/services/__tests__/classroom-sync-channel.test.ts` 补全 100% 覆盖的测试断言。

- **测试数据清理加固与班级测试学生数据恢复 (`scripts/cleanup-test-data.mjs`, `e2e/classroom-interactive-flow.spec.ts`)**：
  - **通配符误伤根因排查**：查明上一轮清理测试课程时清理脚本使用 SQLite `name LIKE '测试学生_%'`，由于 `_` 在 SQL LIKE 中代表单字符通配符，意外误删了系统示范班原有的正式测试学生 `测试学生A`~`测试学生E`（学号 `TEST001`~`TEST005`）。
  - **无损数据恢复**：从系统插件元数据中提取原始快照，以原有 UUID、姓名与学号完整恢复 5 名学生，重新无缝连结其历史课堂点名、答题与加分记录；同时修复孤儿学生「小明」(`S001`) 的班级绑定，重新将 6 名学生完整关联至「人工智能与创意编程示范班」与「test」班。
  - **防护加固**：清理脚本与 E2E 规格中的测试学生过滤模式升级为严格匹配时间戳格式 `STU_%-%`，彻底杜绝自动化清理误伤常规学生数据。

- **测试套件与架构审计闭环修复 (`e2e/global-setup.ts`, `e2e/global-teardown.ts`, `playwright.config.ts`, `scripts/cleanup-test-data.mjs`, `src/components/__tests__/TimetableSubviews.test.tsx`, `src/features/whiteboard/utils/pagination-utils.ts`)**：
  - **E2E 遗留测试课程与数据生命周期隔离**：增加 Playwright 全局 setup 与 teardown 生命周期钩子，在测试前后自动隔离并彻底清理测试课程与临时测试探针，避免 E2E 测试课程堆积污染用户课程列表。
  - **测试审计报告遗留问题修复**：完成测试审计报告要求的治理项，修复白板分页计算工具、课表子视图拆分测试、AI 规划器、课件打分抽取与 Tailwind 扫描测试用例，保证测试套件完整健壮。

- **测试体系审计：补上认证链路的负面测试，修复 4 个存活的变异**：
  - **审计方法**：覆盖率会骗人 —— 一段代码被执行到不代表它被验证过。因此向生产代码注入 11 个真实 Bug，观察测试套件能否发现。**结果是 8 个存活（变异存活率 73%）**，且存活名单里包含完整的认证绕过：把 `server/routes/roster.ts` 教师入口的 `verifyPassword(...)` 结果替换成硬编码 `{ valid: true }`（即任何密码都能登录），当时全量 2243 个测试**依然全绿**。
  - **根因一：登录负面路径完全无覆盖**。全仓库 `grep "Incorrect password|wrongPassword|badPassword" --include=*.test.ts` **零结果**。既有测试只覆盖成功路径 —— `class-passcode-auth.test.ts` 的 7 次 `/api/auth/login` 全部走**学生入口**；3 个 Playwright spec 一律用正确的 `admin/admin` 且只断言 `ok()` 为真。教师入口 `verifyPassword()` 的错误密码路径从未被验证。
  - **根因二：测试覆盖了代码路径，但覆盖的是不产生差异的部分**。`security_hardening.test.ts:87` 确实调用了 `getActorId`，但用 `stu_alice` 这种不含 `:` 和空白的 userId —— `auth.ts` 的 actorId 净化（`.replace(/[:\s]/g, '_').slice(0, 64)`）对它的输出毫无影响，所以删掉净化逻辑断言结果不变。这是「假测试」的典型形态。
  - **修复一**：新增 `server/__tests__/auth-login-negative.test.ts`（18 个用例）。建立**能区分对错的成对断言** —— 每个负面用例配一个正向对照，确保测试在「校验逻辑被删除」时变红、在「校验逻辑正常」时变绿。覆盖：教师入口错误密码 / 空密码 / 大小写错误 / 跨账号密码 / SHA-256 旧哈希账号的正确与错误密码及自动升级、禁用账号即使密码正确也必须 403、入参门禁、未知 entrance；学生入口错误密码与不存在的学号。并断言**任何失败的登录尝试都不得写入 `client_sessions`**。
  - **修复二**：新增 `server/__tests__/auth-middleware-hardening.test.ts`（33 个用例）。用**真正含注入字符**的输入锁死加固行为：`usr_a:administrator` / `usr b\tc` / `usr_d:student:administrator` 三种注入均被净化且 actorId 分段数恒为 3；200 字符 id 截断到 64；`superadmin` / `ADMIN`（大小写变体）/ `root` 全部降级为 `anonymous` 且无法通过任何特权角色门禁；过期 session 被删除；`requireAuth('admin')` 与 `('administrator')` 等价。
  - **反向验证（变异重注入确认）**：MUT-N1（登录不校验密码）、MUT-N4（禁用账号可登录）、MUT-M2a（删除 role 白名单）、MUT-M2b（删除 actorId 净化）—— 修复前 4 个全部存活，修复后 4 个全部被杀。
  - **同时修正了 4 处「我写错了预期」**：教师空密码实际是 400（`!password` 门禁先命中）而非 401；未知 entrance 实际是 400 `'Unsupported entry type'`；cookie `=` 前有空格时 `getCookieToken` 返回 null（当前是严格匹配，真实浏览器按 RFC 6265 不会产出这种形式）；非法角色在 `requireAuth()` 无参门禁下会被放行（无参只校验「已登录」，角色鉴权靠 capability 层）。全部按**断言真实且正确的行为**修正，未放宽任何断言。

- **统一两种「全屏」的内容来源：白板全屏改为渲染真实组件，不再降级为简化版**：
  - **先纠正上一轮的一处错误结论**：我当时判断「`fullscreenRendererRegistry` 从未被注册，所有组件都落到 `DefaultFullscreenRenderer` 字段预览兜底」。这个判断是错的 —— 注册调用在 `InteractiveWhiteboard` 顶部（不在注册表文件内），实际有 5 个宿主内置渲染器。但**结论方向不变，甚至更糟**：那批渲染器是**逐类型手写的第二套实现**，与画布内的真实组件已经漂移。最直接的证据是 `assignment` 的全屏版渲染出一个 `Upload File` 按钮 —— **没有任何 `onClick`**，而画布内的真实组件是「提交作业」且绑定真实提交弹窗；`rollcall` 全屏版只剩一个被抽中的姓名，丢掉了全部操作能力；`timer` 是纯文本倒计时。
  - **改为宿主注入真实组件**：`FullscreenOverlay` 新增 `renderContent(size)` 逃生口（与 `BrowserFullscreenHost` 同一模式），由 `InteractiveWhiteboard` 复用 `renderElement` 渲染。两种全屏从此看的是同一个组件，不会再各自漂移。
  - **注册表区分两条通道**：新增 `registerHostBuiltin` 与 `getEffectiveRenderer`，只有**插件注册**的或**明确标记为宿主内置**的渲染器才生效；早期用 `register` 无 `pluginId` 注册的那批不再生效。`quiz` 改走 `registerHostBuiltin` 保留 —— `QuizFullscreenView` 并非简化版，而是带提交、评分与成绩表格的完整实现，且有独立单测覆盖。
  - **修复一个上一轮引入的真实回归（浏览器全屏在真机上会白屏）**：`renderElement` 返回的是 konva 节点，而 konva 的 reconciler 依赖 `<Stage>` 提供的 `FiberProvider` 上下文 —— 直接放进普通 DOM 容器会抛 `useFiber must be called within a <FiberProvider />`，真机表现是进入全屏瞬间整页白屏。上一轮的测试之所以「通过」，是因为把 `react-konva` 整个 mock 掉了。新增 `WidgetFullscreenStage` 作为承载层，两种全屏共用。
  - **顺带修掉「全屏内容闪一帧空白」**：内容区尺寸改用 ref 回调 + `useLayoutEffect` 同步实测（`clientWidth/clientHeight` 扣除内边距）。原先依赖 `useEffect` 测量，而内容经 `createPortal` 渲染、与宿主 effect 不同步，首帧常读到 `null` 导致尺寸停在 0，konva Stage 不挂载。
  - **回归测试**：新增 6 个集成路径用例（真实组件渲染 / Stage 包裹 / 插件通道优先级 / 浏览器全屏 Stage 包裹）。**反向验证**：回退修复后 3 个用例失败。另为 `WidgetTitleBar` 的白板全屏按钮与 assignment 真实提交按钮补 `data-testid`，使断言不依赖文案。

- **大屏展台全屏：补上原生全屏被拒时的降级与 Esc 退出**：
  - **先纠正一处错误结论**：上一轮我说「展台无 Esc 退出」，这是错的 —— 原生 Fullscreen API 的 Esc 是浏览器内建行为，展台一直可用。
  - **真实缺口在于降级路径**：`requestFullscreen()` 可能因权限策略 / 缺少用户手势被拒绝，此时浏览器不进入原生全屏，**Esc 也完全失效**（Esc 只在原生全屏态下由浏览器接管）。而展台原先只监听 `document.fullscreenElement`，被拒时既不进入全屏态、也没有 `fullscreenchange` 事件 —— 表现为「点了全屏按钮没反应，且 Esc 也退不出」。
  - **修复**：新增 `useViewportFullscreen`（视口级，对应白板既有的元素级 `useBrowserFullscreen`）。进入时若原生调用被拒，仍进入「占满视口」并置全屏态，此时由自己接管 Esc；同时保留 `fullscreenchange` 反向同步，用户经浏览器 UI / 系统 Esc 退出时状态一并退回。补 5 个用例，**反向验证**回退后 2 个失败。

- **修复「整个浏览器全屏」未真正生效，并补上集成路径回归测试**：
  - **这是上一轮实现的一个假通过**：需求是「全屏时隐藏标题栏、保留悬浮退出按钮」，但实际只做到了后者。浏览器全屏的真实渲染链路是 `BrowserFullscreenHost` + `renderElement(el)`，走的是**画布内那条渲染分支**，从未经过 `WidgetFrame` 的 `isBrowserFullscreen` 分支 —— 那段「隐藏标题栏」的代码自加入起就一次都没执行过。原因是我当时的测试直接给 `WidgetFrame` 传 `isBrowserFullscreen`，测的是组件契约而非集成路径（与此前双击删组件那次假通过同一类错误）。
  - **同时发现更严重的问题：全屏时元素根本没放大**。`renderElement` 里元素用 `displayX/displayY/displayWidth/displayHeight` 绝对定位，而这三个值直接来自 `data` —— 也就是说全屏只是把「画布里 400×300 的那个小卡片」原样搬到视口左上角，尺寸不变，所谓「全屏」名不副实。
  - **修复**：`renderElement` 增加可选 `fullscreen` 参数，在**定位计算的唯一入口**统一覆盖为「内缩 24px 铺满视口」。9 个元素类型共享同一套定位计算，因此一处改动即对所有类型生效，也保证后续新增类型自动一致。同时把「全屏隐藏标题栏」抽成 `WidgetTitleBar` 的 `hidden` prop，由宿主的 `getWidgetTitleBarProps` 统一注入 —— 各分支无需各自判断，第三方 widget 也自动生效。
  - **`BrowserFullscreenHost` 暴露视口尺寸**：新增 `data-testid="browser-fullscreen-content"` 容器并监听 `resize`（含原生全屏切换导致的尺寸变化），让元素能真正铺满而不是停在进入瞬间的尺寸。
  - **顺带修复 `rollcall` / `hello-world` 拿不到「浏览器全屏」按钮**：`RollCallWrapper`、`HelloWorldWrapper` 把标题栏属性硬编码、丢弃了宿主传入的 `onBrowserFullscreen`，导致这两个组件**至今无法进入浏览器全屏**（同批的 `CodeSandboxWrapper` / `MathGraphWrapper` 转发正常）。
  - **回归测试**：新增 7 个**集成路径**用例（走 `InteractiveWhiteboard` 真实渲染，覆盖 plugin / html-applet / assignment / rollcall / quiz 五类，断言全屏内标题栏数量为 0 且退出出口存在，并断言内容容器铺满视口）。**反向验证**：回退修复后 5 个用例失败，确认是真实回归测试而非再次假通过。
  - 另补 `presence.test.ts` 中 `mode: 'board'` 透传断言（上一次提交遗漏）。

- **互动课件（html-applet）收口到统一窗口框架 `WidgetFrame`**：
  - 此前它虽然已能拿到 `getWidgetTitleBarProps`（含两种全屏），但仍手工渲染 `WidgetTitleBar` + 手工控制 `isMinimized` 时的内容显隐，与 plugin 分支写法分叉。现在改为与第三方 widget 完全一致的结构：内容交给 `WidgetFrame` 包裹，课件只提供内容本身，窗口能力（最小化 / 两种全屏 / 删除）由宿主统一保证。
  - 澄清一点技术前提：iframe `sandbox` 未开 `allow-same-origin`，父页面本就读不到课件内部 DOM —— 窗口框架位于 **iframe 外部**，因此**不存在**「往 iframe 内注入样式 / 跨文档通信」的成本。

- **互动大屏展台：清除全部写死的假数据，缺失指标补齐真实接口**：
  - **审计结论**：展台原有 4 类假数据 —— ① 投票选项 `options || ['A','B','C','D']` 兜底，接口无数据时画出 4 条不存在的选项柱；② 互评量规均分写死 `95.3`；③ 已同步学生机写死 `32` 台（且 `PeerReviewRubricStats` 里还有 `syncedStudentsCount = 32` 的默认值）；④ **作品「可视化预览」是写死的五边形/旋转矩形 SVG**，与任何真实作品无关 —— 投到大屏上学生会以为那就是该同学的作品。另有批注署名写死「陈老师」、弹幕写死「主讲教师」、语音时长编造 `4` 秒、阶段写死 `STAGE 02.4`。
  - **展台「作业互评赏析」原本是空壳**：`StageDisplayPanel` 只传了 `lessonTitle`，没传 `lessonId`，导致数据源 `usePeerReviewData` 完全没接上。现通过 `usePeerReviewData` 接入真实互评数据（焦点作品 / 互评矩阵 / 提名榜 / 量规 / 弹幕 / 评阅进度），并支持教师「一键分配互评」。
  - **作品预览改为渲染真实作答**：`usePeerReviewData` 新增 `summarizeWorkContent`，从 `submission_raw`（`/api/courseware/attempts/:id/raw`，权限校验已在）提取学生的真实作答，判定形态（代码 / 文本 / 结构化答案 / 数值）并渲染。无可展示内容时**明确说明**而非画假图形。顺带删除与预览区重复渲染同一份 `codeLines` 的旧「Code Snippet」区块（内容原本显示两遍）。
  - **量规均分改为真实计算**：新增 `weightedRubricAverage` 按维度权重算出；无真实维度数据时返回 `null`，UI 显示「—」而非某个写死分数。`PeerReviewRubricStats` 的 `averagePercentage` 类型放宽为 `number | null`，并移除了 `syncedStudentsCount = 32` 的默认值。
  - **接口补齐四类真实指标**：`GET /api/classroom/stage/:lessonId/data` 新增 `attendance`（在线 / 本班在线 / 应到 / 实到，来自 presence 实时在线名单 + `class_students` + 课堂痕迹去重统计）、`feed`（`classroom_feed` 最近 12 条）、`courseware`（`courseware_attempt` + `submission_result` 聚合的参与人数 / 完成数 / 平均完成度）、`exitTicketSubmitted`，以及 `classId` / `sessionId` / `stageStartedAt`。展台右栏新增「课堂出勤」「互动课件参与」「课堂动态」「结课通票进度」四块。
  - **无数据时的诚实呈现**：无班级名单时不出勤率显示「—」并说明原因（**不显示 0%** —— 那会被误读成「无人到课」）；无课件活动、无动态流、无进行中互动时均给出明确说明，不再是空白或假内容。
  - **修复两个真实 SQL 缺陷**（由新增的跑真实 SQLite 的服务端测试暴露，mock 测不出）：
    - 出勤查询用了 `?1` 具名参数，**better-sqlite3 不支持**（那是 SQLite C API 写法）→ 抛错后被 catch，且 catch 把已成功查出的 `expected` 一并清零，导致**展台「应到人数」永远显示 0**；
    - `attended` 的 UNION 里 `classroom_poll_votes` 被当作有 `session_id` 列，但该表只有 `poll_id`，须 `JOIN classroom_quick_polls` 过滤 → 实到人数恒为 0。同时把两个查询拆成独立 try，避免一方失败连带清掉另一方的真实结果。
  - **顺带修复**：`StageDisplayPanel` 新增的「等待课堂互动」空态漏 import `Presentation` 图标，导致展台在无互动时抛 `TypeError: Illegal constructor` 整页白屏。
  - **回归测试**：新增 `server/__tests__/classroom-stage-display-data.test.ts`（9 用例，跑真实 SQLite，含「应到人数 = 班级名单人数」的针对性回归断言）与 `src/features/classroom/__tests__/stage-display-data-honesty.test.tsx`（17 用例，锁定「无真实数据就不编」：不兜底 A/B/C/D、不显示 0% 出勤率、量规无数据返回 null、作品内容提取、等待态渲染）。

- **修复「打开大屏展台」读取成绩规则时报 HTTP 500 `No handler registered for command: undefined`**：
  - **根因**：新增的自动录入规则读写误用了 `/api/commands` 的请求体契约。该接口的契约是 `{ commandType, payload }`（见 `server/routes/os.ts`），我传了 `type`，导致服务端拿到 `commandType === undefined` 而找不到处理器。同时响应体是 `{ success, result }`，我原先从顶层读字段，即使不报错也读不到值（同文件既有调用见 `LiveClassroomView` 的插件工具面板，正确写法是 `commandType`）。
  - **修复**：请求体改用 `commandType`；响应统一按 `json.result` 解包（并保留对无 `result` 包装的兜底）；保存接口额外校验 `success === false` 以捕获命令总线返回的业务失败。
  - **防回归**：测试 mock 改为**严格按真实契约**实现 —— `commandType` 不匹配即返回 500，这样契约漂移会直接被测试拦住，而不会等到运行时才发现；另新增一条专门断言「所有 `/api/commands` 请求都必须带 `commandType` 且不得出现 `type`」。验证：把代码改回错误写法后 3 个用例失败。

- **大屏展台改为独立窗口常驻 + 课程状态变化实时提示**：
  - **新开独立窗口**：「打开大屏展台」由同页模态框改为 `window.open` 拉起独立窗口（`?mode=stage_display&lessonId=…`），授课界面留在主窗口继续操作 —— 此前展台是 `fixed inset-0 z-[9999]` 全屏覆盖，讲台上等于教师自己被挡在屏幕外。由 `useStageDisplayWindow` 管理窗口引用，处理三个现实问题：**弹窗被拦截则降级为同页模态框并明确提示教师去地址栏放行**（否则点了像坏了）、**已开的窗口复用聚焦而非重复开**（连点不会开两个展台抢屏幕）、**教师手动关掉标签页后能重新打开**（3s 探活清理失效引用）。
  - **保持连接**：新增 `useStageDisplayFeed`，由原来的 **2s 无条件轮询** 改为 **Socket 主导 + 20s 低频对账兜底**。监听 12 类课堂事件（`classroom:stage_changed` / `quick_poll_*` / `buzzer_*` / `countdown_updated` / `pacing_updated` / `exit_ticket_submitted` / `feed_appended` / `pulse_check_requested`）即时拉取；密集事件 120ms 内合并为一次请求；带请求代次防止慢响应覆盖新响应。独立窗口自行建连、自行轮询，**不依赖主窗口生命周期** —— 教师切课节、切标签页都不会中断展台数据流。
  - **连接状态可见**：顶栏新增连接指示灯（实时连接 / 重连中 / 轮询同步 / 连接异常 + 最近同步时刻）。这是刻意加的：展台常驻投影且无人操作，内容若已过期而无人察觉，学生是看得见的。
  - **课程状态变化提示**：新增 `stage-notices.ts`（纯函数 diff，便于单测）+ `StageNoticeStack` 浮层。覆盖 **环节推进**（含结课通票与归档的不同语气与跟进建议）、**投票开始/结束**（带作答人数）、**抢答开始/产生赢家/重置**（带姓名与毫秒数）、**连接断开与恢复**。首帧不提示（首次加载不是"变化"）；按 `dedupeKey` 8s 窗口去重、队列限长 40 条、最多同屏 4 条，6s 自动消失且可手动关闭（投影上误触无法撤销，不能要求操作）。
  - **展示层复用**：`StageDisplayModal` 重写为薄壳，展示内容抽到 `StageDisplayPanel` 供「同页模态框（降级路径/旧调用方）」与「独立窗口（主路径）」共用，避免两处 UI 文案漂移。独立窗口不渲染关闭按钮（关标签页即关闭，再给一个按钮只会让教师误以为关掉了主窗口），未选课节时给出明确等待态而非白屏。
  - **顺带修掉**：socket 挂载时重复触发一次拉取（首次同步已由轮询 effect 负责）；`isFullscreen` 初始恒为 false，未按「退出全屏」按钮时全屏图标与实际状态不符（改为监听 `fullscreenchange`）。
  - **回归测试**：新增 41 个用例 —— `stage-display-notices.test.ts`（19，状态 diff 纯函数）、`stage-display-window.test.tsx`（14，连接保持与窗口生命周期，含事件合并/课节过滤/断连恢复/监听清理/弹窗拦截降级）、`stage-display-view.test.tsx`（8，端到端串起「事件 → 拉取 → diff → 提示」）。

- **修复服务端集成测试的间歇性失败（`no such table: classroom_sessions`）**：
  - **根因**：课堂相关表（`classroom_sessions` / `classroom_feed` / `teaching_modes` …）只存在于 `migrations/*.sql` —— `packages/core/db/index.ts` 的内联 schema 块里并没有，而 `runMigrations` 只在 `server.ts` 启动时执行，**测试环境从不在 setup 阶段跑迁移**。于是有 7 个测试文件各自在 `beforeAll` 手动 `runMigrations` 兜底，而 `classroom-session-resume.test.ts` 没有兜底，只能依赖「同 worker 里恰好有别的文件先跑过迁移」。在 `vitest.config.ts` 的 `fileParallelism: true` 下文件到 worker 的分配不确定 —— 该文件独占一个全新 worker 时必然缺表，于是时好时坏（单独运行稳定复现 4 failed）。
  - **修法**：新增 `server/__tests__/helpers/test-schema.ts` 导出幂等的 `ensureTestSchema()`，并在 `vitest.setup.ts` 中**按测试文件路径条件性**调用（仅 `server/__tests__/` 下的测试加载 DB 并补齐迁移，避免让 200+ 个纯前端测试付出加载 `better-sqlite3` 与读迁移文件的代价）。`runMigrations` 本身按 `_migrations` 记账幂等，模块级标记保证同一 worker 只真正执行一次。
  - **顺带去重**：将原先 5 个文件里重复的 `loadMigrationsFromDirectory(path.resolve(__dirname, '../../migrations'))` 样板（含各自重复的 `import path`）替换为 `ensureTestSchema()`；`classroom-runtime-service.test.ts` 使用独立的 `:memory:` 库，语义不同，予以保留。
  - **文档同步**：`docs/developer-guide/testing-strategy.md` 补充「服务端测试的数据库 Schema」条目，明确禁止依赖同 worker 内其他文件的执行顺序。
  - **验证**：`classroom-session-resume` 等 6 个文件在「清空 DB 后独占运行」场景下全部通过；全量套件连跑 3 次稳定 284 文件 / 2138 测试 0 失败。

- **学生提交数据页：手动「录入成绩」升级为「可配置规则 + 自动录入」**：
  - **根因（按钮长期灰着）**：`LiveClassroomView.tsx` 表格行的 `isFinished` 只认 `finished`/`submitted`，**漏掉 `completed`** —— 而 `completed` 正是数据库实际写入的终态（`packages/plugins/builtin.ts` 的 `submit_lms` 仅在该取值下更新 `finished_at`/`status`）。结果：同一文件里筛选下拉的 `FINISHED_STATUSES` 含 `completed` 能筛出这些行，但这些行的「录入成绩」按钮恒为灰色。现把状态口径收敛到模块级常量，并与服务端 `FINISHED_ATTEMPT_STATUSES` 对齐。
  - **堵住「无分数记满分」**：`server/routes/courseware.ts` 的 promote 路由原本 `let finalScore = 100`，在 `submission_result.score` 为 NULL 时会把「没作答」直接记成 **100 分**。现改为无分数一律拒绝录入（422 + 明确原因），前端同步禁用并提示「该提交没有分数，无法录入（不会凭空记分）」。
  - **自动录入规则**：在既有 `courseware_score_config` 上新增 `auto_record_enabled`（默认**关闭**，不改变历史行为）与 `auto_record_min_completion`（完成度门槛 0~1）两列（迁移 `012_auto_record_score.sql`），复用其「课件专属 → 全局 `*` → 内置默认」三级继承，避免出现两套成绩配置。规则可在「学生提交数据」页直接开关与拖动门槛调整，也可经 `courseware.save_score_config` 命令修改；老库缺列时 `saveScoreConfig` 优雅降级，不影响其余字段写入。
  - **双触发路径**：① 学生提交课件时实时录入 —— 服务端从「班级 + 进行中的课堂会话」反查课节（刻意不接受前端上报 lessonId，避免错配/伪造），查不到则不实时录入；② 教师打开「学生提交数据」页时自动补录，并提供「立即补录」按钮显式重跑。
  - **核心逻辑抽出于 `server/utils/auto-record-score.ts`**：手动与自动两条路径共用同一 `promoteAttemptToGrade` 落库实现，保证口径一致。状态门槛与完成度门槛**仅约束自动路径**；手动录入保留教师显式判断的能力（与改动前一致）。全部操作对同一 (作业, 学生) 幂等覆盖，重复触发不产生重复行、不叠加总分。
  - **稳定性**：`fetchAttempts` 与 `addToast` 经 `useCallback` / `addToastRef` 稳定化 —— 二者原本每次渲染重建，若直接进依赖会触发「补录 → setState → 重渲染 → 补录」的无限循环。
  - **回归测试**：新增 `server/__tests__/auto-record-score.test.ts`（23 用例，含三条铁律断言）与 `src/components/__tests__/LiveClassroomViewSubmissionsAutoRecord.test.tsx`（8 用例，覆盖 completed 可点击、无分数禁用、补录不重复触发）；其中 7 个前端用例在修复前失败。

- **学生端抢答题无法退出的严重缺陷修复**（`src/features/student/StudentInteractiveOverlay.tsx`）：
  - **根因**：服务端 `GET /api/classroom/sessions/:lessonId` 返回 session 下**最新一条** `classroom_buzzers` 且不过滤 `status`，而学生端弹窗渲染条件仅为 `activeBuzzer` 非空，且弹窗是 `fixed inset-0` 全屏遮罩却**没有任何关闭入口**。抢答器一旦创建，学生即被永久锁死在「恭喜你率先抢答！」页面。
  - **退出通道**：抢答弹窗新增右上角关闭按钮、结果页「知道了，返回课堂」按钮，并支持点击遮罩关闭；通过 `dismissedBuzzerId` 记录本轮已关闭，保证同一轮不反复弹出、教师开启新一轮（新的 `buzzerId`）时自动重新出现。
  - **教师重置后状态复位**：原同步逻辑只处理 `LOCKED` 分支，教师点击 reset（同一 `buzzerId`、`status` 回到 `READY`）时 `buzzStatus` 永久停留在 `WINNER`/`MISSED`，现补齐 `READY` 复位分支，允许学生再次抢答。
  - **在途快照竞态**：抢答瞬间已发出的轮询请求会带回抢答前的过期 `READY` 快照，把刚判定的结果冲回 `IDLE`。现引入单调递增的轮询序号水位（`pollSeqRef` / `buzzPollSeqRef`），凡诞生于抢答之前的响应一律忽略；已判定结果按 `buzzerId` 锁定，不再被后续轮询翻转。采用序号而非 `Date.now()`，因同一毫秒内的请求与抢答无法用时间戳区分先后。
  - **无限轮询自激（性能缺陷）**：`activePoll` / `activeBuzzer` / `exitTicketSubmitted` 原本处于轮询 `useEffect` 依赖中，而服务端每次轮询都返回全新对象引用，形成「轮询 → 写入新对象 → 依赖变化 → effect 重建并立即再次轮询」的自激循环，2.5s 节流被完全绕过，学生端以 CPU 速度持续打接口。现改用 ref 镜像仅作「新的一轮」比较，effect 依赖收敛为 `[lessonId, studentId]`。
  - **健壮性与体验**：补齐 `BUZZED` 中间态渲染（此前无对应分支，等待响应期间弹窗为空白卡片，观感上等同卡死）；抢答请求失败时回退到可重试状态而非判定为 `MISSED`；未抢到时立即从 `POST .../buzz` 响应写入获胜者姓名，无需等下一次 2.5s 轮询。
  - **回归测试**：新增 `src/features/student/__tests__/StudentInteractiveOverlayBuzzer.test.tsx`（9 个用例），覆盖关闭退出、教师 reset 后重新抢答、新一轮自动重弹、未抢到分支、请求失败回退、在途过期快照竞态、2.5s 节流不被自激绕过；其中 6 个用例在修复前失败。

- **课堂随堂测验与结课通票学情采集全链路修复**：
  - **白板随堂测验（Quiz）交互与端到端答题闭环**：
    - 修复普通白板画布（`InteractiveWhiteboard.tsx`）将 `quiz` 类型元素直接 `return null` 的展示断层，重构为具备卡片头部、题干摘要、选项列表与全屏作答入口的标准白板卡片；
    - 全屏只读专注锁定（`FullscreenRendererRegistry.tsx`）放行 `quiz` 与 `assignment` 交互型微件的鼠标交互事件（`pointer-events-auto`），确保全班处于专注锁定时学生仍可正常交互作答；
    - 全屏随堂测视图强化（`QuizFullscreenView.tsx`）：集成当前学生身份感知、选项点击选中与未提交防剧透保护、单题一键提交（`POST /api/lessons/:id/quiz-submit`）及得分即时反馈；针对教师/管理员模式与只读预览保持 100% 统计解析向后兼容。
  - **随堂测验并发写入与读取权威一致性**：
    - 改造 `server/routes/lessons.ts` 的 `GET /api/lessons/:id/quiz-submissions` 接口，增加对具备行级原子写入保证的 `lesson_quiz_submissions` 关系表的联合读取与内存映射补齐，彻底解决高并发抢答下白板 JSON 元素覆盖与数据丢失隐患。
  - **全景学情报告（`panoramic-report`）结课通票与花名册查询修复**：
    - 修复 `server/routes/classroom.ts` 中结课通票查询未查询 `student_id` 列，导致映射字典永远以 `undefined` 为键、学情报告中所有学生结课通票数据全部丢失的问题；
    - 修复班级花名册查询直接在 `students` 表匹配 `class_id`（该列不存在）导致 SQLite 抛错并引发接口 500 的严重问题，重构为通过 `class_students` 关系表进行规范关联查询，并支持 query 显式传入 `classId`。
  - **全链路自动化回归测试与防护网建设**：
    - 新增端到端集成测试 `server/__tests__/classroom-student-interactive-e2e.test.ts`，涵盖快速投票生命周期与关闭拦截、白板随堂测原子落库与 Socket 广播、结课通票花名册联查与全景学情多维聚合、作业提交与防越权鉴权、教师批改记录以及 EventBus 事件总线通知闭环；
    - 扩展 `server/__tests__/classroom-routes-contract.test.ts`，锁定多学生班级花名册（`class_students`）联查与缺卡学生兜底契约，防止 `panoramic-report` 发生 SQL 报错回归；
    - 扩展 `src/features/whiteboard/__tests__/whiteboard-readonly-lock.test.tsx`，建立白板只读锁定（`readOnly`）防回归断言，确保全班专注锁定下普通课件只读、交互微件（`quiz`/`assignment`）持续放行作答与提交事件；
    - **新增 Playwright E2E 真实浏览器自动化测试（`e2e/classroom-interactive-flow.spec.ts`）**：
      - 覆盖真实 Chromium 浏览器环境下随堂测验（Quiz）白板卡片加载、展开全屏作答、防剧透、选项选择、提交与即时评分（100分），并在教师端接口验证原子学情落库采集；
      - 覆盖极速单选投票（Quick Poll）教师下发、学生端浮层实时响应点击与提交、服务端全景大屏与讲台数据（`GET /api/classroom/stage/:lessonId/data`）实时聚合统计；
      - 支持同时兼容 `/api/auth/session` 与 `/api/auth/me`，确保真实浏览器端身份解析零等待与防剧透状态首屏确定性。

- **在线课堂授课页学生专注力监控 UI 升级与反馈流可伸缩改造**：
  - **学生专注力监控控制台 (Student Focus Console)**：优化右侧边栏排版与信息层级，新增快速随机抽问胶囊按钮与屏幕锁定计数徽章；重构 SVG 环形进度圈与头像气泡比例，解决姓名与百分比文字拥挤问题；增加悬停浮层快捷操作（进度预警提醒与单独屏幕锁定），支持实时学生学情明细展开与全班概况卡片。
  - **课堂互动反馈流可伸缩折叠 (Collapsible Live Feed)**：反馈流支持一键折叠（由 165px 收起至 36px 紧凑条带），带动态计数徽章与展开状态清空（Clear）功能；折叠后将下方垂直高度完整释放给上方学生专注力网格，使大班级教学时无需滚动即可查看更多学生状态。

- **在线课堂顶栏课程切换与课堂倒计时控制优化**：
  - **在线课堂标题与只读班级显示**：将课中授课顶栏标题统一为「🔴 在线课堂」，优雅只读显示当前授课班级 Badge，避免误操作改动班级；
  - **课程选择与二次确认切换**：新增课程选择下拉列表与「切换」按钮，切换时弹出二次确认模态窗，并在确认后即时加载目标课程白板与环节数据；
  - **课堂倒计时控制器移至顶栏**：优化课堂倒计时为胶囊式微型控制器，由左侧边栏移至顶栏「云端在线」右侧，左侧边栏专注呈现教学步骤与白板大纲。

- **白板 AutoTiling 动态切分、黄金分割与空间自动填补**：
  - **方向感知二分与黄金分割切分**：在 `src/features/whiteboard/utils/auto-tiling.ts` 中实现交互式上下/左右分割与黄金分割比（0.618 / 0.382）布局算法；在拖拽组件时，根据鼠标落点动态计算候选停靠槽位（左半/右半水平切分、上半/下半垂直切分），并生成高亮预览虚线框。
  - **组件移走后自动填满空间（Refill on Remove）**：在平铺状态下，当组件移入其他大纲页、其他教学环节或被删除后，剩余组件遵循 i3 autotiling 规则自动重新二分计算新几何并即时填满 100% 容器可用空间，消除布局残留空洞。
  - **乐观几何覆盖与即时重排**：抽取 `applyAutoTilingForElements`，在删除或跨页/跨环节移走时即时重排并乐观更新 `localGeometryRef` 与落库，保证视觉过渡平滑。

- **课程编辑器跨大纲与跨环节拖拽交互增强**：
  - **组件拖动至大纲与教学环节**：允许将画布上的白板组件直接拖拽至左侧大纲树（跨页）或顶部时间线（跨教学环节）；
  - **悬停自动展开**：拖拽组件悬停在折叠的大纲或教学环节节点上方时，自动展开对应层级，方便精准放置；
  - **修复跨页移动失效**：修复组件在同一环节的不同页面大纲之间移动时提示存在但未能成功写库更新目标页 ID 的问题。

- **修复组件跨环节移动时时间线偶发消失的问题**：
  - **移除悬停误开详情面板逻辑**：彻底移除 `TimelineRail` 中悬停 >250ms 误触发 `setEditorPanelsExpanded(true)` 的定时器，避免拖拽过程被突兀展开的环节参数设置面板打断；
  - **时间线导轨外提与强效吸顶（Sticky Header）**：将 `TimelineRail` 从主视图内部滚动容器中移出作为独立顶层，并赋予 `sticky top-0 z-30 bg-surface/95 backdrop-blur-md` 吸顶样式，确保时间线导轨在任何滚动和面板展开状态下始终居顶常驻。

- **上课白板大纲整合入教学步骤与时间管理侧边栏**：
  - 将互动课堂（`LiveClassroomView`）白板界面的大纲组件移入教学步骤与时间管理边栏中，统一授课过程中的环节推进与页面大纲管理；
  - 优化边栏排版、折叠控制与各环节高亮切换视觉体验。

- **互动课堂成为教师/管理员默认首页**：
  - `uiStore` 默认 `teacherTab` 由 `courses` 改为 `live_class`；`App.tsx` 的 `handleLoginSuccess` 教师分支登录后落地页由 `dashboard` 改为 `live_class`（管理员 `role` 同为 `teacher`、靠 `subRole` 区分权限，故一并覆盖）。Hash 路由优先级不变，携带 `#/courses` 的深链行为不受影响。
  - 互动课堂起始门户右侧遥测岛由 2×2 网格改为单行四格（`grid-cols-2 md:grid-cols-4`），配套压缩卡片内边距与图标尺寸，并将容器宽度由 440px 放宽至 620px，避免「保持比例」约束下的文字截断。

- **白板自动平铺（Auto Tiling）—— 类 Linux tiling 窗口管理器布局**：
  - 新增纯布局算法 `src/features/whiteboard/utils/auto-tiling.ts`（不依赖 React/Konva/DOM）：i3 同源 BSP 二分树（首层左右分栏、逐层交替横竖切、`firstCount = floor(n/2)`，n=3 时退化为 i3 经典形态）。默认 `fillMode: 'fill'` —— 元素外框**精确铺满**整个格子、零留白，对齐 i3 窗口行为；白板元素外壳本身是 `flex flex-col`（标题栏 + `flex-grow overflow-auto` 内容区），撑满后内部自动重排。`fillMode: 'fit'`（保持宽高比居中）作为可选项保留。默认 `gap` / `padding` 各 8px，接近 i3 的细边框。
  - 工具栏新增平铺开关按钮（`LayoutGrid` 图标，开启时显示「平铺中」徽标），位于网格开关旁；`readOnly` 态（他人课程预览、学生端）不渲染该按钮。`WhiteboardToolbar` 在 `InteractiveWhiteboard` 内部渲染，故课程编辑器、互动课堂、学生端课节四处白板自动获得该能力。
  - 持续模式语义：开启即**一次性重排白板上的所有页**（逐页独立计算 BSP 布局）；此后增删元素、画布尺寸变化（250ms 防抖）均自动重排。切页与切环节**不触发**重排。拖拽不改变元素 id 集合，因此**不会打断自由布局**——两种效果共存。
  - **为什么按页而不是按环节分组**：所有白板元素共用同一套扁平坐标（`x/y` 即容器像素，不分页分环节），画布一次只渲染「当前页 + 当前环节」这一组。逐页独立平铺是安全的——不同页永远不同屏，故无可见重叠，每页被查看时都铺满画布；而按环节拆组会让「无环节标签元素」与「当前环节元素」各自铺满整块画布而直接互相压住。Playwright 实测：画布 1178×629 下三页共 8 个元素全部平铺完成，每页包围盒 1166×617（12px 差值 = padding 8 + gap/2 4）。
  - **关闭平铺自动还原**：元素首次被平铺改写时，把平铺前几何以 `__preTile` 写入该元素 `data`（另存 `__tiled` 记录本次写入值）。切回自由布局时据此还原并清除两个快照字段。**用户在平铺模式下手动拖动/缩放过的元素会被跳过还原**（当前几何与 `__tiled` 不符即视为用户已调整），避免覆盖其意图，但快照字段仍会清除以免下次误用过期基准。快照随元素落库，因此刷新页面后仍可还原。
  - 平铺写回完全复刻拖拽提交的两步（`onElementUpdate` + `whiteboard.element_updated` 事件广播），持久化、800ms 防抖自动保存与广播行为与手动拖动一致。
  - **乐观几何覆盖层**：课程编辑器三条写入路径待遇不一致——`onElementAdd` / `onElementDelete` 写完都 `fetchElements()`，唯独 `onElementUpdate`（自动平铺走这条）只入队防抖自动保存、不回传，导致「已自动保存但布局没变」。新增 `localGeometryRef` 覆盖层，渲染优先级为「拖拽/缩放中 > 覆盖层 > 服务端 data」，写入点覆盖平铺、还原、拖拽 pointerup、缩放 pointerup；`elements` 变化后按 0.5px 容差比对自动摘除，切课程时整体作废。`Circle` 为独立渲染分支（圆心 + radius），已改读 `overlay.radius`。该修复同时消除了编辑器原有的「松手后等 refetch 期间可能弹回」。
  - 类型差异归一化：`circle` 走 `radius` 而非 `width/height`（写回时改写 radius，否则改动会静默失效）；`pen` / `highlighter` 为绝对坐标折线、`page_meta` 为分页元数据，三者排除出平铺范围。
  - 抽出 `belongsToCurrentPage()` / `getCurrentPageElements()` 供画布渲染筛选，渲染与平铺不再各写一份页/环节判定；`renderElement` 内联的 `getInitialWidth`/`getInitialHeight` 合并为模块级 `DEFAULT_ELEMENT_SIZE` 尺寸表，渲染与平铺不再有两份尺寸规则。
  - 测试 `whiteboard-auto-tiling.test.ts`（36 例）锁定面积守恒、任意两格不重叠、平铺幂等、fill 模式精确铺满、fit 模式宽高比不变、圆形内切取短边，以及快照辅助函数（几何键名、缺失值归零、0.5px 容差判等）等不变量。

- **课程编辑器「学生视角」改为独立标签页打开**：
  - 新增 `student_preview` 标签页模式（`?mode=student_preview&lessonId=…`），与课堂联动的 `student_live` 刻意区分：保留常规 AppHeader（品牌区/通知/登出）与琥珀色模拟学生横幅，**退出动作为「关闭此预览标签页」而非「返回教师端」**（该标签页内不存在教师端，原按钮是死路），且不接入课堂实时同步信道。
  - 必要性：教师已登录时新标签页走会话恢复会执行 `setActiveRole(data.session.role)` 默认回到教师视图，故必须靠显式模式参数才能在新标签页进学生端。
  - 视角切换器（👨‍🏫 教师视角 / 🎓 学生视角）移至工具栏右侧「返回课程库」按钮旁；教师视角仍就地切回，学生视角改为 `window.open` 新标签页并对弹窗拦截给出提示。
  - `useGlobalErrorCapture` / `SystemErrorCenterModal` 的学生端错误上报判定**不包含** `student_preview` —— 预览标签页运行在教师自己的浏览器里，将其错误记为学生机异常会污染教师端错误面板。

- **白板组件操作入口去重与编辑器默认态精简**：
  - 移除全屏浮层右上角的悬浮圆形 X 关闭按钮（`FullscreenRendererRegistry.tsx`）——与标题栏「退出全屏」调用同一个 `onClose`，功能完全重复；ESC 退出仍有效。
  - 移除选中组件时浮出的「类型 + 删除」药丸层（`InteractiveWhiteboard.tsx`）——组件标题栏已有删除按钮；删除入口保留标题栏、右键菜单、工具栏三处。连带清理仅服务于该药丸的 `getElementFloatingPosition` 辅助函数（按 pen/rectangle/circle/text 类型算浮动定位，全项目再无引用）。
  - 课程编辑器「环节参数」面板默认折叠（`useLessonTimeline` 的 `editorPanelsExpanded` 初值改为 `false`）：备课主视图是白板画布，收起后把纵向空间还给画布；工具栏按钮仍可随时展开。

- **移除与「学生视角预览」重复的入口**：
  - 删除 `src/features/modals/StudentPreviewModal.tsx` 及其测试（进入回收站）。该弹窗内容被 `StudentLessonView` 完全覆盖且更弱（无作业 Tab、无实时同步），且其内部「独立Tab预览」按钮生成的 URL 与编辑器按钮逐字符相同。
  - 顺带消除一个隐患：该「预览」弹窗实为**可写库**——给 `LazyWhiteboard` 传了 `userRole={activeRole}`（教师态）却未传 `readOnly`，并挂载了四个直接 POST/PUT/DELETE 的写库回调，在预览中落笔会真实覆盖白板。
  - 连带清理 4 组 state（`isLessonPreviewVisible` / `previewSelectedCourseware` / `previewLessonTab` / `previewFullscreenPanel`）与跨 `App → AppShell → TeacherView → LessonEditorView` / `App → AppModals` 的完整 prop 转发链；`uiStore` 中同名死字段（`App` 用的是本地 `useState`，全项目无人读）一并移除。
  - 同时移除课程编辑器工具栏的「学生视角预览 (独立Tab)」按钮——学生端联动能力收敛到互动课堂控制台（`LiveClassroomView`）单一入口，该入口及其测试原样保留。

- **P2 `ai.agent.persona` —— 插件可注册 AI Agent 角色模板**：
  - 新增 `server/ai-persona-registry.ts` 注册表（kernel AIService 启动时 bind 委托，模式同 `ai.context.registry`），内置四个角色模板：`socratic_questioner`（苏格拉底追问者）、`debate_opponent`（反方辩论助手）、`historical_figure`（历史名人模拟对话）、`plain_assistant`（默认助教）。
  - 插件经 `ctx.services.ai.registerAIPersona(persona)` 注册角色（`persona` 为可序列化静态模板，Inline / Worker 插件均可用；`registeredBy` 记为插件 id，`unregisterAIPersona` 仅允许注册者注销自身模板，内置角色不可注销）。
  - `/api/agent/chat` 按 `personaId` 查找角色，以 `[Persona · <name>]` 段**叠加**在基础 Agent 指令之上（不替换工具链与基础行为）；`GET /api/agent/personas` 供教师聊天面板下拉选择。前端 `useAgentChat` / `RightSidebar` 增角色选择器。

## [0.4.2] - 2026-09-27

- **P2 熔断器与 AI 上下文提供者（修正后审计清单收尾）**：
  - **前端插件熔断器**：`ExtensionErrorBoundary` 升级——每个扩展点渲染异常按 pluginId 连续计数（3 次/5 分钟窗口），达到阈值自动停用插件并告警；成功渲染清零计数；已熔断插件跳过渲染并去重告警，重新激活即恢复。
  - **`ai.context.provider`**：新增 `server/ai-context-registry.ts` 注册表（kernel AIService 启动时 bind 委托）——Inline 插件经 `ctx.services.ai.registerAIContextProvider(id, fn)` 注册 AI 上下文切片提供者（fn 为服务端闭包，按 lessonId 返回插件实时状态如语法错误调用栈）；`/api/agent/chat` 组装 system instruction 时逐个调用并以 `[Plugin Context · <id>]` 段注入，单个提供者故障隔离不影响对话。

## [0.4.1] - 2026-09-27

- **P1 课件播放器与题型扩展插槽**：
  - **`courseware.viewer.toolbar`**：课件播放器顶栏标题区与控制按钮之间注入教辅工具（草稿本浮窗/截图批注/双语字幕/随堂笔记等）；
  - **`courseware.viewer.overlay`**：课件 iframe 上方叠加 HUD 容器（弹幕/防作弊水印/抢答悬浮球；容器 `pointer-events-none`，插件子元素自行开启交互，不遮挡课件操作）；
  - **`assignment.question.renderer` 题型扩展（P1 题型扩展）**：新增 `AssignmentQuestionRendererRegistry`（`src/features/teacher/assignment-question-registry.ts`）——第三方插件经 `ctx.ui.registerAssignmentQuestionRenderer` 注册学科专属题型（在线代码沙箱运行题/口语发音评分题/动态几何作图题），作业 content 以 `{"quizType":"<quizType>"` 命中即整面板交由插件渲染（label/render/validate/buildSubmission 四钩子）；内置 `mcq_learning_objectives` 与 Markdown 内容保持宿主路径；插件卸载时按 pluginId 所有权清理（`clearOwned`）。接线点：`StudentAssignmentQuestionPanel`（新增可选 `setQuizStudentAnswers` prop）。

## [0.4.0] - 2026-09-27

- **课堂反馈情绪实时仪表盘与作业提交通知**：
  - **实时仪表盘（`src/features/classroom/PacingDashboardModal.tsx`）**：教师端顶栏「节奏晴雨表」现可点击打开全屏仪表盘——Recharts 环形饼图 + 四情绪（理解 💡 / 困惑 ❓ / 慢一点 🐇 / 快一点 🐢）进度条 + 中心「理解占比」健康度指标 + 基于聚合阈值的教学节奏建议（如「较多学生困惑，建议放慢并重新讲解」）；数据由 socket `classroom:pacing_updated` 实时驱动（服务端 5 分钟窗口聚合）。
  - **新增 SLOW（快一点/讲太慢）节奏信号**：服务端 pacing 白名单与聚合扩展为 4 信号；学生互动浮层新增 🐢「讲太慢」按钮（原有 🐇「讲太快」= 希望慢一点）。
  - **作业提交实时通知**：`assignment.submitted` 内核事件新增 event-routing 路由（课节/班级房间广播 `assignment-submitted-toast`）；`TeacherAssignmentGradePanel` 监听后自动重拉评分数据，教师不再需要手动刷新。
  - **浏览器实测（Playwright）通过**：教师进课堂 → API 注入 5 条学生情绪信号 → 打开仪表盘（饼图三色扇区/四进度条/理解占比 50%/教学建议渲染）→ 再注入 2 条困惑信号 → 顶栏与面板计数 socket 实时同步（❓ 1→3）。
  - **班级管理域 P0 插槽落地（打破班级管理零插件状态）**：新增 5 个扩展槽位并接线——`class.tab`（班级详情扩展 Tab，元数据按钮 + 面板双渲染，ClassTabs/ClassesView）、`class.batch.action`（花名册批量操作流水线，含选中集与禁用态）、`student.row.panel`（学生行展开卡片插槽，所有展开 Tab 可见）、`editor.header.action`（备课编辑器头部动作）、`classroom.post_class.widget`（课后结课视图插件卡片）。附带入 `ExtensionPointRenderer` 两个渲染特例（button/panel）与存量 rules-of-hooks 修复（hooks 提前无条件调用）。
  - **`student.fullscreen` 考试模式接线（v5.1 休眠槽位激活）**：`StudentInteractiveOverlay` 挂载该槽位；插件侧新增考试模式——组卷面板「🔒 考试模式（全屏锁定）」开关 + 可选限时（分钟），发布后学生端**全屏深色接管**（标题锁定标识/交卷前不可退出/倒计时归零自动交卷/迟到学生显示「考试时间已结束」不交空卷）。浏览器实测：全屏接管 + 倒计时 + 作答 + 交卷判分 10/10。
- **插件 REST 网关 GET 子路径被详情路由吞掉的缺陷修复（`server/routes/plugins.ts`）**：
  - `GET /api/plugins/:id(*)`（插件详情）注册于网关 `/api/plugins/:pluginId/*` 之前，且 `:id(*)` 通配会捕获整条路径（如 `@scope/plugin-x/health`），导致**所有插件 REST API 的 GET 子路径请求永远无法到达网关**（V5.2 网关自此上线以来 GET 通道即不可用，POST 无通配路由不受影响）；
  - 修复：详情路由检测到 id 含 `/`（即 manifest id + 子路径形态）时 `next()` 放行给网关；纯 id 查询行为不变。多段 manifest id（`@scope/name`）经 Express 单段参数匹配会拆分，插件 REST 调用约定使用**插件 DB UUID**（单段）+ 子路径。

- **题库与随堂测验插件构建与安装验证（v2_plugins/plugin-exam-bank）**：
  - 修复 `manifest.json` 含 JSON 注释导致构建失败；`main` 修正为 `index.js`（CLI 将产物平铺到 ZIP 根，`dist/` 前缀触发宿主兼容回退警告）；
  - **幻影 REST 路由治理**：manifest 声明了 11 条 api.routes 但 `activate()` 只实现 `/health`——将业务逻辑抽为 `src/core.ts` 共享层，Command（`invokeCommand`）与 REST（`ctx.http`，网关 RBAC 前置）双通道共用同一组函数，REST 声明全部落地；
  - **插件 id 迁离系统保留前缀**：`@openlearn/plugin-exam-bank` → `@teacher/plugin-exam-bank`——平台将 `@openlearn/*` 视为系统插件阻断 `update-zip-raw` 更新通道，且污染内核命令命名空间；
  - 真实环境验证通过：构建产物预检（无裸导入/jsx 经典模式/external 对齐）→ 管理员 API 安装 → 激活 → 服务器重启自动恢复激活 → 网关 REST 录题/组卷/发布 → 学生提交判分（10/10）→ 重复提交 409 → 统计聚合正确。

- **课堂会话恢复与作业上传链路的审计收敛修复**：
  - **feed 回放按会话隔离（classroom-feed-service.ts）**：`getFeedReplay` 由按 `lesson_id` 过滤改为按当前活动会话 `session_id` 过滤——同一课程重开的新会话不再回放上一次课的动态（无活动会话返回空）；
  - **上传失败回滚补全（assignment-hub.ts）**：`max_files` 超限分支此前直接返回 409 未删除已落盘文件，现在超限/超配额/写库失败一律回滚物理文件，不再留孤儿；
  - **教师代传豁免截止校验**：已截止且不允许迟交的作业，教师代学生上传放行（补收作业的合理教学场景），学生侧仍严格 409；作业状态校验保持全员生效；
  - **下载/GC 路径守卫加固**：`storage/assignments` 前缀复核补尾部分隔符哨兵，阻断 `storage/assignments2/` 形态的前缀伪装；
  - **消除测试对生产逻辑的手工复制**：`extractScoreCommentCompletion` 从 `courseware.ts` 路由闭包抽为 `server/utils/score-extract.ts` 导出模块，路由与 E2E 测试共用同一实现；删除测试侧的手工副本与 `fixture-messages.ts` 的 vm 沙箱死代码，修正误导注释（countByLesson docstring、测试断言注释漂移）；
  - **命名规范收敛**：socket 事件 `classroom:feed` → `classroom:feed_appended`（过去式，对齐 AGENTS.md 事件命名）；`'ARCHIVED_REPORT'` 魔法字符串提取为共享常量 `ARCHIVED_REPORT_STAGE`（classroom-runtime-service.ts 导出，三处消费）。

- **课堂会话保存与恢复（Session Persistence & Resume）**：教师离开课堂后可随时回到当前状态，学生数据、教师数据、作业数据、互动课件数据与课堂动态全部保留。
  - **课堂动态流落库（`server/services/classroom-feed-service.ts` + `migrations/011_classroom_feed.sql`）**：新增 `classroom_feed` 表，feed 服务以 realtime-bridge 同款模式订阅内核事件总线（随堂作答/签到/表彰/作业提交与批改/进度/课件提交），写入会话级事实并向课节/班级房间广播 `classroom:feed` 实时事件——此前 liveClassFeed 是纯前端内存态（上限 50 条），离开即丢失；
  - **视图状态回写（`POST /api/classroom/sessions/:lessonId/view-state`）**：教师切白板页/切教学环节时防抖 500ms 回写；`currentPage` 存 `settings_json.viewState`，`activeSegmentId` 激活休眠列 `current_segment_id`（007 迁移建列从未使用）；
  - **恢复协议扩展（`GET /api/classroom/sessions/:lessonId`）**：在既有 stage/activePoll/activeBuzzer/activeCountdown 基础上新增 `viewState`（当前白板页）与 `feedReplay`（最近 20 条动态升序回放），前端重进课堂一次请求完整还原现场；
  - **前端恢复逻辑（`LiveClassroomView.tsx` / `InteractiveWhiteboard.tsx`）**：动态流按 id 去重预填、环节与白板页一次性恢复（`initialPage` prop 只应用一次不覆盖后续手动切页）、`classroom:feed` socket 实时追加；
  - **「回到课堂」入口（`ClassroomEntryPortal.tsx`）**：所选课程存在进行中会话（IN_CLASS_TEACHING / WRAP_UP_EXIT_TICKET）时显示绿色脉冲提示条「课堂进行中 · 回到课堂」，一键直达恢复后的授课视图；
  - **E2E 测试（`server/__tests__/classroom-session-resume.test.ts`）**：教师开课→产生痕迹→离开（不发请求不清理状态）→「全新客户端」重进，验证 stage/started_at/页码/环节/动态回放/倒计时全部还原；含无会话与非法参数边界。
  - **浏览器实测（Playwright，学生答题界面 + 实时推送弹窗）全链路通过**：学生 Cookie 登录 → 进课节（锁屏跟随）→ 教师端发布 → socket `exambank-survey-state` 推送 → 学生端自动弹出答题模态（课中浮层槽位）→ 作答提交 → 「已提交 ✓ 得分: 10/10」→ 教师端实时统计 `exambank-stats-update`（submission_count/选项分布）。实测抓出并修复 CSP blob 缺失与课中浮层槽位缺失两个平台缺陷。
  - **多题型端到端浏览器实测通过**：多选/判断/填空/量表/简答五题型混合实名卷（晚进恢复 → 逐题型作答 → 判分 25/25 → 统计逐类聚合：多选分布 A:1/C:1、判断分布 true:1、填空高频 80、量表均值 5、简答答案列表、实名 roster）+ 匿名问卷（推送弹窗 → 提交落库 `student_id = anon:<token>` 不入学生档案、`avg_score = null`、`roster` 不输出）。实测抓出并修复两个插件缺陷：判断题 API 建题无选项兜底、统计分布对字符串答案按字符拆键。观察项：学生页面存在多 socket 连接竞态（插件已自愈，平台架构债另计）；`writeLimiter` 60 写/分钟/IP 在课中高频场景偏紧。
  - **教师端浏览器实测（Playwright）通过**：欢迎向导关闭 → `teacher.tab`「题库与测验」面板渲染与录题（列表项落库可见）→ 组卷与问卷设计器（选题保存草稿 → 发布）→ 统计报告面板渲染 → 白板工具栏 🧩 插件区按钮（数量角标）→ 下拉面板列出插件工具（portal 无挤压）。附带验证：入口门户遥测岛 2×2 无截断、「课堂进行中 · 回到课堂」横幅在真实会话下出现且可用。

- **作业中心文件上传链路审计修复（`server/routes/assignment-hub.ts`）**：
  - **H1 跨班越权（IDOR）修复**：新增 `assertClassMembership` 班级归属校验——挂 `class_id` 的作业，学生必须属于该班才能读详情/上传/提交/互评（教师与管理员豁免），杜绝外班学生凭作业 ID 提交作业污染他班成绩册；课时作业（`class_id` 为 NULL）行为不变；
  - **H2 上传侧状态与截止校验**：上传端点此前只挡最终提交，未发布/已关闭/已截止且不允许迟交的作业均可无限上传占盘；现在上传时即校验 `status === 'published'` 与 `due_at/allow_late`（409 拒绝）；
  - **M1 同步写盘阻塞修复**：`fs.writeFileSync`（50MB 时阻塞事件循环、全班请求停摆）改为 `fs.promises.writeFile` 异步落盘；
  - **M2 max_files 竞态修复**：文件数检查 + 插入放入 `db.transaction` 同步事务，消除并发双传突破上限的 TOCTOU；
  - **L3 孤儿文件回滚**：写库失败时自动删除已落盘文件，不再留下无元数据的孤儿；
  - **M4 软删除文件物理 GC**：新增 `gcSoftDeletedAssignmentFiles`（`deleted_at` 超过 7 天的物理删除，保留 `stored_path` 前缀复核防路径逃逸），注册路由时执行一次 + 每 24h 定时清理（unref 不阻塞退出）；
  - **错误语义修正**：新增 `sendHubError` 统一尊重业务异常携带的 `err.status`（归属校验 403 不再误报 500）；
  - **L1 实现 `allowed_ext` 每作业扩展名限制**：此前 `plugin_assignments.allowed_ext` 字段建而未用；新增 `parseAllowedExt`（`server/utils/assignment-upload-policy.ts`）解析每作业白名单，且只能「收紧」全局白名单（越界项过滤、全空回落全局），上传时校验 400 拒绝；
  - **M3 学生存储配额**：新增 `STUDENT_ASSIGNMENT_QUOTA_BYTES`（200MB/学生，全作业累计，软删除文件不计入），上传事务内校验，超限 413；教师代传不受限；
  - **L2 前后端白名单同步守护**：上传策略（白名单/容器族/大小上限/配额）抽为独立模块 `assignment-upload-policy.ts` 单一事实来源，新增测试直接比对前端 `ACCEPT_EXT` 与服务端白名单，杜绝手抄漂移；
  - **回归测试**：`assignment-hub-routes.test.ts` 新增 7 个用例（外班学生 403 × 读/传/交、草稿/截止/迟交上传 409/200、GC 保留期与路径逃逸），20/20 全绿。

- **通用考试课件得分采集链路集成测试与通用课件 FIXTURE（`server/__tests__/courseware-score-capture-e2e.test.ts` & `server/fixtures/demo-courseware/`）**：
  - **3 套与平台零耦合的通用考试课件 FIXTURE**：`simple-quiz.html`（单选组卷 · `LMS_SUBMIT` 显式提交）、`result-screen-quiz.html`（判断题结算页探测 · `#correctCount` X/Y 比例自动换算）、`fill-answers-quiz.html`（填空题增量进度 · `LMS_SAVE_PROGRESS` 多样本 + `LMS_FINISH` 终态）。课件仅依赖「任意 LMS 通用」的 postMessage 协议，不引用 `/bridge.js`，验证的是平台通用采集能力而非定制课件；
  - **postMessage → lms-bridge → submission_result 全链路验证**：覆盖 `LMS_SUBMIT / LMS_FINISH / LMS_SAVE_PROGRESS` 三条原生得分通道的 status 映射（`completed / inprogress`）与 `aggregateAttemptScore` 策略聚合（LATEST / MAX / AVERAGE / FIRST × 原始满分 → 目标满分归一化）；
  - **学习情况与学期成绩贯通**：教师端 `/promote` 将课件成绩写入 `assignment_submissions`，经 `grading.ts` 的 `semester-grades` 接口按权重聚合进学期成绩 `assignment_score` 维度；并在 `server/event-routing.ts` 中新增 3 条内核事件 → Socket.IO 班级房间投递路由（问卷/测验发布、关闭、作答实时统计）。

- **互动课堂学生到课与设备就绪监控在线状态全链路精准化修复**：
  - **纠正课前就绪界面传参错位（`src/components/LiveClassroomView.tsx`）**：修复原先将点名互动签到确认映射表（`liveClassAcknowledgedMap.keys()`）误当作在线学生名单传递给 `PreClassReadyView` 的致命缺陷，纠正为真实的 WebSocket 在线名单（`onlineStudentIds`），使已登录连入系统的学生能即时点亮绿色在线状态指示灯；
  - **学生在线双轨容错匹配（`src/features/classroom/PreClassReadyView.tsx`）**：抽离 `isStudentOnline` 判定函数，支持对学生数据库主键 `st.id` 与学号 `st.student_number` 的双轨匹配；在表头状态栏增加「设备连入」动态数与就绪率双重展示；
  - **服务端断开竞态防护与刷新防误杀（`server/presence.ts`）**：在 `socket.on('disconnect')` 中加入 socketId 校验，避免学生刷新页面（F5）或多标签页切换时旧连接断开抹除新连接已注册的在线状态；新增 `request-presence` 实时事件与 `GET /api/presence` REST 端点；
  - **客户端断网重连自动补报自愈（`src/hooks/useClassroomSocket.ts`）**：封装 `syncPresenceAndRooms`，在 `connect` 与 `reconnect` 事件中自动重新注册 Presence 与进入课节房间，确保局域网抖动后学生端可无感重连并自动点亮在线状态。

- **互动课堂课前就绪「班级上课临时密码」与学生双轨登录鉴权**：
  - **班级临时密码替换动态签到码（`src/features/classroom/PreClassReadyView.tsx`）**：将原本纯前端 5 秒滚动的“防代签动态签到码”重构为真实的班级上课临时密码面板。支持大号口令展示、一键复制、🎲 随机生成 4 位高可读数字密码、⏱️ 有效期快捷切换（45分钟 / 2小时 / 今日有效 / 长期有效）、✏️ 自定义口令输入以及 🗑️ 一键清除口令；
  - **双轨登录鉴权体系（`server/routes/roster.ts` & `packages/core/db/index.ts`）**：`classes` 表增加 `class_passcode_expires_at` 字段及自动迁移支持；`POST /api/auth/login` 支持学生双轨登录（优先校验个人自设密码，未命中则验证所属班级上课临时密码及有效期）；严格隔离非本班学生访问；
  - **预留第三方插件扩展槽与数据获取接口（UI Slots & REST API）**：注册 `classroom.preclass.passcode_action` 与 `classroom.preclass.passcode_addon` 插件扩展槽；新增 `GET /api/classes/:id/passcode` 接口供第三方考勤机、电子班牌及外部系统获取实时口令与剩余时效。

- **互动课堂课前就绪界面去重与预计时长健壮性优化（`src/features/classroom/PreClassReadyView.tsx`）**：
  - **精简重复全局按钮**：移除卡片 Header Banner 中与全局顶栏功能完全重复的「学生视角联动Tab」与「全班专注已锁定」两个次级按钮，仅聚焦「🛡️ 环境一键飞检」与突出的主行动点「▶ 一键开启课中授课 (进入白板)」，形成清晰、专业、聚焦的视觉引导层次；
  - **预计时长 NaN 缺陷修复**：在环节时间线时长累计计算中加入对未设置/非数字 durations 的整型安全转换与 45 分钟兜底逻辑，彻底根治未指定课件环节时长时出现的 `预计授课时长: NaN 分钟` 异常。

- **互动课堂控制中心顶栏操作按钮纯图标化与单行排布优化（`src/components/LiveClassroomView.tsx`）**：
  - **纯图标微卡片改造**：将智能授课控制中心顶栏右侧 7 个扩展流程按钮（告警、AI 预测、小组拼板、多屏对比、家校通知、课堂宏、硬件网关）彻底改造为纯图标形式（Icon-only），每个按钮尺寸精简为 `w-8 h-8` 紧凑微卡片，总占用宽度由原本 ~600px 骤降至 ~230px（缩减超过 60%）；
  - **杜绝折叠换行与断层**：即使在笔记本小屏幕、浏览器分屏或侧边栏展开时，右侧工具按钮亦可与左侧课节/班级选择框和全班锁定控制保持平整单行排布，彻底杜绝换行折叠；完整保留 Hover 气泡提示（`title`）与无障碍属性（`aria-label`）。

- **互动课堂启动门户「挑选授课班级」紧凑化与极简 UI 优化（`src/features/classroom/ClassroomEntryPortal.tsx`）**：
  - **高屏效微卡片胶囊**：重构班级大卡片为紧凑胶囊，去除多行冗余提示，卡片高度缩减近 45%（压缩至 36~38px），单行融合圆点状态、班级名称、人数统计与精致的 `✓ 已选` 标识；
  - **多列自适应网格与一体化工具栏**：采用 `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` 自适应网格，搭配内嵌式紧凑搜索栏与班级数统计，大幅降低纵向空间浪费，优化同屏座位图与模式选择的排版体验。

- **课程编辑器环节参数视觉增强与白板组件窗口化管控**：
  - **环节参数高亮**：优化课程编辑器中环节参数配置区域的视觉焦点与高亮动画引导，帮助教师在编辑教案环节时快速定位配置项；
  - **白板组件紧凑化与通用标题栏**：新增 `WidgetTitleBar`，为白板内置各组件（CodeSandbox, HelloWorld, MathGraph, RollCall 等）及第三方插件挂载组件提供统一样式的最大化、还原、最小化与属性配置抽屉按钮，大幅精简白板画布空间占用。
  - **作业卡班级精准绑定**：白板作业卡属性抽屉透传当前课堂 `classId`，实现新建作业卡与班级实体的无缝关联。

### Fixes

- **在线课堂（互动课堂）去 Mock 彻底净化与教师控制信令全网双轨打通**：
  - **课前诊断真实化与去除虚构（`server/routes/lessons.ts` & `src/features/classroom/PreClassDiagnosticHub.tsx`）**：彻底剔除 82% 虚假预习率计算、硬编码物理力学错题卡点与 65%/25%/10% 心态分布伪造；全面采用真实 SQLite 预习与错题聚合，无数据时诚实展示「暂无前置诊断错题」与「等待学生打卡破冰」；
  - **课堂晴雨表去伪存真（`server/routes/classroom.ts`）**：修复在无学生点击脉搏信号（`pulseTotal === 0`）时默认伪造 75/15/10 繁荣指标的缺陷，诚实返回 0% 并置为平稳静默状态；
  - **随堂测验优秀榜假数据根治与测试解耦（`src/features/teacher/TopPerformersWidget.tsx`）**：移除 `DEFAULT_DEMO_PERFORMERS` 5 位假学生初始化占位与兜底；将「⚡ 模拟答题」按钮收敛至 `allowSimulation={true}`（默认在生产教师端彻底隐藏，避免普通界面污染）；增加真实空状态卡片；
  - **教师端控制信令全网双轨广播打通（`src/services/classroom-sync-channel.ts`, `src/components/LiveClassroomView.tsx`, `server/presence.ts`, `src/hooks/useClassroomSocket.ts`）**：将 `ClassroomSyncChannel` 升级为「同机 BroadcastChannel + 分布式跨机 Socket.IO」双轨驱动，服务端增加对 `teacher-broadcast-lock`、`teacher-broadcast-tab`、`teacher-broadcast-lesson` 与 `teacher-sync-message` 的校验转发，使远程跨机真实学生端能实时同步教师切课节、切环节、切Tab与全班锁屏控制。

- **学期成绩计算漏洞修复与无排课同步兜底**：
  - **未交作业与缺考 0 分判定（`server/routes/grading.ts`）**：修复原先班级发布作业或考试后，未提交作业与缺考学生（`scores.length === 0`）被误判为 100 分的严重缺陷；仅在班级未布置任何作业/考试时保留 100 分避免扣分。
  - **`SemesterGradeService` 成绩同步多级兜底（`packages/core/di/semester-grade-service.ts`）**：在无日历排课（`schedules` 查不到 `class_id`）的即兴授课场景下，自动级联查询 `class_students` 及 `plugin_assignments`，彻底避免成绩同步抛错丢失。
  - **课程环节时间线更新序列化兼容（`server/routes/lessons.ts` & `packages/plugins/builtin.ts`）**：修复 `lesson.update_timeline` 接收数组或 JSON 字符串形式时的 `PayloadValidationError`，保证环节增删修改的健壮提交。
  - **命令总线处理程序类型归一化增强（`packages/core/plugin-host/context-builder.ts`）**：增强沙箱插件 `commandBus.registerHandler` 兼容性，统一支持传统函数签名与标准包含 `execute` 方法的 `CommandHandler` 对象，杜绝第三方插件由于调用习惯差异引起的 `handler.execute is not a function` 异常。
  - **学号自动生成 SQL 语法加固（`server/routes/shared.ts`）**：将 `generateStudentNumber` 中原双引号字符串字面量修正为参数化查询 `LIKE ?`，彻底根除 SQLite 抛出 `"no such column: \"S%\""` 导致的 500 异常。
  - **班级学生关联接口字段兼容（`server/routes/roster.ts`）**：在 `POST /api/classes/:id/students` 中增加对 `studentId` 与 `student_id` 双字段名的容错支持。

### Security & Ops

- **平台安全头部、命令鉴权与生命周期加固（Sprint 1: C-1, C-3, C-4, H-2, H-3, H-8, M-6）**：
  - **CSP 指令映射与自适应 HSTS（`server.ts`）**：启用 Helmet 的 `contentSecurityPolicy`，补齐 `default-src`、`script-src`、`style-src`、`connect-src`（支持 Socket.IO 与 API）、`frame-src`（课件与 LMS 嵌入）等指令；根据 HTTPS/环境变量自适应配置 HSTS，避免无证书机房 HTTP 部署被浏览器永久锁死。
  - **插件沙箱移除 `unsafe-eval`（`packages/core/plugin-host/index.ts`）**：在静态文件安全中间件中移除 `'unsafe-eval'`，消除沙箱逃逸敞口。
  - **`/api/commands` 权限收敛（`server/routes/os.ts`）**：将命令总线手动触发端点限定为 `teacher` 和 `administrator` 角色，阻断学生身份执行特权命令。
  - **`trust proxy` 环境变量解耦（`server.ts`）**：支持通过 `process.env.TRUST_PROXY` 灵活配置代理信任层数，直连时默认关闭防伪造。
  - **CORS 规范合规化（`server.ts`）**：杜绝 `Access-Control-Allow-Origin: *` 与 `credentials: true` 共存，严格回填匹配的 Origin 头部。
  - **`gracefulShutdown` 资源真实回收（`server.ts`）**：实现 `cleanup` 闭包，依次执行 `httpServer.close()` 停止接流、`io.close()` 断开客户端、`kernelContainer.db.close()` 确保 SQLite WAL 完整刷盘。
  - **启动期与运行时空 catch 可见性（`server.ts`）**：为 4 处静默 catch 添加日志级别分级记录，启动异常对运维透明可见。

### Tests & Canary

- **金丝雀探针步骤 2（`server/__tests__/canary/canary.step2.test.ts`）**：
  - 接入完整 32 个可解析 Token mock 与 `bootstrapSharedModules()` 真实共享模块；
  - 验证探针自报告落表、Token 全量扫描与白名单加载/拦截机制（8/8 绿）。
- **金丝雀探针步骤 3（双模式全链路矩阵，`server/__tests__/canary/canary.e2e.test.ts`）**：
  - 覆盖 inline 进程内与 worker 工作线程双模式；
  - 全链路测试 131 组断言（包含 DB 隔离前缀、服务发现与多层生命周期，131/131 绿）。
- **金丝雀探针步骤 4（毒丸防御拒绝矩阵，`server/__tests__/canary/canary.step4.test.ts`）**：
  - 实现 8 大毒丸变体（`nested-zip`, `engine99`, `engine02`, `missing-entry`, `bomb` 301MB, `all-method`, `traversal`, `noprovides`）；
  - 验证系统精准防御拒绝，零临时文件泄露，零脏数据残留（8/8 绿）。
- **金丝雀探针步骤 5（生命周期深度回收与社区市场注册表归一化，`server/__tests__/canary/canary.step5.test.ts`）**：
  - 验证 9.1~9.6 深度回收链条（停用状态与 503 路由解绑、权限彻底吊销、心跳定时器销毁、命令注销、卸载级联删除 DB 表与目录）；
  - 验证社区市场注册表 5 组信封变体归一化、重复 ID 过滤、500 条截断上限、SSRF/安全协议白名单拦截及语义版本比对（14/14 绿）。
- **金丝雀探针阶段 7（前端 UI 扩展槽位矩阵与 Playwright 真实渲染 E2E，`e2e/canary-ui.spec.ts`）**：
  - 构建集成 `frontend.js` 与 `manifest.ui.extensionPoints` 的金丝雀安装包；
  - 建立 Playwright E2E 测试体系（`playwright.config.ts`），自动化管理员登录、插件热插拔、数据种子生命周期；
  - **7.1 & 7.6 教师主导航与命令互通**：Tab 挂载、React 面板渲染、Props 注入与 `canary.ping` 跨进程响应（截图凭证：`artifacts/screenshots/canary_teacher_tab.png`）；
  - **7.5 机房座位图 4 槽联动**：真实 API 排座驱动，验证工具栏按钮（`seating.toolbar`）、图例（`legend`）、底部统计指标（`summary`）与座位角标（`seat_badge`）全部渲染通过（截图凭证：`artifacts/screenshots/canary_seating_map.png`）；
  - **7.4 & 7.9 白板工具栏锚点与自动保存**：验证白板工具栏锚点（`anchor:whiteboard-toolbar:rollcall`）与自动保存状态/动作槽位（`autosave.status`, `autosave.action`）（截图凭证：`artifacts/screenshots/canary_whiteboard_editor.png`）；
  - 3/3 端到端真实渲染用例 100% 绿（用时 14.8s）。
- **学期成绩计算回归测试（`server/__tests__/grading-calculation.test.ts`）**：
  - 真实启动 Express 服务与 SQLite 回归断言已发布作业/考试下的零分判定与空班级满分行为（2/2 绿）。

## [0.3.22] - 2026-09-25

### Features

- **课中全班大屏互评后端补齐（Stitch 21e2dac1）**：`src/features/classroom/peer-review/*` 此前只有前端 UI、**零后端表**，界面靠内置 mock 学生/作品/评分渲染。本次补齐完整数据模型与 API：
  - **迁移 `009_classroom_peer_review.sql`**：新增 5 张表 —— `classroom_peer_review_tasks`（分配任务，唯一键含 `target_attempt_id` 防重复分配）、`classroom_peer_reviews`（评语，唯一键支持同人同作品重复改分走 UPDATE）、`classroom_peer_badges`（互赠微勋章，幂等）、`classroom_peer_nominations`（提名按行存储，票数 COUNT 聚合）、`classroom_danmaku`（文字/语音弹幕）、`classroom_peer_rubric_dimensions`（量规维度，会话首次访问自动落库 3 个默认维度）。
  - **新增 `server/routes/classroom-peer-review.ts`（6 端点）**：`POST …/peer-review/auto-assign`（教师一键「1 生评 2 份」，分层对调标杆/攻坚，**不产生自己评自己**）、`GET …/peer-review`（大屏展示全部真实数据：匹配矩阵/徽章流/提名榜/弹幕/量规达标率/进度）、`POST …/peer-review/tasks/:taskId/submit`（防代评：学生只能提交自己的任务，教师例外；越界分数 400）、`POST …/peer-review/badges`（未知 badgeKey 400）、`POST …/peer-review/nominations`（不能提名自己）、`POST …/danmaku`（空文本 400，超长截断 120 字）。
  - **作品池口径（忠于 schema 事实）**：`courseware_attempt` **没有 `lesson_id`**，课节↔课件关联在 `whiteboard_elements(type='html-applet').data.coursewareUuid`。因此分两级：`scope='lesson'` 优先收本教案内嵌课件的作答；不足 2 份时回退 `scope='class'`（本班学生全部作答），响应回传 `scope` 便于教师理解口径；两者都取不到则 400（不伪造作品）。
  - **前端接线**：`LiveClassroomView` 的互评秀场改为消费真实数据，并在空态提供「一键分配互评」按钮（真实调用 auto-assign）。新增 `usePeerReviewData` hook 承载积分榜 + 互评数据 + 分配动作。
  - **测试**：新增 `server/__tests__/classroom-peer-review.test.ts`（16 例：鉴权、作品不足拒绝、class 回退口径、防代评、越界分、重复提交走 UPDATE、徽章幂等、不能自提名、票数聚合、弹幕截断、空态真实姓名校验）。

### Fixes

- **AI 产物泄漏模型思考过程**：`pnpm dev` 浏览器实测发现，推理模型会把 `<think>…</think>` 思考块随正文返回，直接印进家长通知与学情评语。新增 `stripModelArtifacts()`（`server/routes/classroom-extras.ts`）：移除成对/未闭合的 `<think|thinking|reasoning|analysis>` 块（大小写不敏感、跨行）、` ```think ` 围栏、整体 json 围栏；**清洗后为空时回退原文**避免误删成空。家校通知的班级总评与逐生通知、AI 学情预测的 JSON 解析全部走该清洗。新增 7 例单测（含端到端断言产物中不含思考块）。
- **Layout 治理：`LiveClassroomView` 拆分（2562 → 2317 行）**：抽出两个内聚单元 —— `src/components/classroom/ClassroomModalsHost.tsx`（6 个弹窗的编排层，只渲染不持状态，新增课堂弹窗不必再改动巨型组件）与 `src/features/classroom/hooks/usePeerReviewData.ts`（积分榜 + 互评数据 + 一键分配的数据层）。行为零变更，全部现有测试保持通过。

### Docs

- **插件系统文档审计与一致性修复**：全面比对 `docs/` 与代码实现，修复 5 类差异：
  - **类型定义同步**：`PluginContext.services` 补齐 `pointsDimension`/`pointsLedger`（7→9 服务），同步 `types.ts`、`context-builder.ts`、`plugin-test-kit`。
  - **API 端点更正**：`plugin-registry.md` 中 `upload`→`upload-zip`/`upload-zip-raw`，`store`→`market`+`community`。
  - **共享模块白名单**：`xlsx`→`exceljs`。
  - **ExtensionSlot 补全**：从 9 个补全到 42 个，渲染器表格从 9 行扩到 40 行。
  - **DI Token 字典**：计数 29→33，新增 4 个课堂/课件 Token。
  - **版本号清理**：19 篇文档添加 `<!-- doc-version: sdk=3.7.0 -->` 元数据标记；消除所有 `v5.1`/`v5.2` 内部里程碑标记，替换为实际平台版本（`v0.2.8`/`v0.3.17`/`v0.3.x`）；SDK 版本引用统一至 `3.7.0`。
- **记录 worker 模式积分服务缺口**：`packages/core/worker-runtime/worker-manager.ts` 的 `ALL_SERVICE_TOKENS` 补充说明性注释 —— 该白名单**不含**积分系统两个 token，故 WORKER 模式插件取积分服务时降级为插件内自建（不阻塞激活）。实测把 token 直接加入白名单会让 worker 插件激活阶段抛 `function () { [native code] } could not be cloned`（worker RPC 通用转发路径尝试克隆函数值），需先修 `service-host.ts` 通用转发再放行；inline 模式已在 `plugin-host/context-builder.ts` 完成转发。

- **课堂数据真实化治理（消除 12 处伪数据来源）**：上课流程中原有 12 处「非真实来源」的数据（硬编码学生、伪计算分数、空数组占位），导致 AI 生成、学情简报、雷达图等输出失真。本次全部改为**可追溯的真实来源**，无数据时显式降级为空态而非编造：
  - **新增共享派生层 `src/features/classroom/hooks/useClassroomLiveData.ts`**：把 `LiveClassroomView` 已有的 props/state（`liveClassStudentProgress` / `onlineStudentIds` / `liveClassFeed` / `timelineSegments` / `attempts` / `session.started_at`）统一派生为逐生指标、课堂亮点、环节节奏、已用时长，**不新增任何网络请求**。核心原则：无数据 → `0 / undefined / []`，绝不给「看起来合理」的假值。附带 17 例单测锁定该不变量。
  - **`LiveClassroomView` 4 个流程页面的数据泵**：`participationScore: 60` → 真实 `progress_percent`；空 `highlights` → 真实 `liveClassFeed` 事件；空 `stages` → 真实 `timelineSegments`；`elapsedMin=0` / `plannedTotalMin=45` → 真实 `session.started_at` 与教案时长；`paceIndicator` 由真实进度分级派生；`quizScore` 由真实 `courseware_attempt` 取最高分（排除 teacher/guest 占位）。
  - **`server/routes/classroom.ts` panoramic-report 增加逐生真实明细**：新增 `students[]` 字段，聚合 `lesson_quiz_submissions`（平均分 / 正确率）、`classroom_poll_votes`（投票次数）、`classroom_exit_tickets`（通票评分），并按班级花名册补齐未互动学生（`attendance=false`）。
  - **`ClassroomBriefingView` 伪计算移除**：`quizScore = 80 + ((i * 7) % 21)`、`pollsAnswered = 2 + (i % 3)`、`rating`、`status`、`note` 全部改为消费上述真实明细；无数据字段渲染「—」而非假数字（表格与 CSV 导出同步）。
  - **学生五维雷达图诚实化**：`StudentGrowthProfileModal` 移除 `?? 95/90/88/96/98` 硬编码兜底（旧实现让每个学生雷达图几乎相同）。现在仅使用调用方传入的 `competencyScores`，缺失维度标记 `available: false` → 雷达多边形虚线灰化并提示「暂无数据」；综合评级与 AI 评语改为**由真实维度均值派生**（不再输出「循环变量步长表现出超前理解力」这类无据结论）；时间线移除 4 条内置编造事件，改为空态提示。`ClassroomAttributionModal` 补充 `competencyScores` 透传，`StudentGrowthProfileModal` 的 `role`/`group_name`/`student_number` 缺失时不再编造「组长 / 飞鹰极客队 / 240101」。
  - **`ClassroomLeaderboardModal` 分组与积分真实化**：移除假小组名（飞鹰极客队等）与写死的 `baseScore: 104` / `growth: '+14'`；改为按真实 `groupName` 分组、组内真实积分求和排序，无数据渲染空态；移除 `currentPoints ?? 28`、`focusScore ?? 98` 兜底。
  - **互评秀场真实数据接入**：`PeerReviewShowcaseModal` 移除 `// Initial Mock Data` 中的假学生（张子豪 / 陈子墨 / 李晓彤…）、假作品、假评分、假倒计时，改为 props 驱动（`workA` / `workB` / `matchingItems` / `badges` / `rubricDimensions` / `reactions` / `podiumStudents` / `danmaku` / `reviewProgress` / `countdownSeconds`）；`LiveClassroomView` 用真实课件作答前 2 名作为焦点对比作品、真实积分榜作为提名榜。平台当前无课中互评任务表，相应区域渲染空态并说明原因。`PeerReviewLeaderboardPanel` / `SpotlightDualWorkArena` 的硬编码姓名改为 props 驱动（无数据时按钮禁用）。
  - **未改动的合理默认值**：`ClassroomCountdownWidget` 的 `|| 300` 是倒计时预设时长、`timelineSegments` 的 `|| 300` 是环节默认时长，属合法默认而非伪数据，保持原状。

- **上课流程四页面扩展（家校通知 / AI 学情预测 / 异常告警中心 / 小组协作白板）**：从「上课流程完整性」出发补齐四个课上/课后环节，全部挂在 `LiveClassroomView` 顶栏入口，均支持 `lang: 'zh' | 'en'` 与四套主题语义 token：
  - **#1 家校通知生成器（post-class）**：新增 `src/features/classroom/notifications/ParentNotificationModal.tsx` + 服务端 `POST /api/classroom/:lessonId/parent-notification`（限教师/管理员）。产物 = 全班 Markdown 学情简报（出勤率 / 课堂总评 / 亮点 / 各阶段节奏偏差）+ 逐生家长通知（AI 按参与度、测验、行为标签生成 ≤ 80 字中文简报）；支持「全班简报 / 逐生通知」双 Tab、学生侧栏切换、一键复制到剪贴板、导出 `.md`。**AI 失败降级**：单生 AI 抛错时该生回落模板（`致 xxx 家长` + 参与度/行为标签拼接），互不影响；全班 AI 失败同样回落模板，整体仍 200。
  - **#2 AI 实时学情预测（in-class）**：新增 `src/features/classroom/pacing/MasteryPredictionModal.tsx` + 服务端 `POST /api/classroom/:lessonId/predict-mastery`。**一次 AI 调用批量预测全班**（避免 N 次调用），输出每生 5 维掌握度（算法逻辑 / 代码工程 / 创新思维 / 团队协作 / 课堂专注）+ `risk: low|medium|high` + 一句话说明；顶部课堂进度条（elapsed/planned）与风险聚合徽标，支持「风险优先 / 综合掌握 / 姓名」三种排序。**AI 不可用时自动降级**为启发式（参与度基线 ± 测验校正，`stalled`/低参与度判高风险），并在 UI 标注「降级模式」，`aiSucceeded` 字段回传前端以供区分。
  - **#3 课堂异常告警中心（in-class）**：新增 `src/features/classroom/diagnostics/DiagnosticCenterModal.tsx`，直接消费既有 `errorStore.studentErrors` / `errors`（不新增后端依赖）。提供「学生端异常 / 本机异常」双 Tab + 严重度徽标计数、按 `SystemErrorType`（react / promise / runtime / api / custom）筛选、单条移除、一键清空、**复制全部学生 ID**（供 IT 批量排查）。复用 `src/types/error.ts` 真实类型，不再重复定义。
  - **#4 小组协作白板（in-class）**：新增 `src/features/classroom/collab-whiteboard/GroupCollabWhiteboardModal.tsx`。零依赖 SVG 画布实现（不引入第二套绘图库）：四支工具（笔 / 矩形 / 圆形 / 橡皮）+ 8 色调色板 + 笔触粗细；默认 4 个小组、可新建/删除、按学生「+ / −」手动派位、一键随机自动分配；支持「仅当前组 / 查看全部」叠层对比、单组清空、当前组导出 SVG。实时多人同步预留扩展点 `classroom.collab.canvas`（当前为前端 in-memory 状态，注释标明后续接 socket 广播）。
  - **插件扩展槽位**：新增 4 个槽位 `classroom.notification.tabs` / `classroom.pacing.dashboard` / `classroom.diagnostic.feed` / `classroom.collab.canvas`，四个新页面各自的关键区域均可插件接入而不改宿主。
  - **测试**：新增 `server/__tests__/classroom-extras.test.ts`（10 例：匿名 401 / 学生 403 / 参数校验 400 / AI 成功 / AI 抛错降级 / AI 垃圾 JSON 降级 / 风险判定）与 4 个组件测试（`ParentNotificationModal` 5 例、`MasteryPredictionModal` 7 例、`DiagnosticCenterModal` 8 例、`GroupCollabWhiteboardModal` 8 例），共 38 例。

- **互动课堂起始门户与教学模式体系 (Classroom Entry Portal & Teaching Modes)**：对应 Stitch「课程入口与班级选择门户」设计，教师进入「互动课堂」先看到门户页而不是直接进入无准备的课堂：
  - **起始门户页**：新增 `src/features/classroom/ClassroomEntryPortal.tsx`。顶部遥测岛（系统时钟 / 网络时延 / 席位就绪率 / 主控大屏）、STEP1 课程卡片马赛克、STEP2 班级标签 + **32 席位矩阵**（按 4 组分组、在线态着色）+ 教学模式选择器、底部粘性启动区；右辅栏为教案蓝图与 45 分钟节奏管道（按环节 `duration` 计算占比）、课前学情透镜与三项自检体检卡。全部使用项目语义 token（`bg-surface` / `text-main` / `border-theme` / `bg-primary-theme`…），四套主题自动一致；图标沿用 lucide-react，不引入第二套图标库。
  - **六个插件扩展槽位**：新增 `classroom.portal.telemetry`（遥测岛指标）/ `course_badge`（课程卡徽章）/ `teaching_mode`（自定义教学模式）/ `insight`（课前洞察卡）/ `preflight`（课前检查项）/ `launch_action`（启动区附加操作），门户六个区域均可用插件接入而不改动宿主。AI 课前洞察的**内置实现同样走 `classroom.portal.insight` 槽位**，插件可直接替换。
  - **教学模式后端表与 API**：`migrations/008_teaching_modes.sql` 新增 `teaching_modes` 表与 `classroom_sessions.teaching_mode_id`；`server/routes/classroom.ts` 提供 `GET/POST/PUT/DELETE /api/classroom/teaching-modes` 与 `PUT /api/classroom/sessions/:lessonId/teaching-mode`，`init` 端点亦可携带模式。读开放、写限管理员；内置 5 种模式（讲授 / 探究 / 协作 / 体验 / 练习）以**代码常量兜底、不写进迁移 seed**（避免迁移与业务文案两处维护），内置模式不可删除但可改写文案；前端封装见 `src/features/classroom/teaching-modes-client.ts`。
  - **网络时延探测**：新增 `GET /api/ping`（不鉴权、不访库、无副作用，供登录页等未认证场景复用）与 `src/hooks/useNetworkLatency.ts`（模块级单例探测，多组件订阅共用同一轮询；探测失败时保留上次时延但降级质量，避免误导教师）。
  - **接入方式**：`LiveClassroomView` 新增 `initialPortalOpen`（默认 `true`）。门户确认后先调用 `init`（携带所选教学模式）再切换到授课视图；**初始化失败不切视图**，避免出现「界面已进课堂但服务端无会话」的割裂状态。
  - **测试**：`server/__tests__/teaching-modes.test.ts`（19 例：鉴权、内置模式兜底与顺序、CRUD、内置不可删可改写、非法 id/重复 id/缺 name 拒绝、课堂模式落库与清除）与 `src/features/classroom/__tests__/ClassroomEntryPortal.test.tsx`（20 例：三栏渲染、空态引导、课程/班级选择、席位矩阵在线态、教学模式加载与切换、启动回调 payload、初始化失败提示、节奏管道与课前关注）。

- **插件中心社区市场 (Community Plugin Registry & One-Click Install)**:
  - **远端注册表与后端代取**：新增 `server/services/community-registry.ts`，由服务端通过环境变量 `PLUGIN_COMMUNITY_REGISTRY_URL` 代取社区注册表 JSON。经 `GET /api/plugins/community`（要求有效会话）归一化后返回，前端无需处理 CORS 与远端格式差异；未配置地址时返回 `configured: false` 并展示配置指引，而非报错。
  - **注册表格式容错**：同时兼容 v1 信封（`{ version, plugins: [...] }`）、`items` 别名与裸数组；缺少 `id`、id 非法、缺少 `downloadUrl` 或下载地址未通过出站安全校验的记录被整条丢弃并以 `skipped` 计数回传；重复 id 保留首次出现；`homepage` / `repository` 不安全时置空但保留条目；失败结果不写入缓存。
  - **安装与更新**：新增 `server/routes/plugins.ts` 的 `POST /api/plugins/install-from-url`（管理员专属），服务端下载 ZIP 后交由 `PluginDistributionManager` 安装；`expectedId` 已在本机安装时自动改走 `updateFromZip`（`allowDowngrade` 默认关闭）。服务端下载失败返回 `fallbackToClient: true`，前端改为浏览器下载并以 `application/octet-stream` 直传既有的 `/api/plugins/upload-zip-raw`，与「一键热更新」同一兜底策略。
  - **出站安全校验复用**：将原本内联在 `server/routes/plugins.ts` 的 `isSafeExternalUrl` 提取为共享工具 `server/utils/url-safety.ts`（逻辑逐字节保持等价，消息文案不变），插件更新、AI 供应商连通性测试与社区市场现共用同一份 SSRF 防护实现；插件包下载额外限制 60 秒超时与 200MB 体积上限。
  - **社区页 UI**：新增 `src/components/plugin-center/sub-views/PluginCommunityPanel.tsx`，作为插件中心顶部 **社区 (Community)** 标签页挂载。提供预览卡片（图标/作者/版本/认证与精选角标/描述/标签/权限数量/下载量与收藏数/源码与主页外链）、关键词搜索、高频标签筛选、三种排序与「隐藏已安装」开关，以及骨架屏、可重试错误态、空注册表、筛选无结果、未配置指引等完整状态覆盖；安装成功后卡片立即进入已安装态并触发插件列表刷新（插件前端贡献点在启动时注册，需重新加载页面方生效）。
  - **安装状态标注**：服务端对照本地 `plugins` 表的 `manifest.id` 与版本，为每条注册表记录填充 `installedVersion` / `hasUpdate`，注册表本身无需提供；版本比较对注册表与本机两侧的版本号均做 semver 校验，避免被改坏的 manifest 版本（如 `nightly`）导致整个市场请求失败。
  - **测试**：新增 `server/__tests__/community-registry.test.ts`（归一化、排序、重复与非法条目、安装状态标注、缓存命中/过期/强制刷新/失败不缓存、超时与 5xx、SSRF 拦截、下载体积与空包限制，71 例）、`server/__tests__/community-routes.test.ts`（匿名 401、教师可读但不可装 403、参数校验、`file:` 协议/回环/云元数据端点/私网地址拦截，10 例）与 `src/components/__tests__/PluginCommunityPanel.test.tsx`（卡片渲染、筛选与排序、安装成功、浏览器直传回退、403 提示、已安装与可更新态，18 例）。
  - **文档**：新增 `docs/plugin/community-plugin-registry.md`，记录环境变量配置、注册表 JSON Schema 与字段说明、两条接口契约、归一化容错策略与前后端实现索引；`.env.example` 补充 `PLUGIN_COMMUNITY_REGISTRY_URL` 说明。

- **互动课堂与课程编辑器全局架构优化及第三方插件生态体系 (Interactive Classroom & Lesson Editor Optimization with Plugin Ecosystem)**:
  - **四阶课堂生命周期状态机与中控台 (Classroom Stage State Machine & Cockpit)**:
    - `server/services/classroom-runtime-service.ts`：实现高可用课堂生命周期状态机，定义 `PRE_CLASS_READY`（课前就绪）、`IN_CLASS_TEACHING`（课中授课）、`WRAP_UP_EXIT_TICKET`（结课通票）、`ARCHIVED_REPORT`（学情归档简报）四阶流转；
    - 支持前置守卫钩子（`StageGuardHook`）与流转监听拦截，允许第三方插件在切阶前进行条件阻断或后续联动（如课件同步、随堂测触发）；
    - `src/features/classroom/ClassroomInteractiveCockpit.tsx`：为教师端中控台提供一键阶梯式教学流转控制栏、节奏晴雨表、极速点名/投票/抢答快捷交互与大屏展台唤起。
  - **大屏教学展台 (Projector Stage Display View)**:
    - `src/features/classroom/StageDisplayModal.tsx`：为多媒体教室与大屏投影场景打造暗色高对比度专属展台，集成当前教学环节、大屏高精度时钟、动态投屏签到码、极速抢答夺魁光效看板、极速投票柱状图与实时节奏晴雨表。
  - **学生端极简实时响应与极速互动 (Student Interactive Overlay & Real-time SRS)**:
    - `src/features/student/StudentInteractiveOverlay.tsx`：为学生端（含独立 Tab/弹窗联动模式）打造非侵入式悬浮互动条，支持「听懂了 💡 / 有疑问 ❓ / 讲太快 🐇」瞬时步调反馈、毫秒级一键抢答按钮、极速单选答题卡及 60 秒下课通票打卡。
  - **全链路第三方插件可扩展能力架构 (Third-Party Plugin Extensibility Ecosystem)**:
    - 扩展槽位 `classroom.quick_activity`：允许第三方插件以极简声明式组件向教师端中控台注册自定义即时互动卡片/操作；
    - 扩展槽位 `stage.display.card`：允许第三方插件向多媒体大屏展台投送专属展示看板与数据可视化图元；
    - 课程编辑器步骤扩展：`src/features/teacher/lesson-editor/timelineConfig.ts` 引入 `registerCustomSegmentType` 与 `customSegmentTypes` 动态注册表，支持第三方插件扩展自定义教学环节（如分组研讨、科学探究实验、随堂辩论）；
    - 插件 SDK 与依赖注入：`packages/core/di/interfaces.ts` 与 `@openlearn/plugin-sdk` 暴露 `IInteractionRuntimeServiceToken`，允许插件调用服务端统一状态广播、抢答判定与活动生命周期。
  - **原子并发安全抢答与随堂测原子 Upsert (Atomic Concurrency Protection)**:
    - 抢答状态机采用 `UPDATE classroom_buzzers SET ... WHERE status = 'READY'` 原子 CAS 语句，杜绝并发网络包下的并列第一争议；
    - 修复随堂测关系型提交漏洞，`server/routes/lessons.ts` 的 `/api/lessons/:id/quiz-submit` 在原有 JSON 写入之外新增 `lesson_quiz_submissions` 关系行级 upsert（`ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE`），避免多学生同时交卷时 read-modify-write 覆盖同伴作答；唯一键含 `lesson_id`，同一元素在多个课节复用时也不会跨课节互相覆盖。

- **学生端异常教师端实时感知、系统日志审计与端侧极简角标 (Student Exception Telemetry & Low-Visibility Diagnostics)**:
  - **端侧异常上报与系统审计日志持久化**：
    - `src/hooks/useGlobalErrorCapture.ts` 与 `src/store/errorStore.ts`：新增错误订阅机制 `registerErrorListener`。当学生端（处于 `role === 'student'` 或 `student_live` 模式）捕获到 React 崩溃、Promise 异常、JS 运行时错误或 5xx 接口故障时，自动提取学生学号/ID、学生姓名、课节及班级上下文，通过 Socket.IO 发送 `student-client-error`（并提供 `/api/diagnostics/report` 作为断网或重连期间的 HTTP Fallback）；
    - `server/presence.ts` 与 `packages/core/kernel/index.ts`：服务端接收后向控制台输出警告日志，并通过内核 `eventBus.publish({ type: 'student.client_error' })` 自动将完整错误载荷持久化记录至 SQLite `events` 审计日志表（可供 `/api/events` 追溯查询）；
  - **教师端实时多维感知**：
    - `src/hooks/useClassroomSocket.ts`：监听 `student-error-alert` 事件，在教师/管理员端触发黄色 Toast 警示气泡并记录入 `errorStore.studentErrors`；
    - `src/components/LiveClassroomView.tsx`：在在线互动课堂顶部状态栏展示「学生端异常 (N)」快速入口，并在学生头像圆环卡片与学生详情列表中对发生异常的学生渲染红色脉冲感叹号角标，支持一键点击直达该学生的排查日志；
    - `src/features/modals/SystemErrorCenterModal.tsx`：为教师端引入「本机异常」与「学生端异常」双标签页切换，支持查看学生详细报错堆栈并一键导出 Markdown 诊断报告；
  - **学生端低可见度与低干扰改造**：
    - 降低学生端异常浮窗的视觉侵入性，将以往大尺寸的文本气泡替换为**屏幕左下角极简感叹号圆形图标加红色数字角标**，保留点击查看排查报告能力的同时最大限度降低课堂上对学生专注度的干扰。

- **通用「结算页自动上报」（不主动提交的课件也能拿分）**：部分互动课件答完题后直接切到结算/结果页（如「闯关结束·…」），既不调用 `LMS.submit`，也没有匹配「提交/完成」关键词的按钮，导致旧的“按钮点击 → 抓分”逻辑无法触发。现于 `server/utils/bridge-sdk.ts` 的 `initAutoSubmit` 中新增独立的 `ResultWatcher`：
  - 用 `MutationObserver`（debounce 600ms）监听可见文案，命中强结束信号（`闯关/挑战/答题/测试/游戏/本轮/本关` + `结束/完成/成功`、`通关`、`结算`、`查看解析`、`正确率`、`最终得分`、`总得分` 等）才启动；
  - 抓分口径优先「正确题数 `X/Y` → 百分制」（如 `#correctCount = 12/15 → 80`），否则回落**可见**的分数元素；
  - 仅从可见元素取值（`getBoundingClientRect` + 祖先 `computedStyle` 判定），避开结算页未展开时隐藏的初始值 `0`；
  - 展开后短轮询（`0/120/250/400/700/1100ms`）取最后一次有效分数，**每次作答只上报一次**（`__lmsResultSubmitted` 幂等门）。
  - 验证：用 jsdom 还原该课件的结算页，答题中命中 `第 3 / 15 关` **不**触发；调用 `showResult()`（`#correctCount=12/15`）后仅上报一次 `{score:80,completion:1}`。

- **高频轮询引发的终端指令日志刷屏治理 (CommandBus Logging Noise & Polling Debounce Fix)**:
  - **问题背景**：用户处于互动课堂或白板模式时，终端持续高频输出 `[CommandBus] Executing: courseware.list (ID: 01a0becb-...) by user:usr_admin:administrator`，且因 UUIDv7 携带毫秒时间戳而导致命令 ID 不停递增变化，造成严重的终端日志刷屏。
  - **后端 CommandBus 读写分离静默与元数据扩展**：
    - `packages/core/command-bus/index.ts`: 在 `CommandMetadata` 接口中扩展 `silent?: boolean` 选项；新增默认只读静默指令集合 `DEFAULT_QUIET_COMMANDS`（包含 `courseware.list`, `courseware.get_attempt_raw_data`, `whiteboard.query`, `whiteboard.get_element`, `vfs.read_path`, `vfs.list_dir` 等高频查询）；
    - 仅在非静默指令或设置了 `DEBUG_COMMAND_BUS=true`/`DEBUG=*commandbus*` 时才输出 `[CommandBus] Executing...` 控制台日志，错误日志（`console.error`）与业务数据变更类（Mutation）指令不受影响；
    - `server/routes/courseware.ts`: 在 `GET /api/courseware` 路由中，创建 `courseware.list` 指令时标记 `{ silent: true }`。
  - **前端白板课件拉取防抖与模块级客户端缓存**：
    - `src/features/whiteboard/InteractiveWhiteboard.tsx`: 建立模块级单例缓存 `globalCoursewareCache`（30 秒 TTL + in-flight 请求 Promise 复用去重），避免组件重渲染或重新挂载时频繁发送 `/api/courseware` 请求；在上传新课件时仍可通过 `{ force: true }` 即刻穿透刷新缓存；
    - 精确选中追踪：引入 `lastSelectedCoursewareElementRef`，避免白板 `elements` 数组因心跳轮询更新而持续触发 `fetchCoursewares()`，仅在用户切换选中目标为 `html-applet` 图元时才触发选项拉取。
  - **根组件轮询状态防抖优化**：
    - `src/App.tsx`: 在 `fetchElements` 中引入 `lastElementsJsonRef` 内容浅对比，当课节白板图元数据未发生实质变更时不再调用 `setElements`，消除 2 秒一次轮询引起的全树无谓重渲染。
  - **验证**：核心单元测试与 E2E 流程（`command-routing.test.ts`、`courseware-e2e-flow.test.ts` 以及白板 75 项交互测试）全部通过；终端日志刷屏彻底消除。
- **桥接抓分正则过度转义（数字/分数从未能解析）**：`bridge-sdk.ts` 内嵌于模板字符串中的正则误写成 `\\d` / `\\s`，生成到课件的实际 JS 里是 `\\d`（匹配字面反斜杠 + `d`），导致 `findScoreInDOM` 的分数/分数值解析（`12/15` 等）全部失效。已修正为 `\\d`/`\\s`（即输出 JS 的 `\d`/`\s`），并新增正则自检。
- **AI Provider 密钥解密分叉（插件 AI 调用 401）**：`packages/core/di/ai-service.ts` 曾自带一份 `decryptKeyIfNeeded`，只读 `process.env.ENCRYPTION_KEY`，且在密钥缺失/为空时**静默返回密文**；而「AI Provider 测试」与各业务路由走 `server/utils/crypto.ts`（含 `.env` 回退）。二者实现分叉导致典型故障：**测试按钮通过，但插件 `ctx.services.ai.generateText()` 把密文当作 Bearer 发出，上游返回 `401 login fail: Please carry the API secret key`**。生产 `ecosystem.config.cjs` 将 `ENCRYPTION_KEY` 显式置为 `''`，而 `dotenv` 不会覆盖已存在的空值变量，因此该问题在 PM2 部署下必现。
  - 新增 `packages/core/di/api-key-crypto.ts` 作为唯一事实来源（`getEncryptionKey` / `encryptApiKey` / `decryptApiKey` / `looksLikeCiphertext`），密钥解析顺序：`process.env` → `.env` 文件 → 自动生成并持久化（仍不覆盖已有行）；
  - `server/utils/crypto.ts` 改为从该模块转发导出（保持既有导入路径与可用 API 不变），杜绝再次分叉；
  - `AIService.generateText` 改用共享 `decryptApiKey`，并在解密结果仍是密文时抛出可操作的错误（提示 ENCRYPTION_KEY 不一致 / 需重新保存 API Key），不再向上游发送密文换取难以定位的 401。
  - 验证：`packages/core/di/__tests__/ai-service.test.ts` 通过；`tsc --noEmit` 0 错误；在“正常 / `ENCRYPTION_KEY=''`（PM2 场景）/ 密钥被轮换”三种场景下探测 AIService，分别为成功、成功（回退 `.env`）、抛出明确解密错误。

### Features

- **课件成绩「按策略留分」归集原生化 (Native Courseware Score Policy Aggregation)**：此前「按 `LATEST` / `MAX` / `AVERAGE` / `FIRST` 策略从多次提交里算最终分」只存在于第三方插件 `interactive-courseware` 的私有表里，宿主记录的 `submission_result.score` 恒等于**最后一次**上报值 —— 学生反复作答时「最高分」策略形同虚设，且停用该插件后这层能力一并消失。现在配置与聚合都由平台自己完成：
  - **迁移 `migrations/004_courseware_score_config.sql`** 新增 `courseware_score_config` 表：`courseware_id`（主键）、`courseware_name`、`raw_full_score`（课件自身满分，默认 100）、`target_full_score`（课程目标满分，默认 100）、`weight_percentage`（权重%，默认 100）、`score_policy`（默认 `LATEST`）、`score_fields`（从提交载荷取分的字段路径，逗号/分号分隔，留空自动探测）、`lesson_id`、`updated_at`；并对 `lesson_id` 建索引；`migrations/README.md` 的迁移清单同步登记；
  - **新增纯函数模块 `packages/plugins/courseware-score.ts`**：`getNested`（点号路径）/ `toNumber`（兼容尾随 `%`）/ `parseScoreFields` / `extractScoreFromFields` / `collectScoreSamples` / `aggregateScores` / `clamp` / `round2` —— 无副作用、无 IO，供命令处理器与 HTTP 路由共用，杜绝两处口径漂移；
  - **`courseware.submit_attempt` 按策略聚合**：原始载荷先追加进 `submission_raw`（保持 append-only 流水），随后按该课件配置从**全部样本历史**取分、按策略聚合、按 `raw_full_score → target_full_score` 归一化后写入 `submission_result`；未配置的课件走内置默认（`LATEST`、不折算），行为与改动前完全一致。`POST /api/courseware/attempts/:attemptId/log` 同源同口径接入（该路径的分数抽取口径与 `/submit` 不同，必须复用同一聚合函数才不会算出两个分数）；
  - **新增四个原生命令**：`courseware.get_score_config`（`lesson:read`，回传 `source: 'courseware' | 'global' | 'builtin'` 标示配置来源）、`courseware.save_score_config`（`lesson:write`，保存后广播 `courseware.score_config_saved`）、`courseware.list_score_configs`（`lesson:read`）、`courseware.regrade_attempts`（`lesson:write`，按 attemptId 或 coursewareId 重算历史成绩，改策略后无需学生重做）；
  - **权限口径**：这四个命令刻意声明 `lesson:read` / `lesson:write` 而非 `courseware:read` / `courseware:write` —— 后者不在任何角色兜底能力集内（教师兜底为 `lesson:*` / `whiteboard:*` / `management:*` / `quiz:*` / `vfs:*` / `process:*` / `plugin:*`），用 `courseware:*` 会把教师挡在门外；跨插件调用时需透传调用者原始 `actorId`（`commandBus.createCommand(type, payload, command.actorId)`）以延续其角色身份。
  - 验证：新增 `packages/plugins/__tests__/courseware-score.test.ts`（16 例：字段抽取、样本收集、四种策略、归一化与权重、边界钳制）全部通过；`server/__tests__/courseware-e2e-flow.test.ts` 与 `courseware-attempts-filter.test.ts` 回归 8 例全绿；宿主 `tsc --noEmit` 在本轮改动文件上 0 错误。
- **分数变量监视器原生化 (Native Score Variable Monitor)**：监视器此前由第三方插件经上一版新增的「课件运行时脚本扩展点」注册 —— 方向正确，但**插件停用即失去采集能力**，且白板 `srcDoc` 路径（客户端注入 `/bridge.js`，不经服务端 `injectLmsSdk`）根本拿不到运行时脚本。现在由平台自有：
  - **新增 `packages/plugins/score-monitor-script.ts`**（与 `courseware-score.ts` 同层，避免 `packages → server` 反向依赖）：与插件版行为等价的零依赖脚本，三层采集（`window.__LMS_WATCH__` 显式声明 → window 上名字匹配 `score|point|grade|mark|correct|right` 的有限数值属性自动发现 → 14 个分数类元素的**可见**文本兜底，键名形如 `dom__score`，比例文本 `a/b` 归一化到百分制，同元素按选择器去重）；变量变化后静默 1200ms 以 `LMS.saveProgress({ score, watch })` 上报一次样本（无 `window.LMS` 时回退 `parent.postMessage`），单会话上限 60 次，`window.__LMS_WATCH__ === false` 或 `window.__LMS_WATCH_DISABLED__ === true` 可关闭；`init()` 会把 `{ stop() }` 登记进 `window.__LMS_SCORE_WATCHERS__`，便于运行期排障与测试回收；
  - **由内置插件注册**：`packages/plugins/builtin.ts` 的 `activate()` 以 owner `@openlearn/plugin-builtin`、`id score-variable-monitor`、`position body-end`、`priority 200` 注册进扩展点，`deactivate()` 时 `clear(owner)`；注册失败仅告警，不影响内核启动；
  - **覆盖白板 `srcDoc` 路径**：`GET /bridge.js` 支持 `?cw=<coursewareId|lessonId>&name=<名称>`，把命中该课件的运行时脚本追加在 Bridge SDK 之后返回（`collectCoursewareRuntimeScripts` 相应改为导出）；`src/features/whiteboard/utils/bridgeUtils.ts` 的 `wrapSrcDocWithBridge()` 改为注入 `/bridge.js?cw=<lessonId>`，使白板里手写的 HTML 课件同样获得抓分与采样能力；
  - **脚本字面量安全**：全段不含任何反斜杠转义序列（用 `[0-9]` 代替 `\d` 并改用 `+` 拼接而非模板字符串）、不含 `</script` —— 这两条正是历史上「正则双重转义导致抓分全部失效」与「模板字符串被 `</script>` 截断」两个事故的根因，现以断言测试长期守护；
  - **插件 v1.0.31 相应瘦身**：`interactive-courseware` 删除 `src/score-monitor-script.ts` 与注册/撤销代码（避免双份监视器对同一批变量重复上报样本），并把成绩配置读写改为「平台原生优先」—— `grade.set_config` 写透到 `courseware.save_score_config`、`grade.get_config` 优先读 `courseware.get_score_config` 并回写本地镜像表，保证插件面板与官方成绩口径一致。
  - 验证：新增 `packages/plugins/__tests__/score-monitor-script.test.ts`（jsdom，10 例：字面量安全 / 空闲零上报 / 变量变化一次上报 / 显式声明路径 / DOM 兜底 / 比例文本 / 两处开关 / 无 attempt 不上报 / 无 `window.LMS` 时回退 `postMessage`），并扩展 `builtin.test.ts` 断言 activate 后注册表内存在原生监视器；插件侧 `tsc --noEmit` 0 错误，ZIP 通过平台 `validateAndBundleZip` 校验。
- **课件运行时脚本扩展点（Courseware Runtime Script Extension Point）**：互动课件跑在 `<iframe credentialless sandbox="allow-scripts allow-forms allow-downloads">`（**无** `allow-same-origin`）里，是不透明源（opaque origin）——父窗口读不到它内部的任何状态，服务端拼接 HTML 是平台唯一能向课件投递代码的位置。此前该位置只硬编码了 Bridge SDK，现把这条通道抽象为**可被插件注册的公开扩展点**，宿主不再替业务决定「课件里该跑什么」：
  - **新增内核服务**：`packages/core/di/courseware-runtime-script-registry.ts` 的 `CoursewareRuntimeScriptRegistry`，接口与 Token（`CoursewareRuntimeScript` / `IRegisteredCoursewareRuntimeScript` / `ICoursewareRuntimeScriptRegistry` / `ICoursewareRuntimeScriptRegistryToken`，Token 名 `@openlearn/core:ICoursewareRuntimeScriptRegistry`）定义在 `packages/core/di/interfaces.ts`，并在内核 `constructor()` 中随其他 `IService` 一起注册；`packages/core/di/index.ts` 与 `@openlearn/plugin-sdk` 均已导出；
  - **注册语义**：`register(owner, { id, source, position?, priority?, coursewareId?, coursewareUuid? })` —— `id` 在 owner 内唯一，同一 `owner::id` 重复注册即覆盖（便于热更新）；不指定 `coursewareId`/`coursewareUuid` 则对所有课件生效，指定则精确匹配；`position` 取 `'head'`（紧跟 Bridge SDK）或 `'body-end'`（默认，`</body>` 前）；同位置按 `priority` 升序、插入序次之拼接，顺序确定。配套 `unregister(owner, id)` / `clear(owner?)` / `list(courseware?)` / `listOwners()`；
  - **注入实现**：`server/routes/shared.ts` 的 `injectLmsSdk()` 新增 `collectCoursewareRuntimeScripts(cwInfo)`，把 head 脚本拼在 Bridge SDK 之后、body-end 脚本插在 `</body>` 之前（无 `</body>` 则追加到末尾），每段脚本前带 `<!-- Courseware Runtime Script (owner/id) -->` 注释便于排查；**服务未注册、`list()` 抛错或没有任何脚本时全部静默降级**，既有课件渲染路径零影响；
  - **插件接入方式**：可直接从 `@openlearn/plugin-sdk` 导入该 Token，也可用 `ctx.resolve(new Token('@openlearn/core:ICoursewareRuntimeScriptRegistry'))` 按名字解析 —— 后者不依赖 SDK 构建产物是否已包含新 Token，部署顺序更安全；
  - **首个使用方**：「分数变量监视器」已从 `server/utils/bridge-sdk.ts` 的模板字符串中**整体迁出**，改由 `interactive-courseware` 插件 v1.0.29 通过本扩展点注册（`src/score-monitor-script.ts`，`position: 'body-end'`、`priority: 200`，`activate()` 注册、`deactivate()` 撤销）。监视器行为不变：三层采集（`window.__LMS_WATCH__` 显式声明 / window 上名字匹配 `score|point|grade|mark|correct|right` 的有限数值属性自动发现 / 分数类元素**可见**文本兜底，键名形如 `dom__score`，故完全不调用 `LMS.*`、只把分数写进 `#score` 的静态课件也能采到分）、变化后静默 `1200ms` 以 `LMS.saveProgress({ score, watch })` 上报一次样本、单会话上限 60 次、同一元素按选择器去重（避免 `#score` 与 `[id*="score" i]` 重复登记）；采样仍走 `status='inprogress'`，**不会**提前把 attempt 置为已完成，快照落到 `submission_result.extra_json.watch` 与 `submission_raw.payload_json.watch`，成为插件按 `score_policy`（MAX / AVERAGE / LATEST）聚合的样本历史。
  - 验证：宿主 `tsc --noEmit` 对相关文件 0 错误；插件 `tsc --noEmit` 0 错误；jsdom 冒烟测试（先真实执行 `BRIDGE_SDK_CODE`，再执行扩展点注入的监视器脚本）——两段脚本 `doubleBackslashSeqs=0`，空闲 1.5s 零上报，`window.userScore=55` 触发 1 次采样（`score=55`），`#score` 文本改为 `82` 再触发 1 次（`score=82`、`watch.dom__score=82`，且无重复 DOM 键）。
- **课程编辑器「作业上传」真正落地（作业中心 / Assignment Hub，P0 地基）**：白板教学对象里的「课堂作业任务」此前只有一个按钮加 `alert('系统已经成功模拟拉起本地文件选择和上传流程！…')`，零后端调用；同时学生经命令总线提交作业会恒被 `[CapabilityGuard] Access Denied` 拒绝（`assignment.submit` 要求 `lesson:write`，而学生兜底能力不含它）。
  - **数据模型收敛**：新增迁移 `migrations/005_assignment_hub.sql`（并同步写入 `packages/core/db/index.ts` 的 schema 块，保证全新库与既有库结构一致）：新建 `plugin_assignments`（作业实体，**同时挂 `lesson_id` 与 `class_id`**，白板对象只是投影片段）、`plugin_submission_versions`（每次提交一个不可变版本，支持多文件 + 文本 + 链接）、`plugin_assignment_files`（上传文件归属与归档状态）、`plugin_peer_review_tasks`（互评任务分配）；重建 `plugin_submissions` 以去掉 `UNIQUE(lesson_id, student_id)`（旧表一课时只能存一条、重交直接覆盖丢档），并为旧形态记录保留 `WHERE assignment_id IS NULL` 的部分唯一索引；`plugin_peer_reviews` / `plugin_grades` 补 `assignment_id` / `task_id` / `anonymous` / `peer_average_score` / `source` / `published_at` / `graded_by` 等列。已在真实开发库副本上验证：迁移后旧数据（`plugin_peer_reviews` 20 行、`plugin_grades` 10 行、人造旧提交记录）零丢失，重复执行幂等。
  - **权限修正（P0 阻塞缺陷）**：`packages/core/capability-system/index.ts` 的角色兜底新增 `assignment:read` / `assignment:submit` / `assignment:review`（学生与教师）与 `assignment:manage`（教师）；`packages/plugins/assignment-eval.ts` 的四个动作分别改用这四个能力（原为 `lesson:write` / `lesson:read`，学生因此完全无法提交作业）。学生**仍然没有** `lesson:write` —— 写权限收窄为命令处理器内部的所属权校验（`parseActorId` 比对 `studentId`，教师/管理员不受限），HTTP 层亦对普通学生强制覆盖 `studentId`。
  - **命令总线契约（`packages/plugins/assignment-eval.ts` 重写）**：新增 `assignment.create` / `assignment.list` / `assignment.get` / `assignment.assign_peer_reviews`；`assignment.submit` 支持 `assignmentId` + `fileIds`/`textContent`/`linkUrl`（保留仅 `lessonId` 的旧式调用，自动查找/创建该课时默认作业），重交递增 `version` 并写不可变版本行，迟交按 `due_at`/`allow_late` 拦截；`assignment.grade` 确认后除 `saveSemesterGrade` 外，当作业只挂班级时自行投影到宿主 `assignments` / `assignment_submissions`；提交与评分分别发布 `assignment.submitted` / `assignment.graded` 事件。
  - **HTTP 端点（新增 `server/routes/assignment-hub.ts`）**：`POST /api/assignments`（教师建/改）、`GET /api/assignments`、`GET /api/assignments/:id`、`POST /api/assignments/:id/files`（**原始二进制体**上传，避免 multipart/base64 膨胀；扩展名白名单 + `BLOCKED_EXTENSIONS` + magic bytes + `.zip/.docx/.pptx` 容器头校验 + 单文件大小/文件数上限；教师可代学生上传，普通学生一律写到自己名下）、`GET /api/assignments/:id/files`、`GET /api/assignments/:id/files/:fileId`（越权与不存在一律 403，`path.resolve` 限制在 `storage/assignments` 内，`res.download` + `nosniff`）、`DELETE /api/assignments/:id/files/:fileId`（已随提交归档 → 409）、`POST /api/assignments/:id/submit`、`POST /api/assignments/:id/assign-peer-reviews`。
  - **插件双激活缺陷修复（既有线上问题）**：`PluginHost.restoreActivePlugins()` 与 `Kernel.bootstrapSystemPlugins()` 会在同一内核内把 `@openlearn/plugin-assignment-eval` 激活两次，第二次激活先 `unregisterHandler('assignment.submit')`、再在 `assignment.create` 上撞「已注册」抛错中止，导致**作业插件在生产启动后同样没有注册任何命令**（`No handler registered for command: assignment.submit`）。现于 `activate` 开头按 `OWNED_COMMAND_TYPES` / `OWNED_ACTION_IDS` 做幂等撤销，重复激活安全。
  - **测试与文档**：新增 `packages/plugins/__tests__/assignment-hub.test.ts`（8 例）与 `server/__tests__/assignment-hub-routes.test.ts`（7 例，走真实 `client_sessions` Cookie 会话，证明学生提交不再被拒且无法冒充他人）；`packages/core/di/__tests__/semester-grade.test.ts` 改用规范 `user:<id>:<role>` actorId 并删除手工 `capabilityGuard.grant()`（正是这些手工授权长期掩盖了学生缺少 `assignment:*` 能力的问题）；`docs/reference/plugin-capability-matrix.md` 的 `assignment:*` 段与 `docs/tutorials/plugin-development-tutorial.md` 的权限字符串示例同步更新。
- **课程编辑器「作业上传」学生端闭环（作业中心 P1）**：白板上的「课堂作业任务」不再是只弹提示的说明卡，而是真正驱动一套提交闭环。
  - `src/features/whiteboard/components/AssignmentSubmitDialog.tsx`（新增）：真实文件选择器（本地多选 / 拖拽 / 串行上传 / 实时进度 / 失败重试）、文字作答与作品链接、版本历史与成绩展示；上传中的请求在关闭弹窗时会全部 abort。
  - `src/features/whiteboard/components/AssignmentBindingField.tsx`（新增）：教师端在编辑面板中选择 / 新建 / 解除绑定作业实体，并写回白板元素 payload 的 `assignmentId`（新建后学生立即可见）。
  - `src/features/whiteboard/InteractiveWhiteboard.tsx`：学生按钮在已绑定时直接打开提交弹窗，未绑定时按课时兜底查找已发布作业，找不到则给出明确提示；教师编辑面板接入绑定控件。
  - `server/__tests__/assignment-hub-routes.test.ts`：新增 3 个读路径用例（弹窗数据源与重交版本递增、按课时列表的学生/教师差异、教师新建后可直接绑定），并抽出 `resetAssignmentState`/`uploadTracked`/`submitWork` 让用例彼此独立。
  - `src/features/whiteboard/__tests__/assignment-hub-ui.test.tsx`（新增）：4 个组件用例覆盖绑定 / 解除绑定 / 新建就地面板提示、上传队列与版本历史渲染、提交体去重、失败时保留作答。
  - 修掉自测发现的三处问题：`AssignmentBindingField` 在白板没有 toast 宿主时提示会静默丢失（改为面板内就地提示）；上传完成的附件同时出现在「待提交附件」与「上传队列」导致同一 `fileId` 被写进版本两次（按 id 去重）；`通知/删除/重试` 的边界文案与校验补齐。
- **课程编辑器「作业上传」P2 互评闭环（分配 / 双盲 / 量规 / 截止 / 异常标记）**
  - 服务端（`packages/plugins/assignment-eval.ts`）：`assignment.get` 新增 `peerReviewTasks`（双盲，只给被评作品内容与版本，不含作者身份）与教师专属 `peerProgress`（提交 / 任务 / 待完成统计、互评人清单、异常标记 `peer_review_pending` / `all_full_marks` / `score_gap`）；`assignment.assign_peer_reviews` 支持 `dueAt` 并回写 `plugin_assignments.peer_review_due_at`；`assignment.peer_review` 收紧为「只认互评任务持有人」并在截止后拒绝（此前仅在已提交过互评时拦截）。
  - 路由（`server/routes/assignment-hub.ts`）：新增 `POST /api/assignments/:assignmentId/peer-review`，`reviewerId` 一律由会话决定，请求体无法冒充他人；附件下载对互评人放行（仅限被分配到的提交）。
  - 前端：新增 `AssignmentPeerReviewPanel`（学生端：匿名同学 A/B、作品预览与附件下载、四维四档量规、手输总分、截止后锁定、作者更新后的复核提示），并在提交弹窗里与「我的提交」并列成标签页；新增 `AssignmentPeerProgressPanel`（教师端：分配按钮 + 每份份数 / 截止时间 + 进度 + 异常标记 + 互评人清单），挂在白板教师编辑面板。
  - 测试：插件层 3 例（分配式互评 / 双盲与教师进度 / 截止与反复改分）、路由层 3 例（互评端点防冒充、互评人附件下载、教师进度可见性）、组件层 5 例（量规提交、截止锁定、越界拒绝、分配与提示）。
- **互动课件成绩榜对学生可见（白板课件元素）**：学生点开白板课件元素右上角「查看成绩」即可看到全班分数榜（名次 / 姓名 / 分数 / 完成度 / 均分），自己那一行高亮并显示「我的成绩 N · 全班第 X/Y 名」；访客（guest）与教师预览的占位 attempt 不计入榜单，名次同分并列（88/88/70 → 1/1/3），榜单顺序学生与教师一致。
  - `src/features/whiteboard/components/HtmlAppletFrame.tsx`：新增 `computeAttemptRanks` / `sortAttemptsByRank` 与 `PLACEHOLDER_STUDENT_IDS`，浮层按钮与面板统一改用 `orderedAttempts`（同源计数，避免「徽标 N 条 / 列表 M 条」口径不一致），并从 `useAppStore` 读取当前会话以识别「我」。
  - 回归：`src/features/whiteboard/__tests__/html-applet-scores.test.tsx` 由 5 例扩到 10 例（学生名次与「（我）」标记、未提交提示、教师视角无「我的成绩」、占位行过滤、名次算法单测）。

### Fixes

- **样式基设三处静默失效修复（Tailwind v4 迁移遗留，表现为“黑线”与“样式丢失”）**：这三个问题都不报错、不影响构建，只在视觉上静默失真，因此长期未被发现：
  - **语义色透明度写法全部失效（78 处）**：16 个语义色此前以 `@utility` 定义，而 `@utility` 是**静态工具类**，Tailwind 不会为其生成任何斜杠变体 —— `bg-surface/95`、`bg-primary-theme/10`、`border-primary-theme/20` 这类写法因此**根本不生成、静默失效**（表现为元素背景/边框整体丢失，即用户反馈的“样式似乎没有”）。现将这 16 个语义色全部迁至 `@theme` 颜色令牌，自动派生 `bg-x/50`、`text-x/60`、`border-x/20` 等（走 `color-mix(in oklab, var(--color-x) N%, transparent)`），**类名与调用方零变更**（`bg-surface` / `border-theme` / `text-muted`… 用法不变），四套主题仍自动跟随。
  - **默认边框色回落为 `currentColor`（63 处 / 23 文件）**：Tailwind v4 把 `border` 的默认色从 v3 的 `gray-200` 改为 **`currentColor`**，因此只写 `border` / `border-b` 而未指定颜色的元素会渲染成**文字色** —— 浅色主题下就是一条深色（近黑）细线。已在 `@layer base` 用 `*, ::before, ::after, ::backdrop` 把默认值恢复为「主题边框色」；显式颜色工具类（`border-slate-200` 等）优先级更高，完全不受影响。
  - **`dark:` 变体未绑定应用主题（156 处）**：Tailwind v4 的 `dark:` 默认走 `@media (prefers-color-scheme: dark)`（**操作系统**偏好），而本项目主题是运行时写入 `<html data-theme>`（`themeStore`），两者互不相关 —— 切到深色主题时 `dark:*` 不生效，系统为深色时浅色主题反被深色样式污染。现已用 `@custom-variant dark` 绑定到 `data-theme`（`dark` 与 `chalkboard` 两套深色主题）。
  - **三个从未定义的设计令牌**：`shadow-3xs`（95 处）、`border-border`（22 处）、`text-foreground`（16 处）此前均无定义（Tailwind v4 阴影阶梯只有 `2xs`/`xs`/`sm`…，**没有 `3xs`**），导致对应阴影与颜色静默失效；已在 `@theme` 补齐，值引用主题变量（深色主题下阴影不重复声明）。
  - **验证**：用 `@tailwindcss/cli` 直接编译 `src/index.css` 透项核对，原有 16 个语义类名**零变更**、透明度假体（20 个真实用法抽样）全部生成；`tsc --noEmit` 0 错误；全量 242 个测试文件 / 1597 例通过。
  - **一处诊断陷阱（供后续参考）**：`@tailwindcss/vite` 按 **Vite 模块图**扫描（按需生成 CSS），因此直接 curl 首页 CSS 会看不到尚未加载页面所用的类 —— 这是正常行为，核对类是否生成请用 `@tailwindcss/cli` 全量编译。

- **互动课件学生提交归属丢失（学生提交后教师端「学生互动提交数据」为空）**：学生在互动课堂提交网页课件后，真实学生成绩完全不入库，`submission_result` 长期为空，而 `courseware_attempt` 里堆积的全是 `student_id='guest'` / `'teacher'` 的预览记录。根因是三处独立缺陷叠加：
  - **iframe 不携带会话导致归属丢失**：`src/features/whiteboard/components/HtmlAppletFrame.tsx` 的课件 iframe 使用 `credentialless` + `sandbox`（无 `allow-same-origin`），访问 `/runtime/:uuid/` 时不带 cookie，服务端 `injectLmsSdk` 只能建出一条 `student_id='guest'` 的 attempt，且**同一课件的所有匿名访问者复用同一条**；真实学生提交时又因 `attempt.student_id('guest') !== session.userId` 被 `403 Forbidden` 拒绝。现由持有会话的父窗口在转发上报前调用新增接口 `POST /api/courseware/attempts/:attemptId/adopt` 认领归属：无主 attempt 直接改归属（保留已产生的原始流水），已被其他学生占用则为本学生复用/新建自己的 attempt 并返回新 id；接口幂等，教师/管理员预览不受约束。
  - **提交失败被静默吞掉**：`src/services/lms-bridge.ts` 的三处上报（submit / saveProgress / log）均不检查 `res.ok`，401/403 只在控制台留下无痕错误，学生端看起来「提交成功」。现已对非 2xx 响应输出带响应正文的 `console.error`。
  - **终态状态值不一致导致「已完成」永不生效**：`lms-bridge.ts` 提交时传 `status: 'submitted'`，而 `packages/plugins/builtin.ts` 的 `courseware.submit_attempt` 处理器只在 `status === 'completed'` 时更新 `courseware_attempt.finished_at/status`，导致 attempt 永远停在「进行中」，`HtmlAppletFrame` 的 `submittedAttempts` 覆盖层与提交列表的「已提交/完成」筛选全部失效。现统一提交终态为 `'completed'`。
- **互动课堂提交列表徽标与列表口径不一致（徽标显示 8 条记录、列表却为空）**：`src/components/LiveClassroomView.tsx` 的徽标使用未过滤的 `attempts.length`，而列表使用按所选班级过滤后的结果，二者数据源不同造成自相矛盾的界面。现两者共用同一份派生数据（班级 + 搜索 + 状态筛选），徽标在发生过滤时额外以 `/ 总数` 形式提示总量；状态筛选口径统一为 `completed|submitted|finished`（终态）与 `active|inprogress|started`（进行中），修正原先只认 `'started'` 导致「进行中」筛选失效的问题。
- **修复插件自建表 SQL 注入（`ensureTable` / `table` / `dropAllTables`）**：`ctx.db.ensureTable(tableName, schema)`、`ctx.db.table(tableName)` 的表名与 `CREATE TABLE` 的列定义片段都直接来自插件（ZIP 上传，属不可信输入），此前被原样拼进 DDL —— 形如 `t (x); DROP TABLE events; --` 的表名即可改写内核数据。现在 inline（`packages/core/plugin-host/context-builder.ts`）与 Worker（`packages/core/worker-runtime/worker-manager.ts`）双模式强制同等校验：表名必须匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`，列定义必须为非空字符串且不含 `;`（阻断多语句注入），`dropAllTables()` 从 `sqlite_master` 读到的表名二次校验 `^plugin_[A-Za-z0-9_]+$` 后才拼进 `DROP TABLE`。校验失败直接抛错，不再静默放行。
- **消除插件更新检测的 Shell 命令注入，并为相关出站端点补鉴权**：`server/services/version-fetcher.ts` 原以 `execSync(`git ls-remote --tags "${url}"`)` 执行字符串拼接命令，而 `repo` 来自插件 manifest（安装时由上传方控制，属不可信输入），形如 `x"$(cmd)"`的取值会触发 shell 命令替换（宿主 RCE）。现改为`execFileSync('git', ['ls-remote', '--tags', url])`参数数组执行（不经过 shell），并新增`normalizeSource()`白名单：仅接受`owner/name`形式的 GitHub / Gitee 仓库（长度 ≤ 140，正则为`^[A-Za-z0-9][A-Za-z0-9._-]\*\/[A-Za-z0-9][A-Za-z0-9._-]*$`），非法值直接返回「无效的更新源：仅支持 owner/name 形式的 GitHub / Gitee 仓库」而**不发起任何出站请求**；缓存键与后续 URL 拼接一律改用已校验的值，避免未校验输入污染缓存。
- **`server/routes/plugins.ts` 三个端点补鉴权**：`GET /api/plugins/market` 与 `POST /api/plugins/:id(*)/check-update` 都会按插件声明的 `updateSource.repo` 触发服务端 git / HTTP 出站请求，此前无鉴权、可被未认证调用放大为出站请求放大器，现挂 `requireAuth()`（不限角色，插件中心教师亦需查看）；`POST /api/plugins/execute-command` 是插件宿主前端 → 后端的统一命令入口，此前无鉴权，现挂 `requireAuth()`，且**刻意不限制角色** —— 教师端与学生端共用同一插件宿主（`src/main.tsx` 单例），学生端学习面板与考试全屏视图也会派发命令，若限制为 teacher/administrator 会直接打断学生端功能。
- **修复学生端诊断上报回退端点的鉴权后门与身份冒充**：`POST /api/diagnostics/report` 是 WebSocket 路径（`server/presence.ts` 的 `student-client-error`）的 HTTP 回退，却既无鉴权、也丢掉了 WS 路径已有的防冒充校验，使回退路径成为绕过身份校验的后门。现在：① 挂 `requireAuth()`；② 非教师/管理员时必须 `session.userId === data.studentId`，不符返回 403 并记 `[Diagnostics Security]` 警告（与 `presence.ts` 校验强度对齐）；③ 学生上报的 `studentName` 一律取服务端会话权威值（`session.username || session.studentId`），忽略客户端传值，阻断借 `studentName` 向全体教师广播任意文本的冒充/钓鱼；④ 同一账号 1 秒内只接受一次上报（超出返回 429），计数表超过 5000 条时清理 60 秒前的记录，避免被放大为写库 + 全量广播风暴；⑤ 收敛 payload：仅保留已知字段并截断长度（`type` ≤ 64、`message` ≤ 2000、`title` ≤ 200、`studentId` ≤ 64、`studentName` ≤ 100），防止超大包写进 `events` 审计表；⑥ 无有效载荷时保持静默成功（与历史行为一致，避免触发前端重试）。
- **修复插件停用 / 卸载后的资源与能力残留**：`packages/core/plugin-host/index.ts` 中，Worker 模式插件的 `terminateWorker` 只在 `finally` 里改状态、**未调用** `this.resourceTracker.disposeAll(pluginId)`（只有 inline 路径 `deactivatePluginExclusive` 调用了），导致 worker 模式插件停用后命令、事件订阅、定时器与路由永久残留；非 ACTIVE 态（`ERROR` / `INACTIVE` / `INSTALLED`）的卸载分支既不执行停用逻辑、也不执行 `revokeAll`，使已授予能力残留在内存中（权限泄漏，典型场景：`activate` 中途失败或 reload 失败后直接卸载）。现在 Worker 终止的 `finally` 中无条件 `disposeAll`；卸载流程在「1b. 兜底资源回收」与「4b. 撤销插件能力」两处无条件执行 `resourceTracker.disposeAll(pluginId)`（幂等，对已回收过的插件为空操作）与 `capService.revokeAll('plugin:' + manifestId)`（失败仅 warn），与 inline 路径及 T-04-20 保持一致。
- `packages/core/version.ts` 的兜底版本号 `FALLBACK_VERSION` 由 `0.3.20` 同步为 `0.3.21`（仅在无法定位平台 `package.json` 时作为降级值使用），避免诊断信息与实际发布版本不一致。
- **修复互动课件成绩提交 500（actorId 未归一化 + 空 `completion` 触发载荷校验失败）**：学生提交网页课件成绩时 `POST /api/courseware/attempts/:attemptId/submit` 返回 500，服务端日志为 `[CapabilityGuard] Access Denied: Actor <uuid> missing capability student:write for courseware.submit_attempt`。根因两处：① `server/routes/courseware.ts` 用 `session.userId`（裸 UUID）作为 actorId 传入 `courseware.submit_attempt`，而 CapabilityGuard 的角色兜底依赖 `user:<id>:<role>` 的 `:role` 后缀（`packages/core/capability-system/index.ts` 的 `actorId.endsWith(':student')`），裸 UUID 匹配不到任何角色能力；② `packages/core/kernel/index.ts` 的 `validateJsonSchema` 把**显式 `null` 当作已提供值**校验（`key in data && data[key] !== undefined`），而路由把缺省为 `null` 的 `completion`/`score` 一并塞进 payload，导致不带完成度的提交以 `property "completion": Expected number, got object` 失败。现改用 `getActorId(req)` 归一化身份（仅在取不到时回退 `user:<id>:<role>`），且 payload 只下发非空字段。
  - **教师课件预览提交同样 500**：预览 attempt 的 `student_id = 'teacher_preview'`（`src/features/whiteboard/utils/bridgeUtils.ts`），会话角色为 `teacher`，而 teacher 角色兜底能力此前不含 `student:write`。现将其补入（当前仅 `courseware.submit_attempt` 一条命令要求该能力，路由层仍按 `attempt.student_id` 校验所属权，不放松跨学生写入）。
- **修复 `GET /api/courseware/attempts/:attemptId/raw` 越权读取**：该端点返回学生原始作答明细，但此前既无 `requireAuth`，又将 actorId 硬编码为 `'teacher-demo'`（种子能力含 `lesson:*`，恰好满足命令要求的 `lesson:read`），任何人只要持有 attemptId 即可读取任意学生作答（越权与未认证读取）。现要求登录会话（无会话 401）并叠加**所属权校验**：教师 / 管理员可读任意 attempt，其他角色（含学生）仅能读自己的 attempt（读他人一律 403，attempt 不存在亦返回 403 以免用状态码枚举存在性），身份取真实会话 `getActorId(req)`。这样既关闭 IDOR 与未认证读取，也不打断「学生查看自己作答详情」类调用方，与 `/submit` 的所属权口径一致；前端现有唯一调用方 `src/components/LiveClassroomView.tsx` 挂在教师视图下，不受影响。
  - 验证：新增 `server/__tests__/courseware-submit-actor.test.ts`（6 例：学生 Cookie 会话提交自己的 attempt 并落库、跨学生 403、教师预览提交 200、无会话 401、`/raw` 的 401 / 学生读自己 200 / 学生读他人 403 / 教师读任意 200、CapabilityGuard 角色后缀与裸 UUID 对比）。用例刻意不走 `capabilityGuard.grant`（此前 `courseware-e2e-flow.test.ts` 与 `quiz-answered-e2e.test.ts` 正是靠手工授权绕过了上述缺陷，因此缺陷未被发现；本次已一并移除这两处手工授权，令其回归真实鉴权路径），故修复前必然失败：`git stash` 掉修复复跑，4 例失败并逐字复现线上报错 —— `[CapabilityGuard] Access Denied: Actor stu-actor-0001 missing capability student:write for courseware.submit_attempt`、`property "completion": Expected number, got object`、`/raw` 无会话返回 200、学生读他人 attempt 返回 200。修复后 `courseware-submit-actor` / `courseware-e2e-flow` / `courseware-attempts-filter` / `security_hardening` / `quiz-answered-e2e` / `lesson_ownership` / `builtin` 共 49 例全绿，`tsc --noEmit` 在改动文件上 0 错误。
- **白板 `wrapSrcDocWithBridge` 单测断言过期（全量测试长期为红）**：`src/features/whiteboard/__tests__/whiteboard-components.test.tsx` 仍断言 `<script src="/bridge.js"></script>`，而实现早已输出带追踪参数的 `<script src="/bridge.js?cw=<lessonId>"></script>`（该参数由 `server/routes/bridge.ts` 的 `req.query.cw` 消费），断言已同步修正。另：全量测试中的 `packages/core/__tests__/lti-provider-plugin.test.ts` 因引用仓库内并不存在的 `v2_plugins/plugin-lti-provider/src/index.js` 而整文件失败（新克隆必红），属既有问题，本次未处理。
- 修复作业中心 `assignment.create` 被 `management.ts` 的旧描述符拦截：`ActionRegistry.getActionByCommandType()` 返回**最先注册**的描述符并由它决定内核 payload 校验，旧描述符 `core-assignment-create` 的 `required: ['classId','title']` 会让「只挂课时、不挂班级」的作业创建失败（`Missing required property "classId"`）。插件现在一并接管该描述符；`server/routes/assignments.ts` 的旧班级作业页直接写库、不经命令总线，不受影响。
- `plugin_assignments.created_by` / `plugin_grades.graded_by` 改为保存用户 ID，原先写入 `user:<id>:<role>` 形式的完整 actorId，与其他表的 `*_id` 列口径不一致。
- 修复白板课件元素的成绩浮层在「全班专注锁定」下不可点击的问题：`HtmlAppletFrame` 的浮层与按钮 z-index 由 `z-10` 提升到 `z-[60]`，不再被 `ReadOnlyLockCover`（`z-50`）遮挡，学生在只读锁定态仍能查看成绩榜。
- 修复 `GET /api/courseware/attempts` 无鉴权且下发原始作答的问题：改为 `requireAuth()` + 按角色裁剪字段——学生只拿榜单字段（姓名 / 分数 / 完成度 / 状态），`extra_json`（原始作答明细）与 `comment`（教师评语）仅教师 / 管理员可见，避免同班互相抄答案。
  - 回归：`server/__tests__/courseware-attempts-filter.test.ts` 新增「未登录 401」「学生被裁剪 / 教师保留 `extra_json` + `comment`」2 例（补齐真实 `client_sessions` 会话与 Cookie），`server/__tests__/courseware-e2e-flow.test.ts` 两处成绩榜请求改带教师会话 Cookie（该文件由 4 例扩到 6 例）。
- 修复学生端「作业提交与互评」面板在提交内容为纯文字 / 链接 / 多附件时整页白屏的问题：`src/components/StudentAssignmentEvalPanel.tsx` 直接 `mySubmission.file_path.split('/')`，而作业中心（P0/P1）引入的这类提交 `plugin_submissions.file_path` 恒为 NULL → `TypeError: Cannot read properties of null (reading 'split')`（线上遥测：2026-09-21 学生端 `#/courses`）。
  - 新增 `baseName()` / `describeSubmission()` / `fileHref()`：自己与同学的提交都改为按内容物描述（文件名 / N 个附件 / 文字作答 / 链接作答 / 已提交（无附件）），附件改为走带权限的 `/api/assignments/:assignmentId/files/:fileId`，并在卡片内展示文字作答与作品链接；无附件时不再渲染指向 `null` 的下载链接。
  - `server/routes/lessons.ts`：`GET /api/lessons/:lessonId/eval-submissions` 与 `GET /api/lessons/:lessonId/students/:studentId/eval-status` 新增 `LATEST_VERSION_COLUMNS`（子查询取最新 `plugin_submission_versions` 的 `files_json` / `text_content` / `link_url`）与 `withLatestVersion()`（展开为 `files` / `textContent` / `linkUrl`），旧面板因此能看到真实提交内容而不只是一个文件路径。
  - 回归：新增 `src/components/__tests__/student-assignment-eval-panel.test.tsx` 4 例（纯附件 / 纯文字互评 / 历史纯路径兼容 / 未提交）。把该组件改动 stash 掉后，其中 2 例会以**与线上完全相同的** `TypeError: Cannot read properties of null (reading 'split')` 失败，证明该回归已被锁死。
- 补齐作业互评只读接口的鉴权：`GET /api/lessons/:lessonId/eval-submissions` 与 `GET /api/lessons/:lessonId/students/:studentId/eval-status` 此前**没有任何鉴权**，任何人仅凭 `lessonId` 即可读到全班提交（含文字作答、附件名、互评记录与成绩），现分别加 `requireAuth()`。
  - 回归：新增 `server/__tests__/eval-submissions-auth.test.ts` 3 例（未登录 401；登录后 `file_path` 为 null 的提交回填 `files` 且不泄露内部字段 `latest_files_json`；`eval-status` 同样正常）。
- **互动课堂前后端字段名失配修复（学生端投票 / 节奏信号 / 结课通票）**：
  - **投票**：`StudentInteractiveOverlay` 发送 `selectedOption` 而服务端读 `option`，导致所有投票落库为字符串 `"undefined"`（投票分布与课堂简报警戒失真）。服务端改为兼容 `option` / `selectedOption`，并新增「选项必须属于本次投票的可选项」「缺失选项返回 400」校验；前端统一发送 `option`。
  - **节奏信号**：前端发送 `signalType` 而服务端读 `signal`，请求恒 400 且被前端静默吞掉（"听懂反馈晴雨表"从未生效）。服务端兼容两种字段名，前端统一发送 `signal`。
  - **结课通票**：前端发送 `feedbackNotes` 而服务端读 `feedback`，学生文字反馈被静默丢弃。服务端兼容两种字段名，前端统一发送 `feedback`。
  - 新增 `server/__tests__/classroom-routes-contract.test.ts`（11 例）锁定请求契约：两种字段名均可用、非法选项 400、缺字段 400、投票关闭后拒绝、大屏数据接口未登录 401。

### Docs

- **新增「架构文档 ↔ 代码」漂移审计流水线与本地钩子**：`audit-tools/` 新增三个互不依赖的 Python 脚本与两个入口脚本 —— `normalize.py`（把文档标题与代码目录名归一化为同一套 canonical key）、`extractors.py`（分别从 `docs/` 与 `packages/core/`、`packages/plugins/`、`src/`、`server.ts` 提取结构化事实并落成 JSON）、`aligner.py`（对齐两侧并输出 `MISSING_IN_CODE` / `MISSING_IN_DOCS` 漂移清单）、`run.sh`（一键跑完整链路：无漂移时退出码 0 并打印 `✅ No architecture drift detected.`，有漂移时以 `::error::` 注解打印并退出 1，便于 CI 与钩子消费）、`install-hook.sh`（把审计装成本地 pre-commit 钩子，仅当暂存区命中 `docs/`、`packages/core/`、`src/features/`、`packages/plugins/` 时才运行；若已存在钩子会先备份为 `*.bak` 再链式追加，不覆盖用户脚本）。
- **CI 新增 `docs-drift-audit` job**：`.github/workflows/ci.yml` 中依次 checkout ➔ setup-python 3.11 ➔ `bash audit-tools/run.sh`；失败时上传 `audit-tools/reports/drift_report.md` 作为工件，并在 PR 场景下用 `actions/github-script` 把完整报告贴回 PR 评论，让文档漂移在合并前可见。当前基线：`docs facts: 103` / `code facts: 55` / `drift items: 0`（MISSING_IN_CODE 0、MISSING_IN_DOCS 0）。
- **新增 `docs/developer-guide/docs-drift-audit.md`**：记录该审计要解决的问题（文档描述了而代码已删改，或代码新增了子系统而文档未登记）、两侧事实的提取口径、本地运行方式与装钩子方式，并登记进 `docs/index.md` 的开发者指南 toctree。
- `.gitignore` 补充忽略审计生成物：`audit-tools/reports/`（`extracts.json` / `drift_report.md` / `drift_report.json`）与 `audit-tools/__pycache__/`，仓库只提交脚本与说明，避免每次运行都产生噪声 diff。
- **README 重写为面向外部读者的平台能力总览**：补充徽章（测试 / Node / pnpm / 许可证）、「核心特性」五大项（微内核 + 事件驱动架构、双运行模式插件沙箱、零信任课件隔离与 Bridge SDK、课堂实时协同与学生端遥测、AI 伴随教学引擎）、ASCII 架构拓扑图、pnpm 命令表（补齐 `lint:eslint` / `format` / `db:backup` / `db:reset`）、环境变量表（补默认值列）、分阶段演进路线图（阶段一 v0.3.21 稳固与安全收敛，阶段二 v0.4.0 K12 课堂交互与智能伴随深化）与相关文档索引，替代原先偏「快速上手」的首页。
- **补充三个运行时架构文档**，把此前只存在于代码里的三条运行链路正式文档化：`docs/architecture/classroom-runtime.md`（Classroom Runtime，跨前端 `src/features/classroom-runtime/` 与内核 `packages/core/classroom-runtime/` 两侧）、`docs/architecture/interaction-runtime.md`（Interaction Runtime，覆盖 Keyboard / Mouse / Touch / Gesture / Drag / Clipboard / Focus / ContextMenu / Selection 九个交互域）、`docs/architecture/resource-runtime.md`（Teaching Resource Runtime，把 PDF / PPT / 视频 / Notebook / Mermaid / GeoGebra 等异构资源统一适配为 Workspace 控件）；三篇文档均登记进 `docs/index.md` 的架构 toctree，随 ReadTheDocs 发布，同时被上一提交引入的漂移审计纳入比对范围（本仓库 `docs facts: 103` / `code facts: 55` / `drift items: 0` 基线保持）。
- **修正 README 中 5 处失效链接**：3 处指向并不存在的 `docs/architecture/plugin-architecture-audit-report.md`（该文件全仓不存在、git 历史也从未提交过；改为指向既有的架构文档漂移审计），2 处指向同样不存在的仓库根 `LICENSE`（改为指向声明 `"license": "MIT"` 的 `package.json`）。**注意：仓库目前确实没有 LICENSE 文件**，若要以文件形式发布许可证，需由版权持有者补齐版权行后另行提交。

### Security

- **全面安全审计与修复（14 项）**：对平台进行系统性安全审计（覆盖 974 个源文件 / ~180K 行代码），发现并修复 4 项 CRITICAL、8 项 HIGH、3 项 MEDIUM 安全问题，全部修复通过 TypeScript 类型检查（0 错误）与完整测试套件（250 文件 / 1691 用例通过）验证：
  - **[CRITICAL] 命令注入 RCE 修复**：`server/routes/os.ts` 的 `exec(\`pdfinfo "${filePath}"\`)`替换为`execFile('pdfinfo', [filePath])`，消除 shell 元字符注入风险；`/api/upload`端点补加`requireAuth('teacher', 'administrator')`，阻断未认证 RCE 攻击链。
  - **[CRITICAL] 16 个未认证端点加固**：`/api/db-status`（数据库 Schema 泄露）、`/files/*`（VFS 文件访问）、`/api/mfe/remotes`（微前端入口）、`/api/plugins` 系列（插件列表/配置/贡献点）、`/api/audit-report/download` 等管理报告下载、`/api/commands/registered`（命令注册表）、`/api/agent/conversations`（AI 对话历史）、`/api/activities` 系列（活动管理）全部补加 `requireAuth()` 中间件。管理报告下载限 `administrator` 角色。
  - **[HIGH] 明文密码回退移除**：`server/routes/roster.ts` 学生登录流程中，当存储密码既非 bcrypt 也非 SHA-256 时，原逻辑直接明文比较并自动升级。修复后该分支拒绝登录（`matchesOwnPassword = false`），遗留明文账户需管理员重置。
  - **[HIGH] 临时密码泄露修复**：`POST /api/students` 创建学生接口的响应中移除 `tempPassword` 字段（前端无引用，安全移除）。
  - **[HIGH] CORS null origin 修复**：`server.ts` CORS 中间件不再反射 `null` origin 为 `Access-Control-Allow-Origin`，不再为 null origin 设置 `Allow-Credentials`，防止沙箱 iframe 伪造 origin 进行跨域攻击。
  - **[HIGH] 点击劫持防护**：`helmet.xFrameOptions` 从 `false` 改为 `{ action: 'sameorigin' }`。
  - **[HIGH] 全局 Rate Limiting**：新增 `writeLimiter`（60 次/分钟/IP）作为全局中间件应用于所有 POST/PUT/DELETE 请求；新增 `aiLimiter`（10 次/分钟/IP）专用于 `POST /api/agent/chat`（昂贵 LLM 调用）。`ServerContext` 接口新增 `aiLimiter` 字段。
  - **[HIGH] 作业提交 IDOR 修复**：`GET /api/assignments/:id/submissions` 角色限制从 `requireAuth()` 改为 `requireAuth('teacher', 'administrator')`，防止学生查看他人提交。
  - **[MEDIUM] 上传目录认证修复**：`/uploads` 静态资源中间件从空操作改为实际执行认证检查，`/avatars/` 路径例外放行（产品需求）。
  - **[依赖安全] xlsx → exceljs 替换**：`xlsx@^0.18.5` 有已知 CVE（原型污染），替换为 `exceljs@^4.4.0`。共享模块注册名、Worker 白名单、类型声明、Vitest mock 同步更新。移除 `@types/xlsx`（exceljs 内置类型）。
  - **[依赖分类] devDependencies 修正**：`esbuild`（仅构建脚本）、`@types/reveal.js`（类型定义）、`pino-pretty`（仅开发环境日志格式化）从 `dependencies` 移至 `devDependencies`，减少生产安装体积。
  - **[构建配置] vite.config.ts 优化**：`build.target` 从 `'esnext'` 改为 `'es2022'`（匹配 tsconfig，避免旧环境语法错误）；`modulePreload` 从 `false` 改为 `{ polyfill: false }`；移除 `vendor-content` manualChunk 死规则（marked/dompurify/highlight.js 非直接依赖）。
  - **[类型安全] tsconfig strict 子集启用**：启用 `noImplicitThis`、`alwaysStrict`、`strictBindCallApply`（0 编译错误）。完整 `strict: true` 因需修复 ~150 个 `strictNullChecks` 错误，建议后续按模块渐进推进。
  - **[状态管理] 死 store 清理**：移除 `classStore`/`lessonStore`/`liveClassStore`/`studentStore` 在 `appStore.ts` 中的无效镜像订阅（4 个域 store 从未被组件直接消费），清理 `store/index.ts` barrel 导出。
  - **[文档] 迁移 README 补全**：`migrations/README.md` 补充 009 条目（`009_classroom_peer_review.sql`）。
  - 完整修复报告归档于 `docs/architecture/security-remediation-report.md`。

## [0.3.21] - 2026-09-20

### Fixes

- **启动横幅品牌重命名与版本号单一来源 (Startup Banner Rebrand & Version SSOT)**:
  - **横幅品牌化**：`server.ts` 的 HTTP listen 回调内将启动横幅文本从历史遗留的 "Educational OS Kernel" 重命名为平台统一品牌 "OpenLearn Next"；横幅格式为 `OpenLearn Next vX.Y.Z ready:`；
  - **网址可点击**：本地与局域网 URL 输出套用 OSC 8 (`\x1B]8;;URL\x1B\\URL\x1B]8;;\x1B\\`) 超链接，使 iTerm2 / Windows Terminal / GNOME Terminal / VS Code 集成终端等现代终端可直接 ⌘/Ctrl+点击打开浏览器；同步套用到 `OPEN_BROWSER=true` 时的 "Auto-opening browser" 提示；
  - **TTY 守卫防日志污染**：`process.stdout.isTTY && process.env.TERM !== 'dumb'` 才启用 OSC 8 转义，管道 / PM2 / 文件重定向等非交互环境自动退化为纯文本，避免日志里残留 ANSI 转义序列；
  - **版本号单一来源 (SSOT)**：`packages/core/version.ts` 不再硬编码 `PLATFORM_VERSION = '0.3.18'`，改为运行期从最近的上级 `package.json`（匹配 `name === 'openlearn-next'`）读取 `version` 字段；找不到时回退 `'0.3.20'`。从此发布新版本时只改根 `package.json`，启动横幅与所有 `PLATFORM_VERSION` 引用自动同步；
  - **验证**：`packages/core/__tests__/version-consistency.test.ts` 6/6 通过；`npx tsx` 与模拟 `dist/server.cjs` 两条运行路径均返回 `0.3.21`；`pnpm lint` 在改动文件中未引入新 TS 错误。

## [0.3.18] - 2026-09-19

### Tests & Reliability

- **测试套件时间预算加固 (Test-suite Timing Robustness)**：
  - **背景诊断**：全量测试曾在部分运行中出现“每次失败文件都不同、单独跑又全绿”的抖动。实测定位为**环境性**问题——在 IDE / MCP server / 其他 agent 同时跑重活的机器上，`PSI io full avg300` 达 18%、16 核 loadavg 达 52–72，磁盘停顿令各测试的时间预算先后被击穿；环境回落（loadavg 1.2 / `PSI io` 1%）后全量 43s 稳定通过。因此该抖动**不是仓库代码缺陷**，但下面三处测试本身确实存在可被击穿的脆弱点；
  - **`worker-runtime/integration.test.ts`**：三处硬编码 `setTimeout(..., 5000)` 守卫（失败信息仅 `Timeout A`/`Timeout B`，且条件满足后不清理定时器）抽为具名 `WORKER_ACTIVATION_BUDGET_MS = 30_000` 的 `activateAndWait()` 辅助函数，并在 resolve/reject 时 `clearTimeout`。注意 vitest 的 `testTimeout` **不**管辖测试内部的 `setTimeout`；
  - **`AppShell.test.tsx`**：`beforeAll` 预热 `StudentView`/`TeacherView` 动态 chunk，使 `React.lazy` 命中模块缓存——实测首个用例 **939ms → 322ms（−66%）**，把 vitest 的 transform 开销移出断言窗口；
  - **`LazyCourseware.test.tsx`**：三处 `await waitFor(...)` 补齐显式预算（原为 1000ms 默认值，而实测已消耗 ~320ms，仅约 3× 余量），并同样预热 `InteractiveCoursewareViewer` chunk；
  - **验证**：修复后 6 次全量运行全绿——空闲 ×3、合成 CPU 压力（`PSI cpu` 32.7%）×1、dev server 运行中 ×2（其中一次 `PSI cpu` 44%）。

### Features

- **默认 Gemini 配置彻底移除与动态 AI Provider 架构强制 (Complete Gemini Fallback Removal & Dynamic AI Provider Enforcement)**:
  - **解耦硬编码回退**：服务端与内核全面清理 `process.env.GEMINI_API_KEY` 兜底以及 `@google/genai` 依赖，系统 AI 能力统一由数据库 `ai_providers` 中动态配置的 OpenAI 兼容提供商（如 DeepSeek、Qwen、Ollama、OpenAI 等）驱动；
  - **内核 DI 服务强化与凭据解密**：`packages/core/di/ai-service.ts` 与 `AIProviderGateway` 严格要求已配置的提供商，无有效 Provider 时统一抛出友好中文提示；集成 AES-256-GCM 密钥透明解密支持；
  - **业务路由全量收归内核服务**：`assignments.ts`（生成题目、建议测验与智能评测）、`lessons.ts`（白板 AI 助教）、`grading.ts`（学期综合评估）、`schedules.ts`（课表 OCR）与 `ai-submit-injector.ts` 全面移除 Gemini 回退分支，统一收归内核 `kernelContainer.aiService`；
  - **前端未配置状态与友好引导**：
    - `RightSidebar.tsx`: 移除写死的“系统默认（Gemini）”选项；无提供商时展示“未配置 AI 提供商”禁用选项，并在抽屉顶部展示醒目琥珀色警示卡片引导前往「系统管理 -> AI 提供商管理」，同时禁用输入框与发送按钮；
    - `TimetableOcrView.tsx`: 移除默认选项，无提供商时显示多模态模型要求引导横幅并禁用 OCR 识别按钮；
    - `App.tsx`: 修正 `agentProviderId` 初始状态机与同步逻辑，消除对 `'system'` 伪提供商的隐式依赖；
  - **环境与部署配置清理**：清理 `.env.example`, `docker-compose.yml`, `ecosystem.config.cjs`, `deploy.sh`, `cli.mjs`, `metadata.json` 中的 `GEMINI_API_KEY` 与遗留声明。

- **现代化紧凑导航边栏与分类折叠交互 (Modern Compact Navigation Sidebar & Collapsible Categories)**:
  - **紧凑排版与现代无边框视觉**：导航边栏宽度缩小为贴合项目文字宽度的紧凑尺寸，移除突兀深黑边框，升级为柔和阴影与半透明底色现代设计；
  - **分类折叠与视觉层级区隔**：导航条目分类（如教学工具、系统管理等）支持点击折叠/展开，带平滑动画与状态记忆；条目文字“帮助与支持”统一精简为“帮助支持”。

- **全平台品牌统一为 OpenLearn Next (Brand Standardization to OpenLearn Next)**:
  - 将系统内所有历史遗留的 "Edu OS"、"EduLearn OS"、"EduLearn LMS" 标识全面对齐为统一产品命名 "OpenLearn Next"。

- **全站中文字体规范化与 9pt (12px) 物理保底 (Chinese Web Typography & 9pt Minimum Floor Guarantee)**:
  - **中文排版底线标准设定**：根据现代中文网页排版规范与印刷字号换算标准（$9\text{pt} = 12\text{px}$，中文小五号字），杜绝页面中因字号过小（如 6px~11px）导致的中文字符发虚、笔画粘连与难以辨认问题；
  - **全局 CSS 强防御兜底 (`src/index.css`)**：在全局样式表中配置 `max(12px, calc(12px * var(--app-font-scale, 1))) !important` 规则，确保即使用户选择紧凑缩放模式（85%），全站各处文字依然严格受 12px（9pt）物理底线保护；
  - **全站源码扫描与字号升级**：对全平台 70+ 个页面与组件中的 748 处微像素类名（`text-[6px]` ~ `text-[11.5px]`）全面升级为标准 Tailwind `text-xs` 或 `text-sm`，将 `text-2xs` 与 `text-3xs` 平移升级，并同步将所有 Recharts/SVG 图表（学情轨迹、出勤统计、成绩趋势等）轴线刻度与提示框字体统一提升至 12px。

- **全局字体缩放无障碍辅助功能 (Global Font Size Scaling & Accessibility)**:
  - **全局字号状态管理 (`fontSizeStore`)**：基于 Zustand 构建字号缩放状态机（支持 80%、90%、100%、110%、125%、150%），状态自动持久化至 `localStorage`；
  - **全站 CSS 变量与视图穿透生效**：通过 `--font-scale` 变量联动根节点 `html` 与主要工作区样式，并向所有沙箱课件 `iframe` 广播字号缩放指令（`broadcastFontScaleToIframes`）；
  - **顶栏统一控制交互 (`FontSizeSelector`)**：在系统全局顶栏集成快捷调节器，并移除非顶部的冗余按钮（如白板与课程编辑器工具栏），保障操作界面纯净统一。

### Fixes

- **仪表盘加载 500 异常与 Worker 插件命令注册修复 (Dashboard Command & Worker Capability Fixes)**:
  - **缺陷**：进入 `/#/dashboard` 仪表盘页面时，触发两项 HTTP 500 服务端接口错误（`records is not iterable` 与 `No handler registered for command: lianyun-course.research.get_activities`）；
  - **修复**：
    - `@aymwoo/plugin-lab-seat`: 修复 `records is not iterable` 异常，为数据库 `db.prepare(...).all()` 查询结果增加空值数组兜底（`records || []`）；
    - `service-host.ts`: 修复 worker capability 检查逻辑，支持缺少 `worker:all_commands` 时安全回退，并在无 handler 注册时不发生未捕获奔溃；新增测试 `packages/core/worker-runtime/__tests__/dashboard-plugins.test.ts` 锁定回归。

- **管理后台页面风格规范化对齐 (Admin Panel Visual Harmonization)**:
  - 重构 `AdminPanel.tsx`，将旧式高对比黑边框与深色底框统一调整为与教师端其他页面一致的现代白底、轻质灰边（`border-gray-200/80`）与柔和阴影风格。

- **全班专注锁定白板内嵌组件只读与交互阻断 (Class Focus Lock Whiteboard Component Read-Only Guard)**:
  - **缺陷**：当教师开启“全班专注模式/禁言锁定”时，学生端白板画布虽有锁定提示遮罩，但白板内部渲染的各类教学组件（Reveal 演示文稿、代码沙箱、数理画板、点名器、互动课件等）仍可被学生独立点击和操作；
  - **修复**：在白板容器与所有内嵌教学小部件上联动 `isLocked` / `readOnly` 状态，对白板画布层全面注入交互阻断（`pointer-events-none`、只读参数穿透传递与操作拦截），确保专注锁定期间学生端所有内嵌组件完全处于只读观察状态；
  - **测试覆盖**：新增单元测试 `src/features/whiteboard/__tests__/whiteboard-readonly-lock.test.tsx` 严格验证只读遮罩与组件交互拦截逻辑。

- **交互网页课件任意文件名 404 与自愈恢复机制 (Arbitrary HTML Courseware Entry & Self-Healing)**:
  - **缺陷**：在属性编辑器中选择单文件 HTML 课件时，系统固定寻址 `index.html`；若课件文件名为中文或自定义命名（如 `自适应五子棋.html`、`约翰·斯诺的霍乱地图.html`），运行时报错 `File not found: index.html`；且仅存放在 `system_resources` 原生表的课件在磁盘缺少物理文件时无法直接运行；
  - **修复**：
    - `bridge.ts`: 增加智能入口扫描与回退机制，当指定 `subpath`（如 `index.html`）不存在时，智能扫描目标根目录与首层子目录下的 `.html` 文件并正常直出；自动在磁盘生成 `index.html` 镜像并自愈更新数据库 `courseware.entry`；若磁盘目录不存在，自动回溯至 `system_resources` 原生表还原物理文件；
    - `resources.ts`: 单页 HTML 动态登记时保留原始 `.html` 文件名作为 `entry` 并向磁盘双写；
    - `builtin.ts`: 课件上传与 AI 改写版本生成时保留真实文件名并双写 `index.html` 软副本；
    - `bootstrap-db.ts`: 启动时执行自愈迁移，自动将 `system_resources` 同步至 `courseware` 并纠正历史硬编码。
  - **测试覆盖**：新增 `server/__tests__/bridge.test.ts`，覆盖任意命名直出、入口自愈、系统资源还原与 404 兜底场景。

- **Iframe credentialless 属性 React 渲染警告修复**:
  - `HtmlAppletFrame.tsx`: 将 `credentialless` 属性从布尔值 `true` 调整为字符串 `"true"`，彻底消除 React 19 控制台关于 `Received true for a non-boolean attribute credentialless` 的警告。

- **白板组件最大化学生端实时同步 (Whiteboard Fullscreen Component Student Sync)**:
  - 教师在课堂白板中最大化展示特定教学组件（如互动课件、代码沙箱）时，状态经由 `ClassroomSyncChannel` 与 Socket.IO 即时广播，学生端（包括独立标签页）实时同步全屏展示，并支持取消还原；
  - 补齐回归测试用例 `whiteboard-fullscreen-sync.test.tsx`。

- **CI 与发布流水线假绿修复 (CI & Publish Pipeline Integrity)**:
  - **`ci.yml` 从未真正运行过检查**：`cache: 'npm'` + `npm ci` 用在 pnpm workspace 上（仓库只有 `pnpm-lock.yaml`，无 `package-lock.json`），每次都在第一步以 `ENOLOCK` 失败，`tsc` / `vitest` 根本没跑。现改为 `pnpm/action-setup@v4` + `cache: 'pnpm'` + `pnpm install --frozen-lockfile`，并改用 `pnpm lint` / `pnpm test`；
  - **PR 评论步骤必然 403**：`issues.createComment` 需要 `issues: write`，而默认 token 只读。现为该 job 显式声明 `permissions: { contents: read, issues: write }`；
  - **移除重复跑整套测试的步骤**：原实现用 `execSync` 再跑一次 `vitest run --reporter=json`，其输出超过 `execSync` 默认 1MB buffer，现直接报告上方步骤的结果；
  - **`security-audit` job 无法运行**：`npm audit` 同样因缺 lockfile 报 `ENOLOCK`，改为 `pnpm audit --audit-level high`；因仓库现有 7 项传递性 devDependency high 告警，暂设 `continue-on-error: true` 并注明待归档后收紧；
  - **`publish.yml` 幂等化**：三个 `npm publish` 步骤均无“版本已存在则跳过”守卫，任何重跑（`workflow_dispatch`）或未逐包抬版本的重复 push 都会以 `EPUBLISHCONFLICT` 中断整个 job。现每步先探测 `npm view <pkg>@<ver>`，已发布则 `::notice` 跳过；两处 `workspace:*` 改写后的 `git checkout` 回滚改用 `trap ... EXIT`，即使 publish 失败也会还原工作树。

- **Vitest 配置写死本机绝对路径 (vitest.config.ts Portability)**:
  - 三个 alias 硬编码为 `/home/wuxf/Develop/openlearnv2/...`，导致 `pnpm test` 在 CI 与其他机器上无法解析。现改为基于 `import.meta.url` 的 `fileURLToPath(new URL(rel, import.meta.url))`，解析结果与原先在本机完全一致（已验证字符串一致，不改变模块标识）。

- **系统错误中心未读角标虚高 (Error Center `unreadCount` Invariant)**:
  - **缺陷**：`unreadCount` 应恒满足 `0 <= unreadCount <= errors.length`，但有两处会破坏它 —— `removeError` 删除错误后不递减计数；`addError` 达到 30 条存储上限后 `slice` 截断最旧一条却仍无条件 `+1`（后者可让角标显示 40 而面板里只有 30 条错误）；
  - **修复**：抽出 `reconcileUnreadCount()` 统一收敛该不变量，在上述两处应用；
  - **回归测试**：补齐 `removeError` 原先只断言 `errors` 长度、从不断言 `unreadCount` 的覆盖漏洞，并新增两条用例分别锁定“删除后计数同步”与“截断后不越界”（均已在修复前验证为红）。

- **白板最大化：父组件重渲染导致学生端视图被反复取消 (`InteractiveWhiteboard onFullscreenSync`)**：
  - **缺陷**：`onFullscreenSync` 常以内联箭头函数传入，每次渲染都是新引用；它原先位于 cleanup effect 的依赖数组中，导致父组件每次重渲染都拆解重跑 effect，向学生反复广播 `elementId: null`，把刚建立的最大化视图取消掉（实测：一次无关重渲染即产生 1 次 `null` 广播）；
  - **修复**：将回调存入 ref 供 cleanup 读取，effect 依赖数组仅保留稳定基础值；新增回归测试锁定“父组件重渲染不得触发 `null` 广播”。

### Docs

- **技术文档全景更新与 OpenAI 兼容架构对齐 (Documentation Decoupling & Alignment)**:
  - 全面更新 `docs/getting-started/installation-guide.md`、`docs/getting-started/quickstart.md`、`docs/ai/ai-runtime.md`、`docs/api/di-tokens.md`、`docs/architecture/configuration.md`、`docs/architecture/composition-root.md`、`docs/index.md`、`docs/sdk/plugin-sdk.md` 以及 `AGENTS.md`、`README.md`、`CLAUDE.md`；
  - 阐明 AI 运行时已完全解耦为数据库驱动的 OpenAI 兼容多 Provider 网关机制，全面移除环境变量 `GEMINI_API_KEY` 兜底说明。

## [0.3.17] - 2026-09-19

### Features & Plugin Ecosystem

- **课程设计备课画板组件插件扩展插槽 (Palette Item Extension Slot for Lesson Design)**:
  - **画板组件注册表 (`paletteItemRegistry`)**：基于 Zustand Vanilla Store 构建响应式注册单例，开放 `register`、`unregister`、`unregisterPlugin(pluginId)` 与 `usePluginPaletteItems` 响应式 Hook；
  - **插件上下文契约扩展 (`FrontendPluginContext.ui`)**：在前端插件上下文中新增 `ctx.ui.registerPaletteItem(config)` 与 `ctx.ui.unregisterPaletteItem(type)`，支持第三方插件向备课画板贡献专属教学组件（如学科仿真实验、3D 分子模型、乐谱、编程评测沙箱等）；
  - **备课组件库无缝聚合 (`LessonPalette.tsx`)**：左侧画板面板动态聚合并实时响应插件组件，新增“插件扩展”专属分组，自动享受中英文检索、拼音首字母匹配、分类折叠、收藏置顶与最近使用机制；
  - **初始参数声明式配置弹窗 (`PaletteCardEditModal`)**：支持插件声明 `editFields`（`input`、`textarea`、`select`、`options` 等），教师点击卡片时自动唤起配置表单并支持动态/异步加载选项；
  - **白板画布标准教学卡片容器 (`InteractiveWhiteboard.tsx`)**：白板自动为插件组件提供统一的标准教学卡片外壳，集成标题栏拖拽手柄、平滑缩放 handles、最小化折叠、全屏放大以及删除控制，并无缝挂载插件自定义 React 视图组件；
  - **属性侧边栏自动映射与回退**：选中插件组件时，若未注册专属 `propertyEditor`，右侧属性检查器自动基于 `editFields` 生成即时响应的通用配置表单；
  - **生命周期自动回收**：插件宿主 `unregisterPluginResources(pluginId)` 与插件停用/卸载联动，自动清理插件注册的画板组件，防止内存泄漏或残留脏配置；
  - **文档与 SDK 声明同步**：更新 [`docs/reference/plugin-ui-extension-slots.md`](docs/reference/plugin-ui-extension-slots.md)、[`docs/tutorials/plugin-development-tutorial.md`](docs/tutorials/plugin-development-tutorial.md) 以及 `@openlearn/plugin-sdk` 类型定义。

- **互动课堂独立标签页学生端与多端实时同步 (Independent Tab Student Preview & Realtime Sync)**:
  - **独立浏览器标签页学生端 (`/student/live?lessonId=...`)**：互动课堂的学生视角从页面内弹窗/抽屉改造为弹出独立的浏览器标签页，便于教师在多屏或分屏环境下双端实时对照教学效果；
  - **双向广播联动通道 (`ClassroomSyncChannel`)**：基于 `BroadcastChannel` 与 Socket.IO 构建低延迟双向联动通信通道，教师端的页面切换、白板标注涂写、组件缩放移动与课件交互实时毫秒级同步至独立学生端 tab；
  - **多端状态感知与生命周期管理**：支持主动心跳检测、掉线重连感知与独立窗口关闭状态同步。

- **全局系统错误诊断中心与一键复制 (Global System Error Diagnostic Center & One-Click Copy)**:
  - **全局未捕获异常监听 (`useGlobalErrorCapture`)**：统一捕获 `window.onerror`、`unhandledrejection` 以及 React 渲染 ErrorBoundary 异常；
  - **系统级错误诊断模态框 (`SystemErrorCenterModal`)**：当系统发生错误时通过全局 Toast 提供快速入口，打开“系统错误诊断中心”，智能提取错误分类、发生时间、课程/班级上下文以及格式化调用堆栈；
  - **智能排查建议与一键复制**：针对常见网络中断、插件执行异常、CSP 拦截提供分类排查建议，并提供带 Markdown 格式诊断报告的一键复制功能，极大简化运维排错与技术支持沟通成本。

### Refactor & Architecture

- **白板与备课互动课件属性模型统一 (Courseware Property Unification)**:
  - 备课画板与互动上课白板中，“互动网络课件”属性面板重构，统一使用 `coursewareUuid` 资产标识，移除冗余的 `resourceId` 字段；
  - 统一关联课件列表选择器与本地课件压缩包文件上传流程，规避参数歧义。

### Fixes & Security

- **CSP 内容安全策略内联脚本告警修复 (CSP script-src-attr Directive Hardening)**:
  - 规范内联事件处理器编写，消除浏览器控制台中关于 `script-src-attr 'none'` 的 Content Security Policy 告警。

### Fixes

- **课程编辑器无限重渲染导致崩溃 (Lesson Editor Infinite Render Loop / `Maximum update depth exceeded`)**:
  - **缺陷机理**：`usePluginPaletteItems` 的选择器体 `Array.from(state.items.values()).map(...)` 每次 `getSnapshot()` 都会分配一个新数组，而 `useStore` 底层是 `useSyncExternalStore`（用 `Object.is` 比较连续快照），于是 React 永远判定快照已变化、每次提交都强制重渲染，直到抛 `Maximum update depth exceeded`；只要渲染到备课组件库（`LessonPalette`）就会触发，教师端「课程编辑器」完全不可用；
  - **修复**：用 `useShallow`（`zustand/react/shallow`）包裹选择器，把不稳定数组收敛为引用稳定的结果；空列表与未安装插件场景下也不再重渲染；
  - **全仓扫描**：审查了 42 处 store 选择器，其余均返回单一字段（引用天然稳定），并确认仓库内无手写 `useSyncExternalStore`，此类缺陷仅此一处；
  - **范围说明**：该缺陷由本次未发布的「插件备课画板组件扩展插槽」一并引入（文件尚未提交），未影响任何已发布版本；
  - **回归测试**：新增 `palette-item-registry.test.tsx`，以“单组件 + 单 Hook + 空 Store、零写入”的最小场景锁定重渲染次数，直接复现并防住该缺陷。

- **全班专注锁定只读跟随模式 (Class Focus Lock — Read-only Follow Mode)**:
  - **视图切换唯一收口 (`setStudentViewStatus`)**：锁定期间学生端只放行 `lesson` 视图，其余跳转（Dashboard、作业工作区、通知直达等）统一拦截并弹出提示，修复此前“只禁用了返回学习面板按钮”导致学生仍可自由切换页面的问题；
  - **顶部导航与品牌区拦截 (`AppHeader`)**：`isStudentLocked` 下系统总览按钮与站点 Logo 不再跳转，改显锁图标与提示文案；
  - **标签页与教学环节锁定 (`StudentLessonInteractionPanel` / `StudentLessonContentPanel`)**：白板/互动课件/作业标签页与时间线环节切换在锁定期间禁用并提示，仅允许跟随教师端广播；
  - **白板只读模式 (`InteractiveWhiteboard readOnly`)**：隐藏顶部工具栏与页面栏，画布 `pointer-events: none` 禁止绘制，禁用右键菜单、浮动删除胶囊与元素删除，同时保留测验、随机点名、演示文稿等插件组件本体的交互能力；
  - **底层写入兜底**：`handleElementDelete` / `handleClearBoard` / `handleResetBoard` 与 `onElementDelete` / `onClearBoard` 在只读模式下直接拒绝，防止绕过 UI 触发白板清空；
  - **强制跟随教师步调**：锁定期间自动开启并禁用“跟随教师步调”开关，同时确保学生落在课节视图，不会被困在其他页面。

- **教师端组件最大化视图同步至学生端 (Teacher Fullscreen Component Sync)**:
  - **白板视图广播 (`broadcastFullscreen`)**：互动课堂中教师最大化/退出最大化白板组件时，通过 `teacher-broadcast-fullscreen` 将组件 id 与课节连同广播给授课班级；仅实时授课中控台启用，备课编辑器不打扰学生；
  - **班级房间投递 (`class-<classId>`)**：`register-student` 时服务端按 `class_students` 将学生 socket 加入其所属班级房间，教师端同时投递到课节房间与班级房间；因此学生无论处于课节白板、互动课件、作业标签页、**作业工作区**（此前会 `leave-lesson`）还是**从学习面板直接打开作业**，都能收到同步（先前仅靠课节房间会让这些学生漏收）；
  - **远程视图状态中心 (`whiteboardViewStore`)**：最大化状态提升至独立 Zustand Store，避免学生切到「互动课件/作业」标签页导致白板卸载后同步视图丢失；
  - **强制切回白板并全屏 (`useClassroomSocket`)**：学生收到广播后强制切换到交互式白板标签页并进入全屏遮罩，确保教师展示的组件可见；学生在自学其他课节或停留在学习面板时不会被打断；
  - **原路返回 (`interruptedViewRef`)**：中断前记录学生的视图状态、标签页、课节与被打开的作业，教师退出最大化后恢复原位（同一次中断只捕获一次，反复 maximize 不会覆盖最初位置）；作业答题状态位于 App 层因此原样保留；被拉出作业工作区期间会暂存并清空作业上下文，避免 `useAppPolling` 同时拉取两个房间的 `elements` 互相覆盖；
  - **不可本地退出 (`FullscreenOverlay dismissible`)**：教师同步视图隐藏关闭按钮、ESC 不生效，且插件自定义全屏渲染器拿到的 `onClose` 亦为空操作；
  - **防卡死收敛**：教师端离开白板（切中控台 Tab / 换课节 / 卸载）或被最大化元素被删除时广播 `elementId: null`，学生端重连时同样恢复被中断的视图，避免学生被永久困在不可退出的全屏中。

### Docs

- **Sphinx 文档零告警编译修复 (Zero-Warning Docs Build)**：
  - 将 `docs/reference/plugin-ui-extension-slots.md` 与 `docs/tutorials/plugin-development-tutorial.md` 中含 JSX 的代码块语言标记由 `typescript` 修正为 `tsx`，消除 `misc.highlighting_failure` 告警（TypeScript 词法器无法处理 JSX 语法，Pygments 回退到纯文本模式）；
  - 新增 `docs/release-notes/v0.3.17.md` 并挂载到 `docs/index.md` 发布日志 toctree 顶部。

## [0.3.16] - 2026-09-18

### Fixes & Frontend Plugin Host

- **修复前端插件加载器（`FrontendPluginHost`）裸模块导入解析缺失导致扩展点（如 `teacher.tab`）未注册缺陷**:
  - **裸模块导入转换器 (`transformBareModuleImports`)**：重构 `src/plugin-host/plugin-host.ts` 中针对动态 Blob URL 的 ESM 裸模块导入替换逻辑，由原本单一简单正则升级为全形态 ESM 导入解析转换器；
  - **覆盖复合导入与别名语法**：完整支持复合默认+具名导入（如 `import React, { useState, useEffect } from "react"`）、别名转换（如 `import { useState as useState2 }` 转为对象解构 `{ useState: useState2 }`，避免 `SyntaxError`）、命名空间导入（`* as React`）及多行/带注释语句；
  - **补全共享宿主依赖映射表 (`SHARED_MODULE_MAP`)**：将 `react-dom`、`react-dom/client`、`react/jsx-runtime` 纳入宿主共享依赖，并在 `src/main.tsx` 中向 `window.HostSharedDeps` 完整导出，彻底消除浏览器端 `TypeError: Failed to resolve module specifier "react"` 报错；
  - **解决插件左侧导航与控制台挂载异常**：修复如恋云课程 (`lianyun-course` / `019fa0e6-5f59-7718-b86e-b35c93ba39aa`) 等插件在启用后前端未能正常执行 `activate(ctx)` 的问题，使得 `teacher.tab`（恋云课程管理）在左侧导航栏的“扩展应用”列表和 `teacher.dashboard.widget` 正常生效。

### Fixes & Worker Runtime

- **修复 Worker 激活期异常导致 60 秒假超时挂起 (`WorkerTimeoutError`) 与 Watchdog 误熔断缺陷**:
  - **激活期快速失败机制 (Fail-Fast)**：在 `WorkerManager.createWorker()` 中对底层 `worker` 绑定激活期单次 `exit` 与 `error` 监听；当插件在初始化/激活初期发生未捕获异常、语法错误或进程退出时，主线程由原先盲等 60 秒改为在 5ms 内立即拒绝并抛出精准的 `WorkerActivateError`，彻底消除假超时误报；
  - **WorkerInstance 生命周期细化 (`status: activating`)**：将 `WorkerInstance.status` 扩展为包含 `'activating'` 状态，仅在收到 `'activated'` 消息后提升为 `'running'`；当 Worker 在激活期意外退出时，`WorkerRegistry` 仅清理资源并标记 `crashed`，严禁触发 Watchdog 自动重启风暴，避免并发争用与误触熔断器 (Circuit Breaker)；
  - **Worker 沙箱异步异常陷阱 (`unhandledRejection` / `uncaughtException`)**：在 `generateBootstrapCode` 中为 Worker 进程注入全局未捕获异常监听，格式化错误堆栈并通过 `parentPort` 发送结构化 `error` 消息后再优雅退出，避免由于插件未 `await` 异步 RPC 调用导致 Worker 进程无声暴毙；
  - **插件上下文心跳 API (`ctx.reportProgress`)**：在 `PluginContext` 中暴露 `reportProgress(stage?, message?)`，支持耗时全栈插件在执行数据迁移或大模型加载时向宿主上报进度并滑动续期激活超时窗口；
  - **数据库迁移 DDL 命名空间放行与异步时序保护 (`service-host.ts` & `worker-manager.ts`)**：
    - 在 `ServiceHost.assertDatabaseAccessAllowed` DDL 白名单中放行 `plugin_migrations` 表，解决 Worker 插件执行 `ctx.db.migrate` 自动初始化迁移记录表时因命名空间拦截报错的问题；
    - 在 Worker 沙箱 `dbApi.migrate` 的 `dbWrapper` 中加入 `pendingPromises` 队列并统一 `Promise.all`，保证即使插件开发者未显式 `await` 内部 SQL 也能安全按序完成迁移后再更新版本号；
    - 修复机房插件 `@aymwoo/plugin-lab-seat` 在 `activate()` 中异步 DDL 操作未捕获 Promise Rejection 导致的崩溃问题。

### Docs & Engineering

- **Sphinx 技术文档严苛零告警编译与全量同步**:
  - 修复 `docs/conf.py` 静态目录配置缺失引发的 `_static` 警告，补全 `docs/_static/.gitkeep`；
  - 修复 `docs/plugin/anchor-slots.md` 中未包裹 TSX 语法导致的 Pygments 词法分析器异常；
  - 清理 `docs/index.md` 目录树中重复引用的 `api/di-tokens`；
  - 全面同步前端共享依赖白名单、Worker 迁移 DDL 规则、心跳 API 及 `IAuthSessionBridgeToken` 字典规范。

## [0.3.15] - 2026-09-17

### Features & Security

- **LTI 1.3 协议支持与安全会话桥接体系 (LTI 1.3 Advantage & Safe SSO Integration)**:
  - **Iframe 嵌入安全管控 (`server.ts`)**: 新增 `LTI_ALLOWED_LMS_ORIGINS` 环境变量支持，配置后动态放行 CSP `frame-ancestors` 并自动关闭 `X-Frame-Options: SAMEORIGIN`，使平台可在受信任的 Canvas/Moodle 等 LMS 平台的 iframe 中无缝内嵌运行，未配置时保持原有严格同源防点击劫持策略；
  - **平台统一会话桥接服务 (`IAuthSessionBridgeService`)**: 在 DI 容器中注册统一会话创建服务，供特权认证插件安全同步用户并生成 `client_sessions`；
  - **网关跨域会话 Cookie 安全注入与特权守卫 (`PluginApiGateway`)**: 扩展 `PluginApiResponse` 支持 `sessionToken` 字段，且通过特权守卫限制仅声明依赖 `IAuthSessionBridgeService` 的认证插件可触发下发；网关在主线程自动写入符合第三方 Iframe 规范的 `SameSite=None; Secure; HttpOnly` 会话 Cookie，同时保持对非授权普通响应头 `Set-Cookie` 的严格黑名单剥离；
  - **官方参考插件研发 (`@openlearn/plugin-lti-provider`)**: 提供完整的 LTI 1.3 Tool Provider 独立插件参考实现，内聚 OIDC 3-Legged 登录状态机、RS256 JWT 验签与公钥托管（`/jwks`），支持 LTI Advantage 成绩回传 (`assignment.graded` 监听与 AGS 同步)。

## [0.3.14] - 2026-09-09

### Fixes & Packaging

- **修复 `npx openlearn-next` 运行时无法解析可选依赖 `xlsx` 的告警 (Cannot find package 'xlsx')**:
  - **根因分析**：`xlsx` 被误声明为 devDependency，但服务端 bundle 以 `--packages=external` 构建，`import('xlsx')` 被保留为运行时动态导入；devDependency 不会随发布包安装到消费者环境（含 npx 缓存目录），导致动态导入失败并打印 `[PluginHost] xlsx not available (optional)` 告警；
  - **修复**：将 `xlsx` 从 devDependencies 移至 dependencies，确保运行时动态导入可正常解析，插件共享模块正确注册 Excel 导入导出能力。

### Fixes & UI

- **修复教师端模拟学生（Student View）后无法返回教师端的交互缺失缺陷**:
  - 在 `App.tsx` 页面最顶部新增常驻醒目的全局模拟学生横幅（Top Impersonation Banner），提示当前模拟学生并提供常驻【退出模拟并返回教师端】操作；
  - 在 `AppHeader.tsx` 顶部导航栏的 `View as: [选择学生]` 下拉框旁接入 `setActiveRole` 并增加【返回教师端】快捷操作按钮；
  - 完善 `AppHeader.test.tsx` 单元测试，覆盖模拟状态退出按钮的渲染与触发回调。

## [0.3.13] - 2026-09-06

### Fixes & Packaging

- **修复 NPM 发布包中 `workspace:*` 协议未展开导致的 npx 无法运行异常 (EUNSUPPORTEDPROTOCOL)**:
  - **根因分析**：由于发包流程使用了原生 `npm publish`，原生 npm 不支持 pnpm monorepo 的 `workspace:*` 依赖协议，导致打入 tarball 的 `package.json` 中 `@openlearn/plugin-sdk` 依赖未展开为真实版本号；终端执行 `npx openlearn-next` 时报错 `npm error Unsupported URL Type "workspace:": workspace:*` 并退出；
  - **发布修复**：切换发布脚本为 `pnpm publish --no-git-checks`，打包阶段由 pnpm 自动将 `workspace:*` 解析并转译替换为真实版本号（`3.6.0`）；
  - **SOP 规范修正**：更新 `.agents/skills/openlearn-release-workflow/SKILL.md`，将平台主包发布命令标准化为 `pnpm publish --no-git-checks`。

## [0.3.12] - 2026-09-06

### Features & Security

- **插件 HTTP SSE 流式长连接通信体系 (`Plugin HTTP SSE Streaming & Safety Defense`)**:
  - **极简流式 API 契约 (`ctx.http.stream`)**:
    - 在 `IPluginHttpRouter` 中新增 `stream(path, handler)`（支持缺省动词匹配 GET/POST）与 `stream(method, path, handler)`（显式动词匹配）；
    - 向插件注入 `PluginStreamResponse` 写入器，支持 `stream.write(data, event?, id?)`、`stream.end()`、`stream.error(err)`、`stream.isClosed` 及 `stream.onClose(callback)`；
    - 自动格式化符合 W3C 标准的 SSE 事件流（支持多行文本 `data: line1\ndata: line2\n\n` 及 JSON 结构自动序列化）。
  - **Worker 隔离模式跨线程流式 RPC 通道**:
    - 新增跨线程流式协议族：`httpStreamStart`、`httpStreamChunk`、`httpStreamEnd`、`httpStreamError`、`httpStreamAbort`、`routesRegistered`；
    - Worker 内部通过轻量代理透明接收流式请求，实现毫秒级逐 chunk 双向 IPC 通信；
    - Worker 插件激活时自动将注册的路由元数据（包含 `isStream` 标识）上报至宿主，宿主毫秒级精准识别流式路由。
  - **反向中止与大模型算力熔断保护 (T-STR-04)**:
    - 客户端断开连接（如用户点击“停止生成”、刷新或关闭页面）时，主线程通过 `res.on('close')` 毫秒级向 Worker 派发 `httpStreamAbort`；
    - Worker 内部立即将 `stream.isClosed` 标记为 `true` 并触发 `stream.onClose(cb)` 监听器，强制打断 Worker 内正在进行的大模型 API 调用与循环任务，杜绝 Token 浪费与僵尸进程。
  - **纵深流式安全防御机制 (Threat Mitigations)**:
    - **T-STR-01 并发长连接硬上限**：单 IP 最多 5 个并发流，单插件最多 50 个并发流，超限返回 429 Too Many Requests，防御慢速长连接 Slowloris 攻击耗尽套接字与文件描述符；
    - **T-STR-02 超时看门狗阶梯防护**：首包超时（10s）+ 最大空闲超时（60s）+ 最大生存期（300s）看门狗守护，超时强制切断悬挂流；
    - **T-STR-03 单 Chunk 体积硬限制**：单个 SSE Chunk 大小硬限制 64KB，超限直接报错熔断，防内存洪峰 OOM；
    - **T-STR-05 标头强制固化**：安全网关强制注入标准 SSE 标头（`text/event-stream; charset=utf-8`、`no-cache`、`no-transform`、`keep-alive`、`X-Accel-Buffering: no`），禁止插件篡改高危 Header；
    - **T-STR-06 生命周期统一回收**：插件停用或热重载时，强制销毁所有未关闭的流并向 Worker 发送 abort，无任何悬挂遗留。
  - **开发者测试工具包赋能 (`@openlearn/plugin-test-kit`)**:
    - 导出 `createMockStreamResponse()` 工具函数与 `MockStreamResult` 接口，方便插件开发者在单测中无需启动 HTTP 服务器即可离线验证流式生成与中断逻辑。

## [0.3.11] - 2026-09-06

### Features & Security

- **插件安全 RESTful API 体系 (`Plugin RESTful API & Security Gateway`)**:
  - **声明与注册双轨模型**：
    - 在 `manifest.json` 中支持 `api.routes` 静态规则声明（支持 `method`, `path`, `auth`, `roles`, `rateLimit`），便于平台前置进行静态安全合规审计与网关路由规则初始化；
    - 插件在 `activate(ctx)` 生命周期中直接通过 `ctx.http`（`IPluginHttpRouter`）注册路由处理函数（支持 `get`, `post`, `put`, `delete`, `patch`, `all`），支持动态路径参数提取（`:param`）与自动包装 200 OK；
    - 统一路由端点挂载规范：`/api/plugins/:pluginId/*`。
  - **纵深安全网关防御中间件 (`PluginApiGateway`)**:
    - **系统保留路由避让**：核心动作（如 `config`, `toggle`, `contributions`）无缝避让放行至既有控制器；
    - **路径遍历防护 (Path Traversal Protection)**：对原始子路径及规范化路径执行双重 `..` 检测，识别并阻断路径遍历攻击（返回 400）；
    - **请求体硬限制 (DoS/OOM 防护)**：Payload 体积硬限制 1MB，超限直接返回 413，大文件上传强制引导至平台统一 `IStorageService` 通道；
    - **滑动窗口内存限流器 (Rate Limiter)**：基于客户端 IP + 插件 ID 滑动窗口统计，默认单端点 120 req/min 防刷，超限返回 429 与 `Retry-After`；
    - **前置认证与细粒度 RBAC 守卫**：支持 Session Cookie (`edu_os_token`) 与 `Authorization: Bearer` 凭证，校验用户角色权限，未登录返回 401，权限不符返回 403（`auth: false` 显式声明的公开路由直接放行）；
    - **响应安全清洗 (Response Sanitization)**：安全网关强制剔除插件试图向客户端注入的高危响应头（包括 `Set-Cookie`, `Access-Control-Allow-Origin`, `Content-Security-Policy` 等），从根本上消除会话劫持与策略篡改风险。
  - **Worker 沙箱隔离模式跨线程 RPC 通信**:
    - 在 Worker 运行时与宿主之间扩展 `httpRequest` / `httpResponse` 跨线程 RPC 消息协议；
    - Worker 线程通过纯只读不可变的 `PluginApiRequest` DTO 处理请求，完全杜绝沙箱插件直接持有或污染 Node.js 原生 Express Request/Response 对象的可能；
    - 内置 5000ms 超时熔断保护，防止 Worker 挂起耗尽宿主连接。
  - **Plugin Test Kit 与生命周期联动**:
    - `@openlearn/plugin-test-kit` 的 `createMockContext` 默认内置 `PluginHttpRouter`，让插件开发者开箱即用编写单元测试；
    - `ResourceTracker` 与插件生命周期深度绑定，插件卸载或热重载时自动清理路由器，彻底防止路由泄漏。

## [0.3.10] - 2026-09-06

### Features & CLI Utilities

- **`doctor` 增加 SDK 套件与插件版本全方位兼容性检测**：
  - **SDK Suite 综合检测**：同步校验 `@openlearn/plugin-sdk` 与 `@openlearn/plugin-test-kit` 的解析版本与安装形态；
  - **内置核心插件平台兼容性 (`Core Plugins`)**：零外部依赖校验全部 7 个核心内置插件的 `engines.openlearn` 约束是否被当前平台版本满足，防范版本互锁；
  - **已安装扩展插件引擎约束检测 (`Installed Plugins`)**：自研轻量级 SemVer 范围判定引擎，扫描 SQLite 数据库与本地插件清单，校验各扩展插件与平台版本（`engines.openlearn`）的兼容性，精准识别不兼容插件并提出预警。

### Fixes

- **SDK 依赖版本漂移治理**：根 `package.json` 的 `@openlearn/plugin-sdk` 从 `^3.5.2` 改为 `workspace:*` 并刷新锁文件（此前锁文件冻结在 npm 3.5.2 快照、`.pnpm` 残留 3.4.3，与 workspace 3.6.0 三版本并存，宿主实际解析版本随安装历史漂移）；移除 `pnpm-workspace.yaml` 中过期的 `minimumReleaseAgeExclude`（SDK 3.5.2）与不存在的 `packages/mfe-courseware` workspace 条目。
- **发布流程防漂移（npx 确定性依赖）**：`scripts/publish.sh` 与 CI `publish.yml` 在发布 `openlearn-next` 前将 `workspace:*` 重写为精确 SDK 版本并发布后还原——`server.cjs` 以 `--packages=external` 构建、运行时从消费者 `node_modules` 解析 SDK，精确 pin 保证 npx/npm 用户装到的 SDK 与构建时版本强一致。
- **`build-plugins.mjs` 与 SDK CLI / token-enforcer 策略对齐**：插件 ZIP 构建改为 `external: ['@openlearn/plugin-sdk']`，不再把构建时刻的 SDK 代码打进产物（否则运行时与宿主解析的 SDK 脱节，且可能被 token-enforcer 拒绝）。
- **插件更新检测补全**：`POST /api/plugins/:id/check-update` 在插件未声明市场更新源（`updateSource`）时回退扫描本地 `v2_plugins/*/manifest.json` 按 semver 对比，避免已安装插件停留在安装时刻的快照版本；移除 `one-click-update` 中指向已下架 research-workflow 插件的硬编码死路径分支，无 `downloadUrl` 时明确返回 400 并引导客户端 ZIP 直传；Plugin Center 更新弹窗对本地源更新显示"重新构建 ZIP 上传"提示而非热更新按钮。
- **`npx openlearn-next` CLI 参数解析与命令调度重构**：
  - 引入健壮的零外部依赖 token 解析器，支持位置无关的子命令调度（如 `openlearn-next --port 9001 doctor` 不再跳过子命令错误拉起服务端）；
  - 支持 `--key=value` 赋值语法（如 `--port=9000`、`--host=127.0.0.1`、`--cors=*`）；
  - 严格校验必需参数缺失（如单独输入 `-p` 或 `-p -H 127.0.0.1` 时明确报错退出，不再静默吞并后序参数）；
  - 增加未知/拼写错误命令拦截（如 `docotr` 给出友好报错提示，避免误启动服务）；
  - 增加停机信号超时保护至 35s，确保内核 30s 优雅关机流程完整执行。
- **`clean` 模式 SQLite WAL 预写日志安全落盘保护**：在默认清理模式下，清理 WAL/SHM 前先调用 SQLite `PRAGMA wal_checkpoint(TRUNCATE)` 将预写日志落盘至主库，消除直接 `unlinkSync` 导致未 checkpoint 事务静默丢失的高危隐患；同时兼容 Windows 下 `%LOCALAPPDATA%` NPX 缓存目录发现。
- **`doctor` 防版本漂移体系升级与一键自愈 (`--fix`)**：
  - **SDK Version 解析鲁棒化**：通过 Node 模块解析器与向上递归解析，兼容 npm/npx 依赖提升（hoisting）结构；
  - **平台内核核心版本防漂移**：自动校验 `package.json` 与 `packages/core/version.ts` 的版本一致性；
  - **NPX 缓存历史包防漂移**：扫描发现滞留的旧版本 NPX 缓存包并发出预警；
  - **一键自愈 (`--fix`)**：支持 `npx openlearn-next doctor --fix` 一键自动清理旧版 NPX 缓存、自动同步版本元数据、自动创建数据目录。
- **`backup` 目标目录自动递归创建**：在线冷备时若目标路径包含多级未创建目录，自动执行 `mkdirSync(recursive)` 防止 ENOENT 异常。
- **`openlearn-next doctor` 新增 SDK Version 一致性检查**：对比 `package.json` 声明与 `node_modules` 实际解析版本（支持 workspace 链接 / 精确 pin / caret 三种形态，零依赖实现），不一致时报错并给出修复指引。

### Docs

- `docs/index.md` 去除硬编码的 `@openlearn/plugin-sdk@3.5.2` 版本号，改为跟随平台 release。

## [0.3.9] - 2026-09-06

### Fixes

- **Worker 插件 DB 代理补齐 `exec` 转发**：`ctx.resolve(IDatabaseToken)` 的 worker 侧 stub 只暴露 `prepare/{run,get,all}`，worker 插件调用 `exec` 报 `rawDb.exec is not a function`。主侧 exec RPC 本就经过 `assertDatabaseAccessAllowed` 守卫（DDL 命名空间 + 核心表黑名单），此处补齐转发；返回 Promise（异步 RPC），与 `prepare*` 语义一致。
- **脚手架 CLI 不再把 SDK 自身打进插件 bundle**（随 `@openlearn/plugin-sdk` **3.6.0** 发布，详见其 CHANGELOG）：SDK dist 引用宿主侧 pino/express/uuid/semver，此前被整体打进插件产物导致脚手架项目构建失败、产物在宿主被 token-enforcer 拒绝；现保持 external，与平台官方 `build-plugins.mjs` 一致，独立脚手架无需手动补装依赖。
- 同步发布 `@openlearn/plugin-test-kit` **3.3.2**。

## [0.3.8] - 2026-09-06

### Features & CLI Utilities (CLI 运维诊断与便捷体验全景增强)

- **多网卡局域网 IP 自动侦测与终端直显 (`-H, --host`)**：
  - 启动服务时自动扫描全量本地网卡 IPv4 地址，终端同时以明亮高亮及可点击超链接形式输出 `Local` (http://localhost:PORT) 与 `Network` (http://192.168.x.x:PORT) 访问地址，极大简化教师多设备与局域网移动端机房联调流程；
  - 支持 `-H, --host <host>` 参数自定义监听网卡。
- **服务就绪后自动唤起浏览器 (`-o, --open`)**：
  - 跨平台零外部依赖实现（macOS `open` / Windows `cmd start` / Linux `xdg-open`），在 HTTP 服务器真正绑定就绪时精准静默自动弹出默认浏览器。
- **环境健康自检与就绪诊断工具 (`npx openlearn-next doctor`)**：
  - 新增独立子模块 [`cli-doctor.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-doctor.mjs)，支持五维综合体检：
    1. Node.js 运行时版本校验（>= 20.0.0 严格检查）；
    2. 硬件架构、CPU 核心数与剩余空闲物理内存容量评估；
    3. 目标数据存储目录递归创建与原子写入/删除权限检测；
    4. 目标端口（默认 9000 或 `-p` 指定）占用状态与自动避让检测；
    5. 本机局域网网络接口连通性与 IPv4 地址检测。
- **一键在线冷备快照与安全回滚恢复 (`backup` / `restore`)**：
  - 新增独立数据运维子模块 [`cli-data.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-data.mjs)；
  - `backup [file]`：基于 SQLite WAL 在线一致性快照技术，毫秒级导出当前平台完整快照；
  - `restore <file>`：还原前强制校验 SQLite Magic Header (`SQLite format 3\0`) 防坏文件注入，并自动为被覆盖主库生成 `.bak_<timestamp>` 安全回滚镜像副本。
- **终端免界面重置管理员密码 (`reset-admin`)**：
  - `reset-admin [--password <pwd>]`：在无需启动 Web 界面的情况下，直接对主库 `admin` 账号进行 bcrypt 加密重置，并在账号缺失时自动补全。
- **命令行轻量级插件状态速查 (`plugins [list]`)**：
  - 终端直接输出已安装插件的 ASCII 美化表格（包含插件 ID、版本、状态、加载模式），支持各类环境 schema 兼容。
- **一次性纯净临时沙盒演示模式 (`--demo` / `--temp`)**：
  - 在操作系统临时目录动态生成隔离沙盒环境运行，并在终端收到 `SIGINT` / `SIGTERM` 退出信号时，经由优雅关闭管道自动销毁沙盒数据，实现“零残留、用完即走”。
- **CORS 跨域白名单命令行透传 (`--cors <origins>`)**：
  - 命令行直接透传配置到 Express 与 Socket.IO 运行时跨域拦截器。
- **自动化测试保障**：
  - 新增专用自动化测试套件 [`packages/core/__tests__/cli-enhanced.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/cli-enhanced.test.ts)，全量 7 项测试保障。

## [0.3.7] - 2026-09-06

### Features & CLI Utilities

- **NPX 缓存与运行数据安全清理命令 (CLI Cache Cleaner Command)**：
  - 在 [`cli.mjs`](file:///home/wuxf/Develop/openlearnv2/cli.mjs) 及 [`cli-cleaner.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-cleaner.mjs) 中新增 `clean` / `clean-cache`（以及 `--clean` / `--clean-cache`）命令行工具；
  - **精准清理 NPX 历史旧包**：自动扫描 `~/.npm/_npx/` 下的所有散列子目录，精准清理历史残留的旧版本 `openlearn-next` 临时目录，彻底杜绝 NPX 因缓存命中旧版本的问题；
  - **优化运行数据与日志**：默认清理 SQLite WAL 预写日志 (`data.db-wal`)、共享内存文件 (`data.db-shm`) 与临时目录，并在默认模式下严格保护用户核心业务数据 `data.db` 不被误删；
  - **丰富选项支持**：支持 `--npx`（仅清包缓存）、`--db`（重置本地数据库）与 `--all`（全量彻底清理重置）；
  - 新增 `-v` / `--version` 快速版本查询与完善的 `-h` / `--help` 命令帮助指引；
  - 新增自动化单元测试套件 [`packages/core/__tests__/cli-cleaner.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/cli-cleaner.test.ts)。

## [0.3.6] - 2026-09-06

### Quality & Governance (防版本漂移质量加固)

- **内核导出版本定义强收敛 (Kernel Definition Convergence)**：
  - 将 [`packages/core/bootstrap/types/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/bootstrap/types/index.ts) 中的 `PLATFORM_VERSION` 改为直接从单一真理源 [`packages/core/version.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/version.ts) 导入，彻底消除内核内部出现双重硬编码字面量的隐患。
- **全自动防版本漂移质量门禁测试 (Anti-Drift Test Gate)**：
  - 新增专用自动化质量门禁测试套件 [`packages/core/__tests__/version-consistency.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/version-consistency.test.ts)，设立 6 重自动化强断言：
    1. 根目录 `package.json.version` 强等于 `PLATFORM_VERSION`；
    2. `OPENLEARN_VERSION` 强等于 `PLATFORM_VERSION`；
    3. `bootstrap/types` 导出的平台版本强等于核心版本；
    4. `PlatformBuilder` 构建元数据与环境版本强等于核心版本；
    5. 全量 7 个核心内置插件（`builtin`、`vfs`、`process`、`management`、`ai-planner`、`ai-submit-injector`、`assignment-eval`）的 `engines.openlearn` 约束能被平台当前版本 100% 满足；
    6. `docs/conf.py` 动态或静态严格与 `package.json` 对齐。
  - 后续任何发版若漏改任一处或引发插件互锁，`pnpm test` 会在 1 秒内阻断发布并给出清晰指引。
- **文档系统版本动态绑定 (Dynamic Docs Versioning)**：
  - 改造 [`docs/conf.py`](file:///home/wuxf/Develop/openlearnv2/docs/conf.py)，改用 Python 原生动态读取根目录 `package.json` 的版本号，保证 Sphinx 文档系统与主应用平台版本永不脱节。
- **SDK 依赖版本对齐与发版脚本加固 (Dependency & Publish Hardening)**：
  - 升级根目录 `package.json` 对 `@openlearn/plugin-sdk` 的依赖为 `^3.5.2`；
  - 加固 [`scripts/publish.sh`](file:///home/wuxf/Develop/openlearnv2/scripts/publish.sh)，前置注入 `pnpm lint` 与防漂移测试强制门禁；
  - 完善发版指南 [`.agents/skills/openlearn-release-workflow/SKILL.md`](file:///home/wuxf/Develop/openlearnv2/.agents/skills/openlearn-release-workflow/SKILL.md) 标准操作规程。
- **生态与插件开发规范文档纠偏 (Ecosystem Doc Fixes)**：
  - 修正 [`docs/plugin/plugin-manifest-spec.md`](file:///home/wuxf/Develop/openlearnv2/docs/plugin/plugin-manifest-spec.md) 与插件开发教程中的 SemVer 示范，全面替换为 `">=0.2.5"` 并详细阐述 SemVer 0.x 规则。

## [0.3.5] - 2026-09-06

### Fixes & Architecture Alignment

- **平台版本单一真理源 (Single Source of Truth) 与漂移消除**：
  - 新建 [`packages/core/version.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/version.ts)，统一导出 `PLATFORM_VERSION` 与 `OPENLEARN_VERSION`；
  - 消除 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中历史滞留的 `OPENLEARN_VERSION = '0.2.5'` 硬编码；
  - 消除 [`packages/core/bootstrap/types/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/bootstrap/types/index.ts) 与各适配器（`UnifiedExtensionRegistry`、`PluginRuntimeAdapter`、`PluginCapabilityGateway`、`PluginRuntimeComposition`、`PluginLifecycleManager`、`PluginDistributionManager` 等）中写死的 `'0.2.5'`；
  - 修正 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 的 `/health` 接口版本获取逻辑，直接使用 `PLATFORM_VERSION`，彻底避免跨目录/CLI 运行环境下 `process.cwd()` 缺失 `package.json` 导致的读取回退。
- **内置核心插件与模版兼容性放宽 (Relaxed Engine Constraints)**：
  - 将 7 大内置插件（`builtin`、`vfs`、`process`、`management`、`ai-planner`、`ai-submit-injector`、`assignment-eval`）及插件 SDK 脚手架模板中的 `engines.openlearn` 由过紧的 `^0.2.5`（SemVer 规范下仅匹配 `<0.3.0`）调整为向上兼容的 `>=0.2.5`，杜绝 0.x 阶段版本升级引发的插件互锁拒载异常。
- **SPA 路由与健康检查端点层级调整 (Route Order Correction)**：
  - 将 `/health`、`/health/ready`、`/metrics` 端点移至静态 SPA 回退路由（`app.get('*', ...)`）之前，修复生产环境下对系统探针请求错误返回 `index.html` 的问题。
- **历史数据库插件恢复安全容错 (Worker Directory Existence Guard)**：
  - 在 [`packages/core/worker-runtime/worker-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/worker-manager.ts) 创建 Worker 时，检查 `pluginDir/index.js` 是否在物理磁盘真实存在。若物理文件因迁移或版本迭代已清理，自动安全回退至内嵌数据 URL 启动，消除启动恢复时的 `ERR_MODULE_NOT_FOUND` 堆栈报警。

## [0.3.3] - 2026-09-06

### Fixes & Network Hardening

- **Socket.IO & Express Same-Origin CORS 智能放行 (Same-Origin Auto-Allowance & CORS Fix)**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 引入统一的 `isOriginAllowed(origin, hostHeader)` 判定算法；
  - 修复生产环境（未显式配 `ALLOWED_ORIGINS` 时）CORS 回调对同源浏览器请求（如 `http://localhost:9000`）抛出 `new Error('CORS not allowed')` 导致底层 Engine.IO 响应 `HTTP 400 Bad Request {"code": 3, "message": "Bad request"}` 的问题；
  - 自动放行同源请求（`new URL(origin).host === hostHeader`）与本地回环来源（`localhost`、`127.0.0.1`、`[::1]`、`0.0.0.0`），对于未受信任跨域请求安全剔除 `Access-Control-Allow-Origin` 头而不再向底层抛出未捕获异常；
  - 解决客户端重连由于 CORS 阻断陷入反复 400 的异常状态。

## [0.3.2] - 2026-09-06

### Fixes & Runtime Hardening

- **Vite 依赖动态按需解耦 (Vite Decoupling & Module Loader Fix)**：
  - 移除 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 顶层静态 `import { createServer as createViteServer } from 'vite'`，消除 esbuild 打包 CJS 时在 `dist/server.cjs` 顶层生成的 `require("vite")` 提升语句；
  - 将开发期 Vite 中间件初始化改为在 `if (process.env.NODE_ENV !== 'production')` 分支内执行异步 `await import('vite')`，彻底解决在纯生产环境（零 `devDependencies` 安装）及 `npx openlearn-next@latest` 启动时由于缺失 vite 引发的 `Cannot find module 'vite'` 崩溃异常。
- **esbuild 核心解耦与生产依赖补齐 (esbuild Dynamic Import & Dependency Governance)**：
  - 移除 [`packages/core/esm-loader/install-utils.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/esm-loader/install-utils.ts) 顶层静态 `import * as esbuild from 'esbuild'`，在 `bundlePlugin` 函数内部改为按需动态 `await import('esbuild')`，避免服务启动模块加载期对 esbuild 的同步求值；
  - 将 `esbuild` 正式移入 [`package.json`](file:///home/wuxf/Develop/openlearnv2/package.json) 的生产 `dependencies`，保障在独立部署与分发场景下管理后台上传安装插件 ZIP 时的内存打包与编译功能完好可用；
  - 经扫描校验，`dist/server.cjs` 外部依赖缺失项完全归零（`Missing from dependencies: []`）。
- **CLI 生产环境模式显式守卫 (CLI Production Safeguard)**：
  - 在 [`cli.mjs`](file:///home/wuxf/Develop/openlearnv2/cli.mjs) 启动子进程前显式注入 `process.env.NODE_ENV = process.env.NODE_ENV || 'production'`，保障从 CLI/npx 唤起时稳定运行于生产静态托管模式。

## [0.3.1] - 2026-09-06

### Features

- **插件导航 API 扩展**：`FrontendPluginContext.navigation` 新增 `setSelectedLesson(lessonId: string | null)` 方法，转发到 `appStore.setSelectedLesson`，供第三方插件在 `activate(ctx)` 中切换当前课节。

### Security & Multi-Teacher Authorization (Round 4)

- **IDOR 课程水平越权防护与教师专属所有权 (Lesson Ownership & IDOR Protection)**：
  - **数据层升级**：在 [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 与 [`migrations/000_initial_schema.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/000_initial_schema.sql) 中的 `lessons` 表增加 `creator_id TEXT` 字段，并在系统启动时平滑执行 `ALTER TABLE lessons ADD COLUMN creator_id TEXT`，全面兼容历史老版本未标记创建人的课程；
  - **内核指令绑定**：在 [`packages/plugins/builtin.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/builtin.ts) 的 `lesson.create` 命令执行时，优先解析 `payload.creatorId` 或提取 `command.actorId`（自动解析 `user:usr_id:teacher` 前缀），并在发出的 `lesson.created` 领域事件中携带创建人 ID；
  - **路由所有权守卫与白板写访问权限中间件**：在 [`server/routes/lessons.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/lessons.ts) 抽象出通用鉴权函数 `checkLessonOwnership(req, lessonId)` 与声明式白板写权限中间件 `requireWhiteboardWriteAccess()`：
    - 针对课堂主白板（`!assignment-`），强制教师/管理员登录并验证课程所有权，严禁学生和未授权教师修改/清空白板；
    - 针对随堂作业学生白板（`assignment-${id}-student-${studentId}`），强制身份认证并校验当前学生是否为该作业的拥有者（防止跨学生篡改与匿名恶意刷白板），教师与管理员放行以支持在线批注与作业点评；
    - 统一挂载至 `POST /api/lessons/:id/whiteboard/reset`、`POST /api/lessons/:id/whiteboard`、`PUT /api/lessons/:id/whiteboard/:elementId`、`DELETE /api/lessons/:id/whiteboard`、`DELETE /api/lessons/:id/whiteboard/:elementId`；
    - 为 `POST /api/lessons/:id/quiz-submit`、`GET /api/lessons/:id/quiz-submissions` 以及 `POST /api/lessons/:id/ai-tutor` 补齐明确的 `requireAuth` 角色中间件，拦截匿名恶意调用与大模型 Token 额度消耗。
  - **教研协同流转与一键克隆**：重构 `POST /api/lessons/:id/clone` 接口，强制挂载 `requireAuth('teacher', 'administrator')` 中间件，在复制课程模板与白板结构时自动将新课程属主更新为当前操作教师，实现“跨教师只读浏览 + 一键克隆转为本人教案”的顺畅备课流转；
  - **前端交互与安全视觉**：
    - 在 [`CourseManagement.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/CourseManagement.tsx) 课程卡片中显著标注创建教师身份（本人课程展示皇冠徽章，他人课程展示只读图标），对于非本人创建课程禁用删除按钮并提示权限不足；新增「我的备课」快速筛选开关，支持教师在海量共享课程中一键聚焦个人教案；
    - 在 [`LessonEditorView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/LessonEditorView.tsx) 中增加只读横幅提示，并在他人课程模式下引导一键克隆，拦截非所有者修改操作；
  - **自动化测试套件**：编写 [`server/__tests__/lesson_ownership.test.ts`](file:///home/wuxf/Develop/openlearnv2/server/__tests__/lesson_ownership.test.ts)，全方位覆盖未登录拦截 (401)、学生越权阻断 (403)、跨学生作业白板篡改拦截 (403)、跨教师越权拦截 (403)、管理员放行、老旧课程兼容以及克隆后属主流转等核心用例，全平台 177 个测试套件（1011 个测试用例）持续 100% 绿灯。

### Security & Engineering Governance (Round 3)

- **SEC-01 传输安全与 Cookie 策略加固 (Cookie Secure & Nginx TLS Best Practice)**：
  - 在 [`server/routes/roster.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/roster.ts) 中对身份凭据 Cookie `edu_os_token` 进行安全改造，根据请求来源及环境协议动态注入 `; Secure` 标识，并将超长有效期缩短并精准对齐服务端会话有效期（7 天 / 604,800 秒）。
  - 在 [`nginx.conf`](file:///home/wuxf/Develop/openlearnv2/nginx.conf) 与 [`nginx.generated.conf`](file:///home/wuxf/Develop/openlearnv2/nginx.generated.conf) 增补全链路 HTTPS 443 SSL 规范配置（TLS 1.2/1.3、强加密套件、HSTS），并提供 80 端口强跳 443 的最佳实践指导。
- **SEC-02 敏感端点鉴权防护与统一脱敏错误处理中间件 (Endpoint Protection & Info Leakage Defense)**：
  - 对监控与关键配置端点挂载严格权限门禁：[`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 中的 `/metrics` 挂载 `requireAuth('administrator')`；[`server/routes/plugins.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/plugins.ts) 中的 `GET /api/ai-providers` 挂载 `requireAuth('teacher', 'administrator')`，`/api/admin/logs` 挂载 `requireAuth('administrator')`。
  - 创建 [`server/utils/error-handler.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/error-handler.ts) 实现统一的 `sendSafeError` 错误响应中间件，在生产环境下统一屏蔽底层 SQL 语句、文件系统绝对路径与系统异常堆栈，全面替换各路由模块中的裸 `e.message` 返回，杜绝敏感系统信息探测与泄漏。
- **SEC-03 依赖治理、锁定文件与工程规范校准 (Dependency Governance & Clean Repository)**：
  - 彻底清理仓库跟踪的冗余锁定文件 `package-lock.json` 与历史遗留临时文件 `temp_check.mjs`、`test-results/`，同步在 [`.gitignore`](file:///home/wuxf/Develop/openlearnv2/.gitignore) 增补忽略规则。
  - 在 [`package.json`](file:///home/wuxf/Develop/openlearnv2/package.json) 补齐 `"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }`；清理失效废弃脚本 `migrate-passwords`；
  - 编写 [`scripts/backup-db.ts`](file:///home/wuxf/Develop/openlearnv2/scripts/backup-db.ts) 重构 `db:backup` 脚本，修复此前因 ESM/CJS 混用导致的模块加载失败。
- **SEC-04 代码清洁度与路由层解耦治理 (Lint Warnings & Architecture Hygiene)**：
  - 全面清理由旧版 `server.ts` 拆分至 14 个路由文件时机械复制的无用头文件导入与上下文全量解构代码（如 `GoogleGenAI`、`xss`、`crypto`、`bcrypt`、`ai-submit-injector` 等），ESLint warnings 大幅缩减近 600 个，TypeScript 类型检查零错误通过。
- **SEC-05 自动化测试与内核文档同步 (Docs & Test Parallelism Alignment)**：
  - 校准 [`AGENTS.md`](file:///home/wuxf/Develop/openlearnv2/AGENTS.md) 描述，阐明 Vitest 启用 `fileParallelism: true` 的真实原理（通过环境变量 `VITEST_POOL_ID` 隔离于独立 SQLite 库文件），修复文档失真；全量 176 个测试套件、993 个用例持续 100% 绿灯通过。

### Security

- **VULN-06 白板协同投毒阻断 (RCE & XSS Defense)**：
  - 彻底移除 [`MathGraphWrapper.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/MathGraphWrapper.tsx) 中的原生 `eval`，自研实现算术 AST 递归下降求值器 `safeEvaluateMath`，严格限定白名单数学运算与常用函数，彻底阻断 JS 语法、属性与原型链穿透。
  - 重构 [`CodeSandboxWrapper.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/CodeSandboxWrapper.tsx)，将代码执行迁移至独立 Web Worker Blob 沙箱环境，隔离 DOM、Cookie、`localStorage` 访问，并配置 3 秒看门狗超时中断。
- **VULN-03 审批端点鉴权与篡改拦截**：
  - 在 [`server/routes/processes.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/processes.ts) 中对 `/api/approvals/*` 与 `/api/processes/*` 强制挂载 `requireAuth('administrator')`，并彻底移除 `payloadOverride` 字段，杜绝参数篡改风险。
- **VULN-07 课件上传路径穿越与同源 XSS 隔离**：
  - 在 [`packages/plugins/builtin.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/builtin.ts) 中对课件单 HTML 上传增加路径净化 `path.basename(filename.replace(/\\/g, '/'))` 与 `!destPath.startsWith(storageDir)` 沙箱边界强校验，彻底拦截 `../` 路径穿越写文件。
  - 在 [`server/routes/resources.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/resources.ts) 直出 HTML 资源响应头注入 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-downloads`，将其降级为 opaque origin，消除同源 XSS 攻击向量。
- **VULN-01 核心业务路由鉴权全覆盖**：
  - 在 [`server/routes/roster.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/roster.ts)、[`server/routes/grading.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/grading.ts)、[`server/routes/assignments.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/assignments.ts)、[`server/routes/schedules.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/schedules.ts)、[`server/routes/lessons.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/lessons.ts)、[`server/routes/workspace.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/workspace.ts) 中为所有增删改接口全面补齐 `requireAuth('teacher', 'administrator')`。
  - 在 `/api/vfs` 针对 `virtual-submissions` 增加数据脱敏，普通学生仅可拉取本人提交物，杜绝全校学生姓名、提交内容与成绩泄露。
- **VULN-02 课件成绩伪造与冒名提交拦截**：
  - 在 [`server/routes/courseware.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/courseware.ts) 课件管理接口挂载教师/管理员鉴权，在 `/attempts/:attemptId/log` 与 `/submit` 增加学生所属权强校验，拦截跨账号冒名刷分改分。
- **VULN-04 插件安装命令注入防护与默认凭证预警**：
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中为依赖安装统一添加 `--ignore-scripts` 阻断 postinstall 钩子执行，对 `manifest.deploy.script` 增加 `ALLOW_UNSAFE_PLUGIN_SCRIPTS=true` 环境变量门禁。
  - 在 [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 针对默认内置管理员与教师账号增加显著安全日志预警。
- **VULN-05 插件 Worker 资源配额限制**：
  - 在 [`packages/core/worker-runtime/worker-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/worker-manager.ts) 实例化 Worker 时配置 `resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }`，有效抵御插件内存耗尽型拒绝服务（DoS）。
- **VULN-08 Socket.IO 握手鉴权与 CORS 严格白名单化**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 为 Socket.IO 引入 `io.use()` 握手鉴权中间件，校验 `edu_os_token` Cookie/Auth 并注入 Session；严格限制 CORS Origin 回调，生产环境下禁止未配置时退化为 `origin: '*'`。
  - 在 [`server/presence.ts`](file:///home/wuxf/Develop/openlearnv2/server/presence.ts) 增加角色与身份强校验，阻断学生客户端伪造他人 `studentId` 发起进入/离开课堂事件，并对 `teacher-broadcast-segment` 与 `teacher-ping-student` 严格限定仅教师或管理员可用。
- **VULN-09 插件 ZIP 条目与脚本 Zip Slip 绝对防御**：
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中对 `storage/` 静态条目解压与 `manifest.deploy.script` 路径进行全面规范化，严格拒绝任何包含 `..` 的路径，并强校验 `path.resolve` 结果必须以插件安装目录为绝对前缀，阻断路径穿越写盘。
- **VULN-10 Helmet Content-Security-Policy (CSP) 策略深度收紧**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 的 Helmet CSP 中移除 `scriptSrc` 通配 `https:` 与 `data:`，仅允许 `'self'`, `'unsafe-inline'`, `'unsafe-eval'`, `blob:`；移除 `frameSrc` 全局通配 `http:` 与 `https:`，仅允许 `'self'`, `blob:`, `data:` 及环境变量可配置的合法课件域；精确化 `styleSrc` 与 `fontSrc` 仅允许受信 Google Fonts 域名。
- **VULN-11 数据库 RPC 核心安全表与底层高危 SQL 指令拦截**：
  - 在 [`packages/core/worker-runtime/service-host.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/service-host.ts) 中增加 `FORBIDDEN_OPERATIONS` 正则，全面封杀 `ATTACH DATABASE`、`DETACH DATABASE`、`PRAGMA`、`VACUUM`、`CREATE/DROP TRIGGER` 与 `CREATE/DROP VIEW`；
  - 扩展核心安全保护表白名单与 DDL 作用域校验，杜绝插件通过裸 SQL 绕过业务层或破坏数据库内部结构。
- **VULN-12 生产环境依赖漏洞治理与子依赖版本覆盖**：
  - 将仅用于开发和打包的 `xlsx` 迁移至 `devDependencies`，将 `vite` 迁移至 `devDependencies`；
  - 在 `pnpm-workspace.yaml` 中配置安全版本覆盖（`overrides`），将 `ws` (>=8.21.0), `socket.io-parser` (>=4.2.7), `nanoid` (>=3.3.18), `postcss` (>=8.5.23), `ip-address` (>=10.3.1), `dompurify` (>=3.4.13), `qs` (>=6.16.0), `body-parser` (>=1.20.6), `protobufjs` (>=7.6.5) 全面升级到安全版本。
  - `pnpm audit --prod` 达成 **0 vulnerabilities (无已知漏洞)**。
- **VULN-13 课件 LMS Bridge 消息响应定向化与通配广播收紧**：
  - 在 [`src/services/lms-bridge.ts`](file:///home/wuxf/Develop/openlearnv2/src/services/lms-bridge.ts) 回复 `LMS_PROGRESS_RESPONSE` 时严格校验接收方窗口属于 DOM 中受管辖的有效 iframe；针对具有非 null 真实域名的 iframe 定向回传 `event.origin`，并在 `sendCommandToCourseware` 中根据 iframe URL 解析真实 Origin，消除向非受信窗口通配泄露数据的隐患。
- **VULN-14 前端插件静态解析与静态路由沙箱隔离**：
  - 彻底重构 [`src/utils/pluginParsers.ts`](file:///home/wuxf/Develop/openlearnv2/src/utils/pluginParsers.ts)，完全删除主线程中的 `new Function` 动态求值，改用纯静态正则与作用域提取，杜绝浏览器主线程解析恶意插件时遭受同源脚本执行攻击；
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 的插件静态资源路由挂载中间件，强制注入 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-downloads` 与 `X-Content-Type-Options: nosniff` 响应头，确保插件静态前端页面降级至沙箱隔离环境，无法越权窃取宿主 Cookie 及本地存储。
- **自动化安全回归验证**：
  - 扩充 [`server/__tests__/security_hardening.test.ts`](file:///home/wuxf/Develop/openlearnv2/server/__tests__/security_hardening.test.ts) 与 [`src/utils/__tests__/pluginParsers.test.ts`](file:///home/wuxf/Develop/openlearnv2/src/utils/__tests__/pluginParsers.test.ts)，全量 176 个测试套件、993 个用例持续保持 100% 绿灯通过。

## [0.3.0] - 2026-09-06

### Features

- **现代教育 OS 主题系统 (Theming System Engine - Phase 3)**：
  - **主题可视化设计器 (`ThemeDesignerModal.tsx`)**：开发沉浸式调色板设计器，内置 4 套创意预设（高雅墨蓝、暮樱柔粉、复古秋叶、深海极客），提供核心主色/背景/卡片/边框/文字等色值微调、实时拟真沙箱视口微缩预览、配置 JSON 导入/导出与复制，支持本地自定义主题管理与一键激活。
  - **微前端沙箱与互动课件主题同步 (MFE & Courseware Theme Bridge)**：升级 [`src/services/lms-bridge.ts`](file:///home/wuxf/Develop/openlearnv2/src/services/lms-bridge.ts) 与 [`server/utils/bridge-sdk.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/bridge-sdk.ts)，宿主向所有课件沙箱 `iframe` 跨域广播 `theme:changed` 与 `LMS_THEME_CHANGED` 消息；沙箱内部自动响应式写入 `data-theme` 属性与 CSS 变量，并为第三方课件提供 `window.LMS.getTheme()` 查询 API。
  - **课件加载主动握手**：在 [`InteractiveCoursewareViewer.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/courseware/InteractiveCoursewareViewer.tsx) 与 [`HtmlAppletFrame.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/HtmlAppletFrame.tsx) 的 iframe `onLoad` 时主动下发当前主题，保障各类多文件互动课件与动态 HTML 小应用首屏样式无缝匹配。
- **现代教育 OS 主题系统 (Theming System Engine - Phase 2)**：
  - **白板渲染引擎主题联动**：升级 [`theme-manager.ts`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/rendering-engine/theme/theme-manager.ts)，原生支持 `eyecareTokens` 与 `chalkboardTokens`，实现交互白板底色（黑板墨绿 `#0e1713`）、极坐标微网格点（淡绿微光 `#2d5242`）与笔刷/文字对比度智能自适应反转（Dark/Chalkboard 模式下黑色笔迹自动转为粉笔白 `#f8fafc`），并支持外部主题订阅与动态注册。
  - **白板悬浮控件 Token 化**：白板悬浮工具栏 [`WhiteboardToolbar.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/WhiteboardToolbar.tsx) 与底部分页导航胶囊 [`WhiteboardPageBar.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/WhiteboardPageBar.tsx) 全面语义化，支持选取、画笔、几何图形、荧光笔色盘与大纲抽屉无缝随全局换肤。
  - **核心教学主视图容器适配**：课堂控制中心 [`LiveClassroomView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/components/LiveClassroomView.tsx)、备课工作台 [`LessonEditorView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/LessonEditorView.tsx)（及画板组件库 [`LessonPalette.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/lesson-editor/LessonPalette.tsx)）与学生端工作台 [`StudentView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/student/StudentView.tsx) 全面接入设计 Token。
  - **单测护航**：新增 [`theme-manager.test.ts`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/__tests__/theme-manager.test.ts)，全量 174 个测试套件、976 个用例持续保持 100% 绿灯。
- **现代教育 OS 主题系统 (Theming System Engine - Phase 1)**：
  - 基于 Tailwind CSS v4 原生变量机制构建设计 Token 层，在 [`src/index.css`](file:///home/wuxf/Develop/openlearnv2/src/index.css) 中规范 `--bg-app`、`--bg-surface`、`--border-theme`、`--text-main`、`--color-primary` 等语义化设计变量与实用类。
  - 内置 4 套教育场景专属预设：**浅色日间 (Light)**、**暗夜极客 (Dark)**、**教学护眼防眩光 (EyeCare)**、**经典墨绿黑板 (Chalkboard)**。
  - 新增中心化主题状态管理器 [`src/store/themeStore.ts`](file:///home/wuxf/Develop/openlearnv2/src/store/themeStore.ts)，支持 DOM 响应式同步、本地偏好记忆（`localStorage`）以及动态注册自定义主题样式；
  - 研发顶栏主题切换器组件 [`ThemeSelector.tsx`](file:///home/wuxf/Develop/openlearnv2/src/components/ThemeSelector.tsx)，完成应用主外壳与导航侧边栏的语义化换肤适配。
- **数据库版本化迁移体系 (Phase 20 - DB-MIG-01)**：
  - 新增 [`server/utils/migrate.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/migrate.ts) 迁移加载与执行引擎，支持从 `migrations/` 自动读取 `.sql` 文件，按文件名自然排序并解析 `-- UP` 与 `-- DOWN` 分隔符。
  - 服务启动时自动执行迁移并记录状态至 `_migrations` 表（包含 `applied_at` 与 `checksum`），具备天然幂等性与 duplicate column 容错保护，并支持单项迁移回滚。
  - 落地首批标准迁移：[`000_initial_schema.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/000_initial_schema.sql)（30+ 核心数据表与索引）、[`001_add_execution_mode.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/001_add_execution_mode.sql)、[`002_add_client_session_expiry.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/002_add_client_session_expiry.sql)、[`003_classroom_runtime.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/003_classroom_runtime.sql)。

### Fixes

- **Worker 插件自建表 DDL 安全白名单修复**：
  - [`ServiceHost`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/service-host.ts) 构造函数与方法支持同时校验 `dbPluginId`（DB UUID）与 `pluginId`（manifest.id）双重合法命名空间前缀，转义特殊字符为下划线，彻底修复 `@ext/class-manager` 等插件在 worker 内部建表时触发 `not permitted to perform DDL` 导致的 Watchdog 重启崩溃循环。
- **自定义 AI 提供商首屏列表加载修复**：
  - 修复 [`usePluginManagement`](file:///home/wuxf/Develop/openlearnv2/src/hooks/usePluginManagement.ts) 与 [`AdminPanel`](file:///home/wuxf/Develop/openlearnv2/src/components/AdminPanel.tsx) 初始化挂载时未主动调用 `fetchAIProviders()` 的问题，确保系统初次运行时默认自带的 DeepSeek 与 MiniMax 模型即时呈现，无需在添加新 provider 之后才被动刷新。
- **React 19 Rules of Hooks 违规清零**：
  - 修复 [`PluginCardRenderer.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/PluginCardRenderer.tsx)（`useRef`/`useEffect` 条件调用）与 [`ActivityWorkspaceWidget.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/activity-ecosystem/ActivityWorkspaceWidget.tsx)（`useMemo` 条件调用）中的 3 处致命 Hook 违规，消除了组件卸载/挂载时 Fiber 链条错乱的运行时风险。

### Refactor / Performance

- **测试套件多 Worker 数据库隔离与 Vitest 并发提速**：
  - [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 在 `process.env.VITEST` 下按 Worker Pool ID / PID 分配隔离的临时 SQLite 实例，彻底消除跨测试文件数据库死锁竞争。
  - [`vitest.config.ts`](file:///home/wuxf/Develop/openlearnv2/vitest.config.ts) 开启 `fileParallelism: true`，全量 172 个测试文件、965 个测试用例运行时间从 **204 秒极限压缩至 37.45 秒**（提速 **5.4 倍**）。
- **ESLint 工具链基线修复与清理**：
  - 修正 [`eslint.config.js`](file:///home/wuxf/Develop/openlearnv2/eslint.config.js) 全局 ignores，排除 `.venv`、构建产物与 Sphinx 文档静态脚本，调整非关键警告级别，`pnpm lint:eslint` 达成 0 Error 绿灯基线。

### Features (v0.2.9)

- **html-applet 组件增强**：
  - 抽取统一 `<HtmlAppletFrame>` 组件（画布内嵌/全屏/兜底三处复用），按优先级解析四种内容源：`coursewareUuid` → `resourceId` → 插件自定义内容源 → `code`（`srcDoc`）。
  - `HtmlAppletPayload` 补齐 `resourceId` / `sourceType` / `sourceId`，并修复 `buildElementData` 字段丢失与 `title` 渲染。
  - 新增 `src/types/lms-bridge.ts`，声明 `window.LMS` / `__LMS_STUDENT__` / `__LMS_COURSEWARE__` 类型契约。
- **插件内容源扩展**：新增 `coursewareSourceRegistry` 与 `ctx.ui.registerCoursewareSource` / `unregisterCoursewareSource`（所有权感知 + 停用自动清理），SDK 导出 `CoursewareSourceLoader` 类型。
- **LMS Bridge 双向通信**：`window.LMS` 新增 `on` / `off` / `setConfig` / `getProgress`；宿主新增 `sendCommandToCourseware(iframe, event, payload)`；后端新增 `GET /api/courseware/attempts/:attemptId/progress`。
- **课件事件化**：课件 `submitted` / `progress_saved` / `event_logged` / `config_reported` 发布到前端 EventBus（`courseware.` 前缀经 Socket 转发到后端 EventBus），后端 log 路由发布 `courseware.event_logged`。
- **备课画板组件配置增强**：`EditFieldKind` 新增 `select`（静态 `options` + 动态 `loadOptions`），`PaletteCardEditModal` 支持下拉选择；html-applet 的 `coursewareUuid` / `resourceId` 可在备课画板直接选择。

### Security (v0.2.9)

- html-applet iframe 新增 `credentialless` 与 `referrerPolicy="no-referrer"`；`injectLmsSdk` 防御性移除 `<base>` 与 `<meta http-equiv=refresh>` 导航逃逸向量。

### Fixes (v0.2.9)

- Worker 插件自建表前缀改用 `manifestId`（与命令命名空间及 ServiceHost 的 DDL 守卫一致），避免 Worker 插件在自己命名空间建表被误判为越权 DDL。

### Refactor / Performance (v0.2.9)

- html-applet iframe 懒挂载（IntersectionObserver，200px 预加载边距）+ 同时挂载上限 4 个（`courseware-frame-limiter.ts`）。

### Docs (v0.2.9)

- `docs/reference/plugin-ui-extension-slots.md` 新增 §7 课件内容源、§8 LMS Bridge 双向通信；`docs/architecture/whiteboard-runtime.md` 同步 html-applet 渲染管线说明。

## [0.2.8] - 2026-09-04

### Features

- **第三方插件白板扩展能力（v3.5）**：
  - `ctx.ui.registerFullscreenRenderer(type, renderer)` / `ctx.ui.registerPropertyEditor(type, editor)` 允许插件为自定义白板元素类型注册全屏渲染器与属性编辑器；`fullscreenRendererRegistry` / `propertyEditorRegistry` 增加所有权感知的 `unregister` / `unregisterPlugin`，插件停用/卸载/激活失败时宿主自动清理其注册。
  - SDK `@openlearn/plugin-sdk` 新增 `FullscreenRendererProps` / `FullscreenRenderer` / `PropertyEditorProps` / `PropertyEditorComponent` 四个 type-only 导出。
- **扩展点组件统一注入课堂上下文**：
  - `ExtensionPointRenderer` 向所有扩展点组件 props 注入 `{ lessonId, classId }`（当前课程/班级，源 `appStore.selectedLesson` / `liveClassSelectedClassId`），`teacher.tab` 面板形态同步注入。
  - `FrontendPluginContext` 新增 `ctx.context.get()` / `ctx.context.subscribe()` 只读快照与订阅，供非渲染场景读取当前课程/班级。

### Security

- **Worker 插件数据库安全屏障**：`ServiceHost` 拦截 IDatabase RPC，禁止 Worker 插件访问核心安全表（`users` / `client_sessions` / `plugins` / `ai_providers` 等），并将 DDL 操作限制在插件自身命名空间（`plugin_<id>_` 前缀）内。

### Docs

- 更新 [`docs/reference/plugin-ui-extension-slots.md`](docs/reference/plugin-ui-extension-slots.md)：明确各槽位注入的 `slotProps` 字段契约与 `ctx.context` 用法，纠正 `@/` 宿主内部导入对第三方插件不可达的误区，并将 `fullscreenRendererRegistry` / `propertyEditorRegistry` 用法改为 `ctx.ui.register*`。
- 新增 [`docs/release-notes/v0.2.8.md`](docs/release-notes/v0.2.8.md) 发布说明。

## [0.2.7] - 2026-08-31

### Security

- **严格无同源沙箱隔离（Strict Sandboxing）**：
  - 彻底移除 `src/features/whiteboard/InteractiveWhiteboard.tsx`、`src/features/courseware/InteractiveCoursewareViewer.tsx` 与 `src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx` 中所有 iframe 的 `allow-same-origin` 声明。
  - 统一确立 `sandbox="allow-scripts allow-forms allow-downloads"` 严格沙箱隔离，完全依托 LMS Bridge Proxy 代理跨域消息，对齐平台架构最高安全标准。

### Refactor / Performance

- **数据库外键强制开启（Database Integrity）**：
  - 在 `packages/core/db/index.ts` 初始化连接配置中显式启用 `db.pragma('foreign_keys = ON');`，在 SQLite 引擎层强制激活外键级联检查，杜绝孤儿数据。

### Tooling

- **ESLint TypeScript 规则优化**：
  - 在 `eslint.config.js` 的 `**/*.{ts,tsx}` 配置段加入 `'no-undef': 'off'`，避免 ESLint 重复校验 TypeScript 编译器类型定义导致的假报错。

### Docs

- 新增 [`docs/release-notes/v0.2.7.md`](docs/release-notes/v0.2.7.md) 发布说明，更新 Sphinx toctree 并完成 HTML 文档生成。
- 全量自动化测试回归 169 / 169 套件（941 个用例）100% 通过。

## [0.2.6] - 2026-08-30

### Features

- **插件锚点扩展槽（Anchor Slots）—— 支持在宿主原生按钮前后插入插件按钮**：
  - 新增 `anchor:*` 开放槽位：宿主在原生按钮/元素前后各渲染一次 `<ExtensionPointRenderer slot="anchor:..." placement="before|after" />`，插件通过 `placement` 声明插入侧。
  - `ExtensionPointConfig` 新增 `placement?: 'before' | 'after'`（缺省 `'after'`）；`ExtensionPointRenderer` 新增同名 prop 用于按侧过滤渲染。
  - 前端槽位类型放宽为 `AnyExtensionSlot`（`ExtensionSlot | AnchorSlot | string`），`FrontendPluginContext.ui.registerExtensionPoint` 支持任意锚点槽位。
  - manifest `contributes` 通过 `.passthrough()` 允许任意 `anchor:*` 键；后端 `ContributionRegistry` 新增 `AnchorToolConfig` 类型并纳入 `ContributionConfig` 联合。
  - SDK（`@openlearn/plugin-sdk`）导出 `AnchorToolConfig`；`openlearn.d.ts` 同步补充类型。
  - 白板工具栏已埋七个锚点：`presentation`、`code-sandbox`、`math-graph`、`courseware`、`rollcall`、`ai-tutor`、`grid`（槽位前缀 `anchor:whiteboard-toolbar:`）。

### Security

- **权限边界与最小特权原则加固**：
  - 在 `packages/core/capability-system/index.ts` 中移除 `'user-frontend': ['*:*:*']` 全局通配符特权，改为按用户角色（`:teacher` / `:student`）授予最小能力，未登录用户回退为 `anonymous: []` 零特权。
  - `server/middleware/auth.ts` 中 `getActorId(req)` 未登录回退修正为 `'anonymous'`。
  - 加固 `packages/core/kernel/index.ts` 中的 `isAdmin` 校验，消除子串模糊匹配隐患。
- **Worker 沙箱原生模块安全黑名单**：
  - 在 `packages/core/worker-runtime/worker-manager.ts` 的 `ctx.require` 中拦截 `child_process`, `fs`, `net`, `http`, `os`, `vm`, `cluster`, `worker_threads` 等危险模块，彻底防范插件逃逸沙箱执行主机指令。
- **LMS Bridge 跨窗口消息源校验**：
  - `src/services/lms-bridge.ts` 中校验 `event.source` 是否属于当前 DOM 中的合法 `iframe.contentWindow`，阻断跨窗口消息仿冒。
- **AI Provider 连通性测试 SSRF 拦截**：
  - `server/routes/plugins.ts` 中新增 `isSafeExternalUrl` 校验，封禁指向本地回环及内网私有网段的恶意探测。
- **操作系统指令通道鉴权**：
  - `server/routes/os.ts` 中对 `POST /api/commands` 挂载 `requireAuth()` 中间件。

### Fixes

- **TypeScript 全量类型编译错误清零 (72 Errors -> 0)**：
  - **前端主壳 TDZ 修复**：重构 `src/App.tsx` 中的 Hook 拓扑声明顺序，引入 `chatLogUpdaterRef` 解决 `useCourseWizard`、`usePluginManagement`、`useAgentChat` 的循环与延迟依赖，彻底清除 8 处变量在使用前引用错误。
  - **组件与服务契约对齐**：
    - `src/features/teacher/Dashboard.tsx`：适配 `scoreOverrides` 状态更新器与 `QuickActionsMenu` 异步回调。
    - `src/features/teacher/PluginView.tsx`：引入严格 `Language` 与 Tab 联合类型。
    - `src/features/teacher/classes/ClassStudentsPanel.tsx`：支持函数式更新器 `(prev => ...)`。
    - `src/hooks/useGradeExport.ts`：修复 `exportAllClassesCombinedCSV` 参数传递结构。
    - `src/components/PluginSettingsModal.tsx`：严格声明 `ConfigProperty` 类型断言。
    - `src/features/ai-classroom-context/` & `classroom-runtime/`：修复多态值类型、只读数组解构以及 `EventBus.publish` 的 `metadata: {}` 字段。
  - **核心包与服务端契约修复**：
    - `packages/core/esm-loader/manifest-schema.ts`：适配 Zod v4 双参 `z.record(z.string(), z.unknown())`。
    - `packages/plugins/__tests__/*.test.ts`：将抽象类 `new EsmLoader()` 替换为实体类 `new NodeEsmLoader()`。
    - `server/routes/grading.ts`：将 `kernelContainer.registry` 修复为 `kernelContainer.serviceRegistry`。
    - `packages/core/configuration/PlatformConfiguration.ts`：修复 `ConfigurationContext` 模块导入并放开动态扩展属性的可变性。
- **前端扩展点排序生效**：
  - `plugin-host-store.getExtensions` 按 `position` 升序（缺省 `100`）稳定排序。

### Refactor / Performance

- **数据库 9 处核心高频业务索引**：
  - 在 `packages/core/db/index.ts` 中新增 9 个针对性复合与二级索引（`idx_whiteboard_lesson`、`idx_class_students_class`、`idx_class_students_student`、`idx_schedules_class_date`、`idx_courseware_attempt_cw_st`、`idx_submission_result_attempt`、`idx_events_type_time`、`idx_assignments_class`、`idx_attendance_schedule`），消除面授课堂、排课及成绩导出时的全表扫描。

### Docs

- 新增锚点目录 [`docs/plugin/anchor-slots.md`](docs/plugin/anchor-slots.md) 并更新相关扩展点规范。
- 新增 [`docs/release-notes/v0.2.6.md`](docs/release-notes/v0.2.6.md) 发布说明。
- 全量自动化测试回归 169 / 169 套件（941 个用例）全绿通过。

### Security

- **从仓库跟踪中移除 `scratch/` 目录（17 个文件）**：该目录包含本地开发脚本、playwright 验证脚本、49KB dashboard 截图等。最严重的是 `scratch/test_logs_api.ts` —— 一个会在 SQLite 中插入伪造 admin session token 的脚本。如果随 main 分支泄露，会成为种子式攻击向量。现已 `.gitignore` 排除并 `git rm --cached` 取消跟踪。
- **`server/utils/crypto.ts` 禁止原地覆盖现有 ENCRYPTION_KEY**：旧逻辑检测到 .env 中存在 `ENCRYPTION_KEY=` 空值时会生成新密钥**原地替换**——这会让已用旧密钥加密的全部 AI Provider Key 不可解密（数据级不可回滚故障）。现改为：检测到现有 ENCRYPTION_KEY 行（含空值）时绝不动它，转用 ephemeral in-memory key + 警告日志，强制运维显式备份、轮换密钥。

### Fixes

- **TypeScript 编译错误修复（12 个，全部在未提交修改中）**：
  - `src/components/plugin-center/types.ts`：将 `export type { Language } from '../../i18n'`（re-export 不创建本地绑定）改为 `import type + export type`，修复 `TS2304 Cannot find name 'Language'`。
  - `packages/core/capability-runtime/CapabilityProvider.ts`：`CapabilityContext` 从 `./types.js` 导入但 types 未 re-export；改为从 `./CapabilityContext.js` 直接导入。
  - `packages/core/esm-loader/manifest-schema.ts`：zod v4 要求 `z.record(keySchema, valueSchema)`，将两处 `z.record(z.unknown())` 改为 `z.record(z.string(), z.unknown())`。
  - `packages/core/plugin-host/hot-reload.ts`：`HotReloadCallback` 要求 `Promise<void>` 返回，但 callback 返回 void；callback 改为 async。
  - `packages/core/configuration/ConfigurationError.ts` + `ConfigurationRegistry.ts`：`ConfigurationErrorCode` 联合类型添加 `'NOT_FOUND'`，匹配 `ConfigurationRegistry.get()` 的实际语义。
  - `packages/core/di/container/PlatformContainer.ts`：`ServiceDescriptor` 所有字段 readonly，不能事后赋值；改用三元表达式在对象字面量中一次性构造。
  - **`packages/core/bootstrap/` 三个文件**：消除 `IBootstrapStage` 在 `types/index.ts` 和 `pipeline/bootstrap-stage.ts` 的双重定义歧义（TS2308 + TS2416）。统一为单一权威定义：types 中的版本包含完整字段（`id`、`timeoutMs`、`rollback`），`bootstrap-stage.ts` 改为 `export type` re-export，`pipeline/index.ts` 桶导出移除重复项。
- **回归测试失败修复（2 个）**：
  - `src/components/__tests__/AppShell.test.tsx`：`React.lazy` 加载 `StudentView` 的异步链超过 `findByText` 默认 1s 超时（Suspense fallback 一直显示）。`findByText` 显式传 `timeout: 10_000` 并加注释说明 jsdom lazy import 的特性。
  - `packages/core/worker-runtime/__tests__/service-host.test.ts`：测试期望的错误消息 `'Access to table "users" is restricted'` 与实际产出的 `'Worker plugin "ext-test-db" is forbidden from accessing core security table "users"'` 不一致；同步测试断言到当前实现（代码演进后消息更详细）。
  - `packages/core/__tests__/{bootstrap-pipeline,platform-builder,plugin-platform-integration}.test.ts`：依赖 bootstrap 类型重构 + 为 `PluginCapability` 构造传入真实依赖（`AIRuntimeKernel` + `CapabilityLogger`）。
  - **全量回归 951 passed / 1 skipped**（170/170 测试文件），`pnpm lint` 通过。

### Refactor / Performance

- **`server.ts` health 端点版本号硬编码清理**：原代码返回 `version: '4.0.0'`，与 `package.json` 0.2.5 严重漂移。改为启动时从 `package.json` 读取 `version` 字段，**单一版本来源**，避免版本发布时手工同步遗漏。
- **`vite.config.ts` 移除 `framer-motion` 死代码 chunk 规则**：项目已迁移到 `motion`（`framer-motion` 仅作为其间接依赖存在）；删除针对 `/framer-motion/` 的 chunk 分桶规则，保留对 `/motion-dom/` 的归类（`vendor-motion`）。

## [0.2.5] - 2026-08-29

### Refactor / Performance

- **Vite Fine-grained Bundle Chunking & 90.1% Entry Bundle Reduction**:
  - Entry bundle `index.js` shrank from **2,181.47 kB (2.18 MB)** down to **216.43 kB (gzip: 66.69 kB)** — a **90.1% reduction** in initial download size.
  - Implemented modular `manualChunks` in `vite.config.ts` separating third-party dependencies into categorized vendor chunks: `vendor-react`, `vendor-charts` (Recharts & D3), `vendor-pdf` (jsPDF & html2canvas), `vendor-konva`, `vendor-reveal`, `vendor-pptx`, `vendor-icons` (Lucide), `vendor-motion` (Framer Motion), `vendor-content` (Marked & DOMPurify), and `vendor-utils`.
- **System-wide Asynchronous Component Lazy Loading (`React.lazy` & `Suspense`)**:
  - **`AppModals`**: Converted all 13+ modal dialogs (`CourseWizardModal`, `QuizGeneratorModal`, `ImportLessonsModal`, `BatchPickerModal`, `ExportWeightModal`, `CloudDriveModal`, `SystemResourceLibraryModal`, `StudentPreviewModal`, `ProcessLogsModal`, `HelpTour`, etc.) to asynchronous on-demand loading.
  - **`AppShell`**: Decoupled `TeacherView` and `StudentView` via `React.lazy`, eliminating cross-role code loading for student sessions.
  - **`TeacherView`**: Implemented lazy loading for non-dashboard sub-views (`ClassesView`, `TimetableView`, `ComputerLabView`, `AdminDirectoryView`, `HelpView`, `PluginView`, `LiveClassroomView`).
  - **`StudentView`**: Implemented lazy loading for `StudentLessonView` and `StudentAssignmentView`.

### Fixes

- **Asynchronous Unit Test Compatibility**:
  - Updated `TeacherView`, `StudentView`, and `AppShell` unit tests to support async DOM querying (`await screen.findByText`) with `Suspense` hydration.
  - Added jsDOM `ResizeObserver` mock and mock socket instance in test harnesses.

## [0.2.4] - 2026-08-29

### Refactor / Performance

- **Frontend Architecture & `App.tsx` Decoupling**:
  - Slimmed `src/App.tsx` down from **3,974 lines** to **1,722 lines** (a total reduction of **-2,252 lines, -56.7%**), transforming the monolithic root into a clean routing and context coordinator.
  - **`useLabAndSchedule`**: Encapsulated computer lab management, classroom seating layouts, timetable scheduling, and rollcall attendance tracking.
  - **`useGradeExport`**: Encapsulated grade weighting calculations, real-time CSV preview, single/multi-class CSV grade exports, whole-school PDF generation, and 30-day academic risk warning algorithms.
  - **`useLessonTimeline`**: Encapsulated lesson segment timeline state, drag-and-drop ordering, remote persistence, and SQLite auto-save state machine.
  - **`useStudentNotifications`**: Encapsulated student assignment notices, grading feedback alerts, random rollcall notifications, and read receipt tracking.
  - **`useLessonFiltering`**: Encapsulated lesson searching, sorting, and multi-criteria filters.
  - **`usePluginManagement`**: Encapsulated plugin installations, raw binary ZIP uploads, approval workflows, and AI Provider CRUD / connectivity testing.
  - **`useCourseWizard`**: Encapsulated multi-step course creation wizard workflow and timeline generation.
  - **`useQuizGenerator`**: Encapsulated AI MCQ objective quiz generation and answer tracking.
  - **`useClassBatchOperations`**: Encapsulated batch class/student selection, batch deletion, batch scheduling, batch password resets, and batch transfers.
  - **`bulkImportService`**: Separated CSV/JSON import parsers and template downloads into pure service modules.
  - **`AppModals` Adapter Pattern**: Refactored modal props into structured hook bundle adapters, eliminating dozens of top-level prop drilling lines.

### Features

- **Enhanced Hook & Service Layer**:
  - Pure modular services for grade reporting (`gradeReportService.ts`) and bulk imports (`bulkImportService.ts`).
  - Unified adapter support in `AppModals` allowing direct composition of domain hook bundles.

### Fixes

- **Redundant State & Shadowing Fixes**:
  - Cleaned up shadowed state declarations and duplicate fetcher calls across `App.tsx`.
  - Fixed PDF report generation state conflict between single-class and multi-class tracking.

### Docs

- Generated comprehensive architecture audit reports and stage-by-stage refactoring blueprints (`p0~p4` reports in artifact history).

## [0.2.3] - 2026-07-30

### Features

- **Course Management Enhancement (`CourseManagement.tsx`)**:
  - Add **icon toolbar** on each course card: View/Edit, Copy, Delete, replacing the single "View Interactive" button.
  - Add **filter chips**: filter by enrollment (>0 students), content (non-empty), and creation date (this month).
  - Add **course copy** with optimistic UI: click Copy → immediate placeholder card with loading state → API clone completes → list refreshes.
  - Add **course deletion** with stats confirmation dialog showing affected whiteboard elements, schedules, enrollments, and assignments before irreversibly deleting.
  - Course title is now clickable to navigate to the editor.
- **Backend Course APIs (`server/routes/lessons.ts`)**:
  - `DELETE /api/lessons/:id` — hard-delete a lesson with cascade deletion of whiteboard elements, student progress, schedules, and assignments.
  - `GET /api/lessons/:id/stats` — return counts of whiteboard elements, schedules, enrollments, and assignments for the delete confirmation dialog.
  - `POST /api/lessons/:id/clone` — full clone (title prefixed "副本-", content, timeline, whiteboard elements; enrollment reset to 0).
- **Fullscreen Renderer Registry (`src/features/whiteboard/fullscreen/`)**:
  - New `FullscreenRendererRegistry` with `register(type, component)` / `get(type)` API for third-party plugins to provide custom fullscreen views.
  - Smart default renderer that auto-detects data fields (`code`, `markdown`, `question`, `text`, `url`, `src`, `coursewareUuid`, `equation`) and renders appropriate HTML without hardcoded type switches.
  - `FullscreenOverlay` component using `createPortal` to render at `document.body` with `fixed` positioning covering the entire browser viewport (not just the whiteboard container).
  - Built-in type registrations: `quiz`, `timer`, `assignment`, `rollcall` (preserved from legacy), plus `html-applet` with iframe + Bridge SDK.
  - ESC key and close button always available in overlay.
- **Property Editor Registry (`src/features/whiteboard/properties/`)**:
  - New `PropertyEditorRegistry` with `register(type, component)` / `get(type)` API enabling third-party plugins to inject custom property editors into the whiteboard's right-side properties panel.
  - Plugin editors receive `{ elementId, elementType, data, updateData, lessonId, onClose }` (data-driven `useState`-style API).
  - Generic properties (x/y/width/height) and delete button remain platform-managed.
  - Plugins import via `@/features/whiteboard/properties`.

### Fixes

- **Course navigation always redirects to the same course**: Fix stale closure in `fetchLessons()` polling interval where `selectedLesson` was read from the React closure instead of the Zustand store, causing the 2-second poll to reset `selectedLesson` to `data[0].id`. Changed to `appStore.getState().selectedLesson`.
- **Drag-and-drop from palette to whiteboard fails when existing components are present**: Add `pointer-events: none` to the Konva Stage container during `isDragOverBoard` state, allowing native HTML5 `drop` events to pass through to the outer container div.

### Refactor / Performance

- **Fullscreen system refactored from hardcoded type switch** (90+ lines of if/else) to `FullscreenRendererRegistry` lookup with extensible registration.
- **View/Edit icon** changed from `Eye` to `Edit3` for better "enter editor" affordance.
- **Delete lesson route** now uses direct REST `DELETE /api/lessons/:id` instead of the command bus for simplicity.

### Docs

- Update `docs/reference/plugin-ui-extension-slots.md` with `whiteboard.fullscreen` and `whiteboard.property-editor` registry APIs.
- Expand `docs/whiteboard/whiteboard-runtime.md` with fullscreen renderer architecture and property editor extensibility documentation.

## [0.2.1] - 2026-07-29

### Features

- **Whiteboard Interactive Courseware Entry & Plugin Palette Integration**:
  - Add direct **Interactive Web Courseware / HTML Applet (Globe)** button immediately following **Math Function (Math Graph)** in `WhiteboardToolbar.tsx`.
  - Reorder `html-applet` in `paletteConfig.ts` to appear right after `math-graph` under the `present` group as "交互网页课件 (Interactive Courseware)".
  - Dynamically expose third-party plugins registering `classroom.tool` extension points inside `LessonPalette.tsx`, enabling teachers to click and insert third-party plugin components directly onto the whiteboard canvas.
- **Plugin Setup Wizard Enhancements (`PluginInstallWizard.tsx`)**:
  - Add a **⚡ Express Install / Update (`一键极速安装 / 一键极速更新`)** button in the wizard footer to automatically approve all requested permissions, accept downgrade/hot-update warnings, and complete installation in one click.
  - Apply risk-severity container and text color coding (`rose` for high risk, `amber` for medium risk, `emerald` for low risk) across requested capability rows in the permission audit step.

### Fixes

- **Fix Duplicate Toast Notifications (`appStore.ts`)**: Resolve duplicate toast card popups (e.g., plugin installation, course deployment) in `ToastContainer` by removing redundant `set(...)` array mutations in `appStore.ts`'s `addToast`/`removeToast` and delegating to `uiStore.subscribe` state synchronization. Locked by unit test suite `src/store/__tests__/appStoreToast.test.ts`.
- **Universal `postMessage` TargetOrigin `'null'` Fault Tolerance**: Implement three-layer protection (`server/utils/bridge-sdk.ts`, `src/features/whiteboard/utils/bridgeUtils.ts`, and `src/App.tsx`) that catches and normalizes invalid `targetOrigin: 'null'` calls from sandboxed third-party iframe applets into `'*'` with `[LMS Bridge Notice]` warnings, utilizing the `Object.defineProperty + Proxy` technique for shadowing `window.parent`/`window.top` on cross-origin WindowProxy. Covered by unit tests in `whiteboard-components.test.tsx`.
- **Helmet CSP `frame-src` Configuration (`server.ts`)**: Configure Content Security Policy `frame-src` directive to allow `'self'`, `blob:`, `data:`, `http://localhost`, `http://127.0.0.1`, `http:`, and `https:` origins for iframe courseware embedding.

### Docs

- **Plugin Developer Documentation (`/docs`)**: Update `docs/reference/plugin-ui-extension-slots.md` and `docs/tutorials/plugin-development-tutorial.md` detailing `classroom.tool` slot rendering targets across both `WhiteboardToolbar` and `LessonPalette`.

- **Decompose Remaining "God Components" (`TimetableManager.tsx`, `HelpView.tsx`, `PluginCenter.tsx`)**:
  - `TimetableManager.tsx`: Extracted shared types into `src/components/timetable/types.ts` and date helpers into `src/components/timetable/utils/timetableUtils.ts`. Split into 4 domain sub-views in `src/components/timetable/sub-views/`: `TimetableCalendarView.tsx` (week/cycle/list grid), `TimetableAdjustView.tsx` (batch holiday adjustment form), `TimetableImportExportView.tsx` (CSV/JSON export & importer), and `TimetableOcrView.tsx` (AI vision OCR recognition & review table). Reduced line count from **2,629 down to 1,670 lines** (-959 lines). Verified with unit tests in `src/components/__tests__/TimetableManager.test.tsx` (7/7 passing).
  - `HelpView.tsx`: Extracted helpers into `src/features/teacher/help/helpUtils.ts` & `helpUtils2.ts`. Split into 4 sub-view viewers in `src/features/teacher/help/`: `CommandBusPlayground.tsx` (interactive command playground & API debugger), `SdkGuideViewer.tsx` (plugin SDK tutorial & code examples), `UserGuideViewer.tsx` (system user guide & applet specs), and `PluginDocsViewer.tsx` (extension docs renderer). Reduced line count from **1,926 down to 324 lines** (-1,602 lines). Verified with unit tests in `src/features/teacher/help/__tests__/HelpView.test.tsx` (4/4 passing).
  - `PluginCenter.tsx`: Extracted types into `src/components/plugin-center/types.ts` and parser/sample helpers into `src/components/plugin-center/utils/pluginCenterUtils.ts`. Split into sub-views in `src/components/plugin-center/sub-views/`: `PluginStorePanel.tsx` (App Store discovery marketplace), `PluginDevPanel.tsx` (developer sideloading editor & manifest validator), and `PluginLogsPanel.tsx` (real-time system log terminal). Reduced line count from **1,784 down to 458 lines** (-1,326 lines). Verified with unit tests in `src/components/__tests__/PluginCenter.test.tsx` (2/2 passing).
- **Decompose `InteractiveWhiteboard.tsx` God Component (Phase 1 & 2)**: Extract 6 inline widget wrappers (`PluginCardRenderer`, `RollCallWrapper`, `CodeSandboxWrapper`, `MathGraphWrapper`, `HelloWorldWrapper`, `RevealPresentationWrapper`) and `wrapSrcDocWithBridge` into `src/features/whiteboard/widgets/` and `src/features/whiteboard/utils/bridgeUtils.ts`. Extract top floating toolbar into `src/features/whiteboard/components/WhiteboardToolbar.tsx`, bottom pagination & thumbnail drawer into `src/features/whiteboard/components/WhiteboardPageBar.tsx`, and modal dialogs into `src/features/whiteboard/components/WhiteboardDialog.tsx` & `CoursewareEntrySelectorModal.tsx`. `InteractiveWhiteboard.tsx` line count drops from **5,428 lines down to 3,466 lines** (shedding 1,962 lines of code!). All extracted components and widgets pass TypeScript type checks with 0 errors and are verified by unit tests in `src/features/whiteboard/__tests__/whiteboard-components.test.tsx` (4/4 tests passing).
- **Domain Store Decomposition & State Descent (Phase 1–5)**: Extract state from `appStore.ts` into 5 high-cohesion, low-coupling domain Zustand stores under `src/store/`: `uiStore.ts` (UI navigation, modals, toasts, site branding), `classStore.ts` (classes, student rosters, schedules, grades), `lessonStore.ts` (lessons, selected lesson, whiteboard elements, VFS nodes), `liveClassStore.ts` (live classroom feed, presence, time remaining), and `studentStore.ts` (student dashboard & notifications). Barrel export created at `src/store/index.ts`. All 5 domain stores include backward-compatibility bidirectional synchronization with `appStore.ts` and individual characterization unit test suites (`src/store/__tests__/uiStore.test.ts`, `classStore.test.ts`, `lessonStore.test.ts`, `liveClassStore.test.ts`, `studentStore.test.ts`) with 11/11 tests passing. Added `src/store/__tests__` pattern to `vitest.config.ts`.
- **Frontend monolith decomposition — Phase 1 (lesson_editor view)**: Extract the teacher `lesson_editor` tab view (the course timeline editor shell: palette, timeline rail, segment editor, lazy whiteboard, save-status badges, and the student-view preview trigger) from `src/App.tsx` into `src/features/teacher/LessonEditorView.tsx` behind a `LessonEditorViewProps` interface. All App-level state/setters/handlers are passed as props; the JSX is moved verbatim. Behavior is preserved and locked by `src/features/teacher/__tests__/LessonEditorView.test.tsx` (3 cases). `src/App.tsx` is reduced by ~194 lines. No new `tsc` errors beyond the type-debt baseline (116). This begins the incremental, characterization-test-guarded decomposition of `src/App.tsx` (~8.5k lines remaining) targeted for `0.3.0`.
- **Frontend monolith decomposition — Phase 2 (`classes` / School Management module)**: Decompose the entire `teacherTab === 'classes'` branch out of `src/App.tsx` into `src/features/teacher/classes/`. The module is split **by sub-feature into 9 components**, each with its own verbatim-move characterization test, then collapsed behind a single `ClassesView` wrapper: `CreateClassButton`, `ManualImportButton`, `ClassPasscodeController`, `ClassRowHeader`, `ClassTabs`, `ClassStudentsPanel`, `ClassAssignmentsPanel`, `ClassSchedulesCharts`, `ClassScheduleAttendance`, and `ClassesView` (the School Management header + batch-mode toolbar + export dropdown + `.map` body that forwards state to the 9 sub-components; the grades tab still delegates to the pre-existing `SemesterGradeManager`). `src/App.tsx` drops by ~1,925 lines (8,938 → 7,013). All 10 test files / 26 cases pass; `tsc` stays at the 116-error type-debt baseline. This completes the second feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 3 (`student` view)**: Decompose the entire `activeRole === 'student'` branch out of `src/App.tsx` into `src/features/student/`. Following the same verbatim-move + characterization-test pattern, the branch is split by sub-area into leaf components (`StudentDashboardHeader`, `StudentRollCallAlarms`, `StudentCourseProgressList`, `StudentQuickStats`, `StudentPerformanceCharts`, `StudentSchedulePanel`, `StudentAssignmentsPanel`, `StudentLessonHeader`, `StudentLessonContentPanel`, `StudentLessonInteractionPanel`, `StudentAssignmentHeader`, `StudentAssignmentQuestionPanel`, `StudentAssignmentWorkPanel`), collapsed behind three sub-wrappers (`StudentDashboardPanel`, `StudentLessonView`, `StudentAssignmentView`), and finally behind a single top-level `StudentView` wrapper that holds the outer container, the two guards (No-Student / Loading), and the `studentViewStatus` switch. `src/App.tsx` now renders a single `<StudentView .../>` for the student role; the `) : (` teacher branch join is preserved verbatim. All student-area test files pass (39 cases across 20 files); `tsc` stays at the 116-error type-debt baseline. This completes the third feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 4 (`teacher` branch wrapper)**: Collapse the entire `activeRole === 'teacher'` branch of `src/App.tsx` (the `<div className="flex-1 overflow-hidden flex bg-gray-50">` containing `NavigationSidebar`, the inner content div, the `PluginTabPanel` catch-all, and the full `teacherTab` ternary over `dashboard` / `lesson_editor` / `live_class` / `plugins` / `courses` / `classes` / `timetable` / `admin_directory` / `computer_labs` / `help`) into a single `src/features/teacher/TeacherView.tsx` behind a `TeacherViewProps` interface. `TeacherViewProps` is a flat composition of every child component's prop bag (shared props typed to the greatest-lower-bound across children that declare them), plus the few identifiers referenced only by App's inline expressions (`socketRef`, `setShowCoursewareHub`, `fetchStudents`, `fetchClassStudents`, `classStudentsMap`, `liveClassSelectedClassId`, `t`). The `live_class` inline expressions (the `students` computation, the `fetchStudents` arrow, `onPingStudent`, `onOpenCoursewareHub`) are moved verbatim so behavior is byte-for-byte preserved. `src/App.tsx` now renders a single `<TeacherView .../>` for the teacher role; the `{activeRole === 'student' ? (…) : (…)}` join is preserved verbatim. `TeacherView` ships with a characterization test (`src/features/teacher/__tests__/TeacherView.test.tsx`) covering the `teacherTab` switch. `tsc` stays at the 116-error type-debt baseline; the 8 failures in the broader suite (`packages/core/worker-rpc`, `packages/plugins/raffle-vote`, `packages/plugins/builtin`, `packages/core/di/ai-service`, `classroom-runtime/classroom-event-bus`, `ai-teacher-workspace`) are pre-existing environment/DI/API-key failures in untouched modules. This completes the fourth feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 5 (inline modals)**: Begin extracting the cluster of large **inline modals** still rendered with raw `<div className="fixed inset-0 …">` blocks in `src/App.tsx`. The first, the Course Creation Wizard (`isCourseWizardOpen`), is moved verbatim (steps 1–4, header, footer, `motion.div`, the `react-markdown` live preview, the preset buttons, and the editable timeline grid) into `src/features/modals/CourseWizardModal.tsx` behind a `CourseWizardModalProps` interface. `wizardCourseTimeline` is typed as `WizardSegment[]` (matching App's `any[]` for the `.color/.title/.type/.duration` accesses), and `setWizardStep` / `setWizardCourseTimeline` use `Dispatch<SetStateAction<…>>` to accept both value and updater calls; `generateTemplateContent` is re-imported from `src/features/teacher/HelpView`. The `isCourseWizardOpen &&` guard moves inside the component so `App.tsx` renders `<CourseWizardModal .../>` unconditionally. `src/App.tsx` sheds ~535 lines of inline modal JSX. Locked by `src/features/modals/__tests__/CourseWizardModal.test.tsx` (3 cases: renders for `lang` zh/en, hidden when closed).
- **Frontend monolith decomposition — Phase 5 (cont.: Import Lessons modal)**: Extract the second inline modal, Bulk-Import Courses (`isImportLessonsOpen`), verbatim (IDLE dropzone, PARSING preview table, IMPORTING progress, SUCCESS, ERROR states, footer controls) into `src/features/modals/ImportLessonsModal.tsx` behind an `ImportLessonsModalProps` interface; `previewImportData` is typed as `ImportRow[]` (`{ title; content }`), and `setPreviewImportData` / `setImportStatus` / `setImportErrorMsg` use `Dispatch<SetStateAction<…>>` to match App's `useState` setters. `import`/`motion`/lucide conventions mirror `CourseWizardModal`. Self-gating (`isImportLessonsOpen &&`) so `App.tsx` renders it unconditionally; `src/App.tsx` sheds ~305 lines. Locked by `src/features/modals/__tests__/ImportLessonsModal.test.tsx` (3 cases: renders for `lang` zh/en, hidden when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: AI Quiz Generator modal)**: Extract the third inline modal, the AI Quiz Generator (`isQuizGeneratorOpen`), verbatim (objective/suggestion scan UI, time-limit selector, and the create-assessment `fetch` flow) into `src/features/modals/QuizGeneratorModal.tsx` behind a `QuizGeneratorModalProps` interface. Props typed to match App exactly (`lessons: Lesson[]`, `suggestedQuestions: any[]`, `quizGeneratorClassId: string | null`, `fetchClassDashboard: (classId: string) => void`; setters as `Dispatch<SetStateAction<…>>`). Self-gating so `App.tsx` renders it unconditionally; `src/App.tsx` sheds ~290 lines. Locked by `src/features/modals/__tests__/QuizGeneratorModal.test.tsx` (2 cases). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Student Perspective Preview modal)**: Extract the fourth inline modal, the Immersive Student Perspective Preview (`isLessonPreviewVisible`), verbatim (split workspace: left Lesson-Markdown column + right `LazyWhiteboard`/`LazyCourseware` switcher with fullscreen toggles) into `src/features/modals/StudentPreviewModal.tsx` behind a `StudentPreviewModalProps` interface. Props typed precisely from `../../types/app` (`Lesson`, `WhiteboardElement`, `VFSNode`) and App's `useState` setters (`previewFullscreenPanel: 'none'|'left'|'right'`, `previewLessonTab: 'whiteboard'|'courseware'`, `activeRole`, `selectedLesson`, `elements`, `vfsNodes`, `previewSelectedCourseware`, `currentVfsParent`, `activeSegmentId`, `fetchElements`); `lang` is NOT a prop — the header is hardcoded zh. Mirrors the other modal conventions (`motion/react`, lucide `Eye/X/BookOpen/Minimize2/Maximize2/ChevronRight/Folder/Globe`, self-gating). `src/App.tsx` sheds ~217 lines. Locked by `src/features/modals/__tests__/StudentPreviewModal.test.tsx` (2 cases: renders header when visible, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: System Resource Library modal)**: Extract the fifth inline modal, the System Resource Library / App Store (`isSystemResourceLibraryOpen`), verbatim (tab switch between interactive-courseware/system-resources and the Cloud Drive panel, left upload+list pane, right sandbox `<iframe>` preview) into `src/features/modals/SystemResourceLibraryModal.tsx` behind a `SystemResourceLibraryModalProps` interface. Props typed to match App's `useState` declarations (`systemResourceTab`, `selectedLibraryResourceId`, `vfsNodes`, `currentVfsParent`, `cloudDrivePreviewNode`, `loadingLibraryResources`, `libraryResources`, `fetchLibraryResources`; setters as `Dispatch<SetStateAction<…>>`); reuses `CloudDrivePanel` from `CloudDriveModal`. Self-gating (`isSystemResourceLibraryOpen &&`) so `App.tsx` renders `<SystemResourceLibraryModal .../>` unconditionally; `src/App.tsx` sheds ~291 inline lines. Locked by `src/features/modals/__tests__/SystemResourceLibraryModal.test.tsx` (3 cases: renders header for `lang` zh/en, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Batch Operation Picker modal)**: Extract the sixth inline modal, the Batch Operation Picker (`batchPicker &&`: 排课 / Batch Lock Lesson / Batch Transfer) verbatim into `src/features/modals/BatchPickerModal.tsx` behind a `BatchPickerModalProps` interface. Props typed to match App's `useState` declarations (`batchPicker` mode, `batchPickerLesson`/`batchPickerDate`/`batchPickerTargetClass` + setters as `Dispatch<SetStateAction<…>>`, `lessons`/`classes` as `any[]`, `expandedClassId`, `confirmBatchPicker`, `lang`); self-gating (`if (!batchPicker) return null`) so `App.tsx` renders `<BatchPickerModal .../>` unconditionally. Locked by `src/features/modals/__tests__/BatchPickerModal.test.tsx` (3 cases: renders `lang` zh/en heading when `batchPicker='schedule'`, absent when `null`). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Grade Export & Weighting Settings modal)**: Extract the seventh (final) inline modal, the Grade Export & Weighting Settings dialog (`isExportWeightModalOpen`), verbatim (weighting sliders + 50/50 & 40/60 presets, per-item quiz/assignment categorization overrides, live CSV grade preview table, footer export) into `src/features/modals/ExportWeightModal.tsx` behind an `ExportWeightModalProps` interface. Props typed to match App (`quizzesWeight`/`assignmentsWeight` + setters, `handleQuizzesWeightChange`/`handleAssignmentsWeightChange`, `customCategoryOverrides` + setter, `classDashboardMap`, `exportClassId`/`exportClassName`, `csvPreviewData` as a local `CsvPreviewData` shape, `handleExportGrades`, `lang`); uses `motion/react` and lucide `Settings2/Percent/ListFilter/Terminal/Download`. Self-gating (`if (!isExportWeightModalOpen) return null`) so `App.tsx` renders `<ExportWeightModal .../>` unconditionally. Locked by `src/features/modals/__tests__/ExportWeightModal.test.tsx` (3 cases: renders `lang` zh/en heading when open, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 6 (top app shell): extract `AppHeader`**: Extract the top navigation `<header>` (site brand/dashboard nav, student "View as" selector, notifications bell + dropdown, System Resource Library button, language toggle, SQLite DB-status badge, `UserMenu`) out of `src/App.tsx` (lines ~3602–3828) into `src/components/AppHeader.tsx` behind an `AppHeaderProps` interface. Prop types mirror App's `useState` declarations (`activeRole`, `teacherTab`/`studentViewStatus` + setters, `siteInfo` from the app store, `session`, `activeStudentId`/`students` + setters, `studentDashboardData`, `isNotificationsOpen` + setter, `studentNotifications`/`unreadNotifications`/`readNotifications` + setters, `setSelectedNotificationForModal`, `setIsSystemResourceLibraryOpen`, `lang`, `toggleLanguage`, `dbStatus`/`dbConnected`, `handleLogout`, `setProfileOpen`); reuses `UserMenu` from `./components/UserMenu` and the vite global `__APP_VERSION__`. `src/App.tsx` now renders `<AppHeader .../>` unconditionally. Locked by `src/components/__tests__/AppHeader.test.tsx` (3 cases: en renders `System Resource Library` + `Dashboard`, zh renders `系统资源库`, basic render). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 6 (cont.: `AppShell` role-switch wrapper)**: Extract the `{activeRole === 'student' ? <StudentView/> : <TeacherView/>}` switch (App.tsx lines ~3646–3886) into `src/components/AppShell.tsx` behind `AppShellProps = StudentViewProps & TeacherViewProps` (both existing interfaces are reused; the 5 shared identifiers with differing function signatures — `setActiveSegmentId`, `addToast`, `setSelectedAssignment`, `setStudentViewStatus`, `fetchElements` — resolve via intersection assignability, and `tsc` stays at 116). `AppShell` branches on `activeRole` and spreads all props to the chosen view, so `src/App.tsx` now renders a single `<AppShell .../>` (the merged union of all StudentView + TeacherView props) instead of the ternary. Swapped the now-dead `StudentView`/`TeacherView` imports for `AppShell`. Locked by `src/components/__tests__/AppShell.test.tsx` (2 cases: `activeRole:'student'` renders StudentView's "No Student Selected", `activeRole:'teacher'` renders TeacherView's nav "Live Class", each absent in the other). `tsc` stays at the 116-error type-debt baseline.

### Fixes

- **Type cleanup — `addToast` now accepts `'error'`**: Broaden the `addToast` / `showToast` type union from `'info' | 'success' | 'warning'` to `'info' | 'success' | 'warning' | 'error'` across the whole contract — `src/App.tsx` (the `addToast` definition, which rejected the `'error'` passed at lines 3359/3419), `src/services/ui-service.ts` (`UIService` wrapper), `src/components/TeacherAssignmentGradePanel.tsx`, `src/components/StudentAssignmentEvalPanel.tsx`, `src/components/LiveClassroomView.tsx`, `src/features/modals/CourseWizardModal.tsx`, `src/features/teacher/TeacherView.tsx`, `src/plugin-host/types.ts`, and the `IUIService.showToast` doc in `docs/tutorials/plugin-development-tutorial.md`. This resolves the two `TS2345` type errors that were part of the 116-`tsc` baseline (now **114**); `src/types/app.ts` already allowed `'error'` on the `Toast` type, so only the `addToast` signature was the blocker. Pure type-widening — no runtime behavior change. Affected component/modal/teacher tests (15 cases) still pass.

- **Type cleanup — `setLessons` accepts an updater function**: The `setLessons` store action in `src/store/appStore.ts` was typed `(lessons: Lesson[]) => void` and only took a plain value, so the two `setLessons(prev => prev.map(...))` updater calls in `src/App.tsx` (lines 2485, 2880) failed with `TS2345`. Widened the signature to `Lesson[] | ((prev: Lesson[]) => Lesson[])` and updated the implementation to branch on `typeof lessons === 'function'` (delegating to zustand `set((state) => …)`), mirroring React's `SetStateAction` convention. The value form at `src/App.tsx:1656` is unaffected. Resolves the 2 `TS2345` errors (tsc baseline **114 → 112**). No runtime behavior change; 58 component/feature tests pass.

### Next-round backlog

- **Frontend monolith (`src/App.tsx`)** is the active decomposition target for `0.3.0` — extracted incrementally by feature area with characterization tests. Phases 1–5 are done: `lesson_editor`, `classes`, `student`, and the entire `teacher` branch are decomposed behind `LessonEditorView` / `ClassesView` / `StudentView` / `TeacherView`, and seven inline modals (`CourseWizard`, `ImportLessons`, `QuizGenerator`, `StudentPreview`, `SystemResourceLibrary`, `BatchPicker`, `ExportWeight`) behind `CourseWizardModal` / `ImportLessonsModal` / `QuizGeneratorModal` / `StudentPreviewModal` / `SystemResourceLibraryModal` / `BatchPickerModal` / `ExportWeightModal`. **All raw `<div className="fixed inset-0 …">` inline modal blocks are now extracted**, the top navigation `<header>` is extracted into `src/components/AppHeader.tsx`, and the student/teacher role-switch is extracted into `src/components/AppShell.tsx` (Phase 6). The remaining inline regions in `src/App.tsx` are only: the outer app-shell wrapper `<div className="flex h-screen …">` plus component prop-forwarding calls that are already their own components (`RightSidebar`, `CoursewareHubPanel` via `showCoursewareHub`, `ProfileModal`, `ImportModal`, `ProcessLogsModal`, `CloudDriveModal`, `NotificationDetailModal`, `ToastContainer`, `HelpTour`), and the large prop list forwarded to `<AppShell/>` (unavoidable — `App.tsx` owns all the shared state). `src/App.tsx` is now ~4080 lines (down from ~8938); the net shrink from the shell extractions is modest because the merged prop-forwarding list stays in `App.tsx`, while the inline JSX/logic (header markup, notifications dropdown, role-switch ternary) is now isolated in `AppHeader` / `AppShell`. The decomposition is at a natural close: `App.tsx` is the central state store + prop-forwarding hub wiring `AppHeader` / `AppShell` (→ `StudentView`/`TeacherView`) / `RightSidebar` / the 7 modal components / the misc panels, each behind its own characterization test, with the 116-`tsc` baseline preserved throughout.
- **Type/lint debt**: ~116 `tsc` + ~1471 `eslint` errors carried as backlog from the `tsc` root-cause fix; not blocking.

## [0.1.16] - 2026-07-28

### Fixes

- **npm Compatibility**: Replace `workspace:*` protocol with `^3.4.3` for `@openlearn/plugin-sdk` dependency to fix `npx openlearn-next` installation failure (`EUNSUPPORTEDPROTOCOL`).

## [0.2.0] - 2026-07-28

### Fixes

- **Hidden type errors surfaced & systematic roots fixed**: `tsc` was aborting early on an invalid `tsconfig` `exclude`, masking **389 real type errors**. Fixed: added `tsconfig` `exclude` for fixtures/templates; corrected 17 wrong relative-import depths (incl. a missing `student-workspace-registry`); added the missing `@testing-library/react` dev dependency; fixed two missing name imports. Made `PluginContext.resolve<T>` infer token types across the core↔SDK boundary (public phantom on `Token`). Tightened `@openlearn/plugin-sdk` to **3.5.0**: service tokens typed concretely (was `Token<unknown>`) and service interfaces accept sync-or-async (`void | Promise<void>`). Remaining ~116 genuine per-file type errors tracked as a type-debt backlog.

### Refactor / Performance

- **Server monolith decomposition — Phase 1 (realtime bridge)**: Extract the EventBus→Socket.IO forwarding block (`server.ts` lines 652–803: `assignment.graded` toast, `handleRollcallElement` rollcall persistence, and `whiteboard.*` / `spotlight.*` sync relays) into a standalone `server/realtime-bridge.ts` module behind `setupRealtimeBridge({ eventBus, io, db })`. Behavior preserved verbatim and locked by a new characterization test (`server/__tests__/realtime-bridge.test.ts`, 7 cases). Introduces a structural `BridgeDb` port and reuses the existing `EventBusPort`, keeping the server's `kernelContainer` as the composition root. No new `tsc` errors beyond the type-debt baseline.
- **Server monolith decomposition — Phase 2 (AI agent + shared cache)**: Extract the AI chat orchestration (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`, `executeAgentToolCall`, `buildOpenAIChatUrl`, `runGeminiAgentChat`, `runOpenAIAgentChat`) into `server/ai-agent.ts`, and the two shared module-level state Maps (`MF_REMOTE_CACHE`, `lessonActiveSegments`) into `server/shared-state.ts`. Both are consumed by `server/routes/*.ts` through `ServerContext`. Pure helpers (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`) are covered by `server/__tests__/ai-agent.test.ts`; network-dependent handlers are skipped with a documented reason.
- **Server monolith decomposition — Phase 2 (presence / socket handlers)**: Extract the Socket.IO connection lifecycle (`io.on('connection', …)` — `register-student`, `enter-lesson`, `leave-lesson`, `join-room`, `whiteboard-update`, `whiteboard-event`, `teacher-broadcast-segment`, `teacher-ping-student`, `disconnect`, and presence broadcasting) into `server/presence.ts` behind `setupPresence({ io, eventBus })`. The shared `lessonActiveSegments` singleton is reused from `server/shared-state.ts`. Behavior (incl. the `whiteboard-event` detail that emits to the raw `lessonId`, not `lesson-<id>`) is locked by `server/__tests__/presence.test.ts` (7 cases).
- **Server monolith decomposition — Phase 2 (startup DB migrations)**: Extract the boot-time DB seed/upgrade and SEC-AUTH-03 session cleanup from `startServer()` into `server/bootstrap-db.ts` behind `runStartupMigrations(db: MigrationDb)`. Covers old default-plugin upgrade (Quiz / Random Student Picker), `CREATE TABLE IF NOT EXISTS` for `student_rollcalls` / `site_settings` / `agent_conversations`, the idempotent `client_sessions.expires_at` column add, and the expired-session cleanup. Locked by `server/__tests__/bootstrap-db.test.ts` (7 cases).
- **Composition root shrinks**: `server.ts` drops from ~1000 to ~322 lines. It now acts purely as the composition root — wiring `kernelContainer`, `ServerBootstrapAdapter`, HTTP/Socket.IO, and delegating all domain behavior to the `server/*` modules above. Each extracted slice has a verbatim-move characterization test; `tsc` remains at the 116-error type-debt baseline.

## [0.1.15] - 2026-07-27

### Features

- **Remote Plugin Update Detection**: Replace hardcoded market data with dynamic version checking via `git ls-remote` (fallback to GitHub/Gitee Releases API) and semver comparison; add `updateSource` field to plugin manifest (`@openlearn/plugin-sdk@3.4.3`); add per-plugin "检查更新" button with server-first download and client-side fallback; support pre-release version badges.
- **Dashboard Quick Access**: Make the brand logo/name area clickable to return to the dashboard; add an explicit "系统总览" / "Dashboard" nav button in the top header bar with active-state highlighting.
- **Whiteboard Toolbar Docked**: Move the interactive whiteboard drawing toolbar from a centered floating overlay into the top white area as a docked, left-aligned bar with a bottom border separator.
- **Admin Panel Monitoring Consolidation**: Move "SQLite 数据库健康体检" and "分布式操作系统硬件状况" cards from the "学校教职及系统配置" tab into the "系统监控" tab (renamed from "SQLite 数据库监控"), consolidating all system health metrics under one monitoring view; expand directory tab's staff list to full width.
- **Plugin Center ZIP Install Relocated**: Move the ZIP drag-and-drop install area from the plugin store grid into the "发现" tab header bar, placed inline to the right of the "显示系统核心插件" toggle with matching compact styling and a teal/emerald color palette.

### Fixes

- **Agent Intro Crash**: Fix `Cannot read properties of undefined (reading 'agentIntro')` crash by adding a safe fallback (`?? translations['zh']`) when the language key is unrecognized; fix `toggleLanguage` to pass the current `lang` value directly instead of a function reference causing store corruption.
- **Repository URL**: Fix incorrect repository URL in package.json from `github.com/openlearn/openlearnv2` to `github.com/aymwoo/OpenLearn-Next-V2`.

## [0.1.14] - 2026-07-26

### Features

- **Nav & Header Cleanup**: Remove obsolete "系统总览" (Dashboard) from sidebar navigation and header; set default teacher homepage tab to `courses` (Course Library); simplify language switcher to a single compact `Globe` icon button.
- **SQLite Status Badge Refactoring**: Refactor database status indicator to a compact 32x32px icon badge with dynamic status colors (🟢 Green for normal connection, 🟠 Orange for latency/warning, 🔴 Red for error/disconnect) and interactive tooltips.
- **Contextual Role Switcher**: Remove global `Teacher Mode / Student Mode` toggle buttons from top header; embed contextual `[ 👨‍🏫 教师模式 | 🎓 学生模式 ]` segmented role switchers directly inside Lesson Editor (`lesson_editor`) toolbar and Live Classroom (`live_class`) control center.
- **Integrated Cloud Resource Sub-Category**: Integrate Cloud Course Resource (`CloudDrive`) into System Resource Library modal as a sub-category tab (`[ 📚 互动课件与系统资源库 | ☁️ 云端课程资源 (Cloud Drive) ]`), removing redundant header button.

## [0.1.13] - 2026-07-26

### Features

- **In-Place Plugin Update**: Add `plugin.update_zip` command and `updatePluginFromZip` API that preserve the plugin UUID, configuration and business data on upgrade (`42f8759`); add server endpoints `POST /api/plugins/:id/update-zip-raw` and `GET /api/plugins/by-manifest/:manifestId`, plus `x-install-mode: update` on install (`c10b123`); the Plugin Install Wizard gains update mode with SemVer compare, downgrade/in-use guards and a locked target plugin (`53a8658`).

### Fixes

- **Resilient Worker Activation Timeout**: Default activation timeout raised to 60s with a sliding `activate-progress` heartbeat; tunable via `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` / `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_PROGRESS_SLIDE_MS` (`c6a9730`).
- **Plugin SDK Sync**: Make facade re-exports type-only and sync the published `dist/index.d.ts` token exports; published `@openlearn/plugin-sdk@3.4.2` (`9d0d793`).

### Docs

- **Plugin-Dev Reference**: Add authoritative DI token & Service API dictionary, capabilities/permission matrix, UI extension-slot Props, database API & migration spec, host shared-deps whitelist, and the in-place update & distribution guide (`37b1474`, `4d9ef54`).

## [0.1.12] - 2026-07-26

### Features

- **Plugin Update Detection & One-Click Hot Update**: Add online market update feed (`/api/plugins/market`), automatic SemVer comparison (`⚡ 发现新版本`), Git repository links (GitHub/Gitee) on plugin cards, release notes preview modal (`📋 新特性`), and one-click atomic hot update with state preservation & rollback (`🚀 一键热更新`).
- **Plugin Card UI Refactoring**: Redesign plugin dashboard toggle button into a standard-sized, modern iOS/Tailwind Switch toggle (`w-7 h-3.5`).
- **Plugin Namespace Migration**: Migrate third-party research workflow plugin from core namespace `@openlearn/` to third-party author namespace `@aymwoo/plugin-research-workflow`.
- **Research Workflow Plugin v1.2.0**:
  - **Class Rosters & SQLite Integration**: Wire real platform SQLite tables (`classes`, `students`, `class_students`) for real class selection.
  - **Group Management & Drag-and-Drop**: Multi-strategy auto-grouping (by size/group count) and HTML5 drag-and-drop group member movement (`⋮⋮` handle on the far left, `设为组长` button on the far right).
  - **Role View Isolation & Material Restrictions**: Separate Teacher Control Console and Student Submission Board; configurable allowed file extensions (`.pdf`, `.docx`, `.zip`, `.mp4`, `.xlsx`) and file size limits.
  - **Light Theme Alignment**: Refactor plugin UI to OpenLearn Next Light Theme palette (`slate-50`, `#ffffff` cards, `#2563eb` accents).

### Fixes

- **Worker Timeout Fix**: Optimize plugin `activate(ctx)` function to be non-blocking (< 10ms) with async 500ms race timeout, completely resolving `[WorkerRuntime] Worker operation timed out after 10000ms` during plugin installation/activation.
- **Workflow State Machine Guards**: Fix same-phase click transition error (`无法直接从 DRAFT 切换至 DRAFT`) and support teacher manual phase override flag.

## [0.1.11] - 2026-07-25

### Features

- **Plugin system (P7-A2)**: complete the unified plugin runtime refactor — wire real
  capabilities into `PluginCapabilityGateway`, integrate plugin lifecycle via unified
  facades, surface unified plugin facades (`IPluginLifecycleManager`,
  `IPluginDistributionManager`, `IUnifiedExtensionRegistry`, …) into
  `PlatformServiceRegistry`, and expose them through `@openlearn/plugin-sdk`. (#e435bba, #475e9e1, #163b1fe, #6b8153e, #1b13eba)
- **User menu & profile**: collapse the top-right username / secure-logout area into a
  circular avatar button with a dropdown (Profile / Logout); profile modal supports
  editing the display name; password-change flow added (teacher + student). (#f818550, #86e7e25, #4fd9e91)
- **Class list summary**: class management list now shows per-class summary chips —
  student count, course count (schedules), assignment count — without expanding the row. (#4451d5b)
- **Dashboard Activity Center**: live in-progress status, pause/resume and
  enter-classroom controls, light theme. (#bfecccc, #e1d9ecb)
- **Class roster**: add list view mode and grid layout. (#05ea25e)
- **Navigation**: optimize platform navigation with grouped categories, badge support,
  and a registry adapter. (#2242613)
- **Routing**: reflect the active page in the browser address bar via hash routing. (#506f617)
- **Docs**: official documentation architecture upgrade to a 25-folder taxonomy; refactor
  the plugin-development AI Skill guide to the latest V2 architecture. (#7e62138, #cd31c3a)

### Fixes

- **Dashboard Activity Center**: resolve perpetual loading of the widget. (#cca16b9)
- **plugin-sdk build**: externalize npm dependencies in the SDK bundle so it no longer
  throws `Dynamic require of "path"` at runtime. (#b50392e)

### Chores / Docs

- Purge non-system plugin artifacts and clean up the plugin build manifest
  (remove quiz-pro and other purged plugin entries). (#1b71c21, #690c704, #1ff7f59)
- Bump `@openlearn/plugin-sdk` references to **3.4.1** and document the P7-A2 unified
  plugin services; publish `@openlearn/plugin-sdk@3.4.0`. (#5070506, #7d04c73)
- Add platform foundation audit report, navigation (PF-02) audit report, and a
  documentation quality review report. (#2e9b494, #c4ee1c8, #c272d6f)
- Purge obsolete historical sprint reports / RFC drafts and synchronize docs with the
  implementation. (#1b5662c, #543bd17)
- Add Plugin System Refactor Proposal (P7-A2). (#c53bd3d)

## [0.1.10] - 2025

Baseline release. System-wide version numbers harmonized to 0.1.10 and
`@openlearn/plugin-sdk` to 3.3.1. (#4d1069a)
