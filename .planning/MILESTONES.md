# Milestones

## v1.0 插件系统重构 (Shipped: 2026-06-19)

**Phases completed:** 9 phases, 34 plans | **Tests:** 358 passed, 41 test files | **Commits:** 206

**Key accomplishments:**

1. **Token DI 内核** (Phase 1) — Token<T> 泛型类 + ServiceRegistry 依赖注入容器 + 拓扑排序循环检测
2. **7 个 IService Token 化** (Phase 2) — CommandBus、EventBus、ActionRegistry 等核心子系统封装为 IService 接口，注册到 DI 容器
3. **跨运行时 ESM 动态加载** (Phase 3) — Node.js data: URL + 浏览器 Blob URL 双重加载策略，ZIP 多文件插件包格式 + manifest.json zod 校验
4. **PluginHost 完整生命周期** (Phase 4) — install/activate/deactivate/uninstall 标准流程，ResourceTracker 自动资源追踪清理，5s 超时保护
5. **Worker Thread 隔离 + ServiceProxy RPC** (Phase 5) — Worker 沙箱 + Proxy-based IPC 服务代理 + CapabilityGuard 跨边界权限检查 + Event 转发
6. **EventBus 服务 + SemVer 兼容** (Phase 6) — 全局 IEventBusService + Token 语义化版本兼容检查 + Token Registry
7. **热重载 + 中间件管道** (Phase 7) — chokidar 文件监听 + 原子替换策略（新版本成功才停用旧版本）+ 洋葱模型生命周期中间件
8. **6 个内置 + 2 个第三方插件迁移** (Phase 8) — 全部迁移到 ESM + Token DI 格式，删除旧 plugin-runtime（666 行 VM 沙箱代码）
9. **前端 PluginHost + Extension Points + WebWorker** (Phase 9) — 浏览器端 ServiceRegistry + Zustand state + React Context + ExtensionPointRegistry + BrowserWorkerTransport + ServiceHost RPC + 新旧系统过渡

**Tech stack:** TypeScript 5.8, React 19, Vite 6, Express 4, SQLite (better-sqlite3), vitest 4, Socket.IO 4
**Deferred items at close:** 0 (all artifacts clear)
