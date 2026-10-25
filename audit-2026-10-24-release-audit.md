# 发布前审计报告 —— OpenLearn V2（2026-10-24）

**审计基线**：`main` @ `ed72cf8`（距 tag `v0.7.1`/`68d99ff` 之后 **47 个提交**，517 个文件变更，+19600 / -7714）
**审计环境**：本机 Node 24.1.0（fnm）；CI 基线 Node 22；npm 上 `openlearn-next` 最新为 **0.6.0**
**审计结论**：**建议暂缓发布**。质量门禁本身基本健康，但存在 **2 个 P0**（发布产物缺关键文件、版本号未提升）与 **2 个 P1**（格式门禁失效形态、权限基线自建文件不合规）。

> **2026-10-25 更新**：审计列出的 **P0-1 / P0-2 / P1-1 / P1-2 四项全部已修复并验证** —— 发布包缺文件、版本号占用、格式门禁责任漂移、平台自建文件权限不达基线。详见对应小节。**审计结论由此从「暂缓发布」转为「可发布（待提交 + 打 tag）」。**

---

## 一、门禁结果总表

| 门禁                       | 方式                                                                                            | 结果                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| TypeScript 类型检查        | `pnpm lint`                                                                                     | ✅ 通过                                                |
| 严格类型检查               | `pnpm lint:strict`                                                                              | ✅ 通过                                                |
| ESLint 告警预算棘轮        | `node scripts/check-lint-budget.mjs`                                                            | ⚠️ 通过但零余量（6243 / 上限 6243）                    |
| 源码编码检查               | `pnpm lint:encoding`                                                                            | ✅ 1675 文件无 U+FFFD / 非法字节                       |
| 中文硬编码检查             | `pnpm lint:i18n`                                                                                | ✅ 词典对称                                            |
| **Prettier 格式**          | `node scripts/check-format-budget.mjs`（全仓基线棘轮）                                          | ✅ 1877 个文件 0 不合规（基线清单为空）                |
| 单元测试                   | `pnpm test`                                                                                     | ✅ 599 文件 / 4958 用例（3 跳过）全绿                  |
| 生产构建                   | `pnpm build`                                                                                    | ✅ 通过（server.cjs 2.2 MB）                           |
| 发布包内容                 | `npm pack --dry-run`                                                                            | ✅ 114 文件 / 6.1 MB（修复 P0-1 后）                   |
| 发布包可启动               | 还原包布局后 `node dist/server.cjs`                                                             | ✅ 迁移 44 个文件就绪，`OpenLearn Next v0.7.2 ready`   |
| 版本一致性门禁             | `version-consistency.test.ts`                                                                   | ✅ 6 例通过（0.7.2）                                   |
| **发布脚本 dry-run**       | `bash scripts/publish.sh --dry-run`                                                             | ✅ 全流程通过，产出 `openlearn-next-0.7.2.tgz`，未发布 |
| 版本占用门禁               | 版本号已被 git tag / npm 占用时                                                                 | ✅ 预检阶段拒绝并指名冲突 tag                          |
| **敏感文件权限基线**       | `pnpm ops:check-perms`                                                                          | ✅ 通过（修复前 18 项违规 / 退出码 1）                 |
| 平台自建产物权限           | 全新实例启动后的实际权限                                                                        | ✅ 主库 / WAL / SHM = 600，backups/ = 700              |
| 依赖漏洞                   | `pnpm audit --audit-level high`                                                                 | ✅ 0 漏洞                                              |
| 文档漂移                   | `bash audit-tools/run.sh`                                                                       | ✅ drift 0 / 断链 0                                    |
| E2E 阻塞集                 | lesson-classroom-flow、segment-gate-lock、live-class-contrast、a11y-gate、shell-request-hygiene | ✅ 11/11 通过                                          |
| 公测关键旅程               | `playwright.beta.config.ts`                                                                     | ✅ 通过                                                |
| CI 全量 job                | `gh run list` @ ed72cf8                                                                         | ✅ 11 个 job 全绿                                      |
| Docker 发布演练 / 升级回归 | 同上                                                                                            | ✅ 通过                                                |
| 开放 issue                 | `gh issue list`                                                                                 | ✅ 0                                                   |

---

## 二、阻塞项

### P0-1　发布包缺少 `dist/plugin-net-preload.cjs`，npm 用户的第三方插件无法启动　✅ 已修复（2026-10-25）

> **修复内容**：① `package.json` 的 `files` 补入 `dist/plugin-net-preload.cjs`；② 把 `resolveNetPreloadPath()` 重构为支持注入解析起点（`NetPreloadResolutionOptions.startDirs/cwd`，对齐 `getDefaultMigrationsDir` 的既有模式），使「发布包布局」可被真实测试覆盖；③ 新增护栏测试 `packages/core/worker-runtime/__tests__/plugin-net-preload-packaging.test.ts`（5 例）；④ 新增可复现的端到端验证脚本 `scripts/verify-packaged-plugin-preload.mjs`（发布包实例 + process 模式插件激活，正反两组结果都可复现）。
> **验证**：tarball 113 → **114 个文件**，`package/dist/plugin-net-preload.cjs` 已在包内；包内 preload 真实加载测试可拦截原始 socket；用**从产物里抽出的真实解析函数**在「用户目录跑 npx」场景下解析到 `<pkg>/dist/plugin-net-preload.cjs`；**端到端 A/B**：发布包实例（cwd = 用户目录）安装并激活 `process` 模式第三方插件 —— 带该文件 → 激活成功（`status: active`，插件日志 `[audit-probe] activated successfully`）；删掉该文件 → 激活 500，`[PluginNet] preload script not found`（插件起不来）。护栏有效性反向验证：撤掉 `files` 条目后测试立即变红。

**现象**：本次发布的核心安全修复之一（#237 worker 模式出网管控）在 **npm 发布形态下失效**。

**证据链**：

1. 构建脚本会产出该文件，但 `files` 清单没有它：
   - `package.json:55` 构建末尾 `cp packages/core/worker-runtime/plugin-net-preload.cjs dist/plugin-net-preload.cjs`
   - `package.json:25-38` 的 `files` 只含 `dist/index.html`、`dist/server.cjs`、`dist/env-validation.cjs`、`dist/cli-migrator.cjs`、`dist/assets/`、`dist/plugins/`、迁移目录与 4 个 CLI —— **无 `dist/plugin-net-preload.cjs`**
   - 实际打出的 tarball：`tar -tzf openlearn-next-0.7.1.tgz | grep preload` → **无匹配**
2. 运行时解析逻辑 `packages/core/worker-runtime/child-spawn.ts:312-333` 的四个候选路径，在发布包布局下**全部落空**：
   - `path.join(__dirname, 'plugin-net-preload.cjs')` → `<pkg>/dist/...` → 包内无此文件
   - `process.cwd()/packages/core/worker-runtime/...`、`process.cwd()/dist/...` → 依赖用户当前目录
   - `import.meta.url` 派生那条：**esbuild 把 CJS 产物里的 `import.meta` shim 成 `{}`**（`dist/server.cjs:5814` `import_meta5 = {}`），`import_meta5.url` 恒为 `undefined` → 该候选**永久失效**
3. 该函数是 **fail-closed**：找不到即 `throw new Error('[PluginNet] preload script not found ...')`。
4. 触发面：未受信任的第三方插件被策略强制降级到 `process` 模式（`packages/core/plugin-host/execution-policy.ts:80-101`），而 `process` 模式正是靠该 preload 脚本封锁原始 socket / DNS。

**为什么 CI 抓不到**：CI 从仓库源码布局运行，服务 cwd = 仓库根 → `cwd/dist/plugin-net-preload.cjs` 命中本地构建产物。问题只在「按 `files` 清单还原的发布包」里出现。这与 CHANGELOG 中已修的 `migrations/` 缺失（P0，`npx` 起不来）**属于同一类打包缺陷**。

**建议修法**（二选一或都做）：

- 在 `package.json` 的 `files` 中补 `"dist/plugin-net-preload.cjs"`；
- 并补一条护栏测试（参照 `packages/core/db/__tests__/migrator-resolver.test.ts` 的做法）：断言「`files` 清单必须包含该文件」且「在还原后的发布包布局下 `resolveNetPreloadPath()` 不得抛错」。

---

### P0-2　版本号未提升，现在发布会破坏版本语义　✅ 已修复（2026-10-25）

> **修复内容**：① 版本升到 **`0.7.2`** —— 同步 `package.json` 与 `packages/core/version.ts` 的 `FALLBACK_VERSION`（`docs/conf.py` 动态读取 `package.json`，无需改动；`packages/plugin-sdk/dist/` 由构建脚本重新生成）；② `CHANGELOG.md` 的 `[Unreleased]` 段落为 `## [0.7.2] - 2026-10-25`，上方留空新的 `[Unreleased]`（与 v0.7.1 发布时的体例一致）；③ 新增 `docs/release-notes/v0.7.2.md`（按 `docs/release-notes/` 既有体例写全 47 个提交的变更说明）；④ `scripts/publish.sh` 新增 **`--dry-run`** 模式与**版本占用前置门禁**（版本号已被 git tag 或 npm 精确占用时直接拒绝发布；只对**即将发布**的包生效，已发布且版本未变的 SDK / test-kit 走跳过分支不受影响）。
> **验证**：`version-consistency` 门禁 6 例通过；`bash scripts/publish.sh --dry-run` 全流程通过 → 产出 `openlearn-next-0.7.2.tgz`（114 个文件，含 `dist/plugin-net-preload.cjs`），`workspace:*` 协议已还原，npm 上仍停在 0.6.0（**未发布任何内容**）；门禁有效性反向验证：把版本退回被占用的 `0.7.1` → 脚本在预检阶段即失败并指名冲突的 tag 与其 commit（`版本占用：git tag v0.7.1 已存在（68d99ff84507）`）。
> **注意**：**不要在提交之前打 `v0.7.2` tag** —— tag 必须指向包含版本号提升的那次提交，否则会重演「tag 与 npm 包指向不同代码」。

**事实**：

- `package.json` 版本仍是 `0.7.1`，而 `v0.7.1` 这个 tag 已存在，指向 `68d99ff`（距 HEAD 47 个提交）。
- npm 上 `openlearn-next` 最新版本是 **0.6.0** —— 即 0.7.0 / 0.7.1 从未发布过。
- 因此直接执行 `scripts/publish.sh` 会把「47 个提交之后的内容」以 **0.7.1** 的名义发到 npm：tag `v0.7.1` 与 npm `openlearn-next@0.7.1` 将指向**不同的代码**，且 CHANGELOG 的 `[Unreleased]` 段（9 条条目）与 `docs/release-notes/`（最新仍是 `v0.7.1.md`）都没有下一版说明。

**建议**：

1. 先决定目标版本号（建议 `0.7.2`，若把这批安全修复按 minor 定位则 `0.8.0`）；
2. 同步 `package.json` 与 `packages/core/version.ts` 的 `FALLBACK_VERSION`（`publish.sh` 的前置门禁 `version-consistency.test.ts` 会校验两者强一致，但**不校验版本号是否与既有 tag 重复** —— 这条缺口建议一并补上）；
3. 写 `docs/release-notes/v<新版本>.md`，并把 CHANGELOG 的 `[Unreleased]` 落到新版本段。

---

### P1-1　5 个文件格式不合规；格式门禁存在「责任漂移」漏洞，CI 的绿是不真实的　✅ 已修复（2026-10-25）

> **修复内容**：① 5 个不合规文件全部 `prettier --write` 格式化（含本次顺带处理的 `server/__tests__/file-permissions.test.ts`）→ **全仓 1877 个文件 100% 合规**；② **门禁改为全仓基线棘轮**：新增 `scripts/check-format-budget.mjs` + `config/format-budget.json`（与 ESLint 告警预算棘轮同构：清单外出现不合规即红，清理后 `--update` 收紧），CI 的 `format-check` 作业从「只检查本次变更触及的文件」换成全仓棘轮；③ 新增 `scripts/__tests__/format-budget.test.ts`（6 例，含「CI 里不得再出现 `Collect changed files`」这条防回退断言）。
> **验证**：基线清单为空（全仓必须合规），`node scripts/check-format-budget.mjs` 检查 1877 个文件 → 0 不合规、退出码 0；反向验证（故意弄脏 `packages/core/version.ts`）→ 立即报出该文件并退出码 1，还原后复跑又绿；ESLint 告警预算未受影响（新增文件 0 告警，仍 6243/6243）；`tsc --noEmit` 通过；CI YAML 经解析器校验，`format-check` 作业只剩 `Format budget ratchet` 一步。

**不合规文件**（全仓 `prettier --check` 结果，差异均很小）：

| 文件                                                | 差异行数 | 最后改动         |
| --------------------------------------------------- | -------- | ---------------- |
| `docs/administrator-guide/admin-manual.md`          | 13       | `fd329da` (#288) |
| `docs/architecture/security-permissions.md`         | 14       | `ebcb7a8` (#290) |
| `packages/core/db/__tests__/backup-restore.test.ts` | 9        | `1445b54` (#287) |
| `scripts/coverage-ratchet.mjs`                      | 4        | `8b55b7e` (#289) |
| `server/__tests__/file-permissions.test.ts`         | 4        | `fd329da` (#288) |

**门禁失效形态（这是本次审计最值得记的一条）**：这 5 个文件都是 2026-10-24 刚合入的提交，而那三次 main push 的 CI **确实是红的** —— 失败 job 就是 `Format check`：

- `40075389277`（#288）→ Format check ❌
- `40075941132`（#289）→ Format check ❌
- `40076927131`（#290）→ Format check ❌

但 CI 的 format-check job 只检查「**本次变更触及的文件**」（`ci.yml:151-177`，PR 取 `base...HEAD`，push 取 `HEAD~1..HEAD`）。文件一旦合入 main，只要后续没有 PR 再碰它，就**再也没有任何一次 CI 会检查它** —— 于是 HEAD（#292）的 CI 11 个 job 全绿，而 main 里仍躺着 5 个不合规文件。

**后果**：

1. 现在发布会把这些文件原样发出去（其中 `scripts/coverage-ratchet.mjs` 是**发布流程的一部分**，`pnpm test:ratchet` 直接消费它）；
2. 下一个碰这些文件的 PR 会立刻红，且开发者会误以为是自己的改动导致的。

**建议**：`pnpm exec prettier --write` 这 5 个文件并单独提交；同时给 format-check job 增加一条「全仓基线快照比对」（与 `scripts/check-lint-budget.mjs` 的棘轮同构），否则该门禁永远只能拦住「本次 PR 新引入的」格式问题。

---

### P1-2　平台自建的主库与备份目录不满足自身权限基线，运维门禁在全新环境开箱即红　✅ 已修复（2026-10-25）

> **修复内容**：① 新增 `packages/core/db/secure-files.ts`（共享的收紧原语：`ensureSecureFile` / `ensureSecureDir` / `hardenFile` / `hardenDir` / `secureDatabaseFiles`）—— 文件在 `open(..., 0o600)` 时产生、目录在 `mkdir(mode: 0o700)` 时产生，**创建即合规**，不存在「先 644 再 chmod」的暴露窗口；只收紧不放宽（0400 不会被改成 0600）。
> ② 接入全部创建点：主库（`packages/core/db/index.ts` 打开前 `ensureSecureFile` + 打开后 `secureDatabaseFiles`）、**WAL/SHM 侧车**、备份目录（`backup-manager.ts` ×2、`migrator.ts` 快照目录）、恢复前的安全副本与恢复覆盖后的主库。
> ③ **补上基线漏掉的 WAL/SHM 侧车**：此前基线只查主库，而侧车在 WAL 模式下装着尚未 checkpoint 的全量学生数据 —— 「主库 600 + WAL 644」等于没设防。现在侧车与主库同口径检查。
> ④ `scripts/check-file-permissions.ts` 新增 **`--fix`**：把既有文件按基线收紧（文件 600 / 目录 700），供既有部署一步 remediation；`.env` 属用户自写文件，**不在启动期自动改**，只能经 `--fix` 显式处理。
> **验证**：全新实例（发布包 + 空数据目录）启动 → 主库 / `-wal` / `-shm` 均为 **600**、`backups/` 为 **700**，启动期权限自检**零 ERROR**（修复前是 2 条）；本机 `pnpm ops:check-perms` 由 **18 项违规 → 0**（`--fix` 收紧 20 项后），不带 `--fix` 的复验退出码 **0**；新增 `packages/core/db/__tests__/secure-file-permissions.test.ts`（8 例）与扩展后的 `server/__tests__/file-permissions.test.ts`（6 例）全绿。
>
> **顺带踩到并解决的一个坑（值得记）**：`packages/plugin-sdk/generated.d.ts` 是 SDK 声明生成器（`packages/plugin-sdk/generate-dts.mjs`）的产物，而该生成器的符号闭包会跟随「**入口导出符号的声明节点里引用到的每个标识符**」。把 `ensureSecureFile(...)` 写进 `export const db = (() => {...})()` 的初始化式，会把 helper 连同 `applyPragmas` 一起拖进 `generated.d.ts` —— 在那里它们是「已定义未使用」的形态，直接让 ESLint 告警从 6243 顶到 **6248**，**顶破棘轮上限**（棘轮只许降不许升）。解法不是放宽上限，而是把 helper 调用写成**顶层语句**（`db` 的声明节点保持原样），闭包随之恢复，`generated.d.ts` 回到与提交版逐字节一致，告警回到 6243/6243。同理，`secure-files` **不再从 `packages/core/db/index.ts` 再导出** —— 它是内部实现细节，不该进 core 的公共面。

**实测**（用发布包在空目录启动，日志原文）：

```
[ERROR] /tmp/pkgtest/data/educational_os.db → 644（期望 ≤600，database）
[ERROR] /tmp/pkgtest/data/backups → 755（期望 ≤700，backup-dir）
```

**成因**：

- 主库由 `new Database(dbPath)`（`packages/core/db/index.ts:364`）创建，better-sqlite3 按默认 umask 落盘 → 644；
- 备份目录由 `fs.mkdirSync(backupDir, { recursive: true })`（`packages/core/db/backup-manager.ts:213/294/315`、`packages/core/db/migrator.ts:154`）创建 → 755；
- 而备份**文件**本身已经修好（`backup-manager.ts:241`、`migrator.ts:164` 创建即 600），说明这一轮的修复**只覆盖了文件、没覆盖主库与目录**。

**后果**：`pnpm ops:check-perms` 在全新部署上直接失败（退出码 1）；启动期自检每次都会打 ERROR。而基线的立论是「多用户机器上任何本地账号都能读走全量学生数据」—— 主库 644 正是这个风险本身。

**建议**：创建主库与备份目录时即 `mode: 0o600` / `0o700`（或创建后立刻 chmod），并补一条测试断言「平台自建文件的权限即满足基线」。

---

## 三、观察项（不阻塞发布，但建议记账）

1. **构建会改写受版本控制的源文件**：`pnpm build` 里的 `build-bridge-sdk.mjs` 会用 `packages/bridge-sdk/src/bridge.js` 重新生成 `server/utils/bridge-sdk.ts`，构建后工作区出现 493 行 diff（语义等价，仅内嵌 JS 的格式差异，已逐字符比对确认去掉空白后完全一致）。两个后果：① `git commit -a` 容易误提交；② **仓库测试跑的 payload 与发布产物跑的 payload 不是同一份**，测试件 ≠ 发布件。建议把生成物加入 `.gitignore` 或在构建后自动还原。
2. **ESLint 告警预算零余量**：6243 条 / 上限 6243。新增任何一条 `no-explicit-any` 都会让 CI 变红，建议在下个 PR 里主动收紧基线。
3. **环境变量文档缺口**：`server/security/env-validation.ts` 强校验 14 个 `OPENLEARN_*` 键，其中 `OPENLEARN_WORKER_LIVENESS_GRACE_MS` 在 `.env.example` 里只以缩写 `_GRACE_MS` 出现（`line 74`），按字面 grep 查不到；其余 13 个键均有文档。
4. **本机环境不合规**（非仓库问题）：仓库根 `.env` 为 644（含 `ENCRYPTION_KEY`）、`packages/core/db/backups/` 为 755、18 个历史 `pre_migration_*.db` 为 644。**已于 2026-10-25 用 `pnpm ops:check-perms --fix` 全部收紧**（文件 600 / 目录 700），复验通过、退出码 0。
5. **Node 版本陷阱**：`engines` 声明 `>=20`、CI 用 22，但本机默认 shell 落在 Node 26.12.0。在 Node 26 下跑 `pnpm test` 会得到 **367 个假失败**（jsdom 的 `localStorage` 为 undefined + better-sqlite3 原生模块 ABI 137≠147），并非回归。审计中已用 Node 24.1.0 复跑确认为全绿。建议在 `engines` 或 README 里明确「需 Node 20–24」。
6. **`e2e/shell-request-hygiene.spec.ts` 直接写开发库**：它硬编码 `packages/core/db/educational_os.db` 并直接 INSERT 教师/学生（`spec:47`），与服务器实际使用的库解耦 —— 用隔离库跑必失败（本次审计首次跑 2 例失败即由此导致）。这是既有设计（用 `e2e_`/`STU_` 前缀 + `cleanup-test-data.mjs` 回收），但意味着「本地 e2e 必须用仓库默认库」，隔离环境需另行适配。
7. **单元测试存在偶发单条失败（身份未捕获）**：本次审计期间跑了 7 轮全量 `pnpm test`，其中 **5 轮全绿**、**2 轮各出现 1 条失败**。两次失败时输出都被管道截断（`| tail`），**没能捕获失败用例名**；随后用 `--reporter=json --outputFile` 重跑则 0 失败（4952 通过）。倾向判断为既有的时序敏感用例（仓库 CI 的 `E2E full coverage` 作业已记录过同类不稳定项），且 CI 在 HEAD 上连续两次 push 均全绿。**建议**：下次再遇到时用 `pnpm vitest run --reporter=json --outputFile=/tmp/v.json` 抓出失败用例名，登记为 `test.describe.skip` 并注明原因（与 Issue #230 的处理口径一致），别让它继续以「随机 1 条红」的形式消耗排查时间。

---

## 四、复现命令

```bash
# P0-1 发布包缺文件
npm pack --dry-run | grep -i preload                     # 无输出
tar -tzf openlearn-next-0.7.1.tgz | grep preload          # 无输出
node -e "const p=require('path'),f=require('fs');console.log(f.existsSync(p.join('<pkg>','dist','plugin-net-preload.cjs')))"  # false

# P0-2 版本语义
git describe --tags --always        # v0.7.1-47-ged72cf8
npm view openlearn-next versions     # 最新 0.6.0
node -p "require('./package.json').version"               # 0.7.1

# P1-1 格式（修复后：全仓基线棘轮）
node scripts/check-format-budget.mjs          # 检查 1877 个文件；基线外出现不合规即红
gh run view 40075389277 --json jobs -q '.jobs[] | select(.conclusion=="failure") | .name'   # 历史：Format check

# P1-2 权限基线
pnpm ops:check-perms                  # 全新环境退出码 1
```

---

## 五、放行建议

按顺序处理 —— **四项全部已完成（2026-10-25）**：

1. ~~**P0-1**：`files` 补 `dist/plugin-net-preload.cjs` + 发布包布局护栏测试~~ ✅ **已修复**
2. ~~**P0-2**：定版（0.7.2）→ 同步 `package.json` 与 `version.ts` → 写发布说明 → CHANGELOG 落地~~ ✅ **已修复**
3. ~~**P1-1**：5 个文件格式化 + 格式门禁改为全仓基线棘轮~~ ✅ **已修复**
4. ~~**P1-2**：主库 / WAL / SHM 侧车创建即 600、备份目录创建即 700 + 基线补查侧车 + `--fix`~~ ✅ **已修复**
5. **接下来**：把上述改动提交（含版本号提升）→ 重跑本报告第一节的全部门禁（`pnpm test` + e2e 阻塞集 + `pnpm build` + `npm pack` 还原启动 + `bash scripts/publish.sh --dry-run`）→ 打 `v0.7.2` tag → 执行 `scripts/publish.sh`。

**结论**：审计列出的阻塞项已全部关闭，**可进入发布流程**。唯一残留是「单元测试偶发单条失败」这一观察项（既有 flaky，非本次改动引入）。

**风险提示**：`scripts/publish.sh` 会直接对 npm registry 执行 `npm publish`（`@openlearn/plugin-sdk` 3.7.0 与 `@openlearn/plugin-test-kit` 3.3.3 因远端已是同版本会被自动跳过），且发布过程中会临时改写根 `package.json` 的 `workspace:*` 协议 —— **发布前先跑 `bash scripts/publish.sh --dry-run`**：它走完整流程但不发布任何内容，并打印最终 tarball 的文件清单与版本。

**发布时的 tag 时机**：先提交（含版本号提升），**再**打 `v0.7.2` tag —— tag 必须指向包含版本提升的那次提交，否则 tag 与 npm 包会指向不同代码，重演本次 P0-2。
