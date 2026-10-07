# L-1 立项提案：插件 Worker 的隔离原语升级

- **状态**：待排期
- **提出日期**：2026-10-07
- **来源**：插件系统专项审计（2026-10-06）审计项 **C-1 / H-9 / L-1**
- **决策依据**：D-1（2026-10-07）—— 平台要做**第三方开发者生态**，故此项从「可延后」升为**必立项**
- **关联**：`plugin-system-remediation-tracker.md` 的 L-1 / I-4 / I-5

---

## 1. 结论先行

**当前实现不是安全沙箱，是崩溃隔离。** 但整改后的真实风险面比整改前小得多，且**没有**「已可 RCE」这回事。

本文给出一份**全部经实测**的能力面测量，以及三个层次的处理建议：

| 层次   | 内容                                 | 性质         | 规模                         |
| ------ | ------------------------------------ | ------------ | ---------------------------- |
| **P0** | 宿主侧 CPU 看门狗                    | 真实缺陷修复 | 小（~60 行）                 |
| **P1** | 进程隔离（子进程替代 worker_thread） | 纵深防御     | **大**（需重写 transport）   |
| **P2** | Node Permission Model                | 能力面收敛   | 中（需评估 Node 版本可用性） |

**建议先做 P0**（它才是真正在造成 DoS 的缺口），P1/P2 走独立排期。

---

## 2. 实测：整改后的能力面

测量方式：用**生产实际执行的那段遮蔽代码**（`worker-manager.ts` 的 `extractProcessMaskingBlock()` 同源切取）
放进真实 `Worker` 里跑，而不是写一份等价物。

| 能力                                                                 | 实测结果                                     | 说明                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `process.env`                                                        | **空对象**（`Object.keys().length === 0`）   | I-4 遮蔽生效                                                                                           |
| 环境变量中的密钥                                                     | **0 个**（修前实测 10+ 个）                  | I-4 遮蔽生效                                                                                           |
| `process.exit` / `kill` / `abort` / `setuid*` / `dlopen` / `binding` | 替换为**抛错桩**（调用即抛 `SecurityError`） | I-4；`typeof` 仍是 `function`，故探测须实测调用而非 `typeof`                                           |
| `process.chdir` / `getuid`                                           | **未遮蔽**                                   | `chdir` 是刻意保留：实测遮蔽它会让 `exceljs`（官方白名单依赖）的 require 链炸 `Cyclic __proto__ value` |
| `process.version` / `platform` / `cwd` / `pid`                       | 保留                                         | 刻意：过度遮蔽会让插件无法排障                                                                         |
| `process.argv`                                                       | 收窄为 `['node','openlearn-plugin-worker']`  | 宿主命令行参数可能含路径/内网地址                                                                      |
| `require`                                                            | `undefined`（ESM）                           | —                                                                                                      |
| `SharedArrayBuffer` / `Atomics`                                      | **可用**                                     | 残余面，见 §4                                                                                          |
| **运行期 `await import('node:child_process')`**                      | **ALLOWED，`execSync` 可得**                 | 但**不可达**，见下                                                                                     |

### 运行期动态 import 不可达（决定性验证）

用**真实的** `bundlePlugin()` 路径验证安装期两道门对我能构造的每一条逃逸路径：

| 逃逸形态                                                        | 打包结果                                           |
| --------------------------------------------------------------- | -------------------------------------------------- |
| 静态 `import fs from 'node:fs'`                                 | ❌ `Import of "node:fs" is not allowed`            |
| 字面量 `await import('node:child_process')`                     | ❌ `Import of "node:child_process" is not allowed` |
| 模板字面量 ``await import(`node:child_process`)``               | ❌ 同上                                            |
| 字符串拼接 `const n = 'node:'+'child_process'; await import(n)` | ❌ `[PluginSecurity] computed-import`              |
| `eval('…')`                                                     | ❌ `[PluginSecurity] eval`                         |
| 相对导入（合法对照）                                            | ✅ 打包成功                                        |

⇒ **恶意插件作者无法把加载原生模块的代码送上线**。运行期可达 ≠ 攻击面。

---

## 3. 更正：两条此前写进文档的错误断言

本文同时承担更正责任。这两条已写入台账、CHANGELOG 与源码注释，现予纠正。

### 3.1 「`WorkerOptions.timeout` 可用作 CPU 上限」—— 不存在

- `@types/node@24` 的 `WorkerOptions` **没有 `timeout` 字段**
  （实际字段：`argv/env/eval/workerData/stdin/stdout/stderr/execArgv/resourceLimits/transferList/trackUnmanagedFds/name`）
- 实测 `new Worker(src, { timeout: 1000 })` 完全无效

### 3.2 「同步死循环在 worker_threads 内无法被强制终止」—— **错误**

我在 I-5 时得出该结论，来源是探针缺陷：那次探针打印的「6s 未终止」测的是
`timeout` 选项**有没有触发**，之后才调 `terminate()`，**从未单独验证 terminate 本身**。

严格复测（3 轮 × 2 种载荷）：

```
模块体 while(true)      exit code=1@2ms  exit code=1@2ms  exit code=1@3ms
定时器内 while(true)     exit code=1@2ms  exit code=1@3ms  exit code=1@2ms
死循环期间主线程 300ms 内完成 29 次 tick → 主线程未被阻塞
```

worker 有独立 isolate，V8 侧销毁 isolate **不需要 JS 栈配合** —— 这与
`Atomics.wait` 的协作式阻塞不同，两者不可混为一谈。

---

## 4. 残余风险清单

| #   | 风险                                         | 可达性                         | 后果                              | 处理                                                     |
| --- | -------------------------------------------- | ------------------------------ | --------------------------------- | -------------------------------------------------------- |
| R1  | **CPU 耗尽**：`while(true)` 的插件永久占槽位 | **直接可达**（无需绕过任何门） | 32 个槽位打满即全平台 DoS         | **P0 看门狗**                                            |
| R2  | 堆耗尽                                       | 可达                           | 单插件 OOM                        | `resourceLimits` 已覆盖（128MB/32MB）                    |
| R3  | `SharedArrayBuffer` + `Atomics`              | 可用，但需宿主先创建 SAB       | 与宿主共享内存做低带宽信道 / 竞态 | P2 评估                                                  |
| R4  | `process.chdir` / `getuid`                   | 可用                           | 改变 cwd；读 uid                  | 低。`chdir` 遮蔽会打断 `exceljs`，保留是权衡后的选择     |
| R5  | 单点逃逸 ⇒ 攻陷整个宿主                      | 需先找到 Node/V8 层漏洞        | 爆炸半径 = 整个平台               | **P1 进程隔离**                                          |
| R6  | capability 声明由插件自填                    | 设计如此                       | 声明即获得                        | 已在 `method-policy` 收窄粒度（D-4/B-5）；本质是信任模型 |

**R1 是当前唯一「直接可达且后果严重」的风险。**

---

## 5. 方案

### P0 —— 宿主侧 CPU 看门狗（建议立即做）

**缺口不是「杀不掉」，而是「没有人去杀」**：

- 无 CPU 时间配额（`resourceLimits` 只管堆）
- watchdog 监听 `exit` 事件，而死循环**不产生 exit**，故永不触发
- ⇒ 死循环插件会占住槽位直到进程结束

**做法**（不改插件加载路径、不改 transport）：

1. worker 激活成功后启动一个 CPU 计时器（建议默认 **60s**，可配）
2. worker 每次 `postMessage`（RPC / 心跳）重置该计时器
3. 超时未收到任何消息 → 记日志 + `worker.terminate()` + 走既有 crash 链路（发 `plugin.crashed`）
4. 与既有 `watchdogTimers: Map<string, Set<Timer>>` 合并，复用 C-6 的取消逻辑

**规模**：~60 行 + 测试。**风险**：低（只在插件长时间静默时触发；合法长任务可用环境变量放宽）。

> 注意：与「激活超时」（`ACTIVATE_TIMEOUT_MS`，滑动续期）是两件事 ——
> 那是激活**阶段**的，这个是运行**阶段**的。

### P1 —— 子进程替代 worker_thread（纵深防御）

**收益**：爆炸半径从一个插件 → 一个进程；获得 OS 级强杀、rlimit、cgroup、独立 seccomp。

**代价（必须诚实评估）**：

| 项             | 影响                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| transport 重写 | `NodeWorkerTransport` 依赖 `Worker` 实例的 `postMessage/on/off/terminate`；子进程需改用 `child_process` 的 `ipc` + 手动序列化 |
| 事件转发       | `EventForwarder` 依赖同一进程内的 `EventBus` 引用，跨进程需改为消息中继                                                       |
| 性能           | IPC 序列化开销；worker_threads 的 `structuredClone` 快于子进程 JSON 通道（需评估 `v8.serialize`/`MessageChannel`）            |
| DB 访问        | 现在 worker 通过 RPC 拿 `IDatabase` 代理 —— 跨进程仍走 RPC，**这块架构上已隔离，可直接复用**                                  |
| 启动成本       | 子进程启动 ~50ms vs worker ~15ms                                                                                              |

**结论**：可行但**不是小改动**，必须单独立项、单独排期。

### P2 —— Node Permission Model（能力面收敛）

`node --experimental-permission` 可限制 `fs` / `child_process` / `worker` 等能力。

**但要注意**：

- 它**限能力，不解 CPU**（R1 仍需 P0）
- 与 `bootstrapSharedModules()`（`ctx.require` 白名单）需要协调
- Node 版本可用性需评估（当前环境 v24.1.0，该模型仍在演进）

建议在 P1 落地时一并评估（子进程 + `--permission` 是天然组合）。

---

## 6. 建议的推进顺序

1. **立即**：P0 CPU 看门狗（低成本，修掉唯一「直接可达且严重」的风险）
2. **单独立项**：P1 进程隔离 —— 排期、影响面评估、分阶段（先 transport 抽象，再换实现）
3. **P1 落地时**：评估 P2，以及 `--experimental-permission` 与 `ctx.require` 白名单的协调

---

## 7. 一条方法论备注

本文档记录的两次自我更正（§3）有共性：**先下结论、后验证，且验证的不是结论本身**。

- 说「`timeout` 能限 CPU」→ 验证的却是「这个 worker 会不会自己退出」
- 说「terminate 杀不掉死循环」→ 验证的却是「`timeout` 选项会不会触发」

整改全程（Batch 1~5）另有 5 处同类问题：漂移分析器的 5 个 bug、`process.chdir` 导致 `exceljs` 断裂、
CGNAT 等 7 个漏网保留段、192.0.0.0/24 掩码误写成 /16、`expect(typeof kill).not.toBe('function')` 假通过。

**结论**：涉及「能力/上限/隔离」的断言，一律以**针对性实测**为准，且实测脚本要与断言**同构**
（这正是我写 `extractProcessMaskingBlock()` 与 `extractProcessTerminationProbe()` 的原因 ——
测生产实际执行的那段代码，而不是复制品）。
