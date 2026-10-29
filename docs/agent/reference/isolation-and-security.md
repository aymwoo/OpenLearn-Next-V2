# 隔离与信任边界（执行模式 / 环境 / 权限模型 / SQL 守卫）

> **权威源码**：`packages/core/plugin-host/execution-policy.ts`、
> `packages/core/worker-runtime/child-isolate.ts`、`child-spawn.ts`、`plugin-permission.ts`、
> `plugin-limits.ts`、`plugin-quota.ts`、`plugin-net-preload.cjs`、`worker-manager.ts`、
> `packages/core/plugin-host/sql-guard.ts`、`context-builder.ts`、
> `packages/core/worker-runtime/service-host.ts`、`server.ts`

---

## 0. 一句话结论

````{danger}
**第三方 ZIP 插件一定跑在 `process`（独立子进程）里，不是你声明的那一档。**

```typescript
export function resolvePluginExecutionMode(
  manifestId, requested, env = process.env, sourcePath?,
): ExecutionModeDecision {
  const normalized = normalizeExecutionMode(requested);
  if (isTrustedInProcessPlugin(manifestId, env, sourcePath)) return { mode: normalized, coerced: false };
  if (normalized === 'process') return { mode: 'process', coerced: false };
  return {
    mode: 'process',
    coerced: true,
    reason:
      `Plugin "${manifestId ?? '(unknown)'}" is not trusted for in-process execution; ` +
      `requested "${normalized}" was forced to "process". ` +
      `Trust requires OPENLEARN_TRUSTED_INLINE_PLUGINS or the built-in plugins directory.`,
  };
}
```

接口会把结果原样吐给你：`executionMode: "process"` 与 `executionModeCoerced: true`。
**改写只落 DB 的 `execution_mode` 列，manifest JSON 仍是作者原文** ——
所以任何按 `manifest.executionMode` 判断的代码都是错的
（`src/plugin-host/types.ts` 里这个字段自带 ⚠ 注释，
POC 测试逐字钉死了 `expect(remote).not.toContain("manifest.executionMode === 'inline'")`）。
````

信任依据**只有三条**（`isTrustedInProcessPlugin`，逐字顺序）：

| 依据                     | 判定                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| 入口文件在内置插件目录内 | `isInsideBuiltinPluginsDir(sourcePath)` —— `path.relative` 不以 `..` 开头且非绝对路径 |
| 命中管理明白名单         | `OPENLEARN_TRUSTED_INLINE_PLUGINS`，支持 `*` / `前缀*` 通配                           |
| 测试环境                 | `env.VITEST && env.OPENLEARN_ENFORCE_PLUGIN_ISOLATION !== '1'` → **返回 true**        |

```{warning}
### 三个坑

1. **`@openlearn/` 前缀不是信任依据。** 变更日志原文：
   「manifest id 不以 `@openlearn/` 开头、且不在 `OPENLEARN_TRUSTED_INLINE_PLUGINS` 中的插件……会被改写成 `executionMode=process`」
   —— 后半句才是规则；前缀本身不参与判定。装了个名叫 `@openlearn/evil` 的 ZIP 一样被强制 process。
2. **安装到 `plugins/<uuid>` 的包不在内置目录**。
   `builtinPluginsDir()` 的注释原文：「仓库内置插件源码目录。安装到 `plugins/<uuid>` 的包不在这里。」
   内置判定按**文件路径**，不按 id。
3. **`dist/server.cjs` 里 `import.meta.url` 为空**，`fileURLToPath` 会抛，
   代码 `catch {}` 后回落 `__dirname`，再回落 `process.cwd()`。
   打包形态下「内置目录」的解析结果可能与源码形态不同 —— 生产部署里依赖内置路径做信任判定时要实测。

另外，`OPENLEARN_ENFORCE_PLUGIN_ISOLATION=1` 只在测试里有意义；
跑测试想验证真实隔离路径就设它，或设 `OPENLEARN_WORKER_ISOLATE=process`。
```

---

## 1. 三档隔离的真实差别

|                       | `inline`                | `worker`（`thread`）                                                           | `process`（默认给第三方）                                   |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 载体                  | 宿主进程内的 ESM 模块   | `worker_threads`                                                               | `child_process` 子进程                                      |
| 崩溃影响              | **可拖垮宿主**          | 线程爆炸，`resourceLimits` 兜                                                  | 一个进程，SIGKILL 可回收                                    |
| `process.env`         | 宿主全量                | **宿主全量**（遮蔽是运行期补救）                                               | 白名单 6 项                                                 |
| 网络                  | 无约束                  | bootstrap 内 net-guard section                                                 | `plugin-net-preload.cjs`（`--require`）                     |
| eval / `new Function` | 无约束                  | 源码 lint                                                                      | `--disallow-code-generation-from-strings`（内核级）         |
| 子进程 / worker       | 无约束                  | 默认禁                                                                         | `--permission` 下默认禁，**从不**加 `--allow-child-process` |
| 堆上限                | —                       | `resourceLimits.maxOldGenerationSizeMb` = 128、`maxYoungGenerationSizeMb` = 32 | `--max-old-space-size=128`（同一常量源）                    |
| RSS / CPU 采样        | ❌                      | ❌（只有 V8 堆）                                                               | ✅ 1s 一次读 `/proc/<pid>`，**仅 Linux**                    |
| 服务发现              | 直接对象                | RPC + Token 白名单                                                             | RPC + Token 白名单 + 归属校验                               |
| 可达 Token            | 全部可 resolve 的 31 个 | `computeAllowedWorkerTokens`                                                   | 同 `worker`                                                 |

```{danger}
### `worker` 不再作为第三方插件的隔离方式

变更日志原文：「Worker 线程与宿主共享 `process.env`，因此**不再**作为第三方插件的隔离方式。」

`child-process-manager.ts` 的注释把理由写透了：

> I-4 给 worker bootstrap 加了 `process.env` 遮蔽，但那是**运行期**的补救 ——
> 密钥已经躺在进程的环境里了。子进程可以在遮蔽生效前读到它，也可以从
> `/proc/self/environ` 读到原始值。
> 所以这里从一开始就只给最小 env。这严格优于 worker_threads 的处境：
> worker 是「给了再遮蔽」，子进程是「根本不给」。

看到「worker 模式隔离」这种说法（包括旧文档、包括你自己的先验）应当立刻怀疑。
```

---

## 2. 最小子进程环境

```typescript
const ENV_ALLOWLIST = [
  'PATH',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_ENV',
  'npm_config_user_agent', // 插件若合法地读取自己的包信息会用到；不含任何凭据
] as const;

const ENV_DENYLIST = new Set([
  'NODE_OPTIONS', // --require / --import 会注入代码；指向不存在模块时子进程直接起不来（实测）
  'NODE_REPL_EXTERNAL_MODULE',
]);
```

- 追加注入：`__PLUGIN_WORKER_DATA`（常量 `WORKER_DATA_ENV`），值是
  `JSON.stringify({ pluginId, manifestId, serviceTokens, pluginDir, tablePrefix, approvedNetHosts })`；
- `overrides` 也要过黑名单（测试/特殊场景注入同受约束）；
- 空字符串的环境变量**不会**被带过去（`v.length > 0`）。

```{important}
**你的插件里 `process.env.ANYTHING` 基本一定是 `undefined`。**
包括 `OPENAI_API_KEY`、`DATABASE_URL`、`ENCRYPTION_KEY`、`HOME`、`PWD`、`SHELL`、`TMPDIR`。
需要配置值 → 走 `ctx.config`（管理员在设置页填，见 {doc}`background-and-config`）；
需要临时文件 → 自己 `os.tmpdir()` 计算，别读 `TMPDIR`。

注释还明确写了设计取向：

> 刻意**不做**「先全继承、再删除敏感项」—— 那种写法依赖一份需要持续维护的
> 敏感名单，而新增一个 `*_API_KEY` 就会漏。白名单是默认拒绝，更难出错。

`NODE_OPTIONS` 的排除有两条独立测试守着（`packages/core/worker-runtime/__tests__/`：
「NODE_OPTIONS 被排除（继承它会让子进程起不来或执行注入代码）」，
断言 `expect(env.NODE_OPTIONS).toBeUndefined()`）。
```

---

## 3. Node 权限模型（L-1 P2）

```typescript
export type PluginPermissionPolicy = 'rw' | 'ro' | 'off';
export const DEFAULT_PERMISSION_POLICY: PluginPermissionPolicy = 'rw';
```

`buildPermissionArgs` 生成的旗标（逐字）：

```
--permission
--disallow-code-generation-from-strings
--allow-fs-read=<pluginDir>/*
--allow-fs-write=<pluginDir>/*        （仅 rw）
--allow-fs-read=<rootPath>/node_modules/*
--allow-fs-read=<sharedPath>  与  --allow-fs-read=<sharedPath>/*
```

`off` 时**返回空数组**（一个旗标都不给）。

### 3.1 实测矩阵（Node v24.1.0，源码表格逐字）

| 能力                                             | 最小权限下             | 备注                                                                             |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------- |
| data URL 动态 `import()`（**插件加载路径本身**） | ✅ 放行                | 「这是方案能落地的前提」                                                         |
| `eval` / `new Function`                          | ⛔ `EvalError`         | 由 `--disallow-code-generation-from-strings` 拦，**该旗标独立于** `--permission` |
| 读 / 写 `pluginDir`（含嵌套 `node_modules`）     | ✅ 放行                | 通配符 `*` **会跨 `/`**                                                          |
| 读 `pluginDir` 之外（如 `/etc/hostname`）        | ⛔ `ERR_ACCESS_DENIED` |                                                                                  |
| `child_process` 拉子进程                         | ⛔ 默认即禁            | 需显式 `--allow-child-process`，**平台从不加**                                   |
| 创建 worker                                      | ⛔ 默认即禁            | 同上，需 `--allow-worker`                                                        |
| IPC `process.send` / `on('message')`             | ✅ 放行                | transport 不受影响                                                               |
| **网络（`net` / `dns`）**                        | ⛔ 沙箱拒绝            | Node 仍没有 `--allow-net`                                                        |

```{warning}
### 旗标名在版本间变过

> 提案原文写的是 `--experimental-permission`。**Node v24.1.0 已不接受该旗标**
> （实测 `bad option: --experimental-permission`）—— 它在 Node 23.5.0 随权限模型
> 转正时被移除。本模块统一用 `--permission`。

所以：网上/旧文档里看到的 `--experimental-permission` 写法在目标运行时**直接起不来**。
```

### 3.2 两个必须说清的缺口

```{important}
1. **权限模型不覆盖网络。** 没有 `--allow-net`。出站由沙箱补上：
   `process` 模式经 `plugin-net-preload.cjs`（`--require` 入口脚本），
   `thread` 模式经 bootstrap 内 net-guard section ——
   原始 socket 与 DNS 默认拒绝，`fetch` 只经宿主代理已批准域名（Issue #237）。
   **`OPENLEARN_PLUGIN_PERMISSION=off` 只关掉 `process` 模式的入口脚本 preload；
   `thread` 模式的 net-guard 属于 bootstrap 本体，不受该开关影响。**
2. **不覆盖 CPU。** 权限模型管「能做什么」，不管「能算多久」。
   RSS 与 CPU 窗口由 `plugin-quota.ts` 采样；`OPENLEARN_PLUGIN_QUOTA=off` 关闭采样。
```

### 3.3 与 `ctx.require` 共享模块的协调

```{note}
bootstrap 里 `createRequire('<宿主 cwd>/package.json')` 意味着共享模块
（`PLUGIN_SHARED_MODULES`）是从**仓库的 `node_modules`** 解析的，不在 `pluginDir` 内。
所以权限模式必须额外放行 `<root>/node_modules/*` 的**读**，
否则 `ctx.require('jspdf')` 会被拒。

放行范围刻意只到 `node_modules` 子树：宿主源码、`.env`、迁移文件都读不到。
代价是该子树下任何文件对插件可读（「里面只有 JS 依赖，可接受」）。

`sharedReadPaths` 目前用于宿主提供的 `@openlearn/plugin-sdk` 链接目录 ——
它既不在 `pluginDir` 下也不在 `<rootPath>/node_modules` 下，
不放行则隔离插件 import SDK 会被以 `ERR_ACCESS_DENIED (FileSystemRead)` 拦下（Issue #147 实测）。
```

### 3.4 非法配置一律落到「更安全」那一侧

```typescript
export function normalizePermissionPolicy(raw: unknown): PluginPermissionPolicy {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  if (v === 'rw' || v === 'ro' || v === 'off') return v;
  return DEFAULT_PERMISSION_POLICY; // 不是 'off'
}
```

```{important}
注释原文：「未知值落到**默认策略**而不是 `off` —— 因为 `off` 是权限最宽的那个，
把拼错的 `OPENLEARN_PLUGIN_PERMISSION=rw-only` 当成 `off` 会静默关掉隔离。」
`normalizeMaxHeapMb` 同理（非法值回落 128，要关必须显式写 `0` / `off` / `none`，
低于 32 也回落默认）。

但这条**方向性原则不覆盖「带单位的数字」**：
`OPENLEARN_PLUGIN_MAX_HEAP_MB=128MB` 是被**接受**的（正则 `^(\d+)\s*(?:mb)?$`），
而 `20s`、`512MB` 这类写法在别的键上会被静默吞掉 ——
所以这五个调参键（`OPENLEARN_PLUGIN_MAX_RSS_MB` / `_CPU_QUOTA_MS` / `_CPU_WINDOW_MS` /
`OPENLEARN_PLUGIN_QUOTA` / `OPENLEARN_WORKER_LIVENESS_*`）已被逐个纳入
`assertStartupEnv` 的**启动期强校验**（R-03 复核补的缺口）：
带单位、负数、非正整数**一律拒绝启动**，窗口过短（<1000ms）只告警。
```

---

## 4. 资源治理

| 键                               | 默认     | 行为                                                                                    |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `OPENLEARN_PLUGIN_MAX_HEAP_MB`   | `128`    | `--max-old-space-size`；`0`/`off`/`none` 不设上限；`<32` 回落默认                       |
| `OPENLEARN_PLUGIN_MAX_RSS_MB`    | `512`    | 1s 一次 `/proc` 采样，超限 **SIGKILL**                                                  |
| `OPENLEARN_PLUGIN_CPU_QUOTA_MS`  | `8000`   | 每窗口 CPU 毫秒；`0`/`off` 关闭                                                         |
| `OPENLEARN_PLUGIN_CPU_WINDOW_MS` | `10000`  | 采样窗口                                                                                |
| `OPENLEARN_PLUGIN_QUOTA`         | 开启     | `off` **同时**关闭 RSS 与 CPU 采样（不影响 V8 堆上限）                                  |
| `OPENLEARN_WORKER_ISOLATE`       | `thread` | 未显式指定 isolateKind 时的原语；**第三方插件激活会显式用 `process`，不受此默认值拉回** |

```{danger}
### 超限是「杀掉」，不是「挂起」

采样超限直接 `SIGKILL`，随后交给崩溃看门狗（指数退避 + 熔断）。
**采样只覆盖 `process` 模式，且只在 Linux 上读 `/proc` 生效**；
`thread` 模式目前只有 V8 堆上限，超限表现为 OOM 崩溃。

存活探活（`liveness-monitor.ts`）负责另一半：「卡死但零 CPU」。
两者是**互补的两条检测路径，不是替代关系**。

后果：一个 `while(true)` 的插件在 macOS/容器外的开发机上**不会被 CPU 配额杀掉**，
只会拖慢宿主；实测数据（源码给的）：16 核宿主、8 个烧满 CPU 的子进程，
宿主吞吐仅降 23.6%，事件循环最大抖动 0.62ms —— 服务不会不可用。
```

```{warning}
### `--max-old-space-size` 只管 V8 老生代

不受约束的：Buffer / TypedArray / ArrayBuffer 等 **external 内存**、原生模块分配的内存、
`SharedArrayBuffer`。源码里那条实测很具体：

> 实测一个「持续往 stderr 写」的插件：POSIX 管道是非阻塞的，**不会死锁**
> （我原以为会阻塞，实测否掉了），但数据被静默丢弃、并在子进程内排队占内存。
> 那部分算 external，不受本上限约束。

也就是说：**用 `console.error` 疯狂输出可以绕过堆上限**，
而且现象是「日志丢失 + 内存增长」而不是报错。
真正的进程级 RSS 上限只能靠容器 / cgroup / Job Object。

128MB 不是拍的：沿用 worker 路径既有的 `maxOldGenerationSizeMb`，
`uuid / exceljs / jspdf / react-markdown / recharts` 五个重型依赖全加载后 `heapUsed=35MB`。
两种原语引用同一常量是刻意的 —— 否则漂移的表现是
「同一插件在 worker 模式正常、在 process 模式 OOM」，极难排查。
```

---

## 5. 出网边界

```{important}
三层，缺一不可：

1. **原始 socket / DNS 默认拒绝**：`process` 模式由 `plugin-net-preload.cjs`（`--require`），
   `thread` 模式由 bootstrap 内 net-guard section（Issue #237）；
2. **`fetch` 被劫持到宿主代理**：preload 在启动时拍下 `approvedNetHosts`
   （来自子进程注入数据 `__PLUGIN_WORKER_DATA`），只放行已批准主机名；
3. **批准表**：`plugin_network_grants(plugin_key, host, approved_at)`，
   由管理员写入；manifest `network.outbound` 只是申请。

低层绕过入口 `process.getBuiltinModule` 已列入 process-masking 屏蔽名单。
```

```{danger}
### `OPENLEARN_PLUGIN_NET_ALLOW` 不是给你用的

它是宿主与 preload 之间的**内部交接键**，由 `plugin-net-preload.cjs` 在启动时消费并删除。
在 manifest 或 env 里设置它不会打开网络，也不会报错。

域名归一化与 SSRF 拒绝规则（`normalizeNetHost` / `classifyNetHostProposals`）见
{doc}`token-reference` 8.4 —— 注意 `normalizeNetHost` 拒绝含 `:` 的输入，
所以 **IPv6 字面量域名一律无法批准**，带端口的写法会得到「不能带协议、端口或路径」。
```

---

## 6. SQL 守卫（PL-05）

`packages/core/plugin-host/sql-guard.ts` 的四层防线（头注释逐字）：

1. 语法规范化：剔除注释（`--` 与 `/* */`）、剥离字符串字面量、
   规范化所有括号与方括号标识符（`[tbl]`、`` `tbl` ``、`"tbl"`）；
2. 深度表名提取：`FROM`（含逗号多表）、`JOIN`、`INTO`、`UPDATE`、`TABLE` 子句，
   「无论如何嵌套或混淆均全量捕获」；
3. 双重命名空间校验：表名必须属于 `ownPrefix`，或共享迁移表 `plugin_migrations`，
   或授权研究表 `plugin_research_*`；外加核心安全表静态兜底黑名单；
4. 元数据表严格受限：`sqlite_master` / `sqlite_schema` 仅放行精确前缀查询。

```typescript
export function assertPluginSqlAllowed(options: SqlGuardOptions): void {
  const { sql, ownPrefix, allowedPrefixes = [], researchAllowed = false } = options;
  if (typeof sql !== 'string' || sql.trim() === '') return;          // ← 空 SQL 直接放行
  for (const opRegex of FORBIDDEN_OPERATIONS) if (opRegex.test(sql)) throw new Error(...);
  const clean = sanitizeSql(sql);
  const tables = extractReferencedTables(clean);
  if (/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\b/i.test(clean) && tables.size === 0) throw new Error(...);
  // 黑名单比对 + 前缀校验 + sqlite_master 特判
}
```

### 6.1 `FORBIDDEN_OPERATIONS`（6 条正则，逐字）

```typescript
/\bATTACH(?:\s+DATABASE)?\b/i
/\bDETACH(?:\s+DATABASE)?\b/i
/\bPRAGMA\b/i
/\bVACUUM\b/i
/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i
/\bDROP\s+(?:TEMP(?:ORARY)?\s+)?(?:TRIGGER|VIEW)\b/i
```

```{warning}
这 6 条作用在**原始 `sql`** 上（在 `sanitizeSql` 之前），
所以字符串字面量里出现 `PRAGMA` 也会被拒 ——
误伤方向是「更严」，符合 fail-closed。
`ERROR` 消息统一是 `Dangerous statement is forbidden: "<sql>"`（整条 SQL 原文进消息，注意别把密钥写进 SQL 文本）。
```

### 6.2 `FORBIDDEN_CORE_TABLES`（40 张，兜底黑名单）

前 28 张为初始集：`users`、`client_sessions`、`plugins`、`plugin_storage`、`ai_providers`、
`processes`、`pending_commands`、`classes`、`students`、`class_students`、`lessons`、
`assignments`、`assignment_submissions`、`attendance`、`schedules`、`class_grade_weights`、
`exams`、`exam_scores`、`student_semester_reports`、`student_rollcalls`、`student_seats`、
`student_read_notifications`、`student_lesson_progress`、`courseware`、`courseware_attempt`、
`system_resources`、`events`、`_migrations`；
2026-10-04 审计补充 12 张：`site_settings`、`agent_conversations`、`classroom_sessions`、
`lesson_quiz_submissions`、`courseware_score_config`、`demo_data_registry`、`whiteboard_elements`、
`student_point_logs`、`lianyun_research_activities`、`lianyun_research_groups`、
`lianyun_research_submissions`、`lianyun_research_reviews`。

````{danger}
命中黑名单时消息**分两种**，取决于这条 SQL 是不是 DDL：

```typescript
const isDdl = /^\s*(DROP|CREATE|ALTER|TRUNCATE)\b/i.test(clean);
// DDL：   Worker plugin is not permitted to perform DDL on table "<t>" (core security table is strictly forbidden)
// 其他：   Worker plugin is not permitted to access table "<t>" (core security table is strictly forbidden)
// 越前缀： ... (only <ownPrefix> namespace is allowed)
```

判定用的是 `tables.has(word)`：先按**全词**扫 `clean` 里的每个标识符，
再确认它确实在提取出的表名集合中。
所以 `SELECT id FROM students` 被拒，而
`SELECT student_name FROM plugin_x` 里 `students` 不作为表出现时**不被拒** —— 别据此写绕过，
兜底逻辑是防御失误用的，不是访问控制。
````

### 6.3 fail-closed 与元数据表

| 情形                                                     | 结果                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 有 `FROM/JOIN/INTO/UPDATE/TABLE` 但解析不出表名          | `Worker plugin SQL rejected: unable to resolve target table in "<sql>"`                                                                                                                                                                 |
| `sqlite_master` / `sqlite_schema` / `sqlite_temp_master` | 仅放行**逐字形状**：`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '<...>'`（整条 SQL 去注释后必须**完全匹配**该正则），且 SQL 里必须包含本插件前缀；否则 `Direct access to sqlite metadata table "<t>" is forbidden` |
| `plugin_migrations`                                      | 无条件放行（宿主建表/删表共用）                                                                                                                                                                                                         |
| `plugin_research_*`                                      | 仅当 `researchAllowed`                                                                                                                                                                                                                  |
| 嵌套子查询                                               | `extractReferencedTables` 用 `\(([^()]*)\)` 逐层收缩，最多 **100 层**，子查询替换成占位符                                                                                                                                               |

```{note}
`tablePrefix` 会随 `__PLUGIN_WORKER_DATA` 下发（「与宿主建表/删表共用的前缀。
缺省时 bootstrap 只用 `pluginId`，不用 manifest id」）。
也就是说**表前缀有两种可能取值** —— 别在插件里硬编码 `plugin_<manifestId>_`。
```

---

## 7. `ensureTable` / `table()` 的注入防线

```typescript
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/; // 最长 64，禁 - . $
function assertSafeSqlIdentifier(value, label) {
  if (typeof value !== 'string' || !SQL_IDENTIFIER_PATTERN.test(value))
    throw new Error(`[SEC] Invalid SQL identifier for ${label}: ${JSON.stringify(value)}`);
}
function assertSafeCreateTableSchema(schema) {
  if (typeof schema !== 'string' || schema.length === 0 || schema.length > 4000)
    throw new Error('[SEC] createTable schema must be a non-empty string (max 4000 chars)');
  if (schema.includes(';'))
    throw new Error('[SEC] createTable schema must not contain ";" (multiple statements are not allowed)');
}
```

```{danger}
背景（变更日志原文）：

> 修复插件自建表 SQL 注入（`ensureTable` / `table` / `dropAllTables`）：
> 表名与 `CREATE TABLE` 的列定义片段都直接来自插件（ZIP 上传，属不可信输入），
> 此前被原样拼进 DDL —— 形如 `t (x); DROP TABLE events; --` 的表名即可改写内核数据。
> 现在 **inline 与 Worker 双模式强制同等校验**。
> `dropAllTables()` 从 `sqlite_master` 读到的表名二次校验 `^plugin_[A-Za-z0-9_]+$` 后才拼进 `DROP TABLE`。

三个实操约束：

1. 表名**不能带连字符**（`my-table` 直接被拒），也不能含点（`db.tbl` 不行）；
2. schema 里**不能有分号**，即使你想在末尾写一个；
3. `dropAllTables()` 只会删 `plugin_` 前缀的表 ——
   你的表名若不满足 `^plugin_[A-Za-z0-9_]+$`，卸载后**残留在库里**且无人清理。
```

---

## 8. Worker RPC 的三道闸 + 数据库访问断言

| 闸             | 消息                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 Token 白名单 | `Access to service token '<token>' denied: not in worker allowedTokens for <actorId>`（`name='WorkerCapabilityError'`） |
| 2 空能力降级   | `Capability denied for actor <id>: empty manifestCapabilities, only 'get' methods allowed`                              |
| 3 方法级策略   | `Call denied for actor <id>: <token>.<method>() — <reason>`                                                             |
| 未登记方法     | `Method "<method>" not found on service "<token>"`                                                                      |
| DB 语句守卫    | `ServiceHost.assertDatabaseAccessAllowed`（叠加 §6）                                                                    |

```{warning}
Barrier 2 是**静默**的：`capabilitiesProposed` 缺失或为 `[]` 时插件仍能激活、
仍能调 `get*`，只有写操作被拒。前端 caps 的提取优先级是
扁平 `record.capabilitiesProposed` → `record.manifest`（JSON 字符串）→ `[]` ——
manifest 被序列化成字符串的那条路径上，任何解析失误都会退化成 `[]`，
把插件变成「只读」却不告诉你是为什么。

另外 `IDatabase` 在 worker/process 侧只是 **4 个方法**的 RPC stub
（`exec` / `prepareAndRun` / `prepareAndGet` / `prepareAndAll`），
不是裸句柄；`rawDb.exec is not a function` 这类历史报错的成因见
{doc}`platform-services` §4。
```

---

## 9. 身份与混淆代理（Confused Deputy）

| 面           | 事实                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| actorId      | 插件发起的一切命令 actor 都是 `plugin:<manifest.id>`，**永不可能**被判为管理员（§1.3 of {doc}`capabilities`）                                    |
| 沙箱命令通道 | `POST /api/plugins/:id(*)/sandbox-command` 注释原文：「强制使用插件自身 actor (`plugin:<manifestId>`)，杜绝 Confused Deputy」                    |
| 会话桥       | `IAuthSessionBridgeService.createSession()` **不校验调用方**，能签发 `role:'administrator'` 会话；它不在 worker 基线白名单，只在 inline 可达     |
| 归属校验     | `wrapProcessManager` 用 `ownerHint`（DB 行 UUID）把进程归属从「激活期」扩展到整个生命周期；`kill` 校验 `isOwnProcess`，**owner 未知时保守允许**  |
| Cookie 下发  | 只有 `manifestDeclaresAuthSessionBridge` 逐字命中 token 名后才写 `edu_os_token` Cookie（4 个条件，见 {doc}`http-api` §12）                       |
| 公开路由     | manifest `api.routes[].auth:false` 是**申请**，需要 `plugin_public_routes` 表里有行才生效（审计 H-4）                                            |
| 请求头       | 只有 5 个头部会到达插件：`content-type` / `accept` / `user-agent` / `x-request-id` / `accept-language`；`Authorization` 与 `Cookie` **永不**转发 |

---

## 10. 完整性 / 签名 / 迁移

```{note}
第三方包的完整性由 4 个错误类承载（消息与继承关系见
{doc}`token-reference` §9）：`PluginSignatureError`（基类，带 `code`）、
`PluginIntegrityRequiredError`（`COMMUNITY_INTEGRITY_REQUIRED`）、
`PluginAttestationRequiredError`（`COMMUNITY_ATTESTATION_REQUIRED`）、
`PluginIntegrityMismatchError`（`COMMUNITY_INTEGRITY_MISMATCH`，
默认消息 `Integrity verification failed for plugin "<id>". Downloaded ZIP checksum does not match repository metadata.`）、
`PluginSignatureInvalidError`（`COMMUNITY_SIGNATURE_INVALID`）。

迁移方向只有一条：`PluginMigrationDowngradeError` 的
`Downgrade rejected: Database has migration version <n>, but package only declares version <m>.
Downgrading plugin database schema is not permitted.`
回滚插件包版本后必须手工处理 `plugin_migrations`，平台不提供降级路径。
```

---

## 11. 症状 → 责任方

| 症状                                                      | 更可能是                            | 判据                                            |
| --------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `manifest.executionMode` 写着 `inline` 但代码行为像被隔离 | **平台**（正常）                    | 看接口返回的 `executionModeCoerced`             |
| `process.env.X` 全 `undefined`                            | **平台**（正常）                    | §2 白名单只有 6 项                              |
| `EvalError: Code generation from strings disallowed`      | **平台**（正常）                    | `--disallow-code-generation-from-strings`       |
| `ERR_ACCESS_DENIED (FileSystemRead)` 读 SDK               | 部署配置                            | `sharedReadPaths` 是否放行（Issue #147）        |
| `ctx.require('jspdf')` 被拒                               | 部署配置                            | `<root>/node_modules/*` 读权限                  |
| 插件被无故 SIGKILL                                        | **平台配额**                        | RSS 512MB / CPU 8000ms 窗口；只在 Linux 生效    |
| 「开发机不杀、线上杀」                                    | **平台**                            | CPU/RSS 采样仅 Linux `/proc`                    |
| 疯狂写 stderr 后内存涨、日志丢                            | external 内存不受堆上限约束         | §4                                              |
| `Dangerous statement is forbidden`                        | 你的 SQL                            | 含 `PRAGMA` / `ATTACH` / 建视图，哪怕在字符串里 |
| `... core security table is strictly forbidden`           | 你的表名撞了 40 张黑名单            | §6.2                                            |
| `Direct access to sqlite metadata table ...`              | 你的 `sqlite_master` 查询形状不符   | §6.3                                            |
| `[SEC] Invalid SQL identifier ...`                        | 表名含 `-` `.` `$` 或超 64 字符     | §7                                              |
| 卸载后残留空表                                            | 表名不满足 `^plugin_[A-Za-z0-9_]+$` | §7                                              |
| 插件只读、写操作全被拒且无报错                            | caps 为 `[]` → Barrier 2            | §8                                              |
| `fetch` 挂起或域名被拒                                    | 未批准 / 含端口 / IPv6 字面量       | §5                                              |

---

## 12. 提交前自查

1. 不读 `process.env` 取配置（除 `PATH` / `LANG` / `TZ` / `NODE_ENV` 之外都拿不到）；
2. 不用 `eval` / `new Function` / 字符串拼装的动态代码；
3. 不 `child_process.spawn`、不 `new Worker`、不开原始 socket；
4. 出站域名逐个写进 `network.outbound` 并等管理员批准，不写通配符 / 端口 / 协议；
5. 表名只用 `[A-Za-z0-9_]`，长度 ≤64，且以 `plugin_` 开头（保证可被 `dropAllTables` 清理）；
6. `ensureTable` 的 schema 里不写分号，长度 ≤4000；
7. 不查 `sqlite_master`（除宿主那种逐字形状的 LIKE 前缀查询）；
8. 不碰 40 张核心表，包括「只读」；
9. 不用 `PRAGMA` / `ATTACH` / `CREATE VIEW`（要 `ctx.db` 的能力就用它暴露的方法）；
10. 内存占用按 128MB 老生代规划，大缓冲区别在堆里长驻；
11. 长任务分片让出 CPU，接受 8s/10s 窗口配额；
12. 不把 `OPENLEARN_PLUGIN_NET_ALLOW` / `ALLOW_UNSAFE_PLUGIN_SCRIPTS` 写进插件包；
13. 不依赖 `manifest.executionMode` 判断运行形态，用服务端求值结果；
14. 不用 `metadata.approved` 试图跳过高危审批。

---

## 13. 取证

| 断言                                                            | 来源（repomix 行）                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `resolvePluginExecutionMode` 与 `coerced`/`reason` 逐字         | ``packages/core/plugin-host/execution-policy.ts`→`resolvePluginExecutionMode`（L116–L135） |
| 三条信任依据                                                    | 同上 `isTrustedInProcessPlugin` L107385–107394                                             |
| `builtinPluginsDir` 的 `dist/server.cjs` 回落                   | `packages/core/plugin-host/execution-policy.ts`（L64–L80）                                 |
| `isInsideBuiltinPluginsDir` 判定式                              | `packages/core/plugin-host/execution-policy.ts`（L82–L89）                                 |
| 强制 process + `executionModeCoerced` + worker 不再是隔离方式   | 变更日志 L412503                                                                           |
| `manifest.executionMode` 不可信注释                             | ``src/plugin-host/types.ts`→`FrontendPluginManifest`（L63） 段）                           |
| POC 断言 `not.toContain("manifest.executionMode === 'inline'")` | ``packages/core/plugin-host/**tests**/plugin-audit-poc.test.ts`→`gateway`（L571–L607）     |
| `ENV_ALLOWLIST` / `ENV_DENYLIST` 逐字                           | `packages/core/worker-runtime/child-isolate.ts`、`child-spawn.ts` L126879–126894           |
| 白名单优于「先继承再删」的理由                                  | 同上 `buildMinimalEnv` 注释 L126907–126915                                                 |
| `/proc/self/environ` 与 I-4 遮蔽无效                            | 同上 L126840–126855                                                                        |
| `WORKER_DATA_ENV` 与 `PluginWorkerData` 字段                    | 同上 L126896–126910                                                                        |
| `NODE_OPTIONS` 排除的两条测试                                   | `worker-runtime/__tests__/` L118813–118821、L95667–95681                                   |
| 策略类型 / 默认值 / `normalizePermissionPolicy`                 | `plugin-permission.ts` L128497–128540                                                      |
| 实测矩阵（Node v24.1.0）与旗标名变更                            | 同上 L128452–128475                                                                        |
| 两个缺口（网络 / CPU）                                          | 同上 L128478–128490                                                                        |
| `buildPermissionArgs` 旗标与「从不加 allow-child-process」      | 同上 L128548–128576                                                                        |
| `sharedReadPaths` 与 Issue #147                                 | 同上 L128516–128528                                                                        |
| `ctx.require` 需放行 `node_modules` 读                          | 同上 L128492–128501                                                                        |
| `describePermissionPolicy` 文案                                 | 同上 L128582–128591                                                                        |
| `DEFAULT_MAX_OLD_GENERATION_MB=128` 与来源                      | `plugin-limits.ts` L127940–127955                                                          |
| external 内存盲区与 stderr 实测                                 | 同上 L127923–127938                                                                        |
| `normalizeMaxHeapMb` 方向性与 `mb` 后缀                         | 同上 L127962–127985                                                                        |
| CPU vs 内存的爆炸半径对比表                                     | 同上 L127900–127915                                                                        |
| RSS/CPU 默认值、SIGKILL、仅 Linux、看门狗                       | `docs/`（L13104）+ 审计报告 R-03（L15620）+ 变量表（L16682–16689）                         |
| 五个调参键纳入 `assertStartupEnv`                               | L26954、L16764                                                                             |
| 网络三层与 `process.getBuiltinModule` 屏蔽                      | `plugin-permission.ts` L128468（Issue #237）+ `plugin-net-preload.cjs` L128010 段          |
| `OPENLEARN_PLUGIN_NET_ALLOW` 为内部交接键                       | 同 {doc}`background-and-config` §4 取证                                                    |
| 40 张 `FORBIDDEN_CORE_TABLES` 逐字                              | ``packages/core/plugin-host/sql-guard.ts`→`FORBIDDEN_CORE_TABLES`（L13–L54）               |
| 6 条 `FORBIDDEN_OPERATIONS`                                     | `packages/core/plugin-host/sql-guard.ts`（L58–L65）                                        |
| `sanitizeSql` 的注释/引号处理                                   | `packages/core/plugin-host/sql-guard.ts`（L68–L143）                                       |
| `extractReferencedTables` 100 层收缩                            | `packages/core/plugin-host/sql-guard.ts`（L201–L218）                                      |
| `assertPluginSqlAllowed` 全流程与三种消息                       | `packages/core/plugin-host/sql-guard.ts`（L229–L313）                                      |
| `sqlite_master` 精准放行正则                                    | `packages/core/plugin-host/sql-guard.ts`（L293–L305）                                      |
| `tablePrefix` 下发与缺省语义                                    | `child-process-manager.ts` L126900                                                         |
| `SQL_IDENTIFIER_PATTERN` / 4000 / 分号                          | `context-builder.ts` L102528–102557                                                        |
| 双模式同等校验 + `dropAllTables` 二次校验                       | 变更日志 L414373；worker 侧 `worker-manager.ts` L125906–125916                             |
| 四道 RPC 闸消息                                                 | ``packages/core/worker-runtime/service-host.ts`→`valueStr`（L853–L1258） 段                |
| Barrier 2 只读降级                                              | 同上 + `src/plugin-host/capabilities.ts` L393664 段                                        |
| 沙箱命令通道「杜绝 Confused Deputy」                            | ``server/routes/plugins.ts`→`result`（L1703）                                              |
| 5 个放行请求头                                                  | `server/routes/plugin-api-gateway.ts` L209275 段                                           |
