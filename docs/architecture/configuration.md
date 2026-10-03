# 系统配置架构规范

本文以代码为唯一真源，描述 OpenLearn V2 当前的配置体系。核对范围：`packages/`、`server/`、`server.ts`、`cli.mjs`、`vite.config.ts`、`.env.example`、`docker-compose.yml`、`ecosystem.config.cjs`。

---

## 0. 首要结论：平台没有集中的配置子系统

> **历史包袱说明**：早期版本确实存在 `packages/core/configuration/` 目录，内含 `PlatformConfiguration.ts`、`ConfigurationRegistry.ts`、`ConfigurationProvider.ts`、`ConfigurationLoader.ts`、`ConfigurationContext.ts`、`ConfigurationDescriptor.ts`、`ConfigurationError.ts` 等文件。**该目录已整体删除**，删除提交为 `207ca36 refactor(arch): 删除死子系统 capability-runtime 与 configuration`（2026-10-01），提交说明明确写为「`packages/core/configuration/`（12 文件 ~1190 行）：**无生产消费方**」。

删除后，仓库中**不存在** `PlatformConfiguration`、`ConfigManager` 一类抽象，全仓 `packages/`、`server/`、`server.ts`、`src/` 对这些符号零命中。仓库内唯一残留的历史痕迹是 `docs/release-notes/v0.2.6.md` 对 `packages/core/configuration/PlatformConfiguration.ts` 的一次引用——那是当时的仓库状态，属历史档案，不代表当前存在。

因此，**不要按「三层配置架构」的旧叙述去假设存在一个内核级配置抽象**。当前配置由下面两块拼成，二者之间没有任何统一接口、注册表或热更新机制：

```text
┌──────────────────────────────────────────────────────────────┐
│  ① 平台级配置 = 环境变量                                      │
│     无 schema、无中心注册表、无热更新                          │
│     每个调用点直接 process.env.XXX 就地读取                     │
│     部署形态：.env / docker-compose.yml / ecosystem.config.cjs │
├──────────────────────────────────────────────────────────────┤
│  ② 插件级配置 = manifest.configuration.properties（声明）      │
│                + plugin_storage 表（取值）                    │
│     实现：packages/core/plugin-host/config-service.ts          │
│     访问：ctx.config（IConfigService）                          │
│     持久化后经 REST 暴露，具备 schema 校验与变更订阅            │
└──────────────────────────────────────────────────────────────┘
```

两块之间唯一的交集是**环境变量可间接影响插件运行时**（如 `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 决定 manifest 声明的部署脚本能否执行），但这是部署时行为，不是配置系统的统一抽象。

另需注意：环境变量的读取是**就地、无校验、无类型**的。改一个变量名不会报错，只会让该处的 `||` 兜底值静默生效——这是本体系最需要注意的工程特性。

---

## 1. 平台级配置：环境变量全集

以下为**非测试生产代码**中实际被读取的全部环境变量，共 **25 个**（按变量名去重）。`.env.example` 另有 1 个仅声明、无代码读取的 `APP_URL`，见 §1.7。

### 1.1 服务与网络

| 变量            | 默认值     | 说明                                                                                  |
| --------------- | ---------- | ------------------------------------------------------------------------------------- |
| `PORT`          | `9000`     | HTTP 端口。`server.ts` 的 `startServer()` 与 Vite 代理目标各自读取；`cli.mjs -p` 可覆盖  |
| `HOST`          | `0.0.0.0`  | 监听地址。`cli.mjs -H` 可覆盖                                                        |
| `NODE_ENV`      | 见下      | `production` / 非生产。影响 HMR、静态资源策略、日志级别、仅生产启用的 HTTPS 判定      |
| `TERM`          | —          | `server.ts` 的 `startServer()` 中用于决定终端超链接是否渲染（`dumb` 时关闭）          |
| `OPEN_BROWSER`  | 关闭       | `true` 时启动后自动打开浏览器。`cli.mjs -o` 会设置此变量                             |

`NODE_ENV` 在非测试生产代码中被读取 **19 次**，是覆盖面最广的变量。

### 1.2 安全与代理

| 变量                    | 说明                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`       | CORS 白名单，逗号分隔；`cli.mjs --cors` 可覆盖。`ecosystem.config.cjs` 从 `.env` 透传          |
| `ALLOWED_FRAME_ORIGINS` | Helmet `frame-src` / `frame-ancestors` 白名单（课件 iframe 场景）                              |
| `LTI_ALLOWED_LMS_ORIGINS` | 允许发起 LTI 1.3 启动的 LMS 平台来源白名单                                                    |
| `TRUST_PROXY`           | `server.ts` 的 `startServer()` 解析后交给 Express `trust proxy`                                |
| `ENABLE_HTTPS`          | `true` 且 `NODE_ENV=production` 时按 HTTPS 语义生成自引用 URL（`server/routes/` 下 3 处）      |
| `ENABLE_HSTS`           | `true` 时启用 HSTS                                                                            |
| `FORCE_HTTPS`           | 生产环境下为 `true` 时**隐含** `ENABLE_HSTS`（二者在 `startServer()` 的 `enableHsts` 同一行）  |
| `ENCRYPTION_KEY`        | 加密 AI Provider API Key 落库。**非必需**：首次使用自动生成并写回 `.env`                      |

认证**不使用**任何 JWT 签名密钥环境变量——登录态是基于 Cookie 的不透明会话令牌，由 `client_sessions` 表校验。旧文档中的 `JWT_SECRET` 在当前代码中零命中。

### 1.3 存储与插件包

| 变量                     | 默认值                              | 说明                                             |
| ------------------------ | ----------------------------------- | ------------------------------------------------ |
| `OPENLEARN_DB_PATH`      | 见下                                | SQLite 文件路径                                  |
| `OPENLEARN_MAX_ZIP_SIZE` | `300 * 1024 * 1024`（300MB）        | ZIP 内所有文件的**未压缩**总大小上限，ZIP bomb 防护 |

两者均通过具名 getter 暴露（`getMaxUncompressedSize()`），而非散落读取。`OPENLEARN_DB_PATH` 的默认值随运行方式变化：本地开发指向 `packages/core/db/educational_os.db`，npx 安装指向 `~/openlearn-next/data.db`。

### 1.4 插件运行时

| 变量                                        | 说明                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ALLOW_UNSAFE_PLUGIN_SCRIPTS`               | **非 `true` 时，manifest 中声明的 `deploy.script` 外部部署脚本被拦截**（SEC-RCE-02 默认安全策略，仅打印 `[SECURITY WARNING]` 不执行）。`packages/core/plugin-host/index.ts` 读取 1 处 |
| `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS`      | Worker 插件激活超时，默认 `60_000`ms；解析后要求 `>= 5000` 且为有限数，否则回落默认值 |
| `OPENLEARN_WORKER_ACTIVATE_PROGRESS_SLIDE_MS` | `ctx.reportProgress` 心跳的滑动续期窗口                                            |

注意 inline 路径**没有**对应的环境变量：`packages/core/plugin-host/index.ts` 顶部的 `ACTIVATION_TIMEOUT_MS` 与 `DEACTIVATION_TIMEOUT_MS` 都是硬编码 `5000`，覆盖 inline 路径的 `activate` 与 `deactivate` 计时。两者与 Worker 路径的 `ACTIVATE_TIMEOUT_MS`（60s 起步、可环境变量覆盖）是**互相独立**的两套阈值。

### 1.5 日志与调试

| 变量                | 说明                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `LOG_LEVEL`         | pino 日志级别。**唯一被 `packages/core/observability/logger.ts` 读取的变量**；`docker-compose.yml` 与 `ecosystem.config.cjs` 都显式设为 `info` |
| `DEBUG`             | 包含 `commandbus` 时 `CommandBus` 打印全部命令日志                                        |
| `DEBUG_COMMAND_BUS` | 同上的开关式写法（`true` 生效）                                                            |

后两者在 `packages/core/command-bus/index.ts` 的同一处条件里被同时判断。

### 1.6 构建期与测试

| 变量              | 说明                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `DISABLE_HMR`     | `true` 时关闭 Vite HMR 与 watch。**同时被 `server.ts` 与 `vite.config.ts` 读取** |
| `VITEST`          | 存在时数据库改走临时库分支                                              |
| `VITEST_POOL_ID`  | 配合 `VITEST`，按 vitest worker 隔离临时库名（缺省回退 `process.pid`）  |

### 1.7 声明但无消费方的变量

`.env.example` 声明了 `APP_URL`（宿主地址，供自引用链接与 OAuth 回调使用），但**全仓（排除 `node_modules`/`.git`/`dist`）除 `.env.example` 自身外零命中**——当前没有任何代码读取它。属于预留声明，配置了也不会生效。

### 1.8 间接读取的变量

`PLUGIN_COMMUNITY_REGISTRY_URL`（社区插件注册表 JSON 地址）在 `server/services/community-registry.ts` 中以常量 `COMMUNITY_REGISTRY_ENV` 的形式传给通用环境读取逻辑，而不是散落的 `process.env.PLUGIN_COMMUNITY_REGISTRY_URL` 字面量，因此按字面量 grep 统计时会漏掉。未配置时后端返回 `configured: false`，不报错。

### 1.9 部署形态的变量注入点

同一份代码在不同部署形态下从不同位置拿到环境变量：

- **开发**：根目录 `.env`（`dotenv` 自动加载），模板见 `.env.example`（该文件**刻意只保留最少项**，仅 `APP_URL` 与 `PLUGIN_COMMUNITY_REGISTRY_URL`）
- **Docker**：`docker-compose.yml` 的 `environment` 显式列出 `NODE_ENV`、`OPENLEARN_DB_PATH`、`ENCRYPTION_KEY`、`LOG_LEVEL`、`BACKUP_DIR` 共 5 项
  > 待确认：`BACKUP_DIR` 在 `docker-compose.yml` 中被注入，但全仓 TS/JS 代码未见读取点，其消费方（若有）应在备份脚本侧
- **PM2**：`ecosystem.config.cjs` 自身 `dotenv.config()` 加载同目录 `.env`，再在 `env` 块中显式列出 `NODE_ENV`、`PORT`、`LOG_LEVEL`、`ENCRYPTION_KEY`、`ALLOWED_ORIGINS` 共 5 项
- **CLI 覆盖**：`cli.mjs` 解析命令行参数后**回写 `process.env`**（如 `-p` → `PORT`、`-H` → `HOST`、`-o` → `OPEN_BROWSER`），因此 CLI 优先级高于 `.env`

> 交叉参考：[系统配置规范](../configuration/system-configuration) 提供了另一份环境变量清单。本文的 §1 覆盖面更全——该页未收录 `LOG_LEVEL`、`ENABLE_HTTPS`、`FORCE_HTTPS`、`ENABLE_HSTS`、`TRUST_PROXY`、`ALLOW_UNSAFE_PLUGIN_SCRIPTS`、`OPENLEARN_MAX_ZIP_SIZE`、`DEBUG` 八个变量，以及 `PLUGIN_COMMUNITY_REGISTRY_URL` 的间接读取方式。

---

## 2. 插件级配置

### 2.1 声明：manifest 的 `configuration.properties`

schema 由 `packages/core/esm-loader/manifest-schema.ts` 的 `manifestSchema` 用 Zod 定义，位置是 `configuration.properties`（**注意是嵌套一层，不是顶层 `config`**）。整个 `configuration` 节点与其内部的 `properties` 均为可选：

```json
{
  "configuration": {
    "properties": {
      "maxQuestions": {
        "type": "number",
        "default": 50,
        "description": "最大题目数"
      },
      "enableAutoSave": {
        "type": "boolean",
        "default": true
      }
    }
  }
}
```

单个属性的合法字段共 6 个。该对象未开启 `.passthrough()`，因此**未列出的字段会被 Zod 静默剔除（strip）而非报错**——写错字段名不会得到提示，只会发现读回来是 `undefined`：

| 字段         | 类型                                | 约束                       |
| ------------ | ----------------------------------- | -------------------------- |
| `type`       | 必填                                | `'string' \| 'number' \| 'boolean' \| 'integer'` |
| `default`    | 任意                                | `z.unknown()`，可选        |
| `description`| `string`                            | 可选                       |
| `enum`       | 任意数组                            | 可选                       |
| `minimum`    | `number`                            | 可选，仅数值类型生效       |
| `maximum`    | `number`                            | 可选，仅数值类型生效       |

对应的 TS 类型 `ConfigProperty` 定义在 `packages/core/plugin-host/config-service.ts`。`ConfigDeclaration` 是 `NonNullable<Manifest['configuration']>`，即直接从 Zod schema 推导，避免手写类型与 schema 漂移。

### 2.2 存储：复用 `plugin_storage` 表

配置值**不单独建表**，而是复用插件存储表，以 `ConfigService.KEY_PREFIX`（字面量 `'config:'`）作为 key 前缀写入。存储命名空间是 `plugin_id`，取值取自 manifest 的 `id`（**不是数据库主键 UUID**）。这样配置值与插件其他存储项共存于同一张表。

### 2.3 接口：`IConfigService`（暴露为 `ctx.config`）

完整签名（`packages/core/plugin-host/config-service.ts` 的 `IConfigService`）：

```typescript
export interface IConfigService {
  get<T = unknown>(key: string): T;          // 内存缓存 → DB → schema 默认值 → undefined
  getAll(): Record<string, unknown>;         // 遍历 schema 中声明的全部 key
  set(key: string, value: unknown): Promise<void>;
  onChange(callback: ConfigChangeCallback): () => void;   // 单参，返回退订函数
}

export type ConfigChangeCallback = (key: string, newValue: unknown, oldValue: unknown) => void;
```

**两个易错点**（旧文档均写错）：

1. `onChange` 是**单参**（只收回调），**没有** `onChange(key, callback)` 这样的 per-key 重载。需要按 key 过滤时，在回调体内自行判断 `key`。
2. 配置键的路径是 `manifest.configuration.properties.<key>`，不是顶层 `config.<key>`。写错位置不会报错：`get()` 对**未声明**的 key 直接返回 `undefined`（连默认值都没有，因为 schema 里根本没有这一项），只有**已声明但无 DB 记录**的 key 才会回落到 schema 的 `default`。

`ConfigService` 类上另有两个公开方法不属于 `IConfigService` 接口、但宿主代码在用：`loadFromDB()`（把该插件全部 `config:` 前缀行预载入内存缓存）和 `setSync()`（`set()` 的同步版，供同步 REST 处理器使用）。`hasKey()` / `getSchema()` 也是公开方法。

### 2.4 校验与失败语义

`set()` / `setSync()` 内部调用私有 `validate()`，逐条按 §2.1 的约束检查，未声明的 key 直接抛错并提示去 manifest 声明。`integer` 额外要求 `Number.isInteger`；`minimum` / `maximum` 只在数值类型分支检查；`enum` 在类型检查之后单独校验。

写入顺序为：校验 → 更新内存缓存 → 写 DB → 通知监听器。**DB 写入失败会回滚内存缓存再抛出**（旧值不存在时删除该键）。监听器回调抛错被静默吞掉——单个插件的回调异常不会中断配置写入。

### 2.5 生命周期与时序

`ConfigService` 实例由 `packages/core/plugin-host/context-builder.ts` 的 `buildContext()` 创建，顺序固定为：构造 → `loadFromDB()` → 作为 `ctx.config` 挂到插件上下文。因此**插件 `activate()` 里读到的值已经是 DB 合并后的最终值**，不存在先读默认、后异步刷新的窗口。

### 2.6 平台侧访问路径

插件之外，管理端通过 `packages/core/plugin-host/index.ts` 上的两个方法访问配置：

- `getPluginConfig(pluginId, manifest?)` —— 内部**临时 new 一个 `ConfigService`**、`loadFromDB()`、返回 `getAll()`，不持有内存引用
- `setPluginConfig(pluginId, manifest, updates)` —— 同样临时实例，逐个 `setSync()`

这意味着**管理端写入不会触发运行中插件的 `onChange` 回调**：写操作用的是另一个 `ConfigService` 实例，其 `listeners` 集合与插件持有的实例不相通。插件只在下次读取时才看到新值。这是当前实现的一个已知限制（跨实例的变更广播未实现），此处如实记录。

`resolvePluginUuid()` 负责把「数据库 UUID 或 manifest.id 别名」解析为真实主键（先直查主键，再回退到 SQLite `json_extract(manifest, '$.id')`），上述两个方法与下面的 REST 路由都依赖它。

### 2.7 REST 接口

定义在 `server/routes/plugins.ts`，路径参数 `:id(*)` 允许 manifest.id 中带斜杠的作用域形式：

| 方法   | 路径                          | 权限                 | 行为                                                                       |
| ------ | ----------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `GET`  | `/api/plugins/:id(*)/config`  | 需登录               | 返回 `{ schema: manifest.configuration?.properties ?? {}, values }`        |
| `POST` | `/api/plugins/:id(*)/config`  | 仅 `administrator`   | 请求体为键值对对象，逐键 `setSync()`                                        |

读配置对任何登录用户开放，写配置收紧到 `administrator`，是刻意的权限分层。

⚠️ **POST 无事务性**：`setPluginConfig()` 是普通的 `for...of` 顺序循环，一旦某个键校验失败就抛出中断，而**排在它之前的键已经落库**。因此一次失败的更新会留下部分生效的配置，没有自动回滚。调用方需要自行避免在同一个请求里混入会失败的键。

---

## 3. 速查

| 问题                                       | 答案                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| 有 `PlatformConfiguration` 吗？            | **没有**。目录已于 2026-10-01 作为死代码整体删除（`207ca36`）              |
| 有内核级配置（线程池/沙箱上限/总线超时）吗？ | **没有**。Worker 资源限制是 `worker-manager.ts` 里的硬编码字面量（`maxOldGenerationSizeMb: 128`、`maxYoungGenerationSizeMb: 32`），不可配置；事件总线无超时配置项 |
| 配置会热更新吗？                            | 插件配置**不热更新**（见 §2.6）；环境变量**永不热更新**，改后须重启          |
| 插件配置存哪？                              | `plugin_storage` 表，`plugin_id` + `config:` 前缀的 key                    |
| 改一个不存在的环境变量会怎样？                | 静默失效，该处回落 `||` 兜底值，无任何告警                                 |
