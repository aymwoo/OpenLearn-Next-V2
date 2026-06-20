# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.0 — 微前端架构改造

**Shipped:** 2026-06-20
**Phases:** 4 | **Plans:** 8 | **Sessions:** 3

### What Was Built
- **Vite 6 + Module Federation 2.0 微前端集成**：构建了宿主与远程应用的按需加载体系，配置了共享依赖（React, Zustand）强单例声明。
- **React 动态装载器与 Error Boundary**：实现了高阶容器组件 `MfeLoader`，集成 `MfeErrorBoundary` 实现故障容灾与降级渲染。
- **状态与依赖注入桥接**：利用 `MfeContext` 实现了状态（Zustand Store）的一致性分发，以及带白板/课件白名单过滤的宿主 DI 容器 `MfeServiceRegistryProxy`。
- **业务组件解耦与 CSS 沙箱**：解耦白板和课件并转移为独立项目，利用 Tailwind v4 `prefix(wb)`/`prefix(cw)` 限定符配合禁用 Preflight 实现了样式命名空间隔离。

### What Worked
- **前缀化加缀与 Preflight 禁用**：轻量级地解决了子应用打包 CSS 对宿主全局样式的覆盖冲突，规避了复杂的 Shadow DOM 结构。
- **白名单服务代理**：对暴露给子应用的 `serviceRegistry` 实施代理白名单限制，极大地提高了前端运行时跨包调用的安全性与一致性。

### What Was Inefficient
- **子代理并发与配额管控**：在大文件物理搬移与复杂重构时，过频地派发执行器子代理导致配额（Quota）超限中断，后续需优化执行步骤或倾向顺序执行。

### Patterns Established
- **ServiceRegistry DI Whitelisting**：子项目获取宿主服务一律必须通过白名单审查。
- **Tailwind v4 Sandbox Isolation**：子项目 index.css 一律必须声明独占前缀前限定词并排除 preflight 重置。

### Key Lessons
1. 微前端样式隔离可以借助构建期或编译期前缀完成，极大地减少了运行时动态注入样式的开销。
2. 保持 monorepo 核心共享依赖（React/Zustand）的版本单例，能彻底消除多微应用并发加载时带来的包版本冲突。

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 206 | 9 | 插件系统重构，首次引入 Worker 隔离与 Token DI 体系 |
| v2.0 | 22 | 4 | 微前端架构改造，工程物理拆分与样式沙箱沙盒化配置 |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 358 | 85% | 8 |
| v2.0 | 60 | 90% | 2 |
