# 内置范例插件拆解指南 (Existing Built-in Plugins Guide)

OpenLearn V2 在 `packages/plugins/` 目录中内置了 7 个生产级范例插件。这些插件遵循标准的 API 契约与三件套（Action -> Command -> Event）模式，是开发者编写自定义插件的最佳模板与参考实现。

---

## 1. 虚拟文件系统插件 (`@openlearn/plugin-vfs`)

- **源码目录**: [`packages/plugins/vfs.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/vfs.ts)
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
  engines: { openlearn: '^0.2.5' },
}
```

### 提供的 Commands & Events
- `vfs.write_file`: 写入文件并触发 `vfs.file_written` 事件。
- `vfs.read_file`: 读取路径对应内容。
- `vfs.list_dir`: 列出绝对路径下目录节点。
- `vfs.mkdir`: 创建新文件夹。

---

## 2. 平台管理与运维插件 (`@openlearn/plugin-management`)

- **源码目录**: [`packages/plugins/management.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/management.ts)
- **主要用途**: 管理系统内部插件、插件配置、系统状态诊断与数据备份恢复。

### 核心功能
- **插件在线安装与切换**: 暴露 `plugin.install` 与 `plugin.toggle` 命令。
- **系统清理与重建**: 暴露 `system.reset_db` 与 `system.reboot` 命令。

---

## 3. AI 智能体课程规划器 (`@openlearn/plugin-ai-planner`)

- **源码目录**: [`packages/plugins/ai-planner.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/ai-planner.ts)
- **主要用途**: 利用大模型能力，根据教学大纲与知识点自动规划课程 Stages 与互动环节。

### 实现亮点
- 调用 `ctx.services.ai.generateText()` 生成结构化课程大纲 JSON。
- 自动化组装 `lesson.create` 命令，向课程引擎写入生成的 Flow 与 Stage 节点。

---

## 4. 智能作业自动批改插件 (`@openlearn/plugin-assignment-eval`)

- **源码目录**: [`packages/plugins/assignment-eval.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/assignment-eval.ts)
- **主要用途**: 收集学生提交的文本/代码作业，调用 AI 模型进行初批并生成量化评分与评语。

### 实现亮点
- 监听 `assignment.submitted` 事件。
- 自动提取提交 Payload，结合标准答案生成批改 Prompt 并写入数据库评分记录表。

---

## 5. 后台受控进程与定时器插件 (`@openlearn/plugin-process`)

- **源码目录**: [`packages/plugins/process.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/process.ts)
- **主要用途**: 展示如何通过 `ctx.services.processManager` 创建受监控的后台常驻任务与定时 Cron Job。

---

## 6. 如何将内置插件用作模板

1. 复制对应的 `.ts` 源码文件。
2. 修改 `manifest.id`（确保全局唯一）。
3. 调整 `capabilitiesProposed` 权限声明。
4. 替换 `actionRegistry.register` 与 `commandBus.registerHandler` 中的逻辑。
5. 编译产物并通过 `manifestSchema.parse` 校验后即可直接打包分发。
