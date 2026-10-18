# 升级回归（Upgrade Regression）

每个 PR 都要回答一个问题：**上一正式版的数据库、已装插件和旧数据，升级到当前 `main` 之后还能不能用？**

空库冷启动（`docker-rehearsal.yml`）回答不了这个问题：空库不会暴露「已执行迁移的 checksum 被改写」「插件表被误删」「旧数据读不回」这类只在存量库上出现的故障。本作业就是补这一段的自动化门禁（Issue #147）。

## 它验证什么

`verify-upgrade.ts` 会在恢复出来的旧库上逐项断言：

| #   | 断言                                               | 拦住的问题                          |
| --- | -------------------------------------------------- | ----------------------------------- |
| 1   | fixture 的迁移记录与 `metadata.json` 一致          | fixture 被手改、缓存串版本          |
| 2   | 当前代码能在旧库上启动，`/health` 可用             | 迁移在新 schema 上直接抛错          |
| 3   | 已装插件仍全部 `active`                            | 插件表被误删、manifest/执行模式回归 |
| 4   | 旧班级、学生、班级成员仍可读                       | 迁移写坏业务表、字段被删            |
| 5   | 插件的 `plugin_storage` 标记仍可读回               | 插件数据被清理                      |
| 6   | 已执行迁移的 checksum 未被改写，且当前迁移全部应用 | 改历史迁移（最隐蔽的升级事故）      |
| 7   | 旧库所有表在升级后仍存在                           | 卸载/迁移误删表                     |
| 8   | 重启一次不产生任何新迁移                           | 迁移不幂等                          |

第 6 条同时由服务端自己兜底：作业以 `MIGRATION_CHECKSUM_STRICT=true` 启动，一旦历史迁移被改写，进程会直接启动失败。

## 怎么工作

```
上一正式版 tag (vX.Y.Z)                    PR head (main)
        │                                       │
        ├─ build-fixture.ts ──► fixture.zip ──► verify-upgrade.ts
        │   (真实进程 + HTTP API)                 (真实进程 + HTTP API)
        │
        └─ 缓存到 actions/cache（key 含 tag）
```

- **fixture 内容**：SQLite 库（`VACUUM INTO` 一致快照）+ `plugins/` 目录 + `storage/` + `metadata.json`。
- **fixture 怎么建**：用 release tag 的服务端代码起一个真实进程，管理员登录 → 通过 `POST /api/plugins/upload-zip-raw` 安装三个真实第三方插件并激活 → 建样例班级/学生 → 停服后在 `plugin_storage` 写入标记 → 打包。
- **为什么走 HTTP 而不是拼 schema**：手拼的库无法证明真实安装链路（能力审批、表前缀、`plugin_migrations`）可用。
- **缓存**：`upgrade-fixture/vX.Y.Z`，key 里带插件构建脚本的 hash；缓存命中时 PR 只需 `pnpm install` + 启动校验，通常 1-2 分钟。

## 在 PR 上

`.github/workflows/upgrade-regression.yml`：

- `pull_request → main`：解析 `git describe --tags --match 'v[0-9]*.[0-9]*.[0-9]*'` 得到的上一正式版 → 取缓存或现场构建 → 用 PR head 代码校验。
- `push → main`：同样跑一遍并预热缓存（PR 可以复用 base 分支的缓存）。
- `push → v*.*.*`：用该 tag 自己的代码构建 fixture，作为 artifact 归档（若存在对应 GitHub Release，则尽力附加为资产）。

> 仓库当前没有分支保护。要让这个作业真正**阻塞合并**，需要在 GitHub → Settings → Branches 把 `Upgrade from last release` 设为 required status check（或用 `gh api` 配置保护规则）。在此之前，它至少保证每个 PR 都会跑并给出明确结论。

## 本地怎么跑

```bash
# 1. 准备插件 ZIP（与 CI 相同的三个第三方插件）
#    CI 里由 .github/actions/build-plugin-fixtures 产出；本地可用任意插件 ZIP 代替
mkdir -p /tmp/upgrade-plugins
cp path/to/plugin.zip /tmp/upgrade-plugins/

# 2. 建 fixture（用当前代码模拟「上一正式版」）
pnpm exec tsx scripts/upgrade-regression/build-fixture.ts \
  --plugins-dir /tmp/upgrade-plugins \
  --out /tmp/upgrade-fixture.zip \
  --label local

# 3. 用当前代码做升级校验
pnpm exec tsx scripts/upgrade-regression/verify-upgrade.ts \
  --fixture /tmp/upgrade-fixture.zip
```

想看细节就加 `--keep`：脚本会保留临时数据目录（库、插件、日志）并打印路径。

### 用真实旧版本代码建 fixture

```bash
git worktree add ../prev-src v0.6.1
(
  cd ../prev-src
  pnpm install --frozen-lockfile
  # 旧 tag 的根 package.json 没有 prepare，SDK dist 要显式构建
  (cd packages/plugin-sdk && node build.mjs)
)

pnpm exec tsx scripts/upgrade-regression/build-fixture.ts \
  --server-cwd ../prev-src \
  --plugins-dir /tmp/upgrade-plugins \
  --out /tmp/upgrade-fixture-v0.6.1.zip \
  --label v0.6.1
```

`--server-cwd` 只影响「用哪份代码启动服务」；builder 脚本本身始终用当前 checkout 的版本，这样旧 tag 里没有新脚本也能建库。

### 启动方式（为什么不是 `tsx server.ts`）

`startServer()` 优先执行 `dist/server.cjs`，缺失时用 esbuild 就地打一个 CJS bundle（`--packages=external`，约 1 秒）。原因不是性能：

- 旧版本 `server.ts` 里有 `const distPath = __dirname || ...`，而仓库是 `"type": "module"`，tsx 下 `__dirname` 直接抛 `ReferenceError`，production 模式根本起不来。
- CJS 产物也是生产环境实际运行的形态（`pnpm start`），比 dev 服务器更接近真实升级场景。
- 不跑完整前端构建，避免为了建 fixture 付出几分钟的 Vite 打包成本。

## 反向验证（这个门禁自己可信吗）

`scripts/__tests__/upgrade-regression.test.ts` 用三条用例证明门禁不是绿漆：

1. 注入一条**非幂等迁移**（无 `IF NOT EXISTS` 的重复建表）→ `runMigrations` 必须抛错，且不留下半条 `_migrations` 记录。
2. 迁移中途失败 → 事务回滚，不留下半张表。
3. 改写已执行迁移的 UP → 严格模式下必须抛错。

## 维护

- **升级插件 fixture 版本**：改 `.github/actions/build-plugin-fixtures/action.yml` 里固定的 commit；缓存 key 会因 action 文件 hash 变化自动失效。
- **升级基线**：无需人工操作，`git describe` 会随新 tag 自动前移；打 tag 时 `publish-fixture` 会归档该版本的 fixture。
- **fixture 体积**：当前只含 DB + 插件 + storage 元数据，通常在 10 MB 以内；若某个插件的 fixture 数据过大，在 `snapshotFixture` 里排除对应子目录即可。
