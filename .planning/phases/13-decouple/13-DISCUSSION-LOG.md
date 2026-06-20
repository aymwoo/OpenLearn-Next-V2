# Phase 13: 业务模块解耦与样式沙箱化 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 13-业务模块解耦与样式沙箱化
**Areas discussed:** Zustand 状态共享与本地 UI 隔离, 实时通信与高频数据路由, 样式隔离与 Tailwind CSS 沙箱化, 插件注册与数据库动态加载

---

## Zustand 状态共享与本地 UI 隔离 (State Acquisition & UI Isolation)

### 状态获取决策 1: 微前端子应用应如何消费和变更宿主的业务状态？

| Option | Description | Selected |
|--------|-------------|----------|
| Context Store 直接订阅 | (推荐) 使用 MfeContext 的 store，通过 useStore(infra.store) 直接进行细粒度状态订阅与 Actions 写入 (强同步与高度解耦) | ✓ |
| React Props 传递 | 通过 React Props 进行传统的数据和回调函数向下双向传递 (耦合度高，但开发直观) | |

**User's choice:** Context Store 直接订阅
**Notes:** 通过直接传入 Zustand Store 实例并使用 useStore 进行细粒度 Hook 级别消费，实现强同步和状态订阅的生命周期自动释放。

### 状态获取决策 2: 微应用在非 React 上下文（如 Konva 绘图、异步回调）中需要同步读取状态时，应当如何处理？

| Option | Description | Selected |
|--------|-------------|----------|
| getState() 同步快照 | (推荐) 直接调用 infra.store.getState() 读取最新快照 (防止 Konva 及事件回调中出现闭包旧值) | ✓ |
| useRef React 存根 | 在 React 组件内通过 useStore 订阅并使用 useRef 存根传参给微应用底层的非 React 逻辑 (限制直接访问 store) | |

**User's choice:** getState() 同步快照
**Notes:** 避免 React 重绘延迟及闭包旧值问题，保证底层的绘图引擎能获取高频变化的实时同步值。

### 状态获取决策 3: 微应用所需的业务字典数据（如课程、班级、学生列表等）应由宿主托管还是微应用独立请求？

| Option | Description | Selected |
|--------|-------------|----------|
| 宿主 Zustand 全量托管 | (推荐) 全量由宿主 Zustand Store 托管与同步，微应用仅消费 Context，不发生冗余网络请求 (单一数据源) | ✓ |
| 微应用独立 HTTP 请求 | 仅共享控制型状态，微应用利用注入的 IFrontendAPI 独立请求对应的详细字典 API (解耦) | |

**User's choice:** 宿主 Zustand 全量托管
**Notes:** 保证数据流唯一，并减轻微前端应用并发加载时的后端 API 网络请求压力。

### 状态获取决策 4: 微前端应用的纯局部交互状态（如白板画笔选择、颜色、局部全屏等）应如何托管？

| Option | Description | Selected |
|--------|-------------|----------|
| 微应用内部局部管理 | (推荐) 由微应用在内部自行托管 UI 局部状态 (组件级隔离，不污染宿主 Store 且避免全局重新渲染) | ✓ |
| 宿主全局 store 托管 | 全量同步到宿主的全局 appStore 中 (便于宿主监听、保存以及支持未来可能的跨端 UI 属性同步) | |

**User's choice:** 微应用内部局部管理
**Notes:** 实现 UI 职责的松耦合隔离，杜绝因微应用频繁修改本地笔刷颜色等对宿主核心状态造成无关的重绘污染。

---

## 实时通信与高频数据路由 (WebSocket Sync & Routing)

### 实时通信决策 1: 白板的高频协同绘图坐标消息（如画笔拖动轨迹）应通过何种通道同步？

| Option | Description | Selected |
|--------|-------------|----------|
| 直连 ISocketService | (推荐) 解析 DI 容器中的 ISocketService 直连底层 WebSocket 通道 (提供极致低延迟，且完全不污染前端 EventBus) | ✓ |
| EventBus 网络透传 | 统一使用 EventBus 发布 server:whiteboard-update 事件进行网络中转 (保持微前端通信形式完全统一，但高频笔迹消息会占用本地总线带宽) | |

**User's choice:** 直连 ISocketService
**Notes:** 规避前端 EventBus 序列化开销和重绘轰炸，提供高效率、低延迟的笔画数据同步。

### 实时通信决策 2: 白板协同绘图的临时轨迹（temp-draw/temp-end）应如何进行持久化？

| Option | Description | Selected |
|--------|-------------|----------|
| 内存广播 + 终点持久化 | (推荐) 拖动中的临时轨迹仅作内存广播，画笔松开后生成最终元素再进行 SQLite 数据库持久化 (大幅保护数据库，防止并发写锁死锁) | ✓ |
| 全程实时写入持久化 | 拖动绘制中的每一次坐标变化都实时进行数据库写入持久化 (极致高可用，但有严重的写吞吐 and 死锁风险) | |

**User's choice:** 内存广播 + 终点持久化
**Notes:** 极大地缓解 SQLite 的并发写压力，防止在多人协同绘画时数据库遭遇严重的写锁队列问题。

### 实时通信决策 3: 微应用产生的业务通知与教学控制事件（例如随机点名、环节切换）应走何种通道？

| Option | Description | Selected |
|--------|-------------|----------|
| 统一走宿主 EventBus | (推荐) 控制和业务通知事件 (如点名 picked、环节切换) 统一走宿主 EventBus (实现松耦合、多组件全局响应) | ✓ |
| 全部直连 ISocketService | 所有控制和通知事件同样直连 ISocketService 处理 (保持实现单一性，但牺牲了本地解耦和多组件消费便利性) | |

**User's choice:** 统一走宿主 EventBus
**Notes:** 松耦合控制级事件，使宿主的其他关联面板（例如考勤统计、在线成员栏）能异步监听到相同的事件动作。

---

## 样式隔离与 Tailwind CSS 沙箱化 (CSS Isolation & Sandbox)

### 样式沙箱决策 1: 微前端白板和课件子应用应采用何种技术方案规避 Tailwind CSS 样式冲突？

| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind 前缀隔离 | (推荐) 使用 Tailwind 前缀限制 (例如 wb- 前缀和 cw- 前缀)，避免 Shadow DOM 带来的跨 Portal 弹出层定位失效兼容问题 (低成本、零副作用) | ✓ |
| Shadow DOM 隔离 | 使用 Shadow DOM 进行浏览器级的物理隔离 (样式绝对纯净，但会带来弹出组件和全屏 API 兼容性难题) | |

**User's choice:** Tailwind 前缀隔离
**Notes:** 采用轻量而原生的前缀配置规避冲突，避免 Shadow DOM 对 Portal 渲染和 Fullscreen API 的副作用。

### 样式沙箱决策 2: 微应用自定义的普通样式（非 Tailwind 属性）应如何处理以防止对宿主或其他微应用造成全局污染？

| Option | Description | Selected |
|--------|-------------|----------|
| CSS Modules 自动哈希 | (推荐) 强制使用 CSS Modules (*.module.css) 自动哈希化类名 (编译层提供隔离保障，零泄露) | ✓ |
| 组件根 class 手动嵌套 | 微应用外层绑定唯一根 class，通过手动 CSS 嵌套级联进行约定式隔离 (依赖开发者手动约束，易发生遗漏) | |

**User's choice:** CSS Modules 自动哈希
**Notes:** 由编译期（Vite）提供保障，降低人为约定的遗漏风险，确保完全零污染。

### 样式沙箱决策 3: 微应用各自生成的独立 CSS 文件中，是否应该包含全局 Tailwind 基础重置（Preflight）？

| Option | Description | Selected |
|--------|-------------|----------|
| 禁用 Preflight | (推荐) 在子应用的 Tailwind 构建中禁用 preflight (preflight: false)，微前端直接复用宿主的全局基础重置样式 (防止子应用覆盖宿主默认样式，保证全局风格一致) | ✓ |
| 包含 Preflight | 保留 preflight 样式并通过编译插件强制包裹命名空间选择器 (开发配置繁琐，但微应用内部重置更独立) | |

**User's choice:** 禁用 Preflight
**Notes:** 禁用子应用的 Preflight 可以防止在加载子应用 CSS 时篡改已存在的宿主全局通用重置。

---

## 插件注册与数据库动态加载 (Database Registration & Fail-safe)

### 插件注册决策 1: 白板和课件两个核心微前端应用应如何被宿主发现并加载？

| Option | Description | Selected |
|--------|-------------|----------|
| 数据库动态注册预置 | (推荐) 白板和课件全部作为动态注册的行记录预置到 mfe_remotes 表中，宿主在运行时通过 Loader 动态解析装载 (允许零停机热更新和按需卸载) | ✓ |
| 代码静态硬编码 | 对白板和课件进行硬编码加载配置，仅允许新扩展的第三方应用进行数据库动态注册 (减少初次数据表关联开销，但牺牲了版本解耦热更新能力) | |

**User's choice:** 数据库动态注册预置
**Notes:** 在数据库初始化种子脚本中录入记录，实现白板和课件与宿主代码级别的真正热更新和按需卸载。

### 插件注册决策 2: 如果管理员在数据库中禁用了某个核心微应用，宿主前端界面在试图展现该应用时应如何容错？

| Option | Description | Selected |
|--------|-------------|----------|
| 渲染友好提示占位符 | (推荐) 渲染一个友好提示占位符，并阻断对 entry 脚本的网络加载 (提供安全防守、节约流量、提供开发期可见性) | ✓ |
| 直接在 UI 上彻底隐藏 | 直接在宿主 UI 上彻底隐藏禁用微应用的入口 (界面最简洁，但可能导致用户困惑) | |

**User's choice:** 渲染友好提示占位符
**Notes:** 提供更完善的安全机制，阻断无效网络 Entry 加载并以友好 UI 提示取代白屏。

---

## the agent's Discretion

- 无。所有设计选择均与用户取得对齐。

## Deferred Ideas

- 无。所有的想法均在阶段目标的框架内完成决策。
