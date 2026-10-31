# 测试指南

**结论先行**：Mock 上下文**故意没有安全模型** —— 它能证明「逻辑对」，不能证明「装到宿主上能跑」。
因此测试是四层阶梯（L0 静态契约 / L1 契约 / L2 冒烟 / L3 真实宿主），**L3 不可省**。

---

## 1. 四层阶梯

| 层     | 手段                             | 耗时     | 抓什么                                                                                 |
| ------ | -------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| **L0** | 静态检查脚本（零依赖）           | <1s      | manifest 必填 / 能力串真伪 / 三件套配对 / 槽位真伪 / `view` 前缀 / 裸导入 / 中文 ≤12px |
| **L1** | `createMockContext()` + `vitest` | ~0.3s    | 声明的入口与实际注册一致、handler 形状、`inputSchema`、capability 真实性               |
| **L2** | 同上，跑命令                     | ~0.3s    | 重复激活、执行期 `TypeError`、事件 payload、停用后残留                                 |
| **L3** | 真实宿主                         | 3–10 min | 能力审批、子进程隔离、网关限流、真实槽位渲染                                           |

---

## 2. `@openlearn/plugin-test-kit` API

```ts
import {
  createMockContext,
  MockCommandBus,
  MockEventBus,
  MockActionRegistry,
  createMockStreamResponse,
  runTestPluginMigrations,
} from '@openlearn/plugin-test-kit';

interface CreateMockContextOptions {
  pluginId?: string; // 默认 'ext-test'
  manifest?: Partial<Manifest>; // 默认 { id, name:'Test Plugin', version:'1.0.0', main:'index.js' }
  capabilities?: string[]; // 默认 []，会 grant 给 plugin:<pluginId>
  customTokens?: Record<string, unknown>; // 覆盖 resolve()
  overrides?: {
    // 浅合并到默认 mock
    commandBus?: Partial<ICommandBusService>;
    eventBus?: Partial<IEventBusService>;
    actionRegistry?: Partial<IActionRegistryService>;
    capability?: Partial<ICapabilityService>;
    processManager?: Partial<IProcessService>;
    storage?: Partial<IStorageService>;
    ai?: Partial<IAIService>;
  };
}

const ctx = createMockContext({ pluginId: '@acme/plugin-x', capabilities: ['lesson:read'] });
await activate(ctx); // 你插件导出的 activate
```

证据：`packages/plugin-test-kit/index.ts → createMockContext`（L328）、`CreateMockContextOptions`（L39）。

### 2.1 Mock 里有什么

| 能力                          | Mock 行为                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `ctx.db`                      | 真 `better-sqlite3` `:memory:`，自动建 `plugin_storage` / `plugin_migrations` |
| 表前缀                        | `plugin_<pluginId 清洗后>_`（非 `!`/`@` 都替换为 `_`，L381）                  |
| `ctx.db.migrate`              | 真事务（`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`）                           |
| `ctx.resolve(IDatabaseToken)` | 返回同一个内存 DB                                                             |
| `ctx.services.commandBus`     | `MockCommandBus`：`handlers` Map + `executeCalls` 数组                        |
| `ctx.services.eventBus`       | `MockEventBus`：`subscribers` + `publishCalls`，支持 `'*'` 通配               |
| `ctx.services.capability`     | `MockCapability`：`grant` 只记录，不校验                                      |
| `ctx.http`                    | 真 `PluginHttpRouter`（可直接 `handle(req)` 断言）                            |
| `ctx.config`                  | **空壳**（不读 manifest default）                                             |
| `ctx.contributions.list()`    | `[]`                                                                          |
| `ctx.i18n.t`                  | 回显 key                                                                      |

---

## 3. Mock 与真实宿主的 8 处差异（必须知道）

| 项                               | Mock             | 真实宿主                               |
| -------------------------------- | ---------------- | -------------------------------------- |
| `registerHandler('x.y')` 的键    | **原样** `x.y`   | `<manifest.id>.x.y`                    |
| `execute` 未命中                 | 返回 `undefined` | 抛 `No handler registered for command` |
| ActionDescriptor default-deny    | **不校验**       | 403 `COMMAND_NOT_REGISTERED`           |
| `capabilityRequired` 校验        | **不校验**       | 403 `COMMAND_CAPABILITY_DENIED`        |
| 空 `capabilitiesProposed` 只读锁 | **不存在**       | Barrier 2 拒绝非 `get*`                |
| `ctx.config.*`                   | 空壳             | 三层作用域覆盖                         |
| 跨进程函数传递                   | 无概念（同进程） | `DataCloneError`                       |
| 隔离档位                         | 无               | 强制 `process`                         |

**推论**：这 8 条覆盖的代码路径（`ensureTable` 命名、`provide` 声明、`require` 白名单、能力声明、函数跨边界）
**必须**再做一次 L3。

证据：`openlearn-next docs/agent/reference/testing.md`「Mock 与生产差异」表。

---

## 4. 六件必测事项

### 4.1 三件套配对（双向）

```ts
it('每个 manifest commandType 都有 handler + descriptor', async () => {
  const ctx = createMockContext({ pluginId: '@acme/plugin-x', capabilities: ['lesson:read'] });
  const manifest = (plugin.default as any).manifest;
  await plugin.default.activate(ctx);

  const declared = [
    ...(manifest.classroomTools ?? []).map((t: any) => t.commandType),
    ...Object.values(manifest.contributes ?? {})
      .flat()
      .map((e: any) => e?.commandType)
      .filter(Boolean),
  ];

  for (const raw of declared) {
    const full = `${manifest.id}.${raw}`; // 宿主侧键
    expect(ctx.services.commandBus!.handlers.has(full) || ctx.services.commandBus!.handlers.has(raw)).toBe(true);
    expect(ctx.services.actionRegistry!.getActionByCommandType?.(raw) ?? true).toBeTruthy();
  }
});
```

> Mock 不补前缀，所以断言时**两种键都试**；生产侧一定是全限定名。

### 4.2 handler 必须是 `{ execute }`

```ts
expect(typeof handler).toBe('object');
expect(typeof handler.execute).toBe('function');
```

裸函数在 Mock / worker / process 下都报 `handler.execute is not a function`。

### 4.3 能力串真伪

```ts
const REAL = new Set([/* 19 条，见 capabilities-and-security.md §1.1 */]);
for (const c of manifest.capabilitiesProposed ?? []) expect(REAL.has(c)).toBe(true);
```

### 4.4 执行期不崩

按 `inputSchema` 造最小 payload 跑每条命令，断言无 `TypeError` / `ReferenceError`。

### 4.5 生命周期可重入

```ts
await activate(ctx);
await deactivate?.();
const before = ctx.services.eventBus!.subscribers.get('lesson.created')?.size ?? 0;
await activate(ctx);
const after = ctx.services.eventBus!.subscribers.get('lesson.created')?.size ?? 0;
expect(after).toBe(before); // 订阅数不翻倍
```

### 4.6 前端边界

| 模式                | 断言                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `process`           | `dist/frontend.js` 无 `React` / `document.` / `window.` / `fetch(` / 裸说明符 |
| `inline`            | React 只来自 `HostSharedDeps`                                                 |
| 有 `storage/*.html` | 页面引 `/plugin-sandbox/view-bridge.js`、调 `ui.resize()`、无 `alert(`        |

---

## 5. 测试文件组织（仓库现状两种风格）

### 5.1 平台风格：Vitest + `__tests__/`

```text
packages/plugin-host/__tests__/lifecycle.test.ts
src/plugin-host/__tests__/extension-point-renderer.test.tsx
```

配置：`vitest.config.ts`，`fileParallelism: true`，每 worker 独立临时 SQLite（`/tmp/openlearn_test_dbs/`），60s 超时。

### 5.2 示例插件风格：Node 原生 test runner

```json
"scripts": {
  "test": "node test/build-test-bundle.mjs && node --test test/csv.test.mjs test/smart-assign.test.mjs test/plugin.test.mjs"
}
```

纯函数（`csv.ts` / `smart-assign.ts`）用 `node --test` 直接测，不需要宿主依赖 —— **这是低成本的正确做法**。

---

## 6. L0 静态检查（自己写，不难）

最小可用规则集（每条对应一个真实事故）：

| 规则          | 判据                                                     | 错误码（建议）               |
| ------------- | -------------------------------------------------------- | ---------------------------- |
| manifest 必填 | `id/name/version/main` 存在且非空                        | `MANIFEST_FIELD_MISSING`     |
| `id` 无冒号   | 不含 `:`                                                 | `MANIFEST_ID_INVALID`        |
| 能力串真伪    | ⊆ 19 条命令能力 ∪ 8 条方法能力                           | `CAP_UNKNOWN`                |
| 三件套配对    | 每个 `commandType` 有 handler + descriptor               | `COMMAND_DESCRIPTOR_MISSING` |
| 空能力门禁    | `capabilitiesProposed` 为空且 `activate` 里有非 get 调用 | `CAP_EMPTY_ISOLATED`         |
| `view` 前缀   | 以 `storage/` 开头                                       | `VIEW_PREFIX_INVALID`        |
| 前端边界      | `frontend.js` 无 React/DOM/裸说明符                      | `FRONTEND_BOUNDARY`          |
| 中文字号      | 声明式样式里 `font-size` ≥ 13px                          | `FONT_TOO_SMALL`             |
| 裸导入        | 无 `from 'crypto'` 等                                    | `BARE_IMPORT`                |

实现要点：**不要用正则解析 TypeScript**，直接对 `dist/` 产物与 `manifest.json` 做文本扫描即可。

---

## 7. 测试红了先归因

| 现象                                  | 归属     | 动作                                          |
| ------------------------------------- | -------- | --------------------------------------------- |
| `Cannot find package 'uuid' / 'zod'`  | 环境     | 补依赖                                        |
| `handler.execute is not a function`   | 插件     | 改 `{ execute }` 对象                         |
| `Cannot read properties of undefined` | 插件     | 补判空（多半是 `ctx.services.*` 为 null）     |
| 能力断言失败                          | 插件     | 换成 19 条真值                                |
| 能力对但运行期仍被拒                  | 配置     | 管理员未勾选授予                              |
| Mock 行为与生产不一致                 | 产品边界 | 补 L3，**不改断言迎合 Mock**                  |
| test-kit 自身报错                     | 环境     | 核对 vitest 版本 / `better-sqlite3` / Node 22 |

---

## 8. L3 冒烟清单（10 项）

1. 上传 ZIP → 安装成功，`status=installed`
2. 勾选能力授予 → 激活 → `status=active`、`execution_mode=process`
3. 日志无 `[Plugin:<id>]` 错误
4. 声明的入口出现（Tab / 工具栏 / 命令面板）
5. 点击入口 → 命令派发成功（看网络面板 200 + 结果）
6. AI 自然语言触发 Action（若 `exposeToAgent: true`）
7. `view` 页面：HTML 200、`view-bridge.js` 200、`bridge.invokeCommand` 通、`ui.resize` 生效
8. 停用 → 入口消失 → 再启用 → 入口回来且**不重复**
9. 数据表仍在（停用不删表），卸载后消失
10. `SELECT manifest FROM plugins WHERE id=…` 里每个 `view` 字段都在
