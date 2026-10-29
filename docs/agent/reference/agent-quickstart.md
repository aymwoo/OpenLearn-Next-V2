# 快速开始

从零到「已安装的插件」，以及 CI 里该怎么跑。

---

## 1. 前置条件

| 项         | 要求                                                                                                                                 |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| 宿主平台   | OpenLearnV2 `>=0.7.7`（或按 `engines.openlearn` 声明的范围）                                                                         |
| Node.js    | `20.x` / `22.x` / `24.x`（`engines` 硬约束，安装期守卫会拦截其它版本）                                                               |
| 包管理器   | `pnpm@10.33.4`（平台侧）；插件侧 `npm` / `pnpm` 均可                                                                                 |
| 宿主已开启 | 未签名本地包：`OPENLEARN_ALLOW_UNSIGNED`（默认放行，记 `unverified_local_acknowledged` 审计）；签名分发：`OPENLEARN_TRUSTED_PUBKEYS` |

---

## 2. 用脚手架创建项目

```bash
# 交互式
npx @openlearn/plugin-sdk init

# 非交互式（推荐 Agent 使用）
npx @openlearn/plugin-sdk init \
  --name exam-helper \
  --description "随堂测验与成绩统计" \
  --author myteam \
  --template full-stack
```

约束（脚手架会当场校验）：

- `--name` 必须匹配 `^[a-z][a-z0-9-]*$`（kebab-case，小写字母开头）。
- `--template` 只能是 `server-only`（默认）/ `full-stack` / `frontend-only`。
- 生成的 `manifest.id` 形如 `@{author}/{name}`（author 小写化并把非 `[a-z0-9]` 换成 `-`）。

产物结构：

```
exam-helper/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # 服务端入口：export default { manifest, activate, deactivate }
│   ├── frontend.tsx        # 前端桥接入口（full-stack / frontend-only）
│   └── contracts/index.ts  # 对外提供的服务接口与 Token（full-stack）
└── dist/                   # 构建输出
    ├── index.js
    ├── frontend.js
    └── <插件名>.zip        # index.js + manifest.json + frontend.js
```

---

## 3. 写第一个插件（30 行，可直接跑）

> 下面是**插件工程脚手架**里的文件路径（`src/index.ts` 指的是你本地插件仓库的
> `src/index.ts`，不是 OpenLearn 仓库的路径）。

`src/index.ts`：

```typescript
import type { PluginContext } from '@openlearn/plugin-sdk';

export default {
  manifest: {
    id: '@myteam/hello',
    name: 'Hello OpenLearn',
    version: '0.1.0',
    main: 'index.js',
    engines: { openlearn: '>=0.2.5' },
    capabilitiesProposed: ['lesson:read'],
  },

  async activate(ctx: PluginContext) {
    await ctx.services.commandBus?.registerHandler('@myteam/hello.ping', {
      async execute(command) {
        return { pong: true, actor: command.actorId, at: Date.now() };
      },
    });
    ctx.log.info('hello plugin activated');
  },

  async deactivate() {},
};
```

要点：

- `manifest.main` 必填，且必须等于打包后的实际文件名。
- `commandType` 用 `{@scope/name}.{verb}` 全限定形式 —— 这同时是**权限边界**：内核拒绝你注册
  不是自己前缀的带点命令（会直接把插件打成 `ERROR`）。
- `ctx.services.commandBus?` 用可选链：类型层它是 `T | null`。

---

## 4. 构建、签名、安装

```bash
# 构建 zip
npx @openlearn/plugin-sdk build
npx @openlearn/plugin-sdk build --watch       # 开发期热重建

# 构建时直接签名（Ed25519）
npx @openlearn/plugin-sdk build --key publisher.pem --publisher "My Team"

# 对已存在的 zip 补签
npx @openlearn/plugin-sdk sign --key publisher.pem --publisher "My Team" dist/my-plugin.zip
```

安装方式三选一：

1. **管理端上传**：插件中心 → 上传 ZIP。（未签名包在 `OPENLEARN_ALLOW_UNSIGNED=0` 时，
   每次上传需带请求头 `x-allow-unsigned: true`。）
2. **ZIP 直传 API**：`POST /api/plugins/...`（安装/更新走同一路径，签名覆盖 `integrity` 字符串的 UTF-8 字节）。
3. **社区注册表**：设置 `PLUGIN_COMMUNITY_REGISTRY_URL` + `OPENLEARN_COMMUNITY_INSTALL=1` +
   `OPENLEARN_COMMUNITY_PUBKEY`，缺一装不上；注册表只接受公网 HTTP(S)，回环与私网段被拒。

验证：

```bash
openlearn-next plugins list      # 已安装插件清单与加载状态
```

---

## 5. 本地调试

```bash
# 平台侧：在仓库根起开发服务（9000）
pnpm dev

# 演示数据（一次性库 storage/demo.db，账号 demo_teacher / Demo@2026）
pnpm dev:demo

# 插件侧：构建产物 + 热监听
npx @openlearn/plugin-sdk build --watch
```

开发期想让**未列入白名单的第三方插件跑在 inline**（跳过 worker/子进程隔离，方便打断点）：

```bash
# ⚠ 仅限本地。生产设置会留下可检索告警；写 * 不分环境告警。
OPENLEARN_TRUSTED_INLINE_PLUGINS='@myteam/*' pnpm dev
```

> 这条开关只影响「是否允许进程内运行」。它**不会**把插件变成系统插件（系统插件会阻断更新与卸载）。

**热重载**：宿主具备 `HotReloadController`，`HotReloadEvent { pluginId, filePath, timestamp }`。
ZIP 插件的开发正道仍是 `build --watch` + 重新安装。

---

## 6. 装不上？按这个顺序排查

```
1. zod 校验（manifestSchema，.passthrough()）失败？
   → 看错误里的字段名。安装期失败几乎都在这一层。
2. 通过校验但激活失败？
   → 看 `openlearn-next plugins list` 的 state 字段（7 态之一，见下）。
   → ERROR 且消息含 missing activate function ⇒ 前端入口契约不满足。
3. 激活成功但功能不生效？
   → 大概率是「静默失效」类：slot 名写错（无渲染器）、component 被克隆失败、
     表名硬编码、能力未授予、optional 服务为 null。见 pitfalls。
```

`PluginState`（7 态）：

```
INSTALLED → ACTIVATING → ACTIVE → DEACTIVATING → INACTIVE
                                    ↓
                                  ERROR
INACTIVE / ERROR → ACTIVATING（重新激活）或 UNINSTALLED
```

`ACTIVATING` 与 `DEACTIVATING` 是瞬态，不应长时间停留；卡住通常意味着探活超时（默认 30s 间隔 + 15s 宽限 ⇒ 最长 45s 内被终止）。

---

## 7. CI 建议

```bash
npx @openlearn/plugin-sdk build           # 产物必须成功
npx @openlearn/plugin-sdk build --key "$SIGNING_KEY_PEM"
pnpm test                                 # createMockContext 断言注册结果
```

平台侧的第三方插件兼容性作业会做两件事，值得在本地先复现：

- **产物残留 import 自检**：worker bundle 里不应残留 `node:fs` / `node:path` / `node:url` / `node:crypto`
  等静态导入（这就是 SDK 把宿主内部类改为**仅类型导出**的原因）。
- **ABI 校验**：`better-sqlite3` 原生绑定需能在目标 Node 版本加载。

---

## 取证

| 内容                                    | 位置                                                         |
| :-------------------------------------- | :----------------------------------------------------------- |
| CLI 命令与选项全文                      | `packages/plugin-sdk/cli.mjs`（`init` / `build` / `sign`）   |
| name 正则、template 枚举、pluginId 生成 | `packages/plugin-sdk/cli.mjs`（`cmdInit`）                   |
| 脚手架产物结构                          | `packages/plugin-sdk/scaffold/templates/*/`                  |
| 7 态状态机                              | `packages/core/plugin-host/types.ts`（`PluginState`）        |
| 未签名/社区安装开关                     | `.env.example`；`docs/plugin/community-plugin-registry.md`   |
| 安装期守卫                              | `scripts/assert-node-runtime.mjs`；`package.json#preinstall` |
| 演示数据账号                            | `docs/getting-started/quickstart.md`                         |
