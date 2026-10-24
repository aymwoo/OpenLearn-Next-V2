# 远程前端插件：执行环境、能力边界与路线

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0` / 平台 `v0.7.1+`
> 本页说明**远程（process 沙箱）前端插件**在当前架构下真实能做什么、不能做什么，
> 以及已确认的后续路线。目的是让插件作者与平台维护者对同一份事实达成一致。

---

## 1. 一句话结论

**远程前端插件目前是一个「隐藏的、无 UI 的逻辑执行体」。** 它的可见价值来自
manifest 声明式贡献（由宿主渲染），而不是它自己的前端代码。

---

## 2. 执行环境

| 维度           | 事实                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| 宿主页面       | `frontend.js` 源码由父页面 fetch 后经 postMessage 送入 iframe                                   |
| iframe 源      | `/plugin-sandbox/frame`，`sandbox="allow-scripts"`（**无** `allow-same-origin`）→ opaque origin |
| `window` realm | **与父页面隔离** —— iframe 内 `window.HostSharedDeps` 为 `undefined`                            |
| 可见性         | `frame.style.display = 'none'` —— **隐藏**，插件不能渲染任何用户可见内容                        |
| DOM 访问       | 无权读取或改写宿主 DOM                                                                          |
| 网络           | iframe CSP 禁止 `connect`；插件自身不能发请求，只能经 RPC 桥调用宿主代发                        |
| 加载机制       | 父页面送源码 → iframe 内 `new Blob([source])` → `import(url)`（CSP 已允许 `blob:`）             |

源码：`server/utils/plugin-sandbox-frame.ts`、`src/plugin-host/plugin-host.ts` 的
`mountSandboxFrame` / `activateRemotePlugin`。

---

## 3. 能力边界

### 3.1 远程插件**能**做的（iframe 内 ctx 全量）

| 能力                            | 说明                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| `ctx.services.frontendApi`      | `get` / `post` / `del`，经父页面代发，受方法策略与能力声明约束      |
| `ctx.services.storageService`   | 按 `manifest.id` 命名空间隔离的键值存储                             |
| `ctx.invokeCommand`             | 经 `POST /api/plugins/:id/sandbox-command` 派发，actor 由服务端绑定 |
| `ctx.ui.showToast`              | 宿主代发 toast                                                      |
| `ctx.ui.registerExtensionPoint` | **仅数据型**（见 3.2）                                              |
| `ctx.context.get`               | 当前 `lessonId` / `classId`                                         |

### 3.2 远程插件**不能**做的

| 不能做                              | 原因                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提供**自定义 React 组件**           | `ctx.ui.registerExtensionPoint(slot, { component })` 的 `component` 是函数，postMessage 无法结构化克隆 → 传函数直接 `DataCloneError` 导致激活失败 |
| 渲染任何**可见 UI**                 | 沙箱 iframe 是 `display: none` 的隐藏执行体；插件无权访问宿主 DOM                                                                                 |
| 使用宿主的 `window.HostSharedDeps`  | realm 隔离，iframe 内为 `undefined`（详见 `plugin-host-shared-deps.md` §0）                                                                       |
| 让 `import React from 'react'` 生效 | 宿主转译成 `window.HostSharedDeps.React` 后在 iframe 内求值为 `undefined` → 激活抛 `Cannot read properties of undefined`                          |

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

| 编号 | 事项                                                                                    | 状态                  |
| ---- | --------------------------------------------------------------------------------------- | --------------------- |
| A    | 熔断/激活失败时**保留** manifest 声明式贡献，给出显式错误态与重试（不再「闪现后消失」） | ✅ 已于 v0.7.0 落地   |
| B    | 文档纠偏：不再教用户把 remote 插件的 react 设为 external                                | ✅ 已于 v0.7.0 落地   |
| C    | 层 1 依赖注入：父页面按需把 React 运行时送入 iframe，或改走「插件自打包」               | ⏳ 待立项             |
| D    | 层 2 声明式 slot DSL：manifest 描述 UI，宿主渲染                                        | ⏳ 待立项（方向已定） |
| E    | SDK CLI 前端 externals 预置可配置（默认按执行环境给出正确建议，或直接自打包）           | ⏳ 待立项             |

> 关于 C 的取舍：若 D 走声明式路线，插件不再需要 React 运行时，
> 「宿主注入」与「插件自打包」都不再是必需品 —— 可只保留 C 作为 D 之前的过渡方案。

---

## 6. 关联文档

- `docs/reference/plugin-host-shared-deps.md` —— 共享依赖白名单与执行环境前提。
- `docs/reference/plugin-ui-extension-slots.md` —— 各 UI 扩展槽位的 Props 上下文。
- `docs/plugin/plugin-security-migration.md` —— 前端沙箱安全边界。
- `docs/plugin/plugin-manifest-spec.md` —— manifest schema。

> 最后更新：2026-10-24（v0.7.0：能力边界与路线定稿）
