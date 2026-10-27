# 插件开发文档可用性审计（2026-10-26）

> **审计口径**：不是"文档与代码是否一致"，而是**"一个只会读文档的 AI Agent，能不能照着写出一个真能用的第三方插件"**。
> 覆盖 `docs/tutorials/plugin-development-tutorial.md`（2623 行）、`docs/plugin/*`、`docs/sdk/*`、`docs/reference/plugin-*`，共 20 篇。
> 方法：静态契约比对 + **端到端实跑**（CLI 脚手架 → npm install → build → 拆 ZIP → 对照宿主加载器）。

---

## 0. 一句话结论

文档足以让人（或 Agent）**做出一份能装上的插件**，但**做不出一个能被用户看见的插件**——而且主干教程从来没有把这件事说清楚。

更具体地说：教程有 **580 行（占全文 22%）在教怎么用 React 写插件 UI**，而这套能力对第三方插件（ZIP 分发）**完全不可用**。这不是个别段落过期，是受众与内容整体错位。

---

## 1. 致命项（会让照做的人得到坏结果）

### 1.1 第三方插件的 UI 能力，全篇没有正面交代

| 文档说的                                                 | 代码事实                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| §2.2 只有 `inline` / `worker` 两种模式                   | 实际三档，且第三方插件被 `execution-policy.ts` **强制改写为 `process`**                                   |
| §6 整章教 `ctx.ui.registerExtensionPoint({ component })` | 沙箱 iframe 是 `display:none` 的隐藏执行体，`component` 是函数、`postMessage` 无法克隆 → `DataCloneError` |
| §6.9 / §6.10 教注册画板组件与环节类型                    | 同上，第三方插件拿不到自定义组件                                                                          |
| §4.1 手把手实例 = 完整投票 UI                            | 实例里**根本没有前端**，只有一个工具栏按钮                                                                |

代码依据：

- `packages/core/plugin-host/execution-policy.ts` → 非内置/未受信插件一律 `process`；
- `src/plugin-host/plugin-host.ts:185-250` → manifest 声明式贡献注册的是 `NullExtensionComponent`（`() => null`）；
- `docs/plugin/frontend-sandbox-capability-boundary.md` §3.2/§4 → 明确写了"不能提供自定义 React 组件""声明式 DSL **待立项**"。

**这份最准确的文档，在教程里只被引用过两次（1512、1561 行），且都在第 6 章中段**——Agent 通常读完 §2/§4 就开始写代码了，走不到那里。

### 1.2 §4.1 旗舰示例：点击即报错

原示例（现已修）：

```ts
classroomTools: [{ commandType: 'poll.create', payload: { type: 'single_choice' } }]
// handler 内：
INSERT INTO polls (id, lesson_id, title, options, created_at) VALUES (?, ?, ?, ?, ?)
.run(pollId, payload.lessonId, payload.title, options, Date.now())
```

`payload` 里只有 `type`，`lessonId` / `title` / `options` 全是 `undefined` → 点击后 SQLite `NOT NULL constraint failed`。

同类问题两处：

- `return { message: '投票「${payload.title}」已创建' }` —— 单引号里的 `${}` 不插值，返回的是字面量；
- `manifest.id: '@openlearn/plugin-poll'` —— 教用户占用官方命名空间。而策略层注释写得很清楚："manifest id 以 `@openlearn/` 开头不能证明它是官方插件"，既拿不到信任，又会让运维误判来源。

**根因**：工具栏按钮唯一能拿到课堂上下文的通道是 `$lessonId` / `$classId` 占位符（`LiveClassroomView.handleExecuteTool` 在序列化后做字符串替换），而这个机制**在全仓文档里零提及**。示例作者不知道它存在，于是随手写了个不成立的 payload。

### 1.3 官方脚手架产出的前端，激活必定失败

实测链路：

```
npx @openlearn/plugin-sdk init --name demo-vote --template full-stack
npm install && npx openlearn-plugin-sdk build        # ✅ 成功，产出 13.3 KB ZIP
```

ZIP 内容正常（根级 `index.js` + `manifest.json` + `frontend.js`），但：

| 事实                                                              | 位置                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| 模板 `frontend.tsx` 导出的是 `export default function DemoVote()` | `packages/plugin-sdk/scaffold/templates/*/src/frontend.tsx` |
| 产物 `frontend.js` 中 `grep -c activate` = **0**                  | 实测                                                        |
| 沙箱加载器要求 `plugin.activate` 必须是函数，否则抛错             | `server/utils/plugin-sandbox-frame.ts:80`                   |
| 激活失败 → `PluginState.ERROR`                                    | `src/plugin-host/plugin-host.ts`                            |

即：**用官方脚手架 + 官方模板，不改前端，插件会以"加载失败"状态挂掉。** 而教程 §6.8 教的是 `export default { activate, deactivate }`（这才是对的），模板与教程互相矛盾。

另有模板默认值问题：`init` 不传 `--author` 时 `manifest.id` 生成为 `@/demo-vote`（`cli.mjs:169` 拼 `@${''}/${name}`），`@/` 不是合法 scope。

---

## 2. 会持续误导的项

| #   | 位置                                 | 问题                                                                                                                                                              | 处理                                        |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 2.1 | §2.6 版本速查表                      | "现为 `0.2.x`"、表内写"当前 `0.5.0`"，实际平台 `0.7.4`；两处自相矛盾                                                                                              | 已改为 0.7.4 并说明三个版本维度             |
| 2.2 | §2.6 / §10 自检清单                  | 一律推荐 `engines.openlearn: ">=0.2.5"`                                                                                                                           | 已改为"按实际用到的 API 填"，并给出对应关系 |
| 2.3 | §10 自检清单                         | "远程沙箱插件：react 不要 external，改为自打包" —— 这是 v0.7.0 **之前**的建议，沙箱里自打包 React 也渲染不了任何东西                                              | 已改为"不要为渲染 UI 打包 React"            |
| 2.4 | §11.1                                | 说产物是 `my-plugin.zip`，实际是 `<package.json name>.zip`（实测 `openlearn-plugin-demo-vote.zip`）；未提 `--template` 默认值是 `server-only`、未提 `sign` 子命令 | 已重写，含产物路径/命名/签名                |
| 2.5 | `docs/sdk/scaffold-cli.md`           | 全文 **15 行**，只有两条命令，三项能力（模板/签名/产物结构）缺失                                                                                                  | 重写为完整命令表 + 产物说明 + 三处默认值坑  |
| 2.6 | `docs/sdk/plugin-sdk.md:321,329`     | `ctx.actionRegistry` / `ctx.commandBus` —— 真实入口是 `ctx.services.*`                                                                                            | 已修，并加注释说明                          |
| 2.7 | 教程 §6.9 / §6.10                    | `import type { FrontendPluginContext } from '@openlearn/plugin-sdk'` —— SDK 从未导出该类型（仅存在于宿主 `src/plugin-host/types.ts`）                             | 已改为插件侧自声明最小接口                  |
| 2.8 | `plugin-update-distribution.md` §5.1 | `ctx.reportProgress` 只在 worker bootstrap 注入，`process`/`inline` 下为 `undefined`，且 `PluginContext` 未声明该成员（写了编译不过）                             | 已标注两个限制 + 类型断言写法               |

---

## 3. 新增机器检查：`audit-tools/plugin_docs_check.py`

前三段检查（`refchecks` / `envcheck` / `symbolcheck`）都只判断"这个路径 / 键名 / 符号是否存在"，**不看代码块里怎么调用它**。而插件的崩溃点几乎都在调用形状上。

判定分级：

| 判定 | 含义                                                        | 计入门禁 |
| ---- | ----------------------------------------------------------- | -------- |
| P1   | 从 `@openlearn/plugin-sdk` 导入了 SDK 没声明的符号          | ✅       |
| P2   | `ctx.<成员>` 不在 `PluginContext` / `FrontendPluginContext` | ✅       |
| P3   | `ctx.services.<成员>` 不在任何 `services` 定义              | ✅       |
| P4   | `ctx.ui.<方法>` 不是 `FrontendPluginContext.ui` 的方法      | ✅       |
| P5   | manifest 示例缺 `main`（schema 必填）                       | ❌ 提示  |

契约来源是**实时解析** `packages/plugin-sdk/*.d.ts` 与两个 Context 接口，不维护硬编码列表，SDK 加字段后无需改工具。

首跑抓到 4 条真实缺陷（即 §2.6–2.8 那几处），修完后归零。

**负向测试**（否则"0 drift"没有说服力）：向 `docs/sdk/plugin-sdk.md` 注入四类错误用法后，工具分别报出 P1/P2/P3/P4 各一条；恢复后归零。

已知边界（写进工具文档，避免后人踩）：

- 必须剔除整行注释 —— 文档里大量 `// import { X } ... // ❌ SDK 未导出` 这类**正确反例**；
- ctx 别名只能认 `ctx` / `hostCtx` / `pluginCtx`，加 `context` 会误伤内核代码里的 `request.context.actorRole`；
- 它判断"符号是否声明在 d.ts"，**判断不了"声明了但没从 index 导出"**。

---

## 4. 已改文件

| 文件                                            | 改动                                                                                                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/tutorials/plugin-development-tutorial.md` | §2.2 改为三档执行模式 + 第三方能力边界警示；§2.6/§2.8 版本纠偏；新增 §3.1.1 `payload` 占位符机制；§4.1 修 payload/插值/id 并新增「能看到什么、看不到什么」；§6 章首加适用范围警示；§10 三条自检项纠偏；§11.1 CLI 段重写 |
| `docs/sdk/plugin-sdk.md`                        | `ctx.actionRegistry` / `ctx.commandBus` → `ctx.services.*`                                                                                                                                                              |
| `docs/sdk/scaffold-cli.md`                      | 15 行 → 完整 CLI 指南（命令 / 产物 / 三个默认值坑）                                                                                                                                                                     |
| `docs/reference/plugin-update-distribution.md`  | `ctx.reportProgress` 标注 worker-only + 类型未声明                                                                                                                                                                      |
| `docs/developer-guide/docs-drift-audit.md`      | 四类检查 → 五类，补 `plugin_docs_check.py` 判定表与边界                                                                                                                                                                 |
| `audit-tools/run.sh`                            | 接入第四段检查                                                                                                                                                                                                          |
| `audit-tools/plugin_docs_check.py`              | 新增                                                                                                                                                                                                                    |

校验结果：`canonical_drift=0` / `ref_drift=0` / `env_drift=0` / `plugin_docs_drift=0` / `drift_count=0`。

---

## 5. 未修项（需要决策，不宜由文档单方面裁定）

1. **脚手架模板前端口径**（P0，代码 bug）。修法是把 `scaffold/templates/*/src/frontend.tsx` 改成导出 `{ activate }`，或让 `build` 在检测到纯组件导出时给出明确报错。两者都要发 SDK 3.7.1，超出文档改动范围。当前已在教程与 CLI 指南里写明"必须手改"，但根治要改代码。
2. **§6 是否物理拆成两篇**。现在靠章首警示"劝退"，但 580 行的正文仍在。更彻底的做法是拆成《前端插件（受信/内置）》与《第三方插件前端能做什么》两篇，各自只有一套契约。这是信息架构决策。
3. **声明式 slot DSL**（`frontend-sandbox-capability-boundary.md` §4，状态"待立项"）。它一旦落地，第三方插件才真正有 UI；在此之前，所有教 UI 的段落都只能服务内置插件。
4. **`FrontendPluginContext` 是否补进 SDK**。现在插件作者无法为自己的 `activate(ctx)` 标注类型。补一个导出比让每个人手写接口更合理，但要同步 `generate-dts.mjs` 与 CHANGELOG。
5. **`reportProgress` 是否进 `PluginContext` 类型**。运行时只在 worker 注入，类型里缺失，属于"能用但写不出来"。

---

## 6. 给维护者的一条建议

本次能端到端跑通脚手架（`init → install → build → 拆包`），是因为 CLI 已发布到 npm 且无私有依赖。**把这条链路做成 CI 的 smoke test**（对着 `server-only` 模板跑一遍、断言 ZIP 里三件套齐全、断言 `frontend.js` 的导出形状符合沙箱加载器要求）比任何文档评审都可靠——本次的两个 P0 都会在那一步被抓住。
