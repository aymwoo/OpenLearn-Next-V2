# 宿主共享依赖白名单 (HostSharedDeps)

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0` / 平台 `v0.3.15+`
> 本页说明打包前端插件时**推荐 external（由宿主提供）** 的宿主全局库，及其精确版本，防止因重复打包导致包体积过大或 "Invalid hook call" 等重复加载错误。

---

## 1. 宿主全局提供的共享库

宿主在运行时通过全局对象 `window.HostSharedDeps` 注入并暴露基础前端运行时，供前端插件（ESM Bundle）动态复用：

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

- **打包工具：`esbuild`**（插件构建**不**使用 Vite/Rollup）。SDK 自有可发布 bundle 亦为 esbuild（`build.mjs:25`）。
- **配置/入口**：插件无独立 Vite/Rollup 配置文件。构建完全由 SDK CLI `openlearn-plugin-sdk build` 驱动（源码 `packages/plugin-sdk/cli.mjs`；二进制声明于 `packages/plugin-sdk/package.json:19-20`）。
- **如何触发构建**：脚手架插件置 `"build": "openlearn-plugin-sdk build"`（`scaffold/templates/full-stack/package.json`）。
- **externals 如何设置**：由 CLI **自动注入**，插件作者无需在打包器配置中声明。前端 externals 数组 `['react','react-dom','recharts','lucide-react']` 硬编码于 `cli.mjs:276,292`；服务端 bundle 另加 `@openlearn/plugin-sdk`（`cli.mjs:231`）。
- **manifest 层声明**：脚手架模板声明 `peerDependencies: { "react": ">=17", "react-dom": ">=17" }`（`full-stack` 与 `frontend-only` 模板）。这是"插件消费宿主 React"的人类/清单信号，**不参与** externals 计算（externals 为硬编码）。
- **若手动打包忘记 external**：未 externalize `react` / `react-dom` 会导致**第二个 React 实例**，表现为 "Invalid hook call" / Context 断裂。使用标准 `openlearn-plugin-sdk build` CLI 不会遗漏（数组被强制注入）；若使用手写打包工具，必须将白名单内的共享库列入 external。

---

## 5. `HostSharedDeps` 与动态转译器联动

- **SDK 与运行时分工**：SDK 在编译期通过 external 排除共享库；宿主在加载期通过 `FrontendPluginHost` 动态拦截裸模块说明符，自动注入 `window.HostSharedDeps` 引用，同时兼容现代打包器生成的 `react/jsx-runtime` 和 `react-dom/client`。
- **事实白名单**：包含 `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`recharts` 与 `lucide-react`。

> 最后更新：2026-09-18
