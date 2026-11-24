# 第三方 Mode Pack 接入指南（P4）

目标：在**不改宿主**的前提下，实现第三种课中交付引擎（类似白板 / 学案）。

灰度开关默认关闭。管理员在「站点信息设置 → 运行时策略」打开 Mode Pack。未配置时关闭。构建期变量和 `window` 调试旗标不再控制这个开关。关闭时，交付模式不是学案的课仍走既有白板中栏。学案课（`lessons.delivery_mode = xuean`）会启用学案 Mode Pack，不依赖这个全局开关。

## 1. 契约清单

在插件 `manifest.contributes['mode.pack']` 声明 `ModePackContribution`（见 `@openlearn/plugin-sdk`）：

| 字段                    | 必需       | 说明                                                       |
| ----------------------- | ---------- | ---------------------------------------------------------- |
| `id`                    | 是         | 全局唯一，建议 `@org/mode-*`                               |
| `label` / `labelEn`     | 是         | 展示名                                                     |
| `segmentTypes`          | 是         | 认领的 `segment.type`（支持前缀，如 `lab` 覆盖 `lab:sim`） |
| `isDefault`             | 否         | 仅缺省包为 true（平台白板包）；第三方勿抢                  |
| `prepContributionId`    | 建议       | 备课面贡献 id                                              |
| `outlineContributionId` | 建议       | 课中侧栏大纲贡献 id                                        |
| `teacherWorkspaceId`    | 是         | `classroom.active_segment.main` 扩展 id                    |
| `studentWorkspaceId`    | 是         | `classroom.active_segment.student_main` 扩展 id            |
| `adapterIds`            | 成绩需要时 | SubmissionAdapter id                                       |
| `channels`              | 通讯需要时 | ClassroomMessage channel                                   |

**路由键只有 `segment.type`。** 门户 `teachingModeId` 不驱动工作区。

## 2. 课中工作区

```ts
host.registerExtensionPoint('classroom.active_segment.main', {
  id: 'mode-lab-teacher',
  pluginId: 'ext-lab',
  targetType: 'lab', // 前缀可覆盖 lab:sim
  component: LabTeacherWorkspace,
  slotProps: { primary: true, targetType: 'lab' },
});
host.registerExtensionPoint('classroom.active_segment.student_main', {
  id: 'mode-lab-student',
  pluginId: 'ext-lab',
  targetType: 'lab',
  component: LabStudentWorkspace,
  slotProps: { primary: true, targetType: 'lab' },
});
```

宿主注入 `ClassroomFlowController`（`flow`）：只读快照 + `setActiveSegment` / `advanceStage` / `sendMessage` / `refresh`。

## 3. 成绩与通讯

- 作答真值可落自有表；面板投影经 `SubmissionAdapter`；教师批改只经 `grade-writer`。
- 可靠消息：`registerChannel` + `classroom.sendMessage`（见 `docs/reference/classroom-flow-server.md`）。

## 4. 备课、大纲与宿主消费面

模式包通过 manifest 声明能力，宿主按下表消费；插件不需要改宿主代码，但要注册对应贡献。

| 声明字段                | 宿主消费点                                                         | 缺失时行为                                             |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `prepContributionId`    | 统一备课壳 `ModePackPrepShell` → 扩展槽位 `classroom.prep`         | **回退白板备课面**（`LessonEditorView`），记录一次告警 |
| `outlineContributionId` | 课中侧栏 `ClassroomTimelineSidebar` → 扩展槽位 `classroom.outline` | **回退白板页面大纲**                                   |
| `teacherWorkspaceId`    | `classroom.active_segment.main`                                    | 不接管，使用宿主默认内容                               |
| `studentWorkspaceId`    | `classroom.active_segment.student_main`                            | 同上                                                   |
| `adapterIds`            | 课中提交面板按当前包过滤 `SubmissionAdapter`                       | 不做过滤（向后兼容）                                   |
| `channels`              | `classroom.sendMessage` 的 channel 归属校验                        | 发送时报错                                             |

- 备课 / 大纲贡献通过 `host.registerExtensionPoint('classroom.prep' | 'classroom.outline', …)` 注册；宿主按 `targetType` / `segment.type` 分发。
- 绑定第三方模式包的课时会自动启用 Mode Packs，不依赖全局开关；内置白板包仍受全局开关控制。
- **不要**把活动并入 timeline 表；用 `segment.type` + 外键/约定（如 `config_json.segmentId`）关联。

## 5. 不变式（宿主强制）

1. Segment gates 由 lesson-engine 裁决；包内自报进度不得自动放行。
2. 白板全屏同步 / `ClassroomSyncChannel` 行为保持。
3. 成绩写回只经 grade-writer。
4. 学生不能本地改全班 `activeSegment` / stage。学生页上的 `flow.setActiveSegment` / `advanceStage` 会直接拒绝，不发全班请求。
5. 旧课无 `segment.type` → 视为白板包。没有 `delivery_mode` 的旧课，学生进课后也进白板页。

学生进课后的页面按课节 `delivery_mode` 分开：白板课主面是画布，学案课主面是学案学生工作区。大纲、课件、作业、签到等在可关闭的侧栏里。详见 [classroom-flow-server.md](../reference/classroom-flow-server.md) §1.1.3。

## 6. 验收自检

- [ ] flag 关闭 + 未绑定第三方包：平台行为无变化
- [ ] 绑定第三方包：即使全局 flag 关闭，Mode Packs 自动启用
- [ ] 本包 `segment.type`：双端 primary 工作区挂载，且新建环节默认类型来自 `segmentTypes`
- [ ] 不抢无 type / 白板默认环节
- [ ] 备课面命中 `classroom.prep`；未注册时回退白板备课面
- [ ] 大纲命中 `classroom.outline`；未注册时回退白板页面大纲
- [ ] 声明 `adapterIds` 后，课中提交面板只显示本包适配器；成绩写回进入统一成绩册
- [ ] 声明 `channels` 后，`classroom.sendMessage` 可正常收发；未注册时目录返回 `warnings`
- [ ] 文档与 `ModePackContribution` 字段一致，无需改 `LiveClassroomView`

参考实现：`src/features/classroom/mode-pack/`（`@openlearn/mode-whiteboard` / `@openlearn/mode-xuean`）。

## 7. 阶段 8 实施清单（已完成）

1. **目录、开关与环节类型**：前端模式包目录保留完整 `ModePackContribution`；绑定非内置包自动启用 Mode Packs；插件的 `segmentTypes` 自动注册进环节类型选择器，插件停用时清理。
2. **大纲、工作区与默认环节**：`classroom.outline` 槽位与白板回退；`hasSegmentMainExtension` 按当前 `segment.type` 过滤；`TimelineRail` 默认类型取包的 `segmentTypes`。
3. **适配器、消息通道与成绩**：提交聚合与 `/api/classroomflowserver/submissions` 支持 `adapterIds` 过滤；`/api/mode-packs` 返回缺失 adapter / channel 的 `warnings`；成绩写回沿用 `grade-writer`。
4. **备课面（后置）**：`classroom.prep` 槽位；第三方包命中扩展，缺失时回退白板备课面并记录告警。
5. **文档与门禁**：同步 `plugin-ui-extension-slots.md`、`classroom-flow-server.md`、CHANGELOG，执行全量门禁与 audit。
