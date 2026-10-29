# 事实裁决表（Facts Ledger）

> **这份表是合并手册的唯一裁决依据。**
> 两套来源文档（`agent-docs` 与平台 `docs/`）在同一个事实上有冲突时，以本表的裁决为准；
> 本表每一条都可回源核验，且全部事实表由 `audit-tools/agent_facts.py` 从源码机器抽取。
>
> **不要手工维护本表的数字。** 重新生成：
>
> ```bash
> python3 audit-tools/agent_facts.py           # 生成 contracts/*.json
> python3 audit-tools/agent_facts.py --check   # 校验是否与源码漂移（CI 用）
> ```
>
> 基线：平台 `0.7.7` / `@openlearn/plugin-sdk@3.7.5` / `@openlearn/plugin-test-kit@3.3.3`
> 裁决日期：2026-10-29

---

## 0. 裁决速查（15 条）

| #   | 事实                             | **真值**                                  | agent-docs          | 平台 `docs/`                        | 裁决                             |
| --- | -------------------------------- | ----------------------------------------- | ------------------- | ----------------------------------- | -------------------------------- |
| 1   | 平台版本                         | `0.7.7`                                   | `0.7.7` ✅          | `0.7.7` ✅                          | 一致                             |
| 2   | **plugin-sdk 版本**              | **`3.7.5`**                               | `3.7.4` ❌          | `3.7.4`（27 篇）❌                  | **两套都过期，全改 3.7.5**       |
| 3   | **`capabilityRequired` 数量**    | **19**                                    | 19 ✅               | 20（多含 `quiz:write`）❌           | **agent-docs 对**                |
| 4   | `segment:gate_eval` 归属         | 真实门禁能力，**非** `capabilityRequired` | 「属另一套登记」 ✅ | §1.1 未列                           | **agent-docs 对**                |
| 5   | SDK 值导出的 Token               | 32                                        | 未提                | 32 ✅                               | **平台对**                       |
| 6   | **可解析 Token 数量**            | **31**                                    | 31 ✅               | 速查表只有 27 行 ❌                 | **agent-docs 对；平台需补表**    |
| 7   | `INetworkProxyServiceToken`      | 导出但**完全不可解析**                    | 未提                | 未提                                | **两套都缺，已补**               |
| 8   | `ExtensionSlot` 成员             | 120                                       | 120 ✅              | 120 ✅                              | 一致                             |
| 9   | 有渲染调用点的 anchor            | 8                                         | 8 ✅                | 未列                                | agent-docs 对                    |
| 10  | **`contributes` A 组（严格键）** | **71**                                    | 69 ❌               | 无此区分                            | **改 71**                        |
| 11  | `contributes` B 组（宽松键）     | 38                                        | 38 ✅               | 无此区分                            | 一致                             |
| 12  | frame 通道 bridge op             | 10                                        | 10 ✅               | 虚构 `ui.register`/`context.get` ❌ | **agent-docs 对**                |
| 13  | view 通道 bridge op              | 8                                         | 8 ✅                | 12 行表且与 frame 混写              | 以 `frontend-guide.md` §6.3 为准 |
| 14  | **SQL 禁写表数量**               | **40**                                    | 未标数              | 36 ❌                               | **改 40**                        |
| 15  | `ctx.services.*` 的可空性        | 9 个全为 `T \| null`                      | 9 个 ✅             | `.d.ts` 快照称非空 ❌               | **agent-docs 对**                |

---

## 1. 逐条取证

### 1.1 plugin-sdk 版本 = 3.7.5（裁决 #2）

| 位置                               | 值                                                                                  |
| :--------------------------------- | :---------------------------------------------------------------------------------- |
| `packages/plugin-sdk/package.json` | `3.7.5`                                                                             |
| `packages/plugin-sdk/CHANGELOG.md` | `## [3.7.5] - 2026-10-29` —— 补齐 SDK 自身缺失的 `uuid` 运行时依赖 + 裸导入构建守卫 |

**3.7.5 修的正是 `uuid` 依赖缺失**：第三方按 npm 包消费 SDK 时抛
`ERR_MODULE_NOT_FOUND: Cannot find package 'uuid'`。这不是理论风险 ——
组织内 `class_manager` 插件的 `package.json` 被人手工补过 `"uuid": "^14.0.2"`，
就是撞上了这个坑。装 `3.7.5` 即可。

**3.7.4 的历史声明予以保留**：`3.7.4 起模板形状与构建守卫才正确` 说的是
「前端产物不得残留裸模块说明符」这道构建守卫的引入版本，该事实成立。

### 1.2 `capabilityRequired` = 19（裁决 #3、#4）

真值取自生产代码里 `capabilityRequired:` 的**字面量出现**：

```
assignment:manage  assignment:read  assignment:review  assignment:submit
assignment:write   lesson:delete    lesson:read        lesson:write
management:read    management:write  plugin:read        plugin:write
process:read       process:write     student:write      vfs:read
vfs:write          whiteboard:read   whiteboard:write
```

**两个必须避开的坑：**

1. **`*.d.ts` 里的 JSDoc 注释会被误当成真声明。**
   `packages/plugin-sdk/openlearn.d.ts:1288` 的注释写着
   `建议同时设置 capabilityRequired: 'segment:gate_eval'`。
   抽取时若不排除 `.d.ts`，会得到 **20** —— 这正是 agent-docs 判定
   「`segment:gate_eval` 不是 `capabilityRequired`」的依据，也是对的。
   `audit-tools/agent_facts.py` 已显式排除 `.d.ts` 与 `dist/`。

2. **`quiz:write` 不是任何命令的 `capabilityRequired`。**
   它是 classroom-runtime 的 `RuntimePermission`（第三套登记）。
   平台 `docs/reference/plugin-capability-matrix.md` §1.1 把它列进了能力表 —— **错**。
   平台文档反而在 `source-map` 与 §1.3 里提醒过「`RuntimePermission` 易与
   `capabilityRequired` 混」，自己却犯了。

**`segment:gate_eval` 的真实身份**：`server/services/segment-gate-service.ts:33`
定义 `const GATE_CAPABILITY = 'segment:gate_eval'`，用于给系统 actor
`system:segment-gate` 授权、并校验插件 actor 能否调用环节门禁。
它是**真实存在的能力字符串**，但不是命令 `ActionDescriptor.capabilityRequired` 上的取值。

### 1.3 Token：三个数字，三种口径（裁决 #5、#6、#7）

| 口径                         | 数量   | 出处                                                                                           |
| :--------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| SDK 值导出的 Token 对象      | **32** | `packages/plugin-sdk/index.ts` 的 `export { …Token }`                                          |
| 可解析集合（Token 对象路径） | **30** | `packages/core/di/interfaces.ts:946` `PLUGIN_RESOLVABLE_TOKENS`                                |
| 可解析集合（含按名字收录）   | **31** | 同上 `PLUGIN_RESOLVABLE_TOKEN_NAMES`（追加 `@openlearn/activity-ecosystem:IActivityRegistry`） |

**三个数字都对，但只看数字会掉进两个坑：**

- `IActivityRegistryToken` —— SDK **导出了**这个 Token 对象，
  但可解析白名单里**只有它的名字字符串** `@openlearn/activity-ecosystem:IActivityRegistry`。
  拿 Token 对象去 resolve 会被拒。
- `INetworkProxyServiceToken` —— SDK 导出，但**完全不在**可解析集合里。
  按名字 resolve 它会**显式报错**（不是静默降级）。

所以「SDK 导出 32」与「可解析 31」不矛盾，差的正好是这两个特殊项。

**平台 `docs/sdk/plugin-sdk.md:169` 的「32 个」是对的**，但它自带的速查表只有 27 行，
缺 4 个（`ICoursewareRuntimeScriptRegistryToken` / `IClassroomLifecycleServiceToken` /
`IInteractionRuntimeServiceToken` / `IAssessmentGraderRegistryToken`）—— 数字对、表不全，
是最坏的失败形态。

### 1.4 槽位：四组数字（裁决 #8、#9、#10、#11）

| 组                | 数量                  | 定义处                                      | 语义                                           |
| :---------------- | --------------------- | ------------------------------------------- | ---------------------------------------------- |
| A 严格键          | **71**                | `manifest-schema.ts` `contributesSchema`    | 每个键有专属 Zod 数组；未声明的键被 strip      |
| B 宽松键          | **38**                | 同上 `frontendSlotsShape`                   | 只校验 `id` 必填，其余 `.passthrough()`        |
| C `ExtensionSlot` | **120**               | `src/plugin-host/types.ts:95`               | 前端联合类型，必须命令式注册组件               |
| D anchor          | **8**（有渲染调用点） | `src/plugin-host/types.ts:265` `AnchorSlot` | 开放命名空间，类型上 `anchor:${string}` 全放行 |

- **A ∩ B = ∅**（两组互不重叠）
- A 组 71 个里 **4 个**不在 C 组：`locales` / `palette.items` /
  `teacher.cockpit.widget` / `timeline.segments`（纯声明式贡献键）
- B 组 38 个里 **1 个**不在 C 组：`workspace.view`
- D 组类型上**开放**（任何 `anchor:xxx` 都类型合法），但只有 8 个真有
  `<ExtensionPointRenderer slot="anchor:…">` 调用点 —— 往别的锚点写不报错，只是永远不渲染

**agent-docs 的「69 个」是数错了，不是仓库漂移**：repomix 快照
（`repomix-output.xml`，2026-10-29 10:27 生成）里该文件同样是 **71** 个严格键。

### 1.5 bridge op：两条通道（裁决 #12、#13）

| 通道                             | op 数  | 分发处                               | 备注                                                                                                     |
| :------------------------------- | ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **frame**（隐藏不透明源 iframe） | **10** | `src/plugin-host/plugin-host.ts`     | `api.get/post/del`、`storage.get/set/delete`、`command.invoke`、`ui.register`、`ui.toast`、`context.get` |
| **view**（可视沙箱页）           | **8**  | `server/utils/plugin-view-bridge.ts` | 同上前 8 个，另有 `ui.resize` 走独立消息                                                                 |

**越界报错**：`Unsupported sandbox bridge op "xxx"`。

**两套通道不是一回事**，方法名也不同名（view 侧 `invokeCommand` ↔ frame 侧
`command.invoke`；view 侧 `getContext` ↔ frame 侧 `context.get`）。
**view 通道没有 Barrier 3 方法级能力门禁** —— 这是两者的安全差异，插件作者必须知道。

### 1.6 SQL 禁写表 = 40（裁决 #14）

`packages/core/plugin-host/sql-guard.ts:13` 的 `FORBIDDEN_CORE_TABLES`
实测 **40** 张。平台 `docs/reference/plugin-database-api.md:73` 与
`docs/reference/plugin-architecture-contracts.md:132` 都写「36 张」—— **错**。

### 1.7 `ctx.services.*` 全为可空（裁决 #15）

`packages/core/plugin-host/types.ts` 的 `PluginContext.services` 共 9 个成员，
**全部**声明为 `T | null`：

```
commandBus  eventBus  actionRegistry  capability  processManager
storage     ai        pointsDimension  pointsLedger
```

平台 `packages/plugin-sdk/*.d.ts` 快照里是**非空**类型 —— 那是过期快照。
插件消费 `optional` 服务前**必须判空**，否则运行时空指针。

---

## 2. 能力的三套登记（最容易混的地方）

| 登记         | 字段                                  | 管什么                  | 取值来源                                | 数量 |
| :----------- | :------------------------------------ | :---------------------- | :-------------------------------------- | ---- |
| ① 命令闸门   | `ActionDescriptor.capabilityRequired` | 谁能执行这个命令        | 生产代码的 `capabilityRequired:` 字面量 | 19   |
| ② 方法级闸门 | `method-policy.ts` 的 `CAP_*` 常量    | 某个 `ctx` 方法能不能调 | `CAP_*` 常量                            | 8    |
| ③ 运行时权限 | `RuntimePermission`                   | 课堂运行时的第三套权限  | classroom-runtime/types.ts              | 7    |

**关键机制**（agent-docs §0「三条正交的轴」已正确指出，本表补充事实层）：

- **不存在全局能力白名单。** `manifest-schema.ts:804` 的
  `capabilitiesProposed: z.array(z.string()).optional()` —— 自由字符串数组。
- 杜撰的能力名**会被安静地授予**（`grantCapabilities` 里只有两道闸：
  `isBlockedPluginCapability` 拦通配符、`isCapabilityApproved` 等管理员批准）。
- **真正致命的失败是「少声明」**：目标命令要的 `capabilityRequired`
  与你声明的字符串必须**逐字相等**，否则 `403 COMMAND_CAPABILITY_DENIED`。
- 被硬拒的能力形态只有三种：`*` / `*:*` / `*:*:*`。

---

## 3. 漂移与冲突的根治机制

本表不是一次性的。下列机制保证它不会再次过期：

| 机制           | 工具                                                 | 作用                                                |
| :------------- | :--------------------------------------------------- | :-------------------------------------------------- |
| 事实表机器抽取 | `audit-tools/agent_facts.py`                         | 把 7 张枚举表从源码抽出，产出 `contracts/*.json`    |
| 漂移检测       | `audit-tools/agent_facts.py --check`                 | JSON 与源码不一致即退出码 1                         |
| 代码示例校验   | `audit-tools/plugin_docs_check.py`                   | P1–P9 校验文档代码块里的 API 用法                   |
| CI 门禁        | `.github/workflows/ci.yml` 的 `docs-drift-audit` job | 上述两项进 CI                                       |
| 取证坐标       | `audit-tools/evidence_migrate.py`                    | 把 repomix 行号迁成「仓库路径 + 符号名 + 行号区间」 |

**取证坐标制式**（本手册统一）：

```
❌ 旧：packages/core/plugin-host/types.ts（repomix L113656）
✅ 新：packages/core/plugin-host/types.ts → `PluginContext`（L227）
```

旧坐标绑定单一 18MB 快照产物，仓库一变即静默失效；新坐标跨版本稳定，
且符号名可被 `audit-tools/symbolcheck.py` 校验。

---

## 4. 本表与两套来源文档的关系

- **agent-docs 是本手册的骨架**，其事实层经复核总体准确（15 条里对 11 条），
  它的**方法论**（反先验校准、失败态速查、禁止清单、交付自检）被完整继承。
- **平台 `docs/` 是素材库**，其 `reference/` 5 篇 + `api/di-tokens.md` 提供了
  最完整的枚举表与失败态四列表，但**自身有 8 类高危问题**（捏造 API、版本过期、
  数字漂移、无检索入口），已在本手册与平台侧同步治理。
- 两套文档**都**被本手册取代，但**不删除** —— 平台 `docs/` 仍是全平台文档的
  正式发布渠道，本手册是其中面向 AI 插件开发的**专精子树**。
