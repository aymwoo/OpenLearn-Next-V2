# Phase 10: 基础设施配置与工程集成 - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段的目标是搭建 Vite 6 + Module Federation 2.0 基础构建与编译环境，确立核心依赖单例共享机制，配置 Tailwind CSS v4 扫描及 esnext 编译目标。

</domain>

<decisions>
## Implementation Decisions

### 微前端子项目工程结构与端口规划
- **D-01:** 微前端子应用源码统一存放在 `packages/mfe-[name]` 目录下，作为独立的 pnpm workspace 工作区包。
- **D-02:** 在本地开发环境中，各个子应用采用固定的静态端口分配（例如 Whiteboard MFE 为 5174，Courseware MFE 为 5175），以便在 Host 中进行配置与加载。
- **D-03:** 统一在 monorepo 根目录下运行 `pnpm install` 管理和同步子应用依赖及版本。
- **D-04:** 各远程子应用继承根目录的 `tsconfig.json` 配置，编译目标 (Target) 统一指定为 `esnext`。

### Module Federation 共享依赖控制策略
- **D-05:** 对核心共享依赖（React, React-DOM, Zustand）使用宽松的版本匹配机制（`strictVersion: false`），允许大版本相同、小版本或补丁版本微调，降低加载失败率。
- **[informational] D-06:** 采用 Fail-fast 拒绝加载策略，如果核心单例依赖无法被满足，直接阻断远程应用的加载并在 UI 的 Error Boundary 中显示错误提示，防止出现双 React 实例导致的 React Hook 报错崩溃。*(注：在 Phase 11 通用组件 `MfeLoader` 中实现)*
- **D-07:** 在 `vite.config.ts` 中通过引入 `package.json` 的方式动态生成共享依赖的 `requiredVersion`，确保依赖升级时自动同步。
- **D-08:** 非核心第三方库（如 Recharts, Lucide-React, Motion 等）由子应用按需独立打包，不进行全局单例共享，保持宿主首屏的加载速度。

### 动态 Base/Asset 资源路径解析方案
- **D-09:** 采用运行时动态解析 Base Path，编译构建时 base 使用 `'auto'`，并在动态加载时补全相对资源路径，支持各种复杂的动态插件部署。
- **[informational] D-10:** 微前端远程子应用的 Entry 地址（如 `remoteEntry.js`）统一在后端 SQLite 数据库中注册，由宿主应用在运行时通过 REST API 获取并动态加载，支持热插拔。*(注：在 Phase 11 客户端动态加载以及 Phase 13 宿主数据库动态注册插件渲染中实现)*
- **[informational] D-11:** 生产环境下的微前端子应用构建产物独立部署 to 各自的目录中，并在 Node.js 服务端以 `/plugins/mfe-[name]/*` 路由段静态托管。*(注：在 Phase 11/13 静态托管中实现)*
- **[informational] D-12:** 实现动态加载重试机制，在加载失败或 Chunk 丢失时自动执行最多 3 次指数退避重试，最大化网络容错。*(注：在 Phase 11 初始化 Module Federation 运行时桥接中实现)*

### Tailwind CSS v4 样式扫描机制
- **D-13:** 样式采用宿主侧集中扫描编译。在宿主的 `src/index.css` 中配置 `@source` 扫描所有子应用的组件代码，统一由宿主编译生成一份优化的 CSS，减少样式冗余。
- **D-14:** 规范命名空间并使用 React CSS Modules 隔离自定义样式，对于 Tailwind 提供的原子工具类则保持默认不隔离以最大化共享，避免自定义 CSS 样式冲突。
- **D-15:** 全局设计主题（如配色、圆角、字体）采用 `:root` 原生 CSS 变量的形式由宿主定义，子应用直接继承并使用。*(注：宿主已定义，子项目继承无需额外开发)*
- **[informational] D-16:** 子应用引入的第三方库自带 CSS（如 Radix / LobeHub UI 样式等）应在子应用的 `mount` 钩子中动态挂载到 DOM 中，在 `unmount` 时自动移除，防止非活动期间的全局样式污染。*(注：在 Phase 11 远程微应用生命周期 mount/unmount 钩子中实现)*

### the agent's Discretion
- 没有使用 AI 自主决定事项，所有决策均与用户对齐。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Planning & Roadmap
- `.planning/ROADMAP.md` — Milestone 2.0 roadmap defining Phase 10 details.
- `.planning/REQUIREMENTS.md` — MFE requirements defining MFE-INF-01, MFE-INF-02, MFE-INF-03.
- `.planning/STATE.md` — Milestone v2.0 state and resume pointer.

### Project Configurations
- `vite.config.ts` — Vite config template of Host.
- `package.json` — Monorepo base package dependency specifications.
- `pnpm-workspace.yaml` — pnpm monorepo workspace configuration.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Vite 6 dev server and production bundler infrastructure.
- Tailwind CSS v4 setup via `@tailwindcss/vite` in `vite.config.ts`.
- pnpm workspace monorepo configuration (with existing workspaces like `packages/core`).

### Established Patterns
- Strict type checking via `tsc --noEmit` and ESM building for server/client.
- Native CSS styling imports and setup.

### Integration Points
- `package.json` and `vite.config.ts` of the host application.
- `pnpm-workspace.yaml` where packages are registered.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-infra-config*
*Context gathered: 2026-06-19*
