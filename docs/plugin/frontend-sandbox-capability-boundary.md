# 远程前端插件：执行环境、能力边界与路线

<!-- doc-version: sdk=3.7.5 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.5` / 平台 `v0.7.1+`
> 本页说明**远程（process 沙箱）前端插件**在当前架构下真实能做什么、不能做什么，
> 以及已确认的后续路线。目的是让插件作者与平台维护者对同一份事实达成一致。

---

## 1. 一句话结论

**第三方前端插件采用「双轨制 UI 架构」：后台逻辑在隐藏沙箱执行，自定义 UI 经独立可视沙箱（Visual Sandbox Container）安全呈现。**

插件不能向宿主直接注入 React 组件函数（防范 XSS 与 DOM 污染），但可以在 `manifest.json` 声明 `view` 相对路径（如 `"dashboard.html"`），由宿主在面板区以严格安全沙箱 iframe 挂载，并通过客户端桥接 SDK（`/plugin-sandbox/view-bridge.js`，`window.OpenLearnPluginBridge`）与宿主进行双向通信与状态同步。

---

## 2. 执行环境

| 维度           | 后台逻辑沙箱 (`frontend.js`)                               | 可视视图沙箱 (`view` HTML)                                                                         |
| -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 宿主容器       | 隐藏 iframe（`/plugin-sandbox/frame`）                     | 可视沙箱 iframe（`<PluginSandboxIframeView />`）                                                   |
| iframe 属性    | `sandbox="allow-scripts"` (opaque origin)                  | `sandbox="allow-scripts allow-forms allow-downloads"`（opaque origin，**无** `allow-same-origin`） |
| `window` realm | **与父页面隔离** —— iframe 内 `window.HostSharedDeps` 为空 | **与父页面隔离** —— 独立 DOM 树，不污染宿主样式与全局对象                                          |
| 可见性         | `display: none`（隐藏执行后台逻辑）                        | **可见**（嵌入 `teacher.tab` / `teacher.panel` 等面板区）                                          |
| DOM 访问       | 无权读取或改写宿主 DOM                                     | 无权读取或改写宿主 DOM（但可自由操作自身页面内的 DOM）                                             |
| 通信机制       | `ol-plugin-frame` postMessage RPC                          | `ol-plugin-view` postMessage RPC（`window.OpenLearnPluginBridge`）                                 |
| 网络与 CSP     | `default-src 'none'; connect-src 'none'`（无网络）         | `PLUGIN_VIEW_CSP`（允许自身脚本/样式/媒体，强制 `frame-ancestors 'self'`）                         |

源码：`server/utils/plugin-sandbox-frame.ts`、`server/utils/plugin-view-bridge.ts`、`src/components/PluginSandboxIframeView.tsx`。

---

## 3. 能力边界

### 3.1 远程插件**能**做的（iframe 内 ctx 全量）

| 能力                            | 说明                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| 可视沙箱视图 (`view: "..."`)    | 经 manifest `contributes` 声明相对路径 HTML，在独立可视沙箱 iframe 中呈现完整 UI |
| `ctx.services.frontendApi`      | `get` / `post` / `del`，经父页面代发，受方法策略与能力声明约束                   |
| `ctx.services.storageService`   | 按 `manifest.id` 命名空间隔离的键值存储                                          |
| `ctx.invokeCommand`             | 经 `POST /api/plugins/:id/sandbox-command` 派发，actor 由服务端绑定              |
| `ctx.ui.showToast`              | 宿主代发 toast                                                                   |
| `ctx.ui.registerExtensionPoint` | **仅数据型**（见 3.2）                                                           |
| `ctx.context.get`               | 当前 `lessonId` / `classId`                                                      |

### 3.2 远程插件**不能**做的

| 不能做                              | 原因                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 直接向宿主传递**自定义 React 组件** | `ctx.ui.registerExtensionPoint(slot, { component })` 的 `component` 是函数，postMessage 无法结构化克隆 → 传函数直接 `DataCloneError`。第三方插件的自定义界面应使用独立的 `view` 可视沙箱页面交付 |
| 突破 iframe 沙箱访问宿主 DOM        | 沙箱 iframe 受限于严格浏览上下文，无权读取或改写父页面 DOM（保障宿主系统级安全）                                                                                                                 |
| 使用宿主的 `window.HostSharedDeps`  | realm 隔离，iframe 内为 `undefined`（详见 `plugin-host-shared-deps.md` §0）                                                                                                                      |
| 让 `import React from 'react'` 生效 | 宿主转译成 `window.HostSharedDeps.React` 后在 iframe 内求值为 `undefined` → 激活抛 `Cannot read properties of undefined`                                                                         |

### 3.2.1 网络与实时性：iframe 内没有网络，实时性只能轮询

上文表只回答「能不能渲染 UI」。还有一条同样致命、但更容易踩的边界：**iframe 内没有网络**。

沙箱页面的 CSP 由宿主写死（`server.ts` 的 `/plugin-sandbox/frame` 路由）：

```text
default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; style-src 'none'; img-src 'none'; frame-ancestors 'self'
```

`connect-src 'none'` 的结果很直接：

| 想做的事                           | 实际结果                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `fetch(...)` / `XMLHttpRequest`    | 被 CSP 拦下，控制台报 `Refused to connect`；宿主的 API 也连不上                   |
| 自带 `socket.io-client` 建立长连接 | 同样被拦；沙箱里没有任何可用的出站通道                                            |
| 等宿主把课堂事件推给 iframe        | 宿主只向 iframe 发三种消息：`load` / `reply` / `deactivate`，**没有事件推送通道** |
| 调用桥接层未登记的 op              | 抛 `Unsupported sandbox bridge op "<op>"`                                         |

可用的替代只有一条路 —— **全部经宿主代发**。沙箱桥接层只接受 10 个 op
（`api.get|post|del`、`storage.get|set|delete`、`ui.register`、`ui.toast`、`command.invoke`、`context.get`）：

- 读写数据：`ctx.services.frontendApi.get/post/del`、`ctx.services.storageService.*`
- 派发命令：`ctx.invokeCommand(type, payload)`

**因此「实时同步」只能轮询**（建议 2–5 秒，按命令成本权衡）：

```ts
async function startPolling(ctx: SandboxFrontendContext, onState: (s: unknown) => void) {
  const tick = async () => {
    const r = await ctx.services.frontendApi.get('/my-plugin/state');
    if (r.success) onState(r.result);
  };
  await tick();
  const timer = setInterval(tick, 3000);
  // activate 的返回值不会被沙箱回收，定时器必须在 deactivate() 里清掉
  return () => clearInterval(timer);
}
```

用户反馈同理：iframe 内唯一可用的提示通道是 `ctx.ui.showToast(...)`（宿主代发），
可见界面只能来自 manifest 声明式贡献。设计「课堂实时互动」类插件时，
请先在架构上接受「轮询 + 宿主代发」这一前提，而不是事后把它当 bug 排查。

### 3.3 与「层 2」的矛盾（能力边界 vs 沙箱安全）

要让插件的 **React 组件**出现在宿主页面，插件代码必须回到**父 realm** 执行 ——
这与 PL-02 沙箱的安全目标直接冲突。postMessage 无法跨越这条线（函数不可克隆）。

因此「远程插件自定义 React UI」不是 bug，而是**尚未做出的产品决策**。

---

## 4. 已确认的产品方向：声明式 slot DSL

**决策（v0.7.0）**：远程插件的可见 UI 走**声明式**路线 —— manifest 描述 UI 结构与数据
schema，宿主用自己的 React 渲染；插件只提供数据与命令，不提供组件。

理由：

1. **与沙箱安全目标天然兼容** —— 插件代码始终留在 iframe 内，宿主只渲染自己认识的结构。
2. **插件作者体验更好** —— 不需要理解 React 实例、Context、Portal。
3. **顺带消灭层 1 依赖注入问题** —— 插件不再需要 React 运行时，
   `window.HostSharedDeps` 的 realm 隔离不再是障碍。

实现要点（待立项）：

- manifest 新增结构化 `contributes` 描述（slot + 视图类型 + 字段绑定 + 命令引用）；
- 宿主侧新增对应的渲染器，消费声明式描述；
- `commandType` 继续沿用现有的 manifest 命名空间前缀规则
  （`packages/core/plugin-host/plugin-namespace.ts`）。

---

## 5. 待修项清单（按优先级）

| 编号 | 事项                                                                                    | 状态                 |
| ---- | --------------------------------------------------------------------------------------- | -------------------- |
| A    | 熔断/激活失败时**保留** manifest 声明式贡献，给出显式错误态与重试（不再「闪现后消失」） | ✅ 已于 v0.7.0 落地  |
| B    | 文档纠偏：不再教用户把 remote 插件的 react 设为 external                                | ✅ 已于 v0.7.0 落地  |
| C    | 层 1 依赖注入：父页面按需把 React 运行时送入 iframe，或改走「插件自打包」               | ⏳ 待立项            |
| D    | 层 2 双轨制 UI：独立可视沙箱容器与双向视图桥接（Phase 1）                               | ✅ 已于 v0.7.6+ 落地 |
| D2   | 层 2 声明式结构化 DSL 渲染（Phase 2，复杂数据项按需推进）                               | ⏳ 待立项            |
| E    | SDK CLI 前端 externals 预置可配置（默认按执行环境给出正确建议，或直接自打包）           | ⏳ 待立项            |

---

## 6. 关联文档

- `docs/reference/plugin-host-shared-deps.md` —— 共享依赖白名单与执行环境前提。
- `docs/reference/plugin-ui-extension-slots.md` —— 各 UI 扩展槽位的 Props 上下文。
- `docs/plugin/plugin-security-migration.md` —— 前端沙箱安全边界。
- `docs/plugin/plugin-manifest-spec.md` —— manifest schema。

> 最后更新：2026-10-28（v0.7.6+：双轨制 UI 架构 Phase 1 落地）
