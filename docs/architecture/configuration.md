# 系统配置架构规范

本文描述 OpenLearn V2 配置体系的**设计形态与约束**：为什么没有统一的配置子系统、平台级与插件级各自如何工作、有哪些必须先知道的坑。

> **环境变量的完整清单（变量名 / 默认值 / 说明）只维护一处**：[系统配置规范](../configuration/system-configuration.md) §1。本文不再保留变量表——历史上本文曾并列维护第二份清单，两边各自漂移，2026-10-26 收敛为单一清单。

---

## 0. 首要结论：平台没有集中的配置子系统

> **历史包袱说明**：早期版本确实存在 `packages/core/configuration/` 目录，内含 `PlatformConfiguration.ts`、`ConfigurationRegistry.ts`、`ConfigurationProvider.ts`、`ConfigurationLoader.ts`、`ConfigurationContext.ts`、`ConfigurationDescriptor.ts`、`ConfigurationError.ts` 等文件。**该目录已整体删除**，删除提交为 `207ca36 refactor(arch): 删除死子系统 capability-runtime 与 configuration`（2026-10-01），提交说明明确写为「`packages/core/configuration/`（12 文件 ~1190 行）：**无生产消费方**」。

删除后，仓库中**不存在** `PlatformConfiguration`、`ConfigManager` 一类抽象，`packages/`、`server/`、`server.ts`、`src/` 对这些符号零命中。仓库内唯一残留的历史痕迹是 `docs/release-notes/v0.2.6.md` 对 `packages/core/configuration/PlatformConfiguration.ts` 的一次引用——那是当时的仓库状态，属历史档案，不代表当前存在。

因此，**不要按「三层配置架构」的旧叙述去假设存在一个内核级配置抽象**。当前配置由下面两块拼成，二者之间没有任何统一接口、注册表或热更新机制：

```text
┌──────────────────────────────────────────────────────────────┐
│  ① 平台级配置 = 环境变量                                      │
│     无 schema、无中心注册表、无热更新                          │
│     每个调用点直接 process.env.XXX 就地读取                     │
│     部署形态：.env / docker-compose.yml / ecosystem.config.cjs │
├──────────────────────────────────────────────────────────────┤
│  ② 插件级配置 = manifest.configuration.properties（声明 schema）│
│                + plugin_config 表（按三级作用域存值）           │
│     实现：packages/core/plugin-host/config-service.ts          │
│     访问：ctx.config（IConfigService）                          │
└──────────────────────────────────────────────────────────────┘
```

两块之间唯一的交集是**环境变量可间接影响插件运行时**（如 `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 决定 manifest 声明的部署脚本能否执行），但这是部署时行为，不是配置系统的统一抽象。

---

## 1. 平台级配置 = 环境变量

### 1.1 四个设计特性

1. **就地读取**：没有中心注册表，每个调用点直接读 `process.env.XXX`，读不到就用字面量兜底。
2. **无 schema、无类型**：所有值都是字符串，解析与校验由调用点各自负责（`Number()` / `=== 'true'` / 正则）。
3. **无热更新**：环境变量在进程启动时定型，改后必须重启。CLI 参数（`cli.mjs`）会回写 `process.env`，因此 CLI 优先级高于 `.env`。
4. **改名不报错**：这是本体系最需要注意的工程特性——把变量名拼错，不会报错，只会让该处的 `||` 兜底值静默生效，行为退化成默认值且无任何告警。

正因如此，仓库有两道防线，都不在运行时：

- **启动期强校验** `server/security/env-validation.ts` 的 `assertStartupEnv()`，只覆盖「配了但值非法」这一档（端口越界、枚举拼错、带单位的数值等），见[系统配置规范 §5](../configuration/system-configuration.md#5-启动期环境变量强校验p1)；
- **文档-代码一致性门禁** `audit-tools/envcheck.py`，比对「代码读取」「`.env.example` 声明」「配置页登记」三方，任一侧缺失即报 drift。它守的是**清单完整性**，不是运行期正确性。

### 1.2 部署形态与注入优先级

同一份代码在不同形态下从不同位置拿到变量，**具体条目以各配置文件为准**（本文刻意不复制清单，避免再次与配置页分叉）：

| 形态   | 注入来源                                              | 说明                                                                 |
| ------ | ----------------------------------------------------- | -------------------------------------------------------------------- |
| 开发   | 根目录 `.env`（`dotenv` 自动加载）                    | 模板见 `.env.example`，该文件**刻意只保留最少项**，不是完整配置参考  |
| Docker | `docker-compose.yml` 的 `environment` 块              | 显式列出数据目录、日志、错误上报、指标令牌等；数据卷挂载到 `/data`   |
| PM2    | `ecosystem.config.cjs` 自身 `dotenv.config()` + `env` | 先加载同目录 `.env`，再用 `env` 块显式透传关键项，避免子进程环境丢失 |
| CLI    | `cli.mjs` 解析参数后**回写 `process.env`**            | `-p` → `PORT`、`-H` → `HOST`、`-o` → `OPEN_BROWSER`，CLI 优先级最高  |

### 1.3 声明了但无人读取的变量

`.env.example` 声明了 `APP_URL`（宿主地址，供自引用链接与 OAuth 回调使用），但全仓除 `.env.example` 自身外零命中——当前没有任何代码读取它。属于预留声明，配置了也不会生效。

判断某个变量是否真的生效，唯一可靠办法是查代码读取点；配置页的每一行都标注了消费方语义，这正是它作为单一清单存在的理由。

---

## 2. 插件级配置：三级作用域

Issue #151 之前，插件配置只有一层（等价于今天的平台层），值塞在 `plugin_storage` 的 `config:<key>` 里。现在改为**独立表 + 显式作用域**，解析顺序为 **班级 > 学校 > 平台 > manifest 默认值**。

### 2.1 声明：manifest 的 `configuration.properties`

schema 由 `packages/core/esm-loader/manifest-schema.ts` 的 `manifestSchema` 用 Zod 定义，位置是 `configuration.properties`（**注意是嵌套一层，不是顶层 `config`**）。整个 `configuration` 节点与其内部的 `properties` 均为可选：

```json
{
  "configuration": {
    "properties": {
      "weight": {
        "type": "number",
        "default": 10,
        "minimum": 0,
        "maximum": 100,
        "description": "该插件在本班的评分权重",
        "scope": ["platform", "class"]
      }
    }
  }
}
```

单个属性的合法字段共 **7 个**。该对象未开启 `.passthrough()`，因此**未列出的字段会被 Zod 静默剔除（strip）而非报错**——写错字段名不会得到提示，只会发现读回来是 `undefined`：

| 字段          | 类型     | 约束                                                             |
| ------------- | -------- | ---------------------------------------------------------------- |
| `type`        | 必填     | `'string' \| 'number' \| 'boolean' \| 'integer'`                 |
| `default`     | 任意     | `z.unknown()`，可选                                              |
| `description` | `string` | 可选                                                             |
| `enum`        | 任意数组 | 可选                                                             |
| `minimum`     | `number` | 可选，仅数值类型生效                                             |
| `maximum`     | `number` | 可选，仅数值类型生效                                             |
| `scope`       | 枚举数组 | 可选，取 `'platform' \| 'school' \| 'class'`；**缺省只有平台层** |

`scope` 的语义是「允许在哪一层覆盖」：`platform` 始终隐含允许；`class` / `school` 必须显式声明，否则 `set()` 直接抛错（见 §2.5）。缺省 `['platform']` 保证老插件行为不变——它们本来也只有一层。

对应的 TS 类型 `ConfigProperty` 定义在 `packages/core/plugin-host/config-service.ts`。`ConfigDeclaration` 是 `NonNullable<Manifest['configuration']>`，即直接从 Zod schema 推导，避免手写类型与 schema 漂移。

### 2.2 存储：`plugin_config` 表

配置值有独立表，不再借用 `plugin_storage`（迁移 `037_plugin_config_scopes.sql`）：

```sql
CREATE TABLE plugin_config (
  plugin_id   TEXT NOT NULL,
  scope_type  TEXT NOT NULL DEFAULT 'platform',
  scope_id    TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (plugin_id, scope_type, scope_id, key)
);
```

- 主键含作用域，因此**同一 key 可在平台/学校/班级各存一份**；
- `plugin_id` 取 manifest 的 `id`（不是数据库主键 UUID）——这一点与插件私有表的 `plugin_<scopeId>_` 前缀规则无关，不要混用；
- `value` 统一 `JSON.stringify` 后落库，读回时 `JSON.parse`，解析失败则原样返回字符串；
- **旧值兼容**：迁移会把 `plugin_storage.key = 'config:<key>'` 的行搬到平台层；迁移未执行时 `ConfigService` 仍会回退读旧位置（`ConfigService.KEY_PREFIX = 'config:'`），双重保险；
- **懒建表**：`ensureTable()` 在首次写入时 `CREATE TABLE IF NOT EXISTS`，兼容未执行 037 的旧库与单测夹具。

`loadFromDB()` 一次性把**全部作用域**的行（以及旧 `plugin_storage` 行）预热进内存缓存，避免每条配置一次查询。

### 2.3 解析顺序

```ts
// 平台值（等同旧行为）
const weight = ctx.config.get<number>('weight');

// 班级有效值：班级覆盖 > 学校覆盖 > 平台值 > manifest 默认值
const classWeight = ctx.config.get<number>('weight', { classId });

// 一次取全部（同样支持 classId / schoolId）
const all = ctx.config.getAll({ classId });
```

解析链固定为 `class(classId)` → `school(schoolId)` → `platform('')` → schema `default` → `undefined`。未传 `classId` / `schoolId` 时自动跳过对应层。

`school` 层依赖多租户模型（Issue #149）。在其落地前，调用方可以显式传 `schoolId` 触发该层解析，但没有自动来源；一校一实例部署下 `school` 等价于平台层。

### 2.4 接口：`IConfigService`（暴露为 `ctx.config`）

完整签名（`packages/core/plugin-host/config-service.ts`）：

```typescript
export interface IConfigService {
  get<T = unknown>(key: string, options?: ConfigReadOptions): T;
  getAll(options?: ConfigReadOptions): Record<string, unknown>;
  set(key: string, value: unknown, scope?: ConfigWriteScope): Promise<void>;
  onChange(callback: ConfigChangeCallback): () => void;
}

export interface ConfigReadOptions {
  classId?: string;
  schoolId?: string;
}
export interface ConfigWriteScope {
  scopeType?: ConfigScopeType; // 'platform' | 'school' | 'class'，默认 'platform'
  scopeId?: string;
}
export type ConfigChangeCallback = (key: string, newValue: unknown, oldValue: unknown) => void;
```

**三个易错点**（前两条旧文档均写错）：

1. `onChange` 是**单参**（只收回调），**没有** `onChange(key, callback)` 这样的 per-key 重载。需要按 key 过滤时，在回调体内自行判断 `key`。
2. `onChange` 回调**不带作用域参数**：签名只有 `(key, newValue, oldValue)`。同一个 key 在班级层被改与在平台层被改，回调看起来一模一样——需要区分时必须自己记录写入来源。
3. 配置键的路径是 `manifest.configuration.properties.<key>`，不是顶层 `config.<key>`。写错位置不会报错：`get()` 对**未声明**的 key 直接返回 `undefined`（连默认值都没有，因为 schema 里根本没有这一项），只有**已声明但无任何作用域记录**的 key 才会回落到 schema 的 `default`。

`ConfigService` 类上另有几个公开方法不属于 `IConfigService` 接口、但宿主代码在用：`loadFromDB()`（预载全部作用域到内存缓存）、`setSync()`（`set()` 的同步版，供同步 REST 处理器使用）、`allowedScopes(key)`（返回该 key 允许覆盖的层）、`hasKey()`、`getSchema()`、`cachedEntryCount()`（诊断用）。

### 2.5 校验与失败语义

写入顺序为：`validate()` → `assertScopeAllowed()` → 更新共享缓存 → 写库 → 广播给所有活跃实例的监听器。

- `validate()` 按 §2.1 的约束逐条检查，**未声明的 key 直接抛错**并提示去 manifest 声明；`integer` 额外要求 `Number.isInteger`；`minimum` / `maximum` 只在数值分支检查；`enum` 在类型检查之后单独校验。
- `assertScopeAllowed()` 对应 `scope` 声明：向未允许的层写入会抛错，并回显「manifest 声明允许：platform, class」。
- `normalizeWriteScope()` 要求**非平台层必须给 `scopeId`**，否则抛错；平台层的 `scopeId` 一律归一为空字符串。
- **DB 写入失败会回滚内存缓存再抛出**（旧值不存在时删除该键）。
- 监听器回调抛错被静默吞掉——单个插件的回调异常不会中断配置写入。

### 2.6 生命周期与时序

`ConfigService` 实例由 `packages/core/plugin-host/context-builder.ts` 的 `buildContext()` 创建，顺序固定为：构造 → `loadFromDB()` → 作为 `ctx.config` 挂到插件上下文。因此**插件 `activate()` 里读到的值已经是 DB 合并后的最终值**，不存在先读默认、后异步刷新的窗口。

需要注意缓存的作用域与刷新方式：

- 缓存由**同一 `db` 对象 + `manifest.id` 的所有实例共享**（模块级 `WeakMap<db, Map<manifestId, { values, instances }>>`）。管理端通过临时实例写入后，运行中插件实例的缓存立即被刷新，`get()` 马上读到新值；
- 写入会**广播给所有活跃实例**，运行中插件的 `onChange` 回调因此也会被触发；`oldValue` 取该 key 在共享缓存中的上一个值（此前从未缓存过则为 `undefined`）；
- 激活时**尚不存在**的作用域行，会在首次 `get(key, { classId })` 时因缓存未命中而查库，因此后来新增的班级覆盖能被读到；
- `loadFromDB()` 会**清空并以 DB 为准重建**共享缓存：重装插件、恢复备份或直接在库里改值后，下次管理端读取或重启插件都不会残留旧缓存；
- 实例用 `WeakRef` 登记，插件卸载后其 `ConfigService` 可被回收，广播不会把事件送进已废弃的插件上下文。

需要注意的边界：广播**不带作用域参数**（见 §2.4 第 2 点），班级层与平台层的写入在回调里长得一样；`oldValue` 是共享缓存里的上一个值，不是数据库里的历史值。

### 2.7 平台侧访问路径与 REST

插件之外，管理端通过 `packages/core/plugin-host/core.ts` 上的两个方法访问配置：

- `getPluginConfig(pluginId, manifest?, options?)` —— 内部**临时 new 一个 `ConfigService`**、`loadFromDB()`、返回 `getAll(options)`，不持有内存引用；`options` 支持 `{ classId, schoolId }`。
- `setPluginConfig(pluginId, manifest, updates, scope?)` —— 同样临时实例，逐个 `setSync(key, value, scope)`。

这两个方法创建的临时实例与运行中插件的 `ctx.config` **共享同一份缓存与变更广播**（按 `db` 对象 + `manifest.id` 归属）：管理端写入后，运行中插件立即读到新值，并收到 `onChange` 回调。`getPluginConfig()` 调用的 `loadFromDB()` 会以 DB 为准重建共享缓存，因此外部对库的修改（恢复备份、换库）也会在下次管理端读取时同步给运行中实例。

`resolvePluginUuid()` 负责把「数据库 UUID 或 manifest.id 别名」解析为真实主键（先直查主键，再回退到 SQLite `json_extract(manifest, '$.id')`），上述两个方法与下面的 REST 路由都依赖它。

REST 定义在 `server/routes/plugins.ts`，路径参数 `:id(*)` 允许 manifest.id 中带斜杠的作用域形式：

| 方法   | 路径                         | 权限                           | 作用域参数                                    | 行为                                               |
| ------ | ---------------------------- | ------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| `GET`  | `/api/plugins/:id(*)/config` | 仅 `teacher` / `administrator` | `?classId=&schoolId=`（可选，返回该层有效值） | 返回 `{ schema, values }`                          |
| `POST` | `/api/plugins/:id(*)/config` | 仅 `administrator`             | `?scopeType=platform\|school\|class&scopeId=` | 请求体为键值对对象，逐键 `setSync()`；缺省写平台层 |

`scopeType` 非法返回 400；非平台层缺 `scopeId` 返回 400。

配置值可能含第三方服务密钥等秘密，因此读写都收紧：读 `teacher`/`administrator`、写仅 `administrator`（审计 R-5 收紧，此前「登录即可读」允许学生读走任意插件全部配置值）。

⚠️ **POST 无事务性**：`setPluginConfig()` 是普通的 `for...of` 顺序循环，一旦某个键校验失败就抛出中断，而**排在它之前的键已经落库**。因此一次失败的更新会留下部分生效的配置，没有自动回滚。调用方需要自行避免在同一个请求里混入会失败的键。

---

## 3. 速查

| 问题                            | 答案                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有 `PlatformConfiguration` 吗？ | **没有**。目录已于 2026-10-01 作为死代码整体删除（`207ca36`）                                                                                                                                  |
| Worker 资源上限可配吗？         | **可配**。`OPENLEARN_PLUGIN_MAX_HEAP_MB`（默认 128）、`OPENLEARN_PLUGIN_MAX_RSS_MB`（512）、`OPENLEARN_PLUGIN_CPU_QUOTA_MS`（8000）/`CPU_WINDOW_MS`（10000）、`OPENLEARN_PLUGIN_QUOTA`（总闸） |
| 配置会热更新吗？                | 插件配置**会热更新**（管理端写入即时同步到运行中实例并触发 `onChange`）；环境变量**永不热更新**，改后须重启                                                                                    |
| 插件配置存哪？                  | `plugin_config` 表，主键 `(plugin_id, scope_type, scope_id, key)`；`plugin_storage` 的 `config:` 前缀仅作旧库回退                                                                              |
| 配置能分层吗？                  | 能。`class > school > platform > manifest 默认值`，可覆盖哪些层由 manifest 的 `scope` 声明决定                                                                                                 |
| 改一个不存在的环境变量会怎样？  | 静默失效，该处回落到代码里的兜底值，无任何告警                                                                                                                                                 |
