# Scaffold CLI 脚手架指南

<!-- doc-version: sdk=3.7.2 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.2`（CLI 随该包一起发布，已上 npm）

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

> ⚠️ **ZIP 里只有这三件套**：`migrations/`、`assets/`、`README.md` 等内容**不会**进包。
> 建表/升级请用 `ctx.db.ensureTable()` + `ctx.db.migrate(version, fn)`；
> 声明式 `migrations/*.sql` 仅对内置插件、源码目录直装生效，
> 详见 [插件数据库 API](../reference/plugin-database-api.md) §3.1 的 ZIP 说明。

`manifest.json` 由 CLI 从打包后的代码里抽取 `export default { manifest }` 生成；若项目根目录已有 `manifest.json`，CLI 会优先使用它。

**包名 = `package.json` 的 `name`**。`--name demo-vote` 生成的包名是 `openlearn-plugin-demo-vote`，ZIP 因此叫 `openlearn-plugin-demo-vote.zip`。CI 中请按 `dist/*.zip` 取文件，不要硬编码名字。

## 3. 模板默认值还需要你确认的项

模板能直接编译、直接装、直接激活（含 `frontend.js` 的导出契约），但下面两项是**猜不出来**的业务决定：

| 位置                | 默认值             | 说明                                                      | 怎么改                                 |
| ------------------- | ------------------ | --------------------------------------------------------- | -------------------------------------- |
| `manifest.id`       | `@<author>/<name>` | scope 由 `--author` 推导（如 `@ext-openlearn/demo-vote`） | 换成你自己的 scope（模板内引用已统一） |
| `engines.openlearn` | `>=0.2.5`          | 声称兼容 0.2.5，但你可能用到 `ctx.http`(0.3.11+) 等新 API | 按实际用到的 API 调高                  |

> `manifest.id` 是**命令命名空间前缀的唯一来源**（`resolvePluginCommandType`）：写 `@scope/name`，
> 命令就是 `@scope/name.some_command`。别用 `@/name` 这种空 scope。

### 3.1 各模板的 `frontend.tsx` 契约（已修正，见下方版本说明）

三个模板的前端位置如下 —— 这块曾经是**已知缺陷**（模板生成 `export default function Component()`，
沙箱加载器要求 `plugin.activate` 是函数，装完直接报 `missing activate function`），
仓库内已改为正确的桥接入口：

| 模板            | `src/frontend.tsx` | 产物 `frontend.js` | 行为                                                                                   |
| --------------- | ------------------ | ------------------ | -------------------------------------------------------------------------------------- |
| `server-only`   | 无                 | 无                 | 服务端专用；不带 `frontend.js` 的插件不会被前端激活路径拉起                            |
| `full-stack`    | 有                 | 有                 | 隐藏 iframe 里跑 `activate`：读课堂上下文、记激活次数、注册一个 `command_palette.item` |
| `frontend-only` | 有                 | 有                 | 只演示桥接（首次激活 toast + 命名空间存储），**不声明**课堂工具                        |

三个模板共同遵守的硬契约：

```ts
// ✅ 正确：default export 带 activate 的对象
export default { activate, deactivate };

// ❌ 错误：把组件当 default —— 宿主沙箱加载器会抛 "missing activate function"
export default function MyPanel() {
  /* … */
}
```

> **版本说明**：`@openlearn/plugin-sdk@3.7.1`（已发 npm）起，`init` 直接生成上面的形状。
>
> ⚠️ **3.7.1 本身不要装**：它的产物残留 `node:` 内置模块静态导入，插件打包后运行期失败，已在 npm 弃用。
> 本段的模板修复在 3.7.2 中完整保留 —— 升到 `npm i -D @openlearn/plugin-sdk@3.7.2` 才是既拿到新模板、又不踩坑的那一个。
> 若你仍停在 **3.7.0**，生成的是旧模板 —— 脚手架跑完请手工把 `src/frontend.tsx` 改成上面的形状
> （或直接用 `--template server-only`）；升级到 `npm i -D @openlearn/plugin-sdk@3.7.2` 则无需手改。

> 第三方插件的前端是**隐藏 iframe** 里的无 UI 执行体，写 React 组件既不会被渲染、也无法跨
> `postMessage` 传递。为什么以及能做什么，见 [前端沙箱能力边界](../plugin/frontend-sandbox-capability-boundary.md)
> 与 [前端插件指南](../tutorials/plugin-frontend-guide.md)。

## 4. 完整流程

见 [插件开发教程 §11 发布与分发](../tutorials/plugin-development-tutorial.md)。
