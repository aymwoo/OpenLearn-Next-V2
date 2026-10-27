# 宿主共享依赖白名单 (HostSharedDeps)

<!-- doc-version: sdk=3.7.2 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.2` / 平台 `v0.7.1+`
> 本页说明打包前端插件时**推荐 external（由宿主提供）** 的宿主全局库，及其精确版本，防止因重复打包导致包体积过大或 "Invalid hook call" 等重复加载错误。

---

## 0. ⚠️ 首要前提：先确认插件的执行环境（v0.7.0 勘误）

**`window.HostSharedDeps` 只注入到宿主父页面。** 远程插件的前端代码运行在
`sandbox="allow-scripts"` 的**不透明源 iframe** 中（源为 `/plugin-sandbox/frame`），
iframe 有独立的 `window` realm —— 它拿不到父页面的 `window.HostSharedDeps`，
读到的值是 `undefined`。

因此「把 react 设为 external，由宿主提供」这条规则**有执行环境前提**：

| 执行模式                  | 与宿主同 realm？  | `window.HostSharedDeps` 可用？ | external react 的结果         |
| ------------------------- | ----------------- | ------------------------------ | ----------------------------- |
| 内联（inline）            | ✅ 是             | ✅ 是                          | 正常：宿主提供唯一 React 实例 |
| 远程沙箱（process，默认） | ❌ 否             | ❌ 否（`undefined`）           | ❌ **必然激活失败**，见下     |
| Worker                    | ❌ 否（独立线程） | ❌ 否                          | 同上                          |

### 远程前端插件的失败形态

宿主的转译器 `transformBareModuleImports` 会把裸导入改写成 `window.HostSharedDeps.React`
之类的引用（这是**父页面**执行的改写），改写后的源码再经 postMessage 送进 iframe 执行。
iframe 内的 `window.HostSharedDeps` 仍是 `undefined` → 插件激活时抛：

```
Cannot read properties of undefined (reading 'React')
```

而 SDK CLI 对前端构建**强制**注入 `external: ['react','react-dom','recharts','lucide-react']`
（`packages/plugin-sdk/cli.mjs`），产物必含裸导入 → **用官方 CLI 构建的远程前端插件，只要用到
React/JSX 就必然激活失败**。这是工具链与运行时的断裂，已登记为待修回归
（路线见 `docs/plugin/frontend-sandbox-capability-boundary.md`）。

### 远程前端插件当前可行的构建方式

**把 React 打进自己的 bundle（不要 external）**：

```js
// 自建前端 bundle（不走 SDK CLI 的前端 externals 预置）
esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  format: 'esm',
  // 注意：这里**不要**把 react / react-dom 列进 external
  external: ['@openlearn/plugin-sdk'],
});
```

代价是包体积增大（react + react-dom 约 150 KB min/gzip 后约 45 KB）。
收益是 iframe 内 React 自洽，激活可成功。

> 另注：远程插件的前端 **不提供可见 UI**。沙箱 iframe 是 `display: none` 的隐藏执行体，
> 插件代码无权访问宿主 DOM。可见的界面只能来自 **manifest 声明式贡献**（`contributes`），
> 由宿主用自己的 React 渲染。详见 `docs/plugin/frontend-sandbox-capability-boundary.md`。

---

## 1. 宿主全局提供的共享库

宿主在运行时通过全局对象 `window.HostSharedDeps` 注入并暴露基础前端运行时，供**与宿主同 realm
执行**的前端插件（ESM Bundle）动态复用：

```
react, react-dom, react-dom/client, react/jsx-runtime, recharts, lucide-react
```

### 多层保障机制：

- **运行时 `window.HostSharedDeps`**（`src/main.tsx`）：
  ```ts
  (window as any).HostSharedDeps = {
    React,
    ReactDOM,
    ReactDOMClient,
    Recharts,
    LucideReact,
    jsxRuntime: JsxRuntime,
    react: React,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
    'react/jsx-runtime': JsxRuntime,
    recharts: Recharts,
    'lucide-react': LucideReact,
  };
  ```
- **前端动态导入转译器 (`transformBareModuleImports`)**（`src/plugin-host/plugin-host.ts`）：
  当前端插件 `frontend.js` 包含对上述共享库的裸模块导入时，宿主在执行 Blob URL 动态导入前会自动执行 ESM 语法转译，全面兼容：
  - 复合默认 + 具名导入（如 `import React, { useState, useEffect } from "react"`）
  - 别名转换（如 `import { useState as useState2 } from "react"` 转译为对象解构 `{ useState: useState2 }`，避免语法错误）
  - 命名空间导入（如 `import * as React from "react"`）
  - 纯具名/纯默认导入与副作用导入（`import "react"`）
- **SDK 构建 CLI 预置 externals 数组**（`packages/plugin-sdk/cli.mjs`）：
  ```js
  ...buildOpts(frontendEntry, join(distDir, 'frontend.js'), ['react', 'react-dom', 'recharts', 'lucide-react'])
  ```
  > ⚠️ 该预置仅对**内联**执行环境成立。远程沙箱插件请按 §0 自建 bundle。

> **非白名单依赖提示**：若插件 `import` 了 `react-konva`、`konva`、`socket.io-client`、`motion`、`react-markdown` 等未在白名单中的第三方库，插件必须自行打入 bundle，宿主不提供自动共享注入。

---

## 2. 精确版本（共享库）

版本取自 `package.json`（声明范围）与 `node_modules`（实际安装）。

| 库                  | 声明范围   | 实际安装  | 宿主共享？ | 说明                               |
| ------------------- | ---------- | --------- | ---------- | ---------------------------------- |
| `react`             | `^19.0.1`  | `19.2.7`  | ✅ 是      | React 核心与 Hooks                 |
| `react-dom`         | `^19.0.1`  | `19.2.7`  | ✅ 是      | DOM 渲染与 Portal (`createPortal`) |
| `react-dom/client`  | `^19.0.1`  | `19.2.7`  | ✅ 是      | 现代 Root API (`createRoot`)       |
| `react/jsx-runtime` | `^19.0.1`  | `19.2.7`  | ✅ 是      | 现代 JSX 运行时 (`jsx`, `jsxs`)    |
| `recharts`          | `^3.8.1`   | `3.8.1`   | ✅ 是      | Recharts 图表库                    |
| `lucide-react`      | `^0.546.0` | `0.546.0` | ✅ 是      | Lucide 图标库                      |

---

## 3. 必须自行打包的库（非共享）

以下宿主依赖但**不**共享给插件，插件若使用需打进 bundle（版本取自 `package.json`）：

| 库                  | 声明范围    | 实际安装   | 宿主共享？              |
| ------------------- | ----------- | ---------- | ----------------------- |
| `react-konva`       | `^19.2.4`   | `19.2.5`   | ❌ 否                   |
| `konva`             | `^10.3.0`   | `10.3.0`   | ❌ 否                   |
| `socket.io-client`  | `^4.8.3`    | `4.8.3`    | ❌ 否                   |
| `motion`            | `^12.23.24` | `12.40.0`  | ❌ 否                   |
| `react-markdown`    | `^10.1.0`   | `10.1.0`   | ❌ 否                   |
| `@lucide/lab`       | —（未声明） | **未安装** | ❌ 否（宿主根本不依赖） |
| `react-konva-utils` | `^2.0.0`    | —          | ❌ 否                   |
| `reveal.js`         | `^6.0.1`    | —          | ❌ 否                   |
| `pptx-preview`      | `^0.0.5`    | —          | ❌ 否                   |
| `xlsx`              | `^0.18.5`   | —          | ❌ 否                   |
| `jspdf`             | `^4.2.1`    | —          | ❌ 否                   |
| `zustand`           | `^5.0.14`   | —          | ❌ 否                   |

> ⚠️ **文档口径纠正**：部分旧文档（`docs_plugin_guide.md:708`）提及 `window.HostSharedDeps.socketService` / `uiService`，但运行时仅暴露 React 生态基础库（`React` / `ReactDOM` / `ReactDOMClient` / `Recharts` / `LucideReact` / `jsxRuntime`），**无** `socketService` / `uiService` 键。宿主虽依赖 `socket.io-client`，但未将其暴露为全局。插件获取通信和 UI 服务必须通过 `hostCtx.services` 或 `hostCtx.ui`。

---

## 4. 打包规范（工具、配置、出错表现）

- **打包工具：`esbuild`**（插件构建**不**使用 Vite/Rollup）。SDK 自有可发布 bundle 亦为 esbuild（`packages/plugin-sdk/build.mjs` 的 `esbuild.build()` 调用）。
- **配置/入口**：插件无独立 Vite/Rollup 配置文件。构建完全由 SDK CLI `openlearn-plugin-sdk build` 驱动（源码 `packages/plugin-sdk/cli.mjs`；二进制声明于 `packages/plugin-sdk/package.json:19-20`）。
- **如何触发构建**：脚手架插件置 `"build": "openlearn-plugin-sdk build"`（`scaffold/templates/full-stack/package.json`）。
- **externals 如何设置**：由 CLI **自动注入**，插件作者无需在打包器配置中声明。前端 externals 数组 `['react','react-dom','recharts','lucide-react']` 硬编码于 `packages/plugin-sdk/cli.mjs` 的两处 `buildOpts(frontendEntry, ...)` 调用（构建与 watch 模式各一处）；服务端 bundle 另加 `@openlearn/plugin-sdk`。
  > ⚠️ **v0.7.0 勘误**：该预置**只对内联执行环境成立**。远程沙箱插件照此构建会必然激活失败（§0）。远程插件需自建前端 bundle 并把 react 打进包内。
- **manifest 层声明**：脚手架模板声明 `peerDependencies: { "react": ">=17", "react-dom": ">=17" }`（`full-stack` 与 `frontend-only` 模板）。这是"插件消费宿主 React"的人类/清单信号，**不参与** externals 计算（externals 为硬编码）。
- **若手动打包忘记 external**：未 externalize `react` / `react-dom` 会导致**第二个 React 实例**，表现为 "Invalid hook call" / Context 断裂。使用标准 `openlearn-plugin-sdk build` CLI 不会遗漏（数组被强制注入）；若使用手写打包工具，必须将白名单内的共享库列入 external。
  > 仅**内联**插件适用；远程插件需要的是相反的处理（把 React 打进包内），见 §0。

---

## 5. `HostSharedDeps` 与动态转译器联动

- **SDK 与运行时分工**：SDK 在编译期通过 external 排除共享库；宿主在加载期通过 `FrontendPluginHost` 动态拦截裸模块说明符，自动注入 `window.HostSharedDeps` 引用，同时兼容现代打包器生成的 `react/jsx-runtime` 和 `react-dom/client`。
- **事实白名单**：包含 `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`recharts` 与 `lucide-react`。
- **realm 边界（v0.7.0 补充）**：转译器在**父页面**执行，改写产物被送入远程插件的不透明源 iframe。
  iframe 与父页面不共享 `window`，因此改写后的 `window.HostSharedDeps.*` 在 iframe 内为
  `undefined` —— 这是 §0 所述失败的直接成因，也是「层 1 依赖注入」待修项的根因。

---

## 6. 关联文档

- `docs/plugin/frontend-sandbox-capability-boundary.md` —— 远程前端插件的执行环境、能力边界与路线（含「声明式 slot DSL」方向）。
- `docs/reference/plugin-ui-extension-slots.md` —— 各 UI 扩展槽位注入给插件的 Props 上下文。
- `docs/plugin/plugin-security-migration.md` —— 前端沙箱的安全边界。

> 最后更新：2026-10-24（v0.7.0 勘误：补执行环境前提，纠正 remote 路径的 external 指引）
