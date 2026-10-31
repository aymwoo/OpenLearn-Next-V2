# 构建、测试与部署

> 本文件只讲「怎么把代码变成能跑的东西」。各层内部机制见 [../subsystems/](../subsystems/)。

---

## 1. Node 版本是硬门槛

`package.json → engines.node` 写的是 `20.x || 22.x || 24.x`，但**CI 与文档统一钉 22**（`.nvmrc`）。

两个版本的坑都踩过：

| 版本 | 症状 | 原因 |
| --- | --- | --- |
| 换主版本后启动即崩 `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` | `better-sqlite3` 按主版本编译（22→ABI 127、24→137、26→147） | 修法：`pnpm rebuild better-sqlite3` |
| Node 26 跑测试全红 | `Cannot read properties of undefined (reading 'clear')` | Node 26 内置实验性 Web Storage，`globalThis.localStorage` 存在但为 `undefined`；jsdom 会跳过已定义的全局 |

`preinstall` 脚本 `scripts/assert-node-runtime.mjs` 是安装期唯一硬闸（`engines` 默认只是警告），
Dockerfile 特意在 `pnpm install` 前就把它拷进镜像，否则 install 会因找不到文件直接失败。

---

## 2. 开发循环

```bash
pnpm dev          # tsx server.ts，Express + Vite HMR，端口 9000
pnpm dev:demo     # 带演示数据的开发模式
```

`pnpm dev` 直接跑 `server.ts`（不预编译），前端由 Vite 中间件在进程内提供。
生产才走 `dist/`。

---

## 3. 构建：一条命令 6 个步骤

```bash
pnpm build
```

内部顺序（`package.json → scripts.build`）**不可调换**：

| # | 命令 | 产物 | 为什么必须在这个位置 |
| --- | --- | --- | --- |
| 1 | `node scripts/build-plugin-sdk.mjs` | SDK 产物 | 插件构建依赖它 |
| 2 | `node scripts/build-bridge-sdk.mjs` | `server/utils/bridge-sdk.ts` | 服务端 bundle 前必须已生成 |
| 3 | `vite build` | `dist/assets/*` | 前端要先构建 |
| 4 | `node scripts/build-plugins.mjs` | 内置插件产物 | 服务端 bundle 会引用 |
| 5 | `esbuild server.ts → dist/server.cjs` | 服务端单文件 | `--packages=external`，依赖不打进去 |
| 6 | esbuild 两个附带入口 + 拷贝 preload | `dist/env-validation.cjs`、`dist/cli-migrator.cjs`、`dist/plugin-net-preload.cjs` | 运行时按路径加载，漏了会启动失败 |

**注意 `server/utils/bridge-sdk.ts` 是生成物**：源在 `packages/bridge-sdk/src/bridge.js`，
手改生成物会被下次构建覆盖。

---

## 4. 测试四档

| 命令 | 范围 | 说明 |
| --- | --- | --- |
| `pnpm test` | Vitest 单测 + 集成 | `fileParallelism: true`，每 worker 独立临时库（`VITEST_POOL_ID` → `/tmp/openlearn_test_dbs/`），60s 超时 |
| `pnpm test:coverage` | 带覆盖率 | 基线在 `coverage-baseline.json` |
| `pnpm test:ratchet` | 覆盖率棘轮 | 不允许覆盖率下降 |
| `pnpm test:e2e` | Playwright | `playwright.config.ts` / `playwright.beta.config.ts` |

跑子集：`pnpm vitest run -t "pattern"`。

**测试隔离的三条规则**：

1. `vitest.setup.ts` 会清掉 `BACKUP_DIR` / `OPENLEARN_DB_PATH` —— 防止测试写进真实目录。这是预期行为。
2. 不要设置 `PLAYWRIGHT_TEST` 到生产（`db/index.ts → assertPlaywrightTestNotInProduction` L203 会断言）。
3. 集成测试用 `createDatabase(customPath)` 拿独立库，不要用全局 `db`。

---

## 5. 质量门禁

| 命令 | 检查什么 | 失败含义 |
| --- | --- | --- |
| `pnpm lint` | `tsc --noEmit` | 类型错误 |
| `pnpm lint:strict` | 更严格 tsconfig | 严格模式下的隐式 any / 未使用 |
| `pnpm lint:eslint` | ESLint | 规则违规（`no-explicit-any` 只是 warning） |
| `pnpm lint:encoding` | 源码编码 | 混入非法字符 / BOM |
| `pnpm lint:i18n` | i18n 完整性 | 缺翻译键 |
| `pnpm lint:format` | 格式预算 | 超预算的格式化差异 |
| `pnpm format:check` | Prettier | 格式不符 |

CI 合入门禁全部走这些命令，本地对齐即可。

---

## 6. 数据库运维

| 命令 | 作用 |
| --- | --- |
| `pnpm db:backup` | 备份 |
| `pnpm db:restore` | 恢复 |
| `pnpm db:gen-golden` | 生成 `packages/core/db/schema-golden.json`（表结构基线） |
| `pnpm db:gen-tables` | 生成表清单 |
| `pnpm db:seed` / `db:clean-demo` | 演示数据 |
| `pnpm db:reset` | 删库（下次启动自动重建） |
| `pnpm db:clean-test-data` | 清测试残留数据 |
| `pnpm ops:check-perms` | 检查敏感文件权限 |

`schema-golden.json` 是表结构快照，改表后必须重新生成，否则 CI 会报漂移。

---

## 7. 部署：三种方式

### 7.1 单机脚本（PM2 + Nginx）

```bash
./deploy.sh
```

`deploy.sh` 做四件事：生成 `nginx.generated.conf`（把 `$APP_ROOT` 占位符替换成真实路径）→
构建 → 配 Nginx → 用 PM2 启动。

PM2 配置在 `ecosystem.config.cjs`：

| 项 | 值 |
| --- | --- |
| 进程名 | `openlearnv2` |
| 入口 | `scripts/pm2-entry.cjs` |
| 模式 | `fork`，`instances: 1` |
| 环境 | 从 `.env` 加载 `dotenv`，覆盖 `NODE_ENV=production`、`PORT=9000` |

**必须单实例**：SQLite 单写者 + 进程内单例内核（`EventBus` / `PluginHost`）都不支持多实例。

### 7.2 Docker

```bash
docker compose up -d --build
```

`Dockerfile` 两阶段（`node:22-alpine` 构建 → 运行）。三个不可改的细节：

1. `corepack prepare pnpm@10.33.4` 钉版本 —— `@latest` 会带默认 `minimumReleaseAge`，
   在没有 `.npmrc` 时拒绝当天发布的传递依赖。
2. `.npmrc` 必须在 `pnpm install` **之前**进镜像（`minimum-release-age=0`）。
3. `preinstall` 守卫脚本必须提前拷贝（见 §1）。

### 7.3 反向代理要点

| 项 | 要求 |
| --- | --- |
| `TRUST_PROXY` | 与代理层数一致，否则 `req.ip`、限流、审计全错 |
| WebSocket | Socket.IO 需要 `Upgrade` 头透传与长连接超时放宽 |
| SSE | 插件 SSE 与 AI 流式都需要关闭代理缓冲 |
| 静态资源 | `dist/` 由 Nginx 直出，`/uploads` 与 `/plugins` 必须走 Node（有鉴权） |

`nginx.conf` 与 `nginx.generated.conf` 两个文件并存：前者是模板，后者由 `deploy.sh` 生成，
**改配置改模板**。

---

## 8. 发布流程（版本对齐）

```text
1. 改 package.json → version（SemVer）
2. 更新 CHANGELOG.md（Keep a Changelog 格式，把 [Unreleased] 内容归入 [X.Y.Z]）
3. 若 SDK 有变动 → 同步 packages/plugin-sdk/CHANGELOG.md + version
4. 若内置插件有变动 → 同步 packages/plugins/<id>/CHANGELOG.md
5. 若表结构有变动 → pnpm db:gen-golden
6. git tag vX.Y.Z
```

三层 CHANGELOG 的作用域边界见仓库根 `AGENTS.md`「Release & CHANGELOG Workflow」。

---

## 9. 常见构建/部署故障

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| `MODULE_NOT_FOUND: scripts/assert-node-runtime.mjs` | Docker 里 preinstall 守卫没提前拷贝 | 按 §7.2 第 3 点补 COPY |
| 启动报找不到 `plugin-net-preload.cjs` | 构建最后一步的 `cp` 被跳过 | 重跑 `pnpm build` |
| 前端构建成功但页面白屏 | `base` 路径与 Nginx `root` 不匹配 | 核对 `vite.config.ts` 的 `base` 与部署子路径 |
| 插件安装后前端不生效 | `dist/` 里没有插件的 `frontend.js` | 检查 `build-plugins.mjs` 是否包含该插件 |
| CI 报 schema 漂移 | 改了表结构没重新生成 golden | `pnpm db:gen-golden` |
| 覆盖率门禁失败 | 新增代码未覆盖 | `pnpm test:coverage` 看缺口，或调整 `coverage-baseline.json`（需评审） |
