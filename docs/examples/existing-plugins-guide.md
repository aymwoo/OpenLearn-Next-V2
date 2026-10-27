# 内置范例插件拆解指南 (Existing Built-in Plugins Guide)

OpenLearn V2 在 `packages/plugins/` 目录中内置了 7 个带 `manifest` 的生产级插件。它们遵循标准的 API 契约与三件套（Action -> Command -> Event）模式，是开发者理解平台命令边界的最佳参考实现。

| 插件 | 文件 | 定位 |
| --- | --- | --- |
| `@openlearn/plugin-builtin` | `packages/plugins/builtin.ts` | 平台核心命令：用户、班级、课件、白板、插件安装/启停、系统运维 |
| `@openlearn/plugin-vfs` | `packages/plugins/vfs.ts` | 虚拟文件系统读写 |
| `@openlearn/plugin-process` | `packages/plugins/process.ts` | 后台进程与日志 |
| `@openlearn/plugin-management` | `packages/plugins/management.ts` | 班级 / 学生 / 作业 / 课表 / 考勤 / 实验室管理 |
| `@openlearn/plugin-ai-planner` | `packages/plugins/ai-planner.ts` | AI 备课、推荐应用、AI 批改 |
| `@openlearn/plugin-assignment-eval` | `packages/plugins/assignment-eval.ts` | 作业创建、提交、互评、评分 |
| `@openlearn/plugin-ai-submit-injector` | `packages/plugins/ai-submit-injector.ts` | 向课件 HTML 注入 AI 提交/成绩采集逻辑 |

> `courseware-score.ts`、`score-monitor-script.ts` 是 `builtin.ts` 引用的**内部模块**，不单独注册插件。

---

## 1. 虚拟文件系统插件 (`@openlearn/plugin-vfs`)

- **源码目录**: `packages/plugins/vfs.ts`
- **主要用途**: 为系统与 AI 智能体提供树状目录结构的虚拟文件系统（VFS）隔离读写能力。

### Manifest 解析

```typescript
manifest: {
  id: '@openlearn/plugin-vfs',
  name: '虚拟文件系统插件',
  version: '1.0.0',
  requires: [
    '@openlearn/core:ICommandBusService@^1.0.0',
    '@openlearn/core:IActionRegistryService@^1.0.0',
    '@openlearn/core:IEventBusService@^1.0.0',
    '@openlearn/core:IDatabase@^1.0.0',
  ],
  capabilitiesProposed: ['vfs:read', 'vfs:write'],
  engines: { openlearn: '>=0.2.5' },
}
```

### 提供的 Commands & Events

- `vfs.write_file`: 写入文件并触发 `vfs.file_written` 事件。
- `vfs.read_file`: 读取路径对应内容。
- `vfs.list_dir`: 列出绝对路径下目录节点。
- `vfs.mkdir`: 创建新文件夹。

---

## 2. 平台管理与运维插件 (`@openlearn/plugin-management`)

- **源码目录**: `packages/plugins/management.ts`
- **主要用途**: 班级、学生、作业、课表、考勤与实验室等教学管理命令。

### 核心功能

- **班级 / 学生**: `class.create`、`class.list`、`class.get_students`、`student.create`、`student.list`、`student.update`、`student.delete`、`class.add_student`、`class.remove_student`、`student.add_note`、`student.set_progress`。
- **作业与课表**: `assignment.create`、`assignment.submit`、`assignment.grade`、`schedule.create`、`schedule.cancel`、`schedule.list`。
- **考勤与实验室**: `attendance.record`、`lab.create`、`lab.list`、`lab.assign_seat`。
- 插件安装 / 启停 / 系统运维命令（`plugin.install`、`plugin.install_zip`、`plugin.update_zip`、`plugin.toggle`、`plugin.uninstall`、`plugin.info`、`user.*`、`courseware.*`）在 `builtin.ts`，不在本插件。

---

## 3. AI 智能体课程规划器 (`@openlearn/plugin-ai-planner`)

- **源码目录**: `packages/plugins/ai-planner.ts`
- **主要用途**: 注册 AI 生成/应用/批改三类命令。

### 实现亮点

- `ai.start_generation` 通过 `ctx.services.processManager.spawn()` 把生成任务丢到后台进程，立即返回 `processId`。
- `ai.apply_recommendation`（`isHighRisk: true`）把 AI 建议写回 `lessons` / `assignments`，需要人工审批。
- `ai.apply_grade`（`isHighRisk: true`）把 AI 批改结果写回成绩。

> 该插件本身不直接调用大模型；模型调用发生在后台任务处理器与 AI 平台侧。

---

## 4. 智能作业自动批改插件 (`@openlearn/plugin-assignment-eval`)

- **源码目录**: `packages/plugins/assignment-eval.ts`
- **主要用途**: 作业创建、提交、互评、评分与互评任务分配。

### 实现亮点

- 命令集中在 `assignment.create`、`assignment.list`、`assignment.get`、`assignment.submit`、`assignment.peer_review`、`assignment.assign_peer_reviews`、`assignment.grade`。
- `assignment.submit` 写入 `plugin_submissions` / `plugin_submission_versions`，并发布 `assignment.submitted` 事件。
- **它不订阅事件、也不自动调用 AI 批改**；AI 批改由 `ai-planner.ts` 的 `ai.apply_grade` 等命令承担。

---

## 5. 后台受控进程插件 (`@openlearn/plugin-process`)

- **源码目录**: `packages/plugins/process.ts`
- **主要用途**: 展示如何通过 `ctx.services.processManager` 管理受监控的后台任务。

### 实现亮点

- `process.spawn` 调用 `processManager.spawn()` 创建任务；`process.kill` 终止任务。
- `process.list` / `process.logs` 查询任务与日志。
- 插件在 `activate` 时 `processManager.restore()` 恢复上次运行的任务记录；没有内置 Cron 调度器。

---

## 6. 平台核心插件 (`@openlearn/plugin-builtin`)

- **源码目录**: `packages/plugins/builtin.ts`
- **主要用途**: 平台自带的绝大多数命令。

### 覆盖范围

- 课程：`lesson.create` / `update` / `update_timeline` / `add_segment` / `remove_segment` / `delete`。
- 白板：`whiteboard.draw` / `update` / `delete` / `clear` / `query` / `get_element` / `batch_draw` / `duplicate`。
- 插件生命周期：`plugin.install`、`plugin.install_zip`、`plugin.update_zip`、`plugin.toggle`、`plugin.uninstall`、`plugin.info`。
- 用户与课件：`user.*`、`courseware.upload`、`courseware.confirm`、成绩配置与重判等。

> 这是最适合学习「ActionDescriptor + capabilityRequired + isHighRisk」组合的参考文件。

---

## 7. AI 提交注入插件 (`@openlearn/plugin-ai-submit-injector`)

- **源码目录**: `packages/plugins/ai-submit-injector.ts`
- **主要用途**: 检测课件 HTML 是否已有提交/成绩展示逻辑，并在缺失时注入采集脚本。

### 实现亮点

- 导出 `hasDataSubmission()` / `hasScoreDisplay()` 判断课件能力。
- 通过 AI 生成注入片段；由 `builtin.ts` 的课件上传/确认流程调用。

---

## 8. 如何将内置插件用作模板

内置插件是**进程内源码插件**，不能直接复制成 ZIP 分发给第三方。正确的起步方式：

1. 用 `npx @openlearn/plugin-sdk init --name <kebab>` 生成 `server-only` / `full-stack` / `frontend-only` 模板。
2. 参考内置插件学习命令注册与 ActionDescriptor 写法，但**不要**照搬 `packages/plugins/*.ts` 的直接 `import` 路径与共享模块引用。
3. 第三方 ZIP 固定为根级 `index.js` + `manifest.json` +（可选）`frontend.js`，构建与打包见 [scaffold CLI](../sdk/scaffold-cli.md)。
4. 修改 `manifest.id`（确保全局唯一）、`capabilitiesProposed`（只能用[能力矩阵](../reference/plugin-capability-matrix.md)里的真实字符串），并确认命令的 `capabilityRequired` 落在执行角色已有的能力集合内。
