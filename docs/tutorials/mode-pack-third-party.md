# 第三方 Mode Pack 接入指南（P4）

目标：在**不改宿主**的前提下，实现第三种课中交付引擎（类似白板 / 学案）。

全局灰度开关默认关闭：`VITE_OPENLEARN_MODE_PACKS` / `window.__OPENLEARN_MODE_PACKS__`。关闭时，交付模式不是学案的课仍走既有白板中栏。学案课（`lessons.delivery_mode = xuean`）会启用学案 Mode Pack，不依赖这个全局开关。

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

## 4. 备课与大纲

- 备课：贡献 `prepContributionId`；flag 开时进入统一备课壳，按当前环节类型决议面。
- 大纲：贡献 `outlineContributionId`；课中侧栏按环节类型切换白板页列表 / 学案活动列表等。
- **不要**把活动并入 timeline 表；用 `segment.type` + 外键/约定（如 `config_json.segmentId`）关联。

## 5. 不变式（宿主强制）

1. Segment gates 由 lesson-engine 裁决；包内自报进度不得自动放行。
2. 白板全屏同步 / `ClassroomSyncChannel` 行为保持。
3. 成绩写回只经 grade-writer。
4. 学生不能本地改全班 `activeSegment` / stage。
5. 旧课无 `segment.type` → 视为白板包。

## 6. 验收自检

- [ ] flag 关闭：平台行为无变化
- [ ] flag 开启 + 本包 `segment.type`：双端 primary 工作区挂载
- [ ] 不抢无 type / 白板默认环节
- [ ] 成绩进统一面板（若声明 adapter）
- [ ] 文档与 `ModePackContribution` 字段一致，无需改 `LiveClassroomView`

参考实现：`src/features/classroom/mode-pack/`（`@openlearn/mode-whiteboard` / `@openlearn/mode-xuean`）。
