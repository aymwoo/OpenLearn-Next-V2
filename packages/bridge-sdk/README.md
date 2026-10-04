# @openlearn/bridge-sdk

LMS Bridge SDK — 课件与宿主 iframe 跨域沙箱通信桥接代码。

## 架构说明

在严密沙箱（`sandbox="allow-scripts allow-forms allow-downloads"` 且无 `allow-same-origin`）中运行的互动课件：
- 无法直接访问同源 Cookie 或顶层 Window 属性；
- 通过注入本 SDK 实现 `Object.defineProperty` 与 Proxy 拦截代理 `postMessage`，规范化 `targetOrigin: 'null' -> '*'`；
- 提供标准化 `window.LMS` API 与自动成绩回传。

## 源文件与构建

- 源文件：`src/bridge.js`
- 自动编译同步脚本：`scripts/build-bridge-sdk.mjs`
- 编译输出注入点：`server/utils/bridge-sdk.ts`（供服务端注入与路由分发）
