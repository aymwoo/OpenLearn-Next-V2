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

### P0 —— 存活探活（✅ 已实现，2026-10-07）

**缺口不是「杀不掉」，而是「没有人去杀」**：

- 无 CPU 时间配额（`resourceLimits` 只管堆）
- 崩溃看门狗监听 `exit` 事件，而死循环**不产生 exit**，故永不触发
- ⇒ 死循环插件会占住槽位直到进程结束

> ⚠️ **本节的设计在实施时被实测推翻了两次**，下面是修正后的最终形态。
> 保留原设计思路是为了让后来者看到「为什么最后不是那样」。

#### 原设计（已否决）

> 1. worker 激活成功后启动一个计时器（60s）
> 2. worker 每次 postMessage 重置该计时器
> 3. 超时未收到任何消息 → `terminate()`

**这个设计会误杀健康但空闲的插件。** 一个等着下一节课开始的插件，
本就可以几十分钟不发任何消息 —— 它没做错任何事，却会被当成卡死杀掉。
这是功能性回归，不是保守取舍。

#### 两条替代判据也被实测否决

| 候选                                        | 实测结果                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **worker 自报 `process.cpuUsage()`**        | ❌ **自旋的 worker 发不出心跳** —— 事件循环被 `while(true)` 堵住，`setInterval` 停摆、`postMessage` 永不执行。而同步死循环正是要治的形态，故该方案对该威胁完全无效                                                                                                 |
| **`/proc/self/task/<tid>/stat` 按线程采样** | ❌ `worker.threadId` 是 **Node 内部 id（2、3、4…）**，而 `/proc` 用 **OS tid（70 万级）**，两者无映射，精确到线程不可行。（进程级 `process.cpuUsage()` 区分度确实很强：实测死循环 81.9% / 空闲 0.1%，但它是**进程级**的，含宿主自身开销，无法归因到具体 pluginId） |

#### 最终设计：ping/pong 存活探活

区别不在「有没有主动说话」，而在**「事件循环还能不能响应」**：

- 空闲 worker 的事件循环是通的，收到 ping 会**立刻**回 pong
- 卡死的 worker 收到什么都不会处理

实测（Linux / Node 24，真实 Worker）：

```
健康但空闲（从不发消息）   ping → pong  0ms
同步死循环 while(true)     ping → 完全无响应（等满 1500ms 预算）
```

**实现要点**：

| 位置                | 做法                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worker 侧 bootstrap | ping 分支放在 `parentPort.on('message')` 的**最前面**，同步回 pong。放后面无效 —— 插件卡死后该函数根本不会再被调用                                              |
| 宿主侧              | 每 `interval`（默认 30s）给每个 running worker 发 ping；`grace`（默认 15s）内无响应即 `terminateWorker()`                                                       |
| 存活证据            | **任何**入站消息都算，不只认 pong —— 只认 pong 会误杀高频通信但 pong 排队靠后的插件                                                                             |
| 崩溃链路            | 复用既有 `terminateWorker → exit → scheduleWatchdogRestart`（指数退避 + 熔断），**不另建通道**                                                                  |
| 生命周期            | `startTracking` 在**激活成功后**调用（激活阶段已有 `ACTIVATE_TIMEOUT_MS` 与滑动续期，并行会误杀慢启动插件）；`stopTracking` 在 `terminateWorker` 中做           |
| 终止动作            | 由探活器**自己**调 `terminate()`，而不是只返回判定给调用方 —— 否则会出现「检测接上了、终止忘了接」这种最难发现的接线错误，表现为「一切正常，就是 CPU 一直被吃」 |

**实测检出延迟**：默认参数下 `while(true)` worker 在 **45s 内**被终止；
集成测试把阈值压到 150ms 后，真实死循环在 ~3.5s 内被终止。

**配置**：`OPENLEARN_WORKER_LIVENESS=off` 关闭；
`OPENLEARN_WORKER_LIVENESS_INTERVAL_MS` / `_GRACE_MS` 调整。

**规模**：实际 ~260 行（含 180 行测试），比原估的 60 行多 —— 因为多了一条否决路径的记录、
一套可控时钟的状态机测试，以及必须走真实 Worker 的集成测试。

**仍未覆盖**：「吃 CPU 但让出事件循环」的插件（异步重活）不在本判据范围内 ——
它能回 pong，故被判为健康。这类形态会让进程级 CPU 升高但平台仍可响应，
是比死循环轻一档的威胁，留给 P1 的进程级配额处理。

### P1 —— 子进程替代 worker_thread（纵深防御）

> ⚠️ **本节的成本评估已被实测修正**（2026-10-08）。两处**高估**、一处**低估**，
> 且真正的接缝不在原判断的位置。修正后的分阶段方案见下。

**收益**：爆炸半径从一个插件 → 一个进程；获得 OS 级强杀、rlimit、cgroup、独立 seccomp。

#### 原评估 vs 实测

| 项             | 原评估                                                                      | 实测结论                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| transport 重写 | 「需改用 `child_process` 的 ipc + 手动序列化」                              | **高估**。`IWorkerTransport` 抽象**早已存在**，且已有 Node / Browser 两个实现。bootstrap 侧实测只有 1 行 import + 8 处 `workerData` + 25 处 `parentPort.postMessage` + 1 处 `parentPort.on` —— 一个 ~10 行 shim 即可同时支持两种运行时，**不必逐处改写** |
| 事件转发       | 「`EventForwarder` 依赖同一进程内的 `EventBus` 引用，跨进程需改为消息中继」 | **结论错误**。它是 `new EventForwarder(eventBus, transport)` —— 完全基于 transport、跑在宿主侧、向 worker 转发只走 transport。**无需重写**                                                                                                               |
| 真正的接缝     | 未识别                                                                      | `WorkerRegistry.register()` **直接摸 `instance.worker`**（`threadId` / `on('exit')` / `on('error')` / `terminate()`），完全绕过 `IWorkerTransport`。这才是子进程接不进来的地方                                                                           |
| 序列化         | 「worker_threads 的 structuredClone 快于子进程 JSON 通道（需评估）」        | **已排除为风险**。实测 `spawn(..., {serialization:'json'})` 有 **10/13 探针静默降级**；`serialization:'advanced'`（v8.serialize）**0/13 不一致，与 structuredClone 完全一致**。见 `ipc-serialization-parity.test.ts`                                     |
| DB 访问        | 「走 RPC，架构上已隔离，可直接复用」                                        | 成立                                                                                                                                                                                                                                                     |
| 启动成本       | 「子进程 ~50ms vs worker ~15ms」（**估算**）                                | **实测推翻**：child_process 21.9ms vs worker_threads 24.9ms，**比值 0.88×**（子进程并不更慢）                                                                                                                                                            |

#### 分阶段方案

| 阶段  | 内容                                                                                                                                                                                                         | 状态          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| **1** | 抽出 `IWorkerIsolate`（`isolateId`/`onExit`/`onError`/`terminate`），把 `WorkerRegistry` 与 `node:worker_threads` 解耦；删除只写不读的 `workerByThreadId`                                                    | ✅ **已完成** |
| **2** | 新增 `ChildProcessTransport` + `ChildProcessIsolate`，以及 bootstrap shim（`parentPort`→`process.send`、`workerData`→env），**显式 `serialization:'advanced'`**。仍默认走 worker_threads，子进程作为可选模式 | ☐             |
| **3** | 让 `executionMode` 支持第三种取值，全量测试对比两种隔离原语的行为差异与启动成本                                                                                                                              | ✅ **已完成** |

#### 阶段 3 实测结果

**启动成本 —— 推翻了本提案原先的估算。** 早期写的是「子进程 ~50ms vs worker ~15ms」（3.3×）。
走真实创建路径（`WorkerManager.createWorker`，含 bootstrap 编译、隔离原语启动、插件模块加载、
activate 往返）实测 5 轮取中位数：

| 隔离原语         | 中位启动耗时 | 各轮               |
| ---------------- | ------------ | ------------------ |
| `worker_threads` | **24.9ms**   | 25, 25, 25, 46, 23 |
| `child_process`  | **21.9ms**   | 22, 22, 24, 22, 22 |

比值 **0.88×** —— 子进程**并不更慢，反而略快**。原因：子进程侧走
`node --input-type=module --eval <bootstrap>`，**不写临时文件**，省掉 worker 侧
`resourceLimits` 的 isolate 配置开销。

> ⚠️ **适用边界**：被测插件是**空壳**（`activate` 只返回一个字符串）。真实插件要加载
> data URL 里的 bundle、要经 RPC 拿能力，平衡点可能移动。基准已固化为
> `isolate-benchmark.test.ts`，插件变复杂后重跑即可。断言写成「记录事实 + 1500ms 宽松上限」
> 而非钉死比值 —— 比值依赖机器与并发负载，钉死会在 CI 上偶发失败。

**全量行为对比 —— 两种原语结果完全一致：**

```
thread （默认）  : 386 files / 3245 tests / 2 failed
process          : 386 files / 3245 tests / 2 failed
```

两条失败均来自并行的 E2E 工作流在途改动（canary 撞 method-policy 门禁、
AdaptiveExitTicket 语义变更未同步测试），与隔离原语无关。

**发现的唯一行为差异**：`transport.id` 的前缀随原语变（`worker:<threadId>` vs
`child:<pid>`）。既有用例硬编码 `/^worker/`，在进程模式下红 —— 那不是缺陷，是断言
没考虑「现在有两种原语」。已改为按实际生效的原语断言（两种模式下各 15/15 通过）。

**让 `'process'` 真正可用的关键改动**：`isolateKind` 从 Manager 级单值改为
**按实例覆盖**，否则一个进程内所有 worker 只能同种 —— 那样 `'process'` 就只是个全局
开关，而不是 per-plugin 的执行模式。

**最危险的失效形态（已加测试守住）**：模式收窄散落在 **11 处**，写法是
`x === 'worker' || x === 'inline' ? x : undefined`。**漏改不产生任何编译错误**，
而后果是：管理员选「进程隔离」→ 该入口判非法 → 返回 `undefined` → 默认 `inline`
→ **插件根本没进隔离路径，界面却显示已生效**。故引入具名类型
`PluginExecutionMode` 收敛到单一真源，并用 `execution-mode.test.ts`（11 例）守住
「三处 API 入口都认得 process」。已做反向对照：把两处退回旧写法后 3 例立即红。

**阶段 1 顺带清掉的历史包袱**：`workerByThreadId` 标注「用于崩溃检测」，但全仓**只写不读**
（只有 `set`/`delete`，零读取点，grep 确认）—— 崩溃检测实际由 `onExit` 回调完成。
它是「注册表依赖专有 `threadId`」的唯一来源，故随抽象一并删除。

### P2 —— Node Permission Model（能力面收敛）

`node --experimental-permission` 可限制 `fs` / `child_process` / `worker` 等能力。

**但要注意**：

- 它**限能力，不解 CPU**（R1 仍需 P0）
- 与 `bootstrapSharedModules()`（`ctx.require` 白名单）需要协调
- Node 版本可用性需评估（当前环境 v24.1.0，该模型仍在演进）

建议在 P1 落地时一并评估（子进程 + `--permission` 是天然组合）。

---

## 6. 建议的推进顺序

1. ~~**立即**：P0 CPU 看门狗~~ → **已实现为 ping/pong 存活探活**（原设计的「静默计时器」会误杀空闲插件，见 §5 P0）
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
