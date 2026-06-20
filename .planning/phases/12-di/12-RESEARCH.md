# Phase 12 Research: 宿主状态共享与 DI 桥接

## 1. Domain & Boundaries (领域与边界)

### In-Scope (处于范围内)
- **MfeContext 契约更新**：在 `src/mfe/types.ts` 和 `src/mfe/MfeContextProvider.tsx` 中标准化 MfeContext 接口，并引入 `PlatformEvent` 等类型。
- **Zustand 宿主状态重构**：创建独立的全局 Zustand 状态管理存储（如 `useAppStore`），从宿主 `App.tsx` 中抽取并移植核心业务状态（如课程列表 `lessons`、班级列表 `classes`、用户信息 `session`、白板图层 `elements` 等），并在 `MfeContextProvider` 中将该 store 实例传入上下文。
- **EventBus 包装代理 (MfeEventBusWrapper)**：
  - 子应用 `publish` 时拦截并补全 `source: mfe-name`，校验并拦截 `server:*` 前缀事件，将其自动转发至 Socket 通道 (`socket.emit`)。
  - 自动管理子应用的所有 `subscribe` 调用，在组件或应用 `unmount` 时自动调用返回的取消订阅函数，防止内存泄漏。
- **Socket 事件引用计数与桥接 (SocketBridge)**：
  - 基于引用计数机制，当且仅当至少有一个活跃子应用订阅了 `server:xxx` 事件时，宿主才订阅对应的后端 Socket 事件；计数归零时自动退订。
  - 收到后端推送时，自动将消息封装为 `PlatformEvent` 并推入本地前端 EventBus 分发。
- **DI 注册表只读代理 (MfeServiceRegistryProxy)**：
  - 封装 `FrontendServiceRegistry`，仅暴露只读查询方法 `resolve`、`get`、`has`。
  - 通过配置化白名单（DI_WHITELIST）进行拦截，非白名单服务抛出权限异常；白名单内服务若宿主未注册，抛出标准 DI 异常供 MfeErrorBoundary 降级捕获。
- **`useMfeEvent` Hook 助手**：在 `src/mfe/useMfeEvent.ts` 提供对 EventBus 订阅生命周期的 React 封装，降低子应用编写 useEffect 样板代码的开销。

### Out-of-Scope (处于范围外)
- **子应用视图代码重构**：本阶段只构建桥接通道，不包含白板 (whiteboard) 和课件 (courseware) 视图的代码抽取和微应用拆分（这些在 Phase 13 完成）。
- **后端 Socket 安全与鉴权修改**：不改变后端的 Socket.IO 鉴权模型，EventBus 跨网络传输的鉴权完全依赖现有的后端能力守卫 (CapabilityGuard) 与 Socket 处理器。
- **Shadow DOM 影子样式沙箱隔离**：本阶段不涉及影子 DOM (Shadow DOM) 的注入和样式安全环境隔离（已推迟）。

---

## 2. Technical Approach (技术方案)

### 2.1 Zustand 状态共享与订阅机制

#### 方案对比
- **方案 A：宿主 useState 原生状态导出为 Store-like Plain Object**  
  - *优点*：App.tsx 重构代价极小，开发周期短。  
  - *缺点*：缺乏 selector 粒度订阅。每次状态变动都会触发子应用全量渲染，且无法使用 `useStore` 钩子，违反决策 D-01。
- **方案 B：独立实例化 Zustand Store (`useAppStore`) 并通过 Context 共享 (已选)**  
  - *优点*：状态强同步，完全符合 Zustand 规范，支持精细化 selector 订阅 (`useStore(infra.store, selector)`)；Zustand `useStore` 会随组件生命周期自动清理，杜绝内存泄漏。  
  - *缺点*：需要重构宿主 App.tsx 中 160 余个 useState 钩子的核心部分。

#### 详细架构设计
1. 创建 `src/store/appStore.ts`，定义核心业务状态 `AppState`：
   ```typescript
   export interface AppState {
     lang: Language;
     session: SessionType | null;
     lessons: Lesson[];
     selectedLesson: string | null;
     elements: WhiteboardElement[];
     classes: ClassType[];
     students: StudentType[];
     liveClassSelectedClassId: string | null;
     liveClassIsActive: boolean;
     // ... 其他核心 useState 状态
     
     // 对应的状态修改方法 (Actions)
     setLang: (lang: Language) => void;
     setSession: (session: SessionType | null) => void;
     // ...
   }
   ```
2. 使用 `createStore` (Vanilla store) 创建全局实例，这样能保证此 store 可以脱离 React context 被子应用原生订阅：
   ```typescript
   import { createStore } from 'zustand/vanilla';
   export const appStore = createStore<AppState>((set) => ({ ... }));
   ```
3. 在宿主侧封装便捷 React Hook 供宿主使用：
   ```typescript
   import { useStore } from 'zustand';
   export const useAppStore = <T>(selector: (state: AppState) => T) => useStore(appStore, selector);
   ```
4. 将 `appStore` 实例通过 `<MfeContextProvider value={{ store: appStore, ... }}>` 传入上下文。子应用内使用 `useStore(infra.store, selector)` 直接订阅。

---

### 2.2 前端 EventBus 与 Socket 桥接策略

为了支持 `server:*` 事件的拦截、转发与引用计数，需要在宿主引入一个集中式协调器 `SocketBridge`，并在 `MfeLoaderCore` 的生命周期中挂载 `MfeEventBusWrapper` 实例。

#### 详细设计方案
1. **`SocketBridge` 实现**：
   维护 `Map<string, number>` 记录各个 `server:xxx` 事件的当前订阅计数，以及 `Map<string, Function>` 存储对应的 Socket 监听包装函数。
   - `register(eventType)`: 当计数从 0 变为 1 时，调用 `socketService.on(socketEvent, handler)`。收到 Socket 推送时，构建 `PlatformEvent`（自动生成 UUID，设置 `source: 'server'`，拼装 payload，带上 timestamp）并调用 `hostEventBus.publish(event)`。
   - `unregister(eventType)`: 当计数归 0 时，调用 `socketService.off(socketEvent, handler)` 并移除 handler 映射。
2. **`MfeEventBusWrapper` 实现**：
   - 实例化时传入当前微前端名称 `mfeName`。
   - `subscribe` 时将订阅方法与取消订阅的 cleanup 动作记录在内部的 `activeSubscriptions` 数组中。如果订阅事件是 `server:*`，则调用 `socketBridge.register(event)`。
   - 返回一个退订函数，该函数会调用 `hostEventBus.unsubscribe`，如果是 `server:*` 事件则调用 `socketBridge.unregister(event)`。
   - `publish` 方法：拦截事件。若为 `server:*` 事件，截断前缀，提取 payload 直接调用 `socketService.emit(socketEvent, payload)`；若为普通事件，补齐 `source: mfeName`、`id` 与 `timestamp`，然后通过 `hostEventBus.publish` 广播。
   - `cleanup` 方法：在子应用被卸载时执行，循环调用所有已记录的退订函数，保证事件处理器与 Socket 链路被彻底释放。

---

### 2.3 DI 服务注册表安全与隔离

#### 方案对比
- **方案 A：基于 ES6 Proxy 拦截对象读写**  
  - *优点*：动态拦截所有未定义属性，逻辑极其精简。  
  - *缺点*：在编译期子应用缺少清晰的 TS 类型定义，且容易因未拦截的方法造成越权。
- **方案 B：只读 Wrapper 类装饰模式 (已选)**  
  - *优点*：只定义 `resolve`, `get`, `has`，从物理代码上完全抹除 `register` / `unregister` 的调用通道。在 `types.ts` 中提供强类型描述，编译期安全极高，且完全满足 D-15/D-16/D-17。
  - *缺点*：稍微多写一些转发代码。

#### 详细设计方案
```typescript
const DI_WHITELIST = [
  '@openlearn/frontend:IFrontendAPI',
  '@openlearn/frontend:ISocketService',
  '@openlearn/frontend:IUIService',
  '@openlearn/frontend:IStorageService'
];

export class MfeServiceRegistryProxy {
  private serviceRegistry: FrontendServiceRegistry;

  constructor(serviceRegistry: FrontendServiceRegistry) {
    this.serviceRegistry = serviceRegistry;
  }

  private verifyWhitelist(token: string) {
    if (!DI_WHITELIST.includes(token)) {
      throw new Error(`Access Denied: Service token "${token}" is private to the Host Shell and cannot be resolved by Remote Micro Frontends.`);
    }
  }

  async resolve<T>(token: string): Promise<T> {
    this.verifyWhitelist(token);
    return this.serviceRegistry.resolve<T>(token);
  }

  get<T>(token: string): T | undefined {
    this.verifyWhitelist(token);
    const servicesMap = (this.serviceRegistry as any).services;
    if (servicesMap && servicesMap.has(token)) {
      return servicesMap.get(token) as T;
    }
    return undefined;
  }

  has(token: string): boolean {
    this.verifyWhitelist(token);
    return this.serviceRegistry.has(token);
  }
}
```

---

## 3. Validation Architecture

为确保桥接机制的正确性、稳定性和防止内存泄漏，需在实施阶段设计三层验证模型。

### 3.1 单元与集成测试 (Automated Testing)
使用 `Vitest` 编写自动化测试套件。

1. **`MfeEventBusWrapper` 与 `SocketBridge` 集成测试**：
   - 模拟 `SocketService` 和 `hostEventBus`。
   - 验证 MFE 订阅 `server:test-event` 时，`socketService.on` 的引用计数行为：计数从 0 变 1 时调用监听，从 1 变 2 时不再调用，退订归 0 时调用 `socketService.off`。
   - 验证 `publish` 时 `source` 自动补全为子应用名称。
   - 验证子应用卸载时自动调用退订函数，清除所有事件监听器。
2. **`MfeServiceRegistryProxy` 安全白名单测试**：
   - 测试调用白名单服务（如 `@openlearn/frontend:IFrontendAPI`）能够正常解析。
   - 测试调用非白名单服务抛出 `Access Denied` 权限异常。
   - 测试白名单内但宿主未注册的服务，抛出标准 DI 异常 (`No provider registered for token: ...`)。
3. **Zustand 状态同步测试**：
   - 验证宿主状态更新后，通过 `useStore(infra.store, selector)` 能够接收到最新值。
   - 验证在组件卸载后，对应的组件级 Zustand 订阅被自动释放，无残留监听器。

### 3.2 手动集成与 UAT 校验 (Manual UAT)
1. **控制台及网络 Tab 联动监控**：
   - 在宿主 `HelpTabContent` 页面中，触发具有 `server:*` 前缀的广播命令（如 `server:whiteboard-update`）。
   - 查看宿主控制台和网络 Tab，确认没有因 EventBus 事件产生死循环或多次重复监听的问题。
2. **内存泄漏检测验证 (Leak Detector Verification)**：
   - 挂载子应用，发起 10 次 EventBus 和 Socket 订阅，然后卸载该子应用。
   - 借助 `createLeakDetector` 和 Chrome DevTools Heap Snapshot，确认卸载后没有遗留的 wrapper 闭包、事件 handler 或未释放的 socket 侦听函数。

---

## 4. Codebase Patterns & Reusable Assets (代码库模式与复用资产)

### 4.1 可复用资产 (Reusable Assets)
- **`EventBus` 类 (`packages/core/event-bus/index.ts`)**：作为前端 EventBus 实例的基类，提供通用的事件订阅、发布和通配符广播能力。
- **`FrontendServiceRegistry` 类 (`src/plugin-host/service-registry.ts`)**：提供扁平的 DI 服务容器，作为只读代理包装的源对象。
- **`PlatformEvent` 接口 (`packages/core/event-bus/index.ts`)**：保证宿主与子应用流转的所有事件参数契约一致。
- **Zustand 依赖单例 (`package.json`)**：复用共享的 `zustand` 库以保证 `useStore` 能够无缝在两端识别同一个 vanilla store 实例。

### 4.2 需遵循的模式 (Established Patterns)
- **Module Federation Singleton Config**：遵循 Phase 10 中确立的 react/react-dom/zustand 的 `singleton: true` 及 `strictVersion: false` 共享机制，防止因多实例加载导致 Hook 异常。
- **MfeContext 的 useMfeContext 导出模式**：遵循 `src/mfe/useMfeContext.ts` 的结构，包装 config 与 infra 并返回，屏蔽 React Context 的原始 `useContext` 实现细节。
- **Error Boundary 隔离模式**：依赖 `src/mfe/MfeErrorBoundary.tsx` 捕获子应用生命周期及 DI 权限异常，进行容灾渲染。

---

## 5. Integration Points (集成点)

### 5.1 契约更新点
- **`src/mfe/types.ts`**：
  - 更新 `MfeContext` 的类型定义，用强类型的 `eventBus`（含 `subscribe` 与 `publish`）、`serviceRegistry`（只读方法）和 `store`（vanilla store 实例）覆盖旧占位定义。
- **`src/mfe/MfeContextProvider.tsx`**：
  - 去除本地 `MfeContext` 重复接口定义，统一从 `types.ts` 导入。
  - 在 `MfeContextProvider` 中，允许在组件挂载时通过 reference-counting 机制实例化并挂载全局 `SocketBridge`。

### 5.2 状态重构点
- **`src/App.tsx`**：
  - 提取原有核心业务状态（lessons, classes, session 等）移植到新建立的 `src/store/appStore.ts`。
  - 在 `App` 渲染入口，用 `MfeContextProvider` 包裹子节点，并将 `appStore` 传入 `value.store`。
  - 替换 `App.tsx` 内部大量读写这些状态的 `useState` 和 `setXXX` 调用为 Zustand 的 `useAppStore` 读写及 actions 调用。

### 5.3 动态加载注入点
- **`src/mfe/MfeLoaderCore.tsx`**：
  - 引入并调用 `useMfeInfraContext()` 获取宿主的 infra 环境。
  - 在远程模块加载后的 Effect 内部，实例化该 Remote 应用专属的 `MfeEventBusWrapper` 与 `MfeServiceRegistryProxy`。
  - 将包装后的本地 proxies 和 `infra.store` 装配为 `mfeContext` 对象传入 `mod.createMfeApp(mfeContext)`。
  - 在 `cleanup` 函数中，调用本地 `eventBusWrapper.cleanup()`，自动清除微前端生命周期内发起的所有订阅。

### 5.4 新增功能点
- **`src/mfe/useMfeEvent.ts`**：
  - 新增通用的 `useMfeEvent` 钩子，方便子应用在组件层以生命周期绑定的方式订阅 EventBus 事件。
