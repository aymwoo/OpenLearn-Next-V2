# OpenLearnV2 微前端与 Vite 模块联邦 (Module Federation) 引入踩坑与规避指南

在 OpenLearnV2 升级至微前端架构（v2.0）的过程中，将庞大的宿主（Host）App.tsx 拆分为独立的微前端模块，并在前端集成 Vite Module Federation，是实现灵活插件渲染的必经之路。然而，由于项目本身结合了 React 19、Vite 6、Zustand、沙箱 Worker（PluginHost）、Token 依赖注入（DI）系统等复杂底层设施，这一过程极易遇到工具链、运行时状态、以及生命周期和样式污染等层面的“隐形地雷”。

本研究旨在为 OpenLearnV2 的微前端改造提供一份具备指导性、意见明确的踩坑排雷指南，用以指导后续各阶段的架构实施与 roadmap 制定。

---

## 1. 核心选型与构建工具链踩坑 (Vite 6 & Module Federation)

### 踩坑点 1.1：联邦插件选型错误导致运行时漂移与构建失败
*   **具体征兆**：本地开发环境运行良好，但一旦打包成 Rollup 生产包或在 Vite 6 中启用某些高级功能时，控制台抛出 `__federation__` 相关变量未定义的错误，且无法完美兼容 Vite 6 的 Environment API。
*   **深度剖析**：社区常用的 `@originjs/vite-plugin-federation` 使用了其自定义的虚拟运行时来模拟 Webpack 的联邦机制。它在早期 Vite 版本中表现较好，但对于 Vite 6 的新架构（如 Environment API）支持严重滞后，且其编译产物在处理 React 19 复杂的依赖树时存在边缘行为冲突。而官方团队推出的 `@module-federation/vite` 直接连接底层的统一 `@module-federation/runtime`，能确保跨 bundler（Webpack/Rspack/Vite 6）行为的完全一致与长期维护性。
*   **意见/方针**：**严禁使用 `@originjs/vite-plugin-federation`，必须且仅能统一采用官方的 `@module-federation/vite`（配合 `@module-federation/runtime`）。**

### 踩坑点 1.2：开发与生产环境不一致导致 Chunk 加载错误 (CORS/404)
*   **具体征兆**：在开发环境下所有模块正常加载，但在部署到 CDN 或预发服务器后，宿主加载远程模块时报 `ChunkLoadError` 错误，或者遭遇 CORS 跨域拦截。
*   **深度剖析**：Vite 6 在 Dev 开发模式下利用浏览器原生的 ES modules 动态解析远程依赖，而生产模式下由 Rollup 静态生成并打包。如果 Remote 端的 `publicPath` 或静态资源根路径配置为相对路径，宿主在解析子应用 Chunk 时会错误地向“宿主自身域名”请求该静态资源。
*   **预防策略**：
    1.  Remote 微应用的 `vite.config.ts` 中必须显式配置绝对地址 `base`（例如：`http://cdn.openlearn.internal/mfe-whiteboard/`）。
    2.  Remote 静态服务器必须开启 `Access-Control-Allow-Origin: *` 的 CORS 头。
    3.  宿主加载 Remote 时，避免在 `vite.config.ts` 中写死端口，应采用运行时 **动态发现与注册（Dynamic Remote Resolution）** 方案，通过运行时 API 加载配置。

### 踩坑点 1.3：Vite 6 Environment API 下的 HMR 频繁失效
*   **具体征兆**：在修改子应用（Remote）代码时，宿主页面不发生局部热更新（Fast Refresh），或者导致整个页面闪烁重刷，控制台提示 "HMR connection lost"。
*   **深度剖析**：Vite 6 引入了全新的 Environment API 对模块环境做了隔离。微前端中，Remote 模块从其自身端口提供服务，但默认 HMR 客户端会连接 Host 的端口（如 5173），导致热更新的 WebSocket 被宿主拦截或拒连。
*   **预防策略**：微应用的 `vite.config.ts` 必须对开发服务器进行显式 HMR 端口绑定：
    ```typescript
    server: {
      port: 5174,
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 5174, // 强制 HMR 监听微应用自己的端口，不共用 Host 端口
      }
    }
    ```
    并且在宿主配置官方 Module Federation 插件时，必须显式开启 `remoteHmr: true`。

---

## 2. React 19 运行时与单例冲突 (React 19 Singleton)

### 踩坑点 2.1：React 实例多重加载导致 React Context 穿透失效
*   **具体征兆**：宿主（Host）中使用了 React Context 传递全局的主题、用户状态或总线配置，但在 MFE 子应用（Remote）中，通过 `useContext()` 消费该上下文时拿到的却是 `undefined` 或初始默认值，即使子应用已经挂载在 Provider 内部。
*   **深度剖析**：React Context 的值传递是基于运行内存中 `React` 库实例对象的物理引用匹配。若 Host 和 Remote 在加载时没有被严格限制使用同一个 React 实例，Module Federation 会为 Remote 独立下载或打包一份 React。此时宿主的 React 实例与 Remote 的 React 实例属于不同的“物理副本”，Context 的树状向下查找机制直接失效。React 19 对此要求更为严苛。
*   **预防策略**：在联邦配置的 `shared` 中，**必须将 `react` 和 `react-dom` 强制配置为 Singleton。** 且需要通过 `strictVersion: true` 保证 Host 和 Remote 的 React 版本精准一致（例如同为 `19.0.0`），坚决杜绝版本混用。
    ```typescript
    // vite.config.ts 中的 shared 配置示例
    shared: {
      react: { singleton: true, requiredVersion: '19.0.0', strictVersion: true },
      'react-dom': { singleton: true, requiredVersion: '19.0.0', strictVersion: true }
    }
    ```

### 踩坑点 2.2：React 19 并发更新与微应用生命周期卸载冲突
*   **具体征兆**：切换路由或卸载微应用再重新进入时，控制台报 "Target container is not a DOM element" 或 React Root 挂载冲突，DOM 树中出现重复残留的微应用元素，且页面频繁闪烁。
*   **深度剖析**：React 19 彻底废弃了 `ReactDOM.render` 并引入了并发根（`createRoot`）的标准管理。在 MFE 微应用生命周期规范（`MFE-03`）中，若在 `unmount` 阶段仅仅简单地清空父 DOM 容器的内容（如 `container.innerHTML = ""`），而没有调用 React 19 实例的 `root.unmount()`，会导致 React 内存中的 Fiber 树没有卸载，进而引起 DOM 节点悬挂、事件监听器未清理以及内存泄漏。
*   **预防策略**：定义清晰的、基于 Promise 的生命周期规范。每个 MFE 模块暴露的 `unmount` 函数必须保存并同步调用对应的 React 19 `root` 实例的销毁方法：
    ```typescript
    // MFE 子应用暴露的挂载标准
    let reactRoot: any = null;

    export const mount = (container: HTMLElement, props: any) => {
      reactRoot = createRoot(container);
      reactRoot.render(<App {...props} />);
    };

    export const unmount = () => {
      if (reactRoot) {
        reactRoot.unmount(); // 确保安全卸载 Fiber 树
        reactRoot = null;
      }
    };
    ```

---

## 3. 与 OpenLearnV2 现有沙箱及插件系统集成

### 踩坑点 3.1：前端微应用（View 层）直接调用后台 Web Worker（Logic 层）的沙箱屏障损坏
*   **具体征兆**：微应用打包或运行时报错 "require is not defined" 或 "window is not defined"，或者由于微应用尝试引入 Node.js/数据库 API 导致浏览器直接白屏。
*   **深度剖析**：OpenLearnV2 的核心安全架构是：插件逻辑和后台计算必须在 Worker 隔离的沙箱（`PluginHost`）中运行，而微前端架构负责的是视图（View 层）渲染。若微应用（MFE）开发者混淆了两者职责，将本应在后台运行的插件执行代码打包进微前端的前端产物中，就会因环境不兼容而崩溃，同时严重危害系统安全性（使恶意插件能轻松逃逸沙箱拿到浏览器 DOM 控制权）。
*   **预防策略**：微前端模块仅包含**纯前端的 UI 渲染组件**。如果微前端需要获取后台数据，必须通过宿主注入的 `IEventBusService` 发送事件，或调用经过安全过滤的前端 `ServiceProxy`（RPC 代理）来与 Worker 通信，微前端自身绝对禁止进行文件系统读写、数据库操作等高危动作。

### 踩坑点 3.2：ServiceRegistry (Token DI) 多实例导致服务 Token 查找失败
*   **具体征兆**：微前端子应用中通过依赖注入框架请求 `IEventBusService` 或其他宿主提供的 Token时，抛出 "Token is not registered" 异常。
*   **深度剖析**：如果子应用的依赖列表（`dependencies`）中包含了底层依赖注入库 `@openlearn/core` 或 `@openlearn/di`，且构建时未将其声明为 `shared`，联邦机制就会将该库的底层 DI `ServiceRegistry` 类在 Remote 中单独打包一份。这样 Remote 应用所生成的 `ServiceRegistry` 单例实例和 Host 的 `ServiceRegistry` 实例成为了两个不同的对象。
*   **预防策略**：核心服务库（如依赖注入基础库、Token 声明模块）必须被配置到 Module Federation 的共享白名单中，且设为 `singleton: true`。同时，Host 应当在加载并挂载子应用时，在 `mount` 的 `props` 或 React Context 中将 Host 的 `ServiceRegistry` 实例显式透传给子应用。

### 踩坑点 3.3：Zustand 状态库非 Singleton 引起的状态分裂与响应失效
*   **具体征兆**：宿主应用（Shell）更新了 Zustand Store 中的状态（例如课程当前进度），但子应用对应的 MFE 组件并未跟随渲染；或者子应用修改了 Store，宿主状态纹丝不动。
*   **深度剖析**：Zustand 本质上是模块作用域的闭包状态。若 `zustand` 库本身没有在 MFE 中配置为 Singleton，或者 Host 和 Remote 各自引用了独立的 Store 定义文件，会导致运行期内存中存在两个同名的 Zustand 实例，状态随之裂变，彼此监听不到对方的状态变更。
*   **预防策略**：
    1.  配置联邦共享规则，强制 `zustand` 为 `singleton`。
    2.  **绝对禁止**微前端 Remote 在其内部自行初始化全局性质的 Zustand Store。
    3.  宿主的 Zustand Store 实例必须通过 Token DI（作为依赖注入的服务）或宿主提供的 React Context 统一分发到微前端组件中，子应用通过消费宿主传入的 Store 引用来执行 `useStore(store, selector)`。

---

## 4. CSS 与样式隔离失效 (CSS Scoping)

### 踩坑点 4.1：微前端样式污染与全局选择器冲突
*   **具体征兆**：微应用挂载后，宿主（Host Shell）的侧边栏布局或字体突然发生变化，或者微应用本身的按钮样式被宿主的 CSS 规则彻底覆盖或改版。
*   **深度剖析**：在 Module Federation 的默认机制下，微应用的 CSS 会随组件加载而通过 `<style>` 或 `<link>` 标签直接动态注入到宿主的全局 `document.head` 中。由于其生效范围是全局的，如果 Remote 组件中包含没有作用域限制的 CSS 选择器（如 `h1`，`.btn`，`.header`，或者是全局的 Tailwind 注入），就会造成无法预测的样式混乱。
*   **预防策略**：
    1.  **全面强制微前端使用 CSS Modules**（使用 `[name].module.css`），从而在构建时将 CSS 类名哈希化，确保物理隔离。
    2.  如果微前端和宿主都使用 TailwindCSS，微前端的 `tailwind.config.js` **必须配置前缀（prefix）**（如 `prefix: 'mfe-wb-'`），防止实用工具类覆盖宿主的默认类。或者设置 `important: '#mfe-root-whiteboard'` 将微应用样式限制在特定根节点 ID 下。
    3.  对于第三方未处理样式的微组件，在挂载点可选用 Shadow DOM 进行硬隔离，但需注意妥善处理 Shadow Root 内的样式表载入。

---

## 5. 规避策略与排错指标矩阵 (Warning Signs & Prevention Matrix)

下表将微前端改造（v2.0）的踩坑领域、问题表现、预警信号及具体预防策略整理归类，并明确划分了其应在 Roadmap 的哪一个实施阶段予以解决和规避。

| 踩坑领域 | 问题定义 (Pitfall) | 预警信号/征兆 (Warning Signs) | 预防与解决策略 (Prevention Strategy) | 目标落地阶段 (Target Phase) |
| :--- | :--- | :--- | :--- | :--- |
| **构建配置** | 混用社区版与官方 Module Federation 插件 | `dev` 开发通过，`prod` 构建产物报 `__federation__` 引用错。Vite 6 插件报错。 | **强一致性选型**：项目全局强制且仅能选用官方 `@module-federation/vite` 插件。 | **Phase 1 (MFE-01 构建集成)** |
| **部署与加载** | 相对路径打包导致静态资源加载 404/跨域 | 加载远程应用报错 `ChunkLoadError`。网络面板中 Remote 的 JS/CSS 请求返回 404 或 CORS 拦截。 | 1. 显式配置微应用构建的 `base` 路径为绝对 URL。 <br>2. 开启静态服务器 CORS 支持。<br>3. 宿主使用运行时动态注册 API 加载 Remote。 | **Phase 1 (MFE-01 构建集成)** |
| **热更新** | 开发环境下微应用 HMR 报错、卡死或导致 Host 整页刷新 | 浏览器控制台提示 HMR WebSocket 握手失败。修改子应用代码，宿主页面不发生局部更新而是直接全部重刷。 | 在 Remote 的 `vite.config.ts` 中配置独立的 `server.hmr.clientPort` 以防端口冲突。同时在 Host 联邦配置开启 `remoteHmr: true` | **Phase 2 (MFE-02 动态加载)** |
| **依赖共享** | React 19 多物理实例运行导致 Context 崩塌 | Context Provider 包裹了组件，但 Remote 消费该 Context 依然拿到 `undefined`。可能伴有 "Hooks can only be called inside..." 报错。 | 将 `react` 和 `react-dom` 强制配置为共享依赖中的 **`singleton: true` 和 `strictVersion: true`**，确保版本精确匹配。 | **Phase 4 (MFE-04 宿主状态共享)** |
| **生命周期** | 微前端组件卸载不彻底导致内存泄漏与 DOM 残留 | 频繁切换微应用路由后，内存持续飙升，宿主渲染容器中残留微应用的 DOM 节点，再次渲染时报错根节点冲突。 | 微前端挂载规范（`MFE-03`）严格定义 `unmount` 生命周期。**必须在 unmount 函数内部显式且同步调用 React 19 的 `root.unmount()`**。 | **Phase 3 (MFE-03 生命周期挂载)** |
| **依赖注入** | DI 容器中 Token 服务加载不到（`ServiceRegistry` 多实例） | MFE 子应用尝试通过 Token 获取 `EventBus` 服务时，返回 `null` 或抛出未注册异常。 | 1. 将 `@openlearn/core` 和 Token 基础声明库加入 Module Federation 的 `shared` 并设为共享单例。<br>2. 挂载时由 Host 通过 Context 或生命周期将其实例注入子应用。 | **Phase 4 (MFE-04 宿主状态共享)** |
| **状态管理** | Zustand 全局状态失去响应或数据分裂 | Host 触发的状态修改在 Remote 界面上没有触发局部重新渲染，两端数据不一致。 | 1. 共享 `zustand` 库。<br>2. 宿主 Zustand Store 实例作为 DI Service 注入或 React Context 注入传递，Remote 使用 `useStore(store, selector)` 消费该引用。 | **Phase 4 (MFE-04 宿主状态共享)** |
| **样式安全** | 远程应用 CSS 全局泄漏污染宿主布局 | 加载特定微前端后，宿主的侧边栏、背景色或第三方库组件的样式突然变形。 | 1. 限制 Remote 使用全局样式。<br>2. 开启 CSS Modules 编译。<br>3. TailwindCSS 配置 `prefix` 隔离或设置局部 `important` 选择器。 | **Phase 5 (MFE-05 组件与路由解耦)** |

---

## 结论与后续行动建议

在接下来的 OpenLearnV2 微前端集成架构改造中，为了绝对规避上述踩坑点，应当在 Roadmap 设计中采取以下三大铁律：

1.  **架构审查把关（Phase 1）**：在 MFE-01 启动时，直接在代码中通过 ESLint 或编译脚本限制对社区旧版 `@originjs` 插件的引入，强制锁定官方统一运行时。
2.  **契约化生命周期（Phase 3）**：定义明确的微前端入口 TypeScript 类型契约（`MfeModule` 接口），任何 Remote 应用在接入前，必须导出严格符合 React 19 渲染模型要求的 `bootstrap`, `mount`, `unmount` 接口规范。
3.  **非侵入式状态流转（Phase 4）**：坚持 OpenLearnV2 原有的 DI 与总线设计。微前端 Remote 与后端沙箱的交互，仅依靠被注入的 `IEventBusService` 实例发送事件进行。这既保持了逻辑的强解耦，也守护了 Web Worker 的安全边界。
