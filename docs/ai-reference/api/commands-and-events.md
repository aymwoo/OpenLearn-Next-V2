# 命令与事件目录

> 命令是平台唯一的「可授权操作」单元；事件是唯一的「已发生事实」广播单元。
> 本文件给**命名空间级**的目录与配对校验方法，不逐条抄 84 个命令的 payload 结构。

---

## 1. 命令注册总量与分布

统计口径：**唯一 `commandType`**，不是调用点。一条命令在 `management.ts` 与
`assignment-eval.ts` 各注册一次时只计 1 条。复跑校验：

```bash
node scripts/plugin-command-audit.mjs
# registerHandler   : 84 个唯一 commandType（其中 4 条由对象表解析）
# actionRegistry    : 84 个唯一 commandType（其中 5 条由规格数组解析）
# 有 handler 无 action: 0 个   有 action 无 handler: 0 个
```

| 文件                                  | 命令 handler                       | ActionDescriptor | 配对       |
| ------------------------------------- | ---------------------------------- | ---------------- | ---------- |
| `packages/plugins/builtin.ts`         | 35                                 | 35               | ✅         |
| `packages/plugins/management.ts`      | 25                                 | 25               | ✅         |
| `packages/plugins/assignment-eval.ts` | 7                                  | 7                | ✅         |
| `packages/plugins/process.ts`         | 4                                  | 4                | ✅         |
| `packages/plugins/vfs.ts`             | 4                                  | 4                | ✅         |
| `packages/plugins/ai-planner.ts`      | 3                                  | 3                | ✅         |
| `server/routes/classroom.ts`          | 5（1 个调用点循环注册）            | 5                | ✅         |
| `server/routes/resources.ts`          | 4（1 个调用点循环注册）            | 4                | ✅         |
| **合计**                              | **84**（87 处注册 − 3 处同名重复） | **84**           | **0 缺口** |

**87 与 84 的差额**：`assignment.create` / `.submit` / `.grade` 在 `management.ts`
（L619/656/697）与 `assignment-eval.ts`（L417/710/1058）各注册一份，descriptor id 不同
（`core-assignment-*` vs `eval-assignment-*`），命令名相同 → 去重后 84。

**运行时交叉验证**：内核启动完成（`bootstrapSystemPlugins()` 结束）后，descriptor 已覆盖
**75 个 commandType**（35+25+7+4+4+3，去掉 3 个重名）；剩下 9 条由 `server.ts` 挂载路由时补
（`classroom.ts` 5 条 + `resources.ts` 4 条）→ 84。
路由级 descriptor 在**路由注册时**才存在，所以任何「启动即导表」的脚本都少这 9 条 ——
写工具校验时必须把 `registerClassroomRoutes` / `registerResourcesRoutes` 一起跑过再读 `actionRegistry`。

> **计数陷阱**：直接 `grep -c registerHandler` 会得到虚高数字。四个必须排除的来源：
> `unregisterHandler(`（子串命中）、`processManager.registerHandler(`（另一个总线）、
> 循环里的单次 `actionRegistry.register(`（一个调用点注册 N 条）、
> `src/` 模板字符串里的教学示例（`quiz.create` / `hello.greet`，不是运行时注册）。
> 平台侧正确做法是跑 `node scripts/plugin-command-audit.mjs`，它按文件分两种口径输出。

---

## 2. 命令命名空间

命令名一律 `namespace.action`，命名空间取**领域**而非文件：

| 命名空间              | 命令数 | 代表命令                                                               | 归属文件                                                             |
| --------------------- | ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `courseware`          | 10     | `courseware.submit_attempt`、`.save_score_config`、`.regrade_attempts` | `packages/plugins/builtin.ts`                                        |
| `class`               | 8      | `class.create`、`.add_student`、`.template_download`                   | `packages/plugins/management.ts`                                     |
| `whiteboard`          | 8      | `whiteboard.draw`、`.batch_draw`、`.query`                             | `packages/plugins/builtin.ts`                                        |
| `assignment`          | 7      | `assignment.create`、`.submit`、`.peer_review`、`.grade`               | `packages/plugins/assignment-eval.ts`（3 条与 `management.ts` 重复） |
| `student`             | 7      | `student.create`、`.set_progress`、`.add_note`                         | `packages/plugins/management.ts`                                     |
| `lesson`              | 6      | `lesson.create`、`.update_timeline`、`.add_segment`、`.delete`         | `packages/plugins/builtin.ts`                                        |
| `plugin`              | 6      | `plugin.install`、`.install_zip`、`.toggle`、`.uninstall`              | `packages/plugins/builtin.ts`                                        |
| `classroom.countdown` | 5      | `.start`、`.pause`、`.resume`、`.reset`、`.add_time`                   | `server/routes/classroom.ts`                                         |
| `process`             | 4      | spawn / kill / list / logs                                             | `packages/plugins/process.ts`                                        |
| `vfs`                 | 4      | `vfs.write_file`、`.read_file`、`.list_dir`、`.mkdir`                  | `packages/plugins/vfs.ts`                                            |
| `user`                | 4      | `user.create`、`.update`、`.delete`、`.list`                           | `packages/plugins/builtin.ts`                                        |
| `resource`            | 4      | `.list`、`.get`、`.create`、`.delete`                                  | `server/routes/resources.ts`                                         |
| `ai`                  | 3      | `ai.start_generation`、`.apply_recommendation`、`.apply_grade`         | `packages/plugins/ai-planner.ts`                                     |
| `schedule`            | 3      | `schedule.create`、`.list`、`.cancel`                                  | `packages/plugins/management.ts`                                     |
| `lab`                 | 3      | `lab.create`、`.list`、`.assign_seat`                                  | `packages/plugins/management.ts`                                     |
| `attendance`          | 1      | `attendance.record`                                                    | `packages/plugins/management.ts`                                     |
| `hello`               | 1      | `hello.say`                                                            | `packages/plugins/builtin.ts`（连通性探针）                          |

**命名规则**（由 `plugin-host/plugin-namespace.ts → resolvePluginCommandType`，L62 强制）：

| 输入                                   | 结果                                                      |
| -------------------------------------- | --------------------------------------------------------- |
| 已带前缀 `@acme/x.foo.bar`             | 原样（UUID v7 前缀也原样）                                |
| 短名 `lesson.create`（平台内置）       | 原样                                                      |
| 短名 `lab_seat.check_in`（插件内注册） | 前置插件 id → `@aymwoo/plugin-lab-seat.lab_seat.check_in` |

**前端派发时必须用全限定名**，后端注册时用短名。写反了就是「点按钮没反应」。
见 [../development/troubleshooting.md](../development/troubleshooting.md) §2。

---

## 3. 命令对应的能力要求（抽样）

`capabilityRequired` 是**自由字符串**，不在 19 条真值内的值不会报错，只会让所有非管理员
调用静默失败 —— 所以下表的值必须逐字抄，不能"顾名思义"。

| 命令                           | `capabilityRequired` | 其他闸门               | 说明                                                 |
| ------------------------------ | -------------------- | ---------------------- | ---------------------------------------------------- |
| `assignment.grade`             | `assignment:manage`  | —                      | 终评。**不是** `assignment:grade`（该值不存在）      |
| `assignment.submit`            | `assignment:submit`  | —                      | 学生可发起（唯一允许学生写入的入口）                 |
| `lesson.create`                | `lesson:write`       | —                      | 建课                                                 |
| `lesson.delete`                | `lesson:delete`      | `isHighRisk`           | 删课，需人工审批                                     |
| `classroom.countdown.start`    | `lesson:write`       | —                      | 课堂控制复用 lesson 域。**不是** `classroom:control` |
| `vfs.write_file`               | `vfs:write`          | —                      | 虚拟文件系统写。**不是** `storage:write`             |
| `courseware.save_score_config` | `lesson:write`       | `exposeToAgent: false` | 改成绩规则，不进 AI 工具箱                           |
| `resource.create`              | `management:write`   | —                      | 建教学资源                                           |
| `resource.delete`              | `management:write`   | `isHighRisk`           | 删资源 + 磁盘缓存，需人工审批                        |
| `plugin.install`               | `plugin:write`       | `isHighRisk`           | 装任意 JS 源码                                       |
| `user.delete`                  | `management:write`   | `isHighRisk`           | 删账号                                               |

19 条能力真值全表见 [../plugin-system/capabilities-and-security.md](../plugin-system/capabilities-and-security.md) §1。

---

## 4. `resource.*` 曾经缺描述符（U-11，已修复，留档）

**现状**：`server/routes/resources.ts` 的 4 条命令各有一条 ActionDescriptor，配对完整
（`node scripts/plugin-command-audit.mjs` 报 0 缺口）。修复点在该文件的
`registerResourcesRoutes()` 尾部，descriptor 紧挨 `RESOURCE_HANDLERS` 之上。

**曾经的故障**：该文件只注册了 handler，没有任何 `actionRegistry.register()`。
kernel 的 interceptor 是 default-deny（`packages/core/kernel/index.ts` L372-400），
所以这 4 条命令**任何路径都拿不到执行权** —— 包括插件内部直接 `commandBus.execute`，
因为闸门是全局的、在 handler 之前跑。表面现象是 REST 一切正常（`/api/resources` 独立工作），
只有走命令面的插件会收到 403 `COMMAND_NOT_REGISTERED`。这条缺口长期无人发现的原因见 §1 计数陷阱。

**修复时的三个取舍**（改这 4 条命令前先读，否则容易重犯）：

| 取舍                       | 选定                                                             | 理由                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能力前缀                   | 复用 `management:read` / `management:write`，不新造 `resource:*` | `CapabilityGuard` 的角色回退只认既有词汇表（`packages/core/capability/guard/capability-guard.ts` L84-97）。teacher 持 `management:*`、`agent-system-0` 持 `management:read+write`；新造前缀会让教师与 AI 助教**双双被拒** |
| `resource.delete` 是否高危 | `isHighRisk: true`                                               | 同时删 `system_resources` 行与 `storage/courseware` 磁盘缓存，不可回滚。与 `lesson.delete`、`user.delete`、`plugin.uninstall` 同档：非管理员调用进 `pending_commands` 等人工审批                                          |
| 无参命令的 schema          | `{ type: 'OBJECT', properties: {} }`（同 `courseware.list`）     | `validateJsonSchema` 见到 `type: 'OBJECT'` 就要求 payload 是对象。**调用方必须传 `{}`**，省略 payload 会被拒为 `Expected object, got undefined`                                                                           |

回归测试：`server/__tests__/resource-commands.test.ts`（7 例）—— 描述符存在性、能力标注、
教师派发放行、学生 403、`undefined` payload 被拒、create→get 往返、delete 触发审批。

原始记录见 [../evidence/unresolved-questions.md](../evidence/unresolved-questions.md) `U-11`（状态 CLOSED）。

---

## 5. 事件目录

### 5.1 划分

| 类别       | 前缀                        | 例子                                                            |
| ---------- | --------------------------- | --------------------------------------------------------------- |
| 领域事实   | `<domain>.<past_tense>`     | `lesson.created`、`assignment.graded`、`courseware.uploaded`    |
| 课堂       | `classroom.*` / `segment.*` | `classroom.lock_changed`、`segment.gate_overridden`             |
| 白板       | `whiteboard.*`              | `whiteboard.element_drawn`、`whiteboard.batch_drawn`            |
| 学生侧     | `student.*`                 | `student.progress_updated`、`student.notification_acknowledged` |
| 积分       | `points.*`                  | `points.awarded`                                                |
| 系统       | `process.*` / `approval.*`  | `process.spawned`、`approval.requested`                         |
| 插件自定义 | `<plugin_ns>.*`             | `lab_seat.student_checked_in`                                   |

**命名约束**：过去时（`created` 而非 `create`），点分命名空间。这条与命令的现在时（`create`）刻意区分。

### 5.2 订阅的三条路径

| 路径                           | 谁用                     | 特点                                 |
| ------------------------------ | ------------------------ | ------------------------------------ |
| `eventBus.subscribe(type, fn)` | 服务端业务（如积分发放） | 进程内，同步/异步皆可                |
| `SOCKET_ROUTES` 一行声明       | 需要推给前端的事件       | 声明式，自动带 `_meta`，可枚举可单测 |
| `ClassroomFeedService`         | 课堂动态流               | 独立订阅，落 `classroom_feed` 表     |

**同一事件可以同时走三条**（`assignment.graded` 就同时进 toast 路由、成绩历史、动态流）。

### 5.3 只在服务端消费、不推前端的事件

这些事件**不在** `SOCKET_ROUTES` 里，前端收不到，属于设计如此：

```text
lesson.created / lesson.timeline_updated      → 前端靠 HTTP 重新拉取
courseware.uploaded / courseware.confirmed    → 前端靠上传响应
process.spawned                                → 管理后台靠 /api/processes 轮询
approval.requested                             → 管理后台靠 /api/approvals 轮询
```

**推论**：前端「不刷新」不一定是 bug —— 先确认该事件是否本就设计为 HTTP 拉取。

---

## 6. 新增一条命令的完整清单

```text
[ ] 1. 命名空间用领域名，动作现在时：<domain>.<verb>
[ ] 2. commandBus.registerHandler('<domain>.<verb>', { execute })
[ ] 3. **同一段落内**紧接着 actionRegistry.register({ id, commandType, description, capabilityRequired, inputSchema })
[ ] 4. capabilityRequired 必须在 19 条真值内
[ ] 5. inputSchema 用全大写类型名（'OBJECT'/'STRING'…），否则 required 静默失效
[ ] 6. 高危操作加 isHighRisk: true（会进 pending_commands 等人工审批）
[ ] 7. 不想被 AI 调用时加 exposeToAgent: false
[ ] 8. 成功后 eventBus.publish({ id, type, source, payload, timestamp, correlationId: command.id })
[ ] 9. 要推前端 → 在 SOCKET_ROUTES 加一行
[ ] 10. 跑 node scripts/plugin-command-audit.mjs 确认 0 缺失
```

插件侧同一套流程，差异只有两点：`manifest.capabilitiesProposed` 要先声明该能力；
命令注册时用短名（宿主会加前缀）。完整示例见
[../examples/minimal-plugin.md](../examples/minimal-plugin.md)。
