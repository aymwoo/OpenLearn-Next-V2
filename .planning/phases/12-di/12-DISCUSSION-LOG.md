# Phase 12: 宿主状态共享与 DI 桥接 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 12-宿主状态共享与 DI 桥接
**Areas discussed:** Zustand 状态共享与订阅机制, 前端 EventBus 与 Socket 桥接策略, EventBus API 接口规范, DI 服务注册表 (ServiceRegistry) 的暴露范围与安全隔离

---

## Zustand 状态共享与订阅机制

### Q1: 微应用（MFE）应当如何获取并订阅宿主的前端状态？
| Option | Description | Selected |
|--------|-------------|----------|
| Context 注入 Store | 统一通过 Context 注入主 App 状态 Store，子应用调用 store.subscribe 订阅变化或使用自定义 Hook 包裹 (实现强同步，无需重复实例化) | ✓ |
| 独立实例化 Store + EventBus 同步 | 子应用独立实例化自己的 Zustand Store，主宿主与子应用的状态同步完全通过 EventBus 异步广播进行 (彻底解耦，但有数据冗余和同步延迟风险) | |

### Q2: 如何将宿主 App.tsx 现有的 useState 状态提供给 Zustand Context 共享？
| Option | Description | Selected |
|--------|-------------|----------|
| 重构为独立的 Zustand Store | 将 App.tsx 中的核心共享业务状态重构为一个独立的 Zustand Store (如 useAppStore)，在 Context 中传入其原生的 store 对象 (最符合 Zustand 规范，订阅精度高) | ✓ |
| useState 包装成 Plain Object | 暂不重构 App.tsx，在 App.tsx 内部将现有的 useState 状态值和修改器打包成一个 store-like 的 Plain Object 传入 (开发速度快，但无法做到 Zustand 细粒度 selector 订阅) | |

### Q3: 子应用侧的 React 组件如何具体订阅并消费 Context 中传入的 store？
| Option | Description | Selected |
|--------|-------------|----------|
| 直接使用 useStore 钩子 | 子应用直接导入并使用 `zustand` 导出的 `useStore` 钩子订阅传入的 store 实例 (例如 `useStore(infra.store, selector)`)，极简且类型安全 | ✓ |
| 宿主提供 Bridge Hook | 在宿主中封装一个订阅桥接 Hook，作为 Context 的一部分传递给子应用 (子应用不直接调用 `useStore`，通过 Context 里的辅助函数订阅) | |

### Q4: 当子应用被卸载时，如何确保其对宿主 Zustand Store 的订阅被正确释放，避免内存泄漏？
| Option | Description | Selected |
|--------|-------------|----------|
| 依赖组件生命周期自动清理 | 依靠 React 组件自身的生命周期清理：Zustand 的 `useStore` 在组件销毁时会自动取消订阅，因此宿主和子应用无需手动介入清理 store 级别的订阅 (最标准且无内存泄漏) | ✓ |
| 手动调用 unsubscribe 清理 | 在 mount/unmount 契约中由子应用实现手动的 `store.subscribe` 清理逻辑，并将 unsubscribe 函数注册到泄漏检测器中 (双重保障，但增加了子应用的样板代码) | |

**Notes:** 通过 Module Federation 共享的 `zustand` 单例直接在子应用调用 `useStore` 是最标准且无泄漏的做法。为了使数据类型在宿主和子应用之间完全一致，必须将 `App.tsx` 中的状态重构为 Zustand 存储。

---

## 前端 EventBus 与 Socket 桥接策略

### Q1: 前端 EventBus 发布的事件是否需要自动通过 Socket.IO 桥接到后端？
| Option | Description | Selected |
|--------|-------------|----------|
| 混合桥接模式 | EventBus 本地事件默认仅在浏览器端内部广播；如果事件满足特定前缀规范（如 `server:*`），则由宿主自动拦截并转化为 socket.emit 发给后端；同时，后端推送的特定 socket 消息也由宿主转入前端 EventBus (开发体验最统一，符合 pub/sub 设计) | ✓ |
| 纯本地通信模式 | 前端 EventBus 只负责浏览器内部的发布订阅。任何涉及后端的跨网络通信，子应用必须直接调用 DI 注入的 socketService 实例来 emit 和监听 (保持两套机制完全独立) | |

### Q2: 在前端 EventBus 流转的事件，其 Payload 结构设计应当如何？
| Option | Description | Selected |
|--------|-------------|----------|
| 统一 PlatformEvent 结构 | 统一采用与后端一致的 `PlatformEvent<T>` 结构 (包含 id, type, source, payload, timestamp 等元数据)，确保端到端类型完全一致且易于过滤和追踪 | ✓ |
| 简化的事件名 + data 传参 | 允许简化的 publish('event', data) 传参形式，仅在桥接到 Socket 时由宿主补全 Event 元数据 | |

### Q3: 如何管理子应用注册的 EventBus 监听器生命周期，确保在卸载时自动清理？
| Option | Description | Selected |
|--------|-------------|----------|
| 宿主侧自动代理与释放 | 宿主向子应用传入的 eventBus 是一个包装代理 (Proxy/Wrapper)，自动记录子应用的所有订阅，在子应用 unmount 时宿主自动释放它们 (最安全，对子应用开发者透明) | ✓ |
| 子应用完全手动管理 | 子应用在 mount 时收集所有的取消订阅函数 (unsubscribe)，并在其生命周期的 unmount 阶段显式调用它们 (开发者需要高度自律，遗忘会导致内存泄漏) | |

### Q4: 对于桥接到后端的跨网络事件，宿主前端是否需要进行权限与安全校验？
| Option | Description | Selected |
|--------|-------------|----------|
| 后端安全机制作为最终防线 | 前端宿主仅作为通道透传事件，由后端的 Socket.IO 处理器和后端 DI 容器能力守卫（CapabilityGuard）作安全鉴权 (逻辑集中在后端，前端更轻量) | ✓ |
| 前端宿主进行双重校验 | 在宿主转发 `server:*` 事件前，先检查该子应用的能力声明（Capabilities）是否被允许发送该类型的消息，如果不允许则在前端拦截 (安全性更高，但需要在前端维护权限映射) | |

### Q5: 当子应用订阅或取消订阅 `server:*` 跨网络事件时，宿主是否应当向服务器动态管理 Socket.IO 事件订阅？
| Option | Description | Selected |
|--------|-------------|----------|
| 动态按需订阅与引用计数 | 宿主 Socket.IO 维护一个事件订阅的引用计数。只有当至少有一个活跃子应用通过 EventBus 订阅了某个 `server:*` 事件时，宿主才向服务器端发起 Socket.IO 事件订阅请求；计数归零时，自动退订以节省服务器和网络带宽 | ✓ |
| 静态全量订阅 | 宿主在连接建立时静态注册所有可能的 Socket 监听事件，本地 EventBus 无条件接收并分发 (开发最简单，但在无子应用挂载时会浪费网络流量) | |

### Q6: 微前端子应用如果需要向后端请求数据并等待返回，应该首选哪种通道？
| Option | Description | Selected |
|--------|-------------|----------|
| 职责分离 | 鼓励子应用使用 DI 注入的 `IFrontendAPI` (基于 REST HTTP) 进行请求-响应式数据拉取，而 EventBus 专职用于单向的、广播式的实时事件通知 (最符合标准 Web 架构模式，职责极清晰) | ✓ |
| EventBus Request-Response | 在 EventBus 层面实现异步 Request-Response 封装：利用 PlatformEvent 中的 `correlationId` 字段，在 Socket 管道上双向发送请求并使用 Promise 等待回包 | |

### Q7: 当 EventBus 接收到事件时，对于同一个事件的多个订阅者，应该如何执行？
| Option | Description | Selected |
|--------|-------------|----------|
| 保持异步并发执行 | 保持异步并发执行：与现有后端 EventBus 设计一致，多个订阅者并发执行（Promise.all）。对于需要严格顺序的业务，由订阅者业务侧内部根据 PlatformEvent 的 timestamp / sequence 自行做排序和缓存 (保证总线高性能且防止单一订阅者卡死) | ✓ |
| 总线级串行保障 | 总线级串行保障：EventBus 在分发具有严格时序要求的事件时，必须按注册顺序串行 `await` 执行每个订阅者函数 | |

### Q8: 前端 EventBus 是否需要支持事件类型的通配符匹配订阅？
| Option | Description | Selected |
|--------|-------------|----------|
| 仅支持全量通配符 `*` | 仅支持全量通配符 `*`：与后端 EventBus 对齐，仅支持 `*` 订阅全部事件，不支持过于复杂的命名空间正则匹配，保持总线实现的高效与简洁 | ✓ |
| 支持命名空间级别通配符 | 支持命名空间级别通配符（如 `whiteboard:*`）：子应用可以通过命名空间一次性订阅相关的系列事件，由 EventBus 进行前缀匹配转发 | |

**Notes:** 通过对 `eventBus` 进行按需引用计数管理与自动销毁代理，既保证了微前端网络通信的高效，也降低了由于频繁挂载/卸载引入的内存泄漏。

---

## EventBus API 接口规范

### Q1: 前端微前端上下文（MfeContext）中的 EventBus 应当采用哪种 API 接口形式？
| Option | Description | Selected |
|--------|-------------|----------|
| 统一为 subscribe/publish 规范 | 标准化为 subscribe/publish 规范：`subscribe(event, handler) => () => void` (返回取消订阅函数) 和 `publish(event: PlatformEvent)`。这便于在 React 的 `useEffect` 清理函数中直接使用 (如 `return infra.eventBus.subscribe(...)`)，且与标准 pub/sub 模式高度一致 | ✓ |
| EventEmitter 风格 (on/off/emit) | 保留 EventEmitter 风格的 on/off/emit 规范：`on(event, handler)`, `off(event, handler)`, `emit(event, ...args)`。这与 Socket.IO 的命名风格一致，开发人员较熟悉 | |

### Q2: 是否应该在宿主侧为子应用提供专属的 React Hook 以便订阅 EventBus 事件？
| Option | Description | Selected |
|--------|-------------|----------|
| 提供 useMfeEvent Hook | 在宿主侧的 `src/mfe` 目录提供 `useMfeEvent` 自定义 Hook (例如 `useMfeEvent('event.type', handler)`)。该 Hook 内部获取 MfeContext，自动执行 `subscribe` 并处理 React 卸载时的取消订阅，对子应用开放导入 (极大地简化子应用中的 useEffect 样板代码) | ✓ |
| 不提供专属 Hook | 不提供专门的 Hook，子应用自行通过 raw API 结合 `useEffect` 编写逻辑 (保持宿主 API 极简，子应用有充分的实现自由) | |

### Q3: 在子应用 publish(event: PlatformEvent) 时，事件的 source 字段（事件源标识）应如何填充？
| Option | Description | Selected |
|--------|-------------|----------|
| 宿主代理自动补全 | 宿主代理自动补全：子应用拿到的 eventBus 代理在 `publish` 时自动拦截并注入 `source: mfe-name`，子应用调用时无需填写或可忽略该字段 (防止子应用冒充或写错 source) | ✓ |
| 子应用手动填写 | 子应用在 publish 时必须显式拼装完整的 PlatformEvent，自备正确的 `source` 属性 (宿主不做拦截重写，保持原样传递) | |

### Q4: 前端 EventBus 的 publish 方法应当返回 Promise 还是 void？
| Option | Description | Selected |
|--------|-------------|----------|
| 返回 `Promise<void>` | 返回 `Promise<void>`：与后端 EventBus 保持高度一致。虽然大多数情况是“发完即忘”，但也允许发布者在特殊场景下（如协调多个组件的销毁顺序）通过 await 确保处理函数全部执行完毕 | ✓ |
| 返回 `void` (Fire-and-Forget) | 返回 `void`（同步非阻塞，Fire-and-Forget）：发布事件后立即返回，任何事件处理函数的执行都对发布者透明，彻底避免发布者由于 await 耗时操作而阻塞 UI 交互线程的风险 | |

**Notes:** 标准化为 `subscribe` (返回取消函数) 与 `publish` (返回 Promise) 是 React 开发体验和多端规范一致性的最佳选择。

---

## DI 服务注册表 (ServiceRegistry) 的暴露范围与安全隔离

### Q1: 宿主应当向子应用注入怎样暴露范围的 DI 服务注册表？
| Option | Description | Selected |
|--------|-------------|----------|
| 代理隔离模式 | 代理隔离模式：宿主为每个子应用注入一个包装后的 `ServiceRegistry` 代理，只允许其 resolve 获取白名单中的前端公共服务 Token（如 API、Socket、UI、Storage 等），尝试获取私有 Token 会在前端抛出拒绝访问的权限异常 (构筑微前端间的第一道防线) | ✓ |
| 全量共享模式 | 直接将宿主的 `FrontendServiceRegistry` 实例透传给子应用，子应用能够自由解析并调用宿主注册的所有服务 (极其简便，无任何过滤开销，但子应用可能通过 DI 破坏宿主内部服务状态) | |

### Q2: 子应用拿到的 DI 服务注册表代理，是否应当允许注册或注销服务（写操作）？
| Option | Description | Selected |
|--------|-------------|----------|
| 仅读访问限制 (只读代理) | 仅读访问限制（只读代理）：子应用拿到的 ServiceRegistry 代理只包含 `resolve` / `get` / `has` 方法，且只允许查询白名单服务，完全屏蔽 `register` 和 `unregister` 写入接口 (确保子应用不能注入或破坏容器，保持服务空间的单向依赖与纯净) | ✓ |
| 隔离性注册空间 | 隔离性注册空间：子应用的代理除了白名单服务，还允许注册自己的服务，但会自动加上子应用名称前缀隔离 | |

### Q3: 如果子应用尝试解析（resolve）一个白名单内但宿主尚未注册的公共服务，应当如何处理？
| Option | Description | Selected |
|--------|-------------|----------|
| 抛出标准 DI 异常 | 抛出标准 DI 异常：如果服务未注册，立即抛出 `Error("No provider registered for token: ...")`，由子应用的错误边界（MfeErrorBoundary）统一拦截并降级渲染 (符合 DI 标准，使遗漏依赖在开发期立即可知) | ✓ |
| 静默返回 undefined | 静默返回 undefined：如果该服务目前未被宿主注册，静默返回 undefined，并在 console 中记录警告，允许子应用自行降级 | |

### Q4: 如何定义和管理可以被子应用访问的公共服务白名单列表？
| Option | Description | Selected |
|--------|-------------|----------|
| 配置化白名单 | 配置化白名单：在宿主 `MfeContextProvider` 内部定义一个静态数组配置该白名单，如果未来宿主新增了其他需要共享的公共服务，直接在数组中追加 Token 字符串即可 (灵活且维护方便) | ✓ |
| 强硬编码写死 | 强硬编码写死：直接在 Proxy 拦截条件中写死这 4 个 Token 常量，杜绝任何外部或动态扩展，确保最高的安全性防护 | |

**Notes:** 通过只读 Proxy 对 `FrontendServiceRegistry` 进行安全隔离和白名单校验，实现了微前端沙箱安全的最小特权原则。

---

## the agent's Discretion
- 所有领域均与用户进行了交互式对齐，没有使用 AI 自主决定事项。

## Deferred Ideas
- 无 — 讨论完全局限于阶段范围内。
