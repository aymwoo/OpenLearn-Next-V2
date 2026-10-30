# 版本兼容与迁移

> **适用范围**：`@openlearn/plugin-sdk@3.7.5` / OpenLearnV2 v0.7.8
> 解决两个问题：**宿主版本和 SDK 版本是同一条线吗？** 插件升级后，老用户的数据怎么办？

---

## 0. 先纠正三个先验

```{danger} ⚠ 与 LLM 先验冲突 1：两条版本线，彼此独立
**宿主版本**（`engines.openlearn`，当前 `0.7.8`）和 **SDK 版本**
（`@openlearn/plugin-sdk`，当前 `3.7.5`）是**两条互不相干的版本线**。

- 宿主升级 **不必然** 要求插件换 SDK 版本；SDK 升到 `3.7.5` 也不要求宿主升到某个版本。
- SDK 是**独立发版**的 npm 包，它的版本号与宿主版本号没有对应关系。
- 所以「宿主 0.7.8 就该用 SDK 3.7.5」是巧合，不是规则。

→ **两个都要显式声明**：manifest 里写 `engines.openlearn`，
`package.json` 里写 `"@openlearn/plugin-sdk": "^3.7.5"`。
```

```{danger} ⚠ 与 LLM 先验冲突 2：engines.openlearn 不写 = 不检查
宿主在安装时用 `semver.satisfies(OPENLEARN_VERSION, manifest.engines.openlearn)` 判断，
**但整个判断包在 `if (manifest.engines?.openlearn)` 里** ——
**不写这个字段，等于放弃兼容性声明，装上任何版本都不拦你**。

→ 一定要写。它是唯一的「装不上」的防线，也是唯一的「装上了但跑不动」预警。
```

```{warning} ⚠ 与 LLM 先验冲突 3：迁移写在 activate 里，不是独立步骤
插件的数据迁移**没有**框架级「迁移钩子」。唯一受支持的方式是在
`activate`（或首次访问时）调用 `ctx.db.migrate(targetVersion, upgradeFn)`，
由宿主记录版本号、保证幂等。

→ **`migrations/*.sql` 这类声明式迁移文件不会随 ZIP 进包，也不会被自动执行。**
插件自己声明、自己在 `activate` 里驱动。
```

---

## 1. 两条版本线

|              | 宿主版本                                                              | SDK 版本                                             |
| :----------- | :-------------------------------------------------------------------- | :--------------------------------------------------- |
| 声明位置     | `manifest.json` 的 `engines.openlearn`                                | `package.json` 的 `dependencies` / `devDependencies` |
| 当前值       | `0.7.8`                                                               | `3.7.5`                                              |
| 约束方式     | `semver.satisfies` 在**安装时**检查                                   | npm 解析 + `engines` 字段自检                        |
| 不满足的后果 | **装不上**，报 `requires OpenLearn <range>, current version is <ver>` | 运行时才暴露（缺 API、缺依赖）                       |
| 谁能变       | 随宿主发布                                                            | 随时可发新版，**不需要**宿主配合                     |

**`engines.openlearn` 的取值**是标准 semver range：

```json
{
  "engines": {
    "openlearn": ">=0.7.0"
  }
}
```

宿主版本从 `packages/core/version.ts` 的 `OPENLEARN_VERSION` 读取。

---

## 2. `requires` / `optional` 的版本后缀

`manifestSchema`（Phase 6+）允许在服务依赖后加 `@版本`：

```
@scope/domain:IServiceName              ← 不带版本
@scope/domain:IServiceName@^1.0.0       ← 带版本
```

正则（`requiresItemSchema`）：

```
^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$
```

**要点**

- 版本后缀只接受 `^` / `~` / 裸版本，且必须是**完整三段** `x.y.z`（可带预发布后缀）。
  `>=1.0.0`、`1.0` 都会被判**格式无效**（manifest 校验直接失败）。
- **旧的 `manifestSchemaV3` 不接受版本后缀** —— `requiresItemSchemaV3` 是严格格式。
  宿主当前用 `manifestSchema`（带后缀支持）。
- `optional` 里的服务**版本不匹配不会阻止激活**，而是把 `ctx.services.<key>` **置为 `null`**。
  见 {doc}`plugin-context` §2。

---

## 3. SDK 版本沿革与迁移动作

| SDK 版本 | 变化                                                                                                                                        | 你需要做什么                                                       |
| :------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------- |
| `3.7.0`  | 脚手架生成**旧模板**：`export default function Component()`。沙箱加载器要求 `plugin.activate` 是函数 → 装完直接 `missing activate function` | 重新 `init` 或手工把导出改成 `export async function activate(ctx)` |
| `3.7.1`  | **已在 npm 弃用**。产物残留 `node:` 内置模块静态导入，运行期失败                                                                            | 不要装；升到 `3.7.5`                                               |
| `3.7.4`  | 引入**前端构建守卫**：产物不得残留裸模块说明符（`import 'xxx'`），因为 frame 沙箱按浏览器原生模块执行                                       | 重新构建；不要手工往 `frontend.js` 里塞裸导入                      |
| `3.7.5`  | 补齐 SDK 自身缺失的 **`uuid` 运行时依赖**，并加固裸导入构建守卫                                                                             | 升到 `3.7.5`。**这是当前唯一推荐版本**                             |

### 3.1 迁到 3.7.5 要做什么

```bash
npm i -D @openlearn/plugin-sdk@3.7.5
rm -rf node_modules package-lock.json && npm i
npx @openlearn/plugin-sdk build
```

逐项自查：

- [ ] `node_modules/@openlearn/plugin-sdk/package.json` 的 `version` 是 `3.7.5`
- [ ] 脚手架产物是 `export async function activate(ctx) { ... }`（不是 `export default function`）
- [ ] `dist/frontend.js` 里没有裸模块说明符：`! grep -qE "^import ['\"]" dist/frontend.js`
- [ ] 如果之前靠手工补 `"uuid": "^14.0.2"` 绕过 SDK 缺陷 —— **可以删掉了**，`3.7.5` 已自带

> `3.7.4` 及更早的包在某些入口会抛 `ERR_MODULE_NOT_FOUND: Cannot find package 'uuid'`。
> 这是 SDK 自身的缺陷，不是你的代码问题，升版本即可。

---

## 4. 数据迁移

### 4.1 唯一受支持的路径：`ctx.db.migrate`

```typescript
export async function activate(ctx: PluginContext): Promise<void> {
  await ctx.db.migrate(2, async (db) => {
    // 从版本 1 升到 2
    db.exec(`ALTER TABLE ${ctx.db.table('configs')} ADD COLUMN theme TEXT`);
  });
}
```

**契约**（`PluginDatabaseAPI.migrate`）

| 参数            | 类型                            | 说明                     |
| :-------------- | :------------------------------ | :----------------------- |
| `targetVersion` | `number`                        | 目标版本号，**单调递增** |
| `upgradeFn`     | `(db) => Promise<void> \| void` | 升级函数；**可 async**   |

**宿主行为**

1. 建表 `plugin_migrations (plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL)`；
2. 读当前版本（没有记录则视为 `0`）；
3. **只有 `currentVersion < targetVersion` 才执行** `upgradeFn` —— 天然幂等；
4. 执行期包在 `BEGIN IMMEDIATE` 事务里；抛错则 `ROLLBACK`，版本号不变（下次仍会重试）。

> 事务是 `IMMEDIATE` 模式 —— 迁移期间会拿写锁。**不要在 `upgradeFn` 里调宿主服务**，
> 那可能触发别的写事务，造成锁等待。迁移里只碰 `db`。

### 4.2 worker 运行时是另一份实现

进程型插件（`executionMode: "process"`）走 worker 运行时，
它在 `packages/core/worker-runtime/bootstrap/sections/message-handler.ts` 里
**独立实现了同一套 `plugin_migrations` 语义**。

→ **两条路径共用同一张 `plugin_migrations` 表**，所以迁移逻辑在两种运行形态下互通。
但 `upgradeFn` 拿到的 `db` 对象不同（宿主侧是同步的 `better-sqlite3`，
worker 侧是 `dbService` 的异步封装），**迁移代码要按运行形态写**，
或干脆只用同步 API 并保证 worker 侧也支持。

### 4.3 声明式迁移文件不会被执行

- `migrations/*.sql` 之类的文件**不会**被打进 ZIP（见 {doc}`publishing-and-distribution` §3）；
- 宿主**不会**扫描并执行它们；
- 唯一受支持的是 `ctx.db.migrate()`。

→ 要用 SQL 文件，请自己读文件并执行（但注意文件也要自己打进 ZIP）。

---

## 5. 排障速查

| 现象                                                          | 根因                                            | 修法                                                                         |
| :------------------------------------------------------------ | :---------------------------------------------- | :--------------------------------------------------------------------------- |
| 安装报 `requires OpenLearn >=0.8.0, current version is 0.7.8` | `engines.openlearn` 范围太窄                    | 放宽范围，或等宿主升级；确认 `OPENLEARN_VERSION` 真值                        |
| 装到了**明显不兼容**的宿主上                                  | 压根没写 `engines.openlearn`                    | 补上，永远别省                                                               |
| manifest 校验失败：`requires/optional 条目格式无效`           | 用了 `>=1.0.0` / `1.0` / 带 `@latest`           | 只接受 `@^1.0.0` / `@~1.0.0` / `@1.0.0` 三段式                               |
| 同一个 `@version` 后缀在 V3 schema 下不被接受                 | 用了 `manifestSchemaV3`                         | 宿主当前用 `manifestSchema`；确认调用方                                      |
| 装上后 `missing activate function`                            | SDK ≤ 3.7.0 的旧模板                            | 升 SDK ≥ 3.7.5 并重新 `init`；导出改成 `export async function activate(ctx)` |
| `ERR_MODULE_NOT_FOUND: Cannot find package 'uuid'`            | SDK < 3.7.5 缺运行时依赖                        | 升到 `3.7.5`；临时可手工补 `"uuid": "^14.0.2"`                               |
| 前端报 `Cannot use import statement`                          | `frontend.js` 有裸模块说明符                    | 用 SDK ≥ 3.7.4 重建；见 §3                                                   |
| `ctx.services.xxx` 是 `null`                                  | `optional` 依赖版本不匹配                       | 判空；或改用 `requires`（不匹配会直接装不上）                                |
| 迁移函数每次激活都重跑                                        | `targetVersion` 没递增，或 `upgradeFn` 抛错被吞 | 递增 `targetVersion`；检查 `upgradeFn` 是否抛异常（抛了会 ROLLBACK）         |
| 迁移报 `database is locked`                                   | 迁移期拿写锁，却在 `upgradeFn` 里调了别的写事务 | `upgradeFn` 里只碰 `db`，不要调宿主服务                                      |
| 数据升了但版本号没升                                          | 直接改了表结构而没走 `migrate`                  | 统一走 `ctx.db.migrate`；手工改表后要手动更新 `plugin_migrations` 的版本号   |
| 插件被重装后数据没了                                          | 卸载时 `dropAllTables()` 删了插件自有表         | 重要数据不要放插件自有表；用宿主存储或 `ctx.db` 之外的持久化方案             |

---

## 6. 自检清单

- [ ] `manifest.json` 写了 `engines.openlearn`，且范围覆盖目标宿主版本
- [ ] `engines.openlearn` 是合法 semver range（不是 `>=x.y` 这种两段式）
- [ ] `package.json` 的 `@openlearn/plugin-sdk` 是 `^3.7.5`
- [ ] `node_modules` 里实际装的是 `3.7.5`（不是 lock 文件里的旧版本）
- [ ] 导出的入口是 `export async function activate(ctx)`
- [ ] `dist/frontend.js` 无裸模块说明符
- [ ] 所有 `requires` / `optional` 条目都符合 `@scope/domain:IService@^x.y.z` 格式
- [ ] 凡是 `optional` 依赖，消费处都判了 `null`
- [ ] 数据结构变更走的是 `ctx.db.migrate(targetVersion, fn)`，且 `targetVersion` 单调递增
- [ ] `upgradeFn` 里没有调用宿主服务（只碰 `db`）
- [ ] `upgradeFn` 是幂等的（重复执行不炸）

---

## 取证

| 结论                                                                 | 位置                                                                              |
| :------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| `engines.openlearn` 用 `semver.satisfies` 在安装时校验               | `packages/core/plugin-host/install.ts`（L116–L120、L291–L295）                    |
| 宿主版本来源                                                         | `packages/core/version.ts` → `OPENLEARN_VERSION`（L44）                           |
| `requires` 条目正则与错误文案                                        | `packages/core/esm-loader/manifest-schema.ts` → `requiresItemSchema`（L776–L778） |
| `manifestSchema` 与 `manifestSchemaV3` 的差异（是否支持 `@version`） | `packages/core/esm-loader/manifest-schema.ts`（L781–L786、L870）                  |
| `ctx.db.migrate` 的接口签名                                          | `packages/core/plugin-host/types.ts` → `PluginDatabaseAPI`（L107）                |
| `migrate` 的事务与版本记录实现                                       | `packages/core/plugin-host/context-builder.ts`（L1003–L1021）                     |
| worker 运行时同语义实现                                              | `packages/core/worker-runtime/bootstrap/sections/message-handler.ts`（L383–L416） |
| SDK 3.7.x 沿革与 3.7.5 的 uuid 修复                                  | `packages/plugin-sdk/CHANGELOG.md`                                                |
| ZIP 只装三个文件（`migrations/*.sql` 不在内）                        | `packages/plugin-sdk/cli.mjs`（L546–L551）                                        |
| `optional` 版本不匹配 → 服务置 `null`                                | `packages/core/plugin-host/context-builder.ts`（`buildContext`）                  |
