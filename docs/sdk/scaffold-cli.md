# Scaffold CLI 脚手架指南

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0`（CLI 随该包一起发布，已上 npm）

## 1. 命令一览

| 命令                                               | 作用                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `npx @openlearn/plugin-sdk init`                   | 交互式创建项目                                               |
| `npx @openlearn/plugin-sdk init --name <kebab>`    | 非交互创建（可加 `--template`、`--description`、`--author`） |
| `npx @openlearn/plugin-sdk build`                  | 编译 + 打包为 ZIP                                            |
| `npx @openlearn/plugin-sdk build --watch`          | 监听改动重建                                                 |
| `npx @openlearn/plugin-sdk sign --key <pem> <zip>` | Ed25519 签名（社区注册表分发用）                             |

`--template` 取值：`server-only` | `full-stack` | `frontend-only`（**默认 `server-only`**，未指定时交互式提示）。

## 2. 产物

`build` 产出两类东西：

```
<项目>/
├── dist/
│   ├── index.js            # 服务端 bundle（esbuild，format=esm，SDK 保持 external）
│   ├── frontend.js         # 仅 full-stack / frontend-only
│   └── <包名>.zip          # 分发包
└── <包名>.zip              # 同一份 ZIP 的副本，方便直接上传
```

ZIP 内部固定为**根级** `index.js` + `manifest.json` +（可选）`frontend.js`，无嵌套目录。

`manifest.json` 由 CLI 从打包后的代码里抽取 `export default { manifest }` 生成；若项目根目录已有 `manifest.json`，CLI 会优先使用它。

**包名 = `package.json` 的 `name`**。`--name demo-vote` 生成的包名是 `openlearn-plugin-demo-vote`，ZIP 因此叫 `openlearn-plugin-demo-vote.zip`。CI 中请按 `dist/*.zip` 取文件，不要硬编码名字。

## 3. 脚手架默认值的三处坑

CLI 3.7.0 的模板能编译通过，但默认值不适合直接分发：

| 位置                | 默认值                                | 问题                                                                          | 怎么改                                                   |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `manifest.id`       | `@/<name>`（未传 `--author` 时）      | `@/` 不是合法的 scope 写法                                                    | 改 `ext-<name>` 或 `@scope/<name>`                       |
| `src/frontend.tsx`  | `export default function Component()` | 沙箱 iframe 要求 `plugin.activate` 是函数，否则报 `missing activate function` | 改为 `export default { activate }`，或改用 `server-only` |
| `engines.openlearn` | `>=0.2.5`                             | 声称兼容 0.2.5，但你可能用到 `ctx.http`(0.3.11+) 等新 API                     | 按实际用到的 API 调高                                    |

> 前两条是 CLI 模板与运行时契约不一致导致的**已知缺陷**，修模板需要发新版 SDK；在那之前请在脚手架生成后手动改正。第三方插件为什么不能保留 React 组件，见 [前端沙箱能力边界](../plugin/frontend-sandbox-capability-boundary)。

## 4. 完整流程

见 [插件开发教程 §11 发布与分发](../tutorials/plugin-development-tutorial)。
