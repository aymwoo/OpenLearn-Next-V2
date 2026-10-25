# C 组立项：Student Workspace 迁移

> 状态：**P1 已启动（特性开关并行预览）** · 立项日期 2026-10-25
> 相关：`docs/experimental-modules.md`（孤儿模块清点）

## 一、先纠正一个前提：这不是"搬迁"，是"重建"

立项前做了代码级对齐，结论与"接线一套已有学生端"的直觉**相反**：

|              | 现状（现行学生端）                                                                        | C 组壳（`student-workspace`）  |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------ |
| 真实面板组件 | **25 个**（`src/features/student/*.tsx`）                                                 | **0 个**                       |
| 单测文件     | **31 个**                                                                                 | 3 个（测注册表/会话，不测 UI） |
| E2E 覆盖     | **22 条 spec 涉及学生端**                                                                 | **0**（从未挂载过）            |
| 业务逻辑     | 课堂跟随、环节门禁、答题、作业、进度、成绩、点名、破冰、成长档案、日程、倒计时、互动浮层… | 无                             |

C 组那 1,403 行**主要是基础设施**（context / slot registry / session / layout 底座 + 4 模块依赖链），
`student-default-widgets.tsx` 里的 9 个 wrapper 中：

- **3 个是明确占位**：`StudentResourcesWidget`（"No resources shared yet."）、
  `StudentBroadcastWidget`（"No announcements yet."）、
  `StudentNotificationsWidget`（`useState<any[]>([])` —— **通知恒为空数组**，不是接真数据）；
- **其余是薄包装**：把 `LazyWhiteboard` / `StudentAssignmentEvalPanel` /
  `NotificationsDropdown` / `AITeacherWorkspaceWidget` 塞进 slot。

**所以"迁移"的真实工作量 = 把 25 个面板移植到新布局底座上**，而不是搬 1,403 行。
本立项按这个真实工作量排期；如果按"搬迁"估工，会严重低估。

## 二、为什么仍然值得做（如果做）

1. 新壳有**布局/插槽抽象**（`WorkspaceShell` + `WorkspaceSlotRegistry`），与教师端共用同一套。
   现行学生端是 25 个平铺面板，没有插槽概念 —— 插件想往学生端贡献 UI，
   目前只能靠零散的 `student.view` 扩展槽。
2. 会话可恢复（`StudentWorkspaceSession` 持久化 openedWidgets / layout / currentLessonId）。
3. 统一的权限词汇（复用 `packages/core/classroom-runtime` 的 `RuntimeRole` / `RuntimePermission`）。

## 三、分期计划

### P1 —— 特性开关并行挂载（**本次已实施**）

**目标**：让壳"能被打开、能被测"，但不改变任何现有行为。

- 入口：URL `?studentShell=workspace`；`AppShell` 用独立 `lazy()`，默认路径不进学生端 chunk；
- 预览页顶部显示明确横幅「功能不等价于现有学生端」，避免被误认为已完成；
- 无学生身份时不渲染（不造假身份跑壳）；
- **不碰** `AppDataContext` 的课堂状态，不发 socket 事件 → 现行学生端零影响。

**完成判据**：`tsc` / 全量单测 / 全量 E2E 与 P1 前完全一致；预览壳能在真实浏览器渲染出布局底座。

### P2 —— 面板 parity 矩阵 → 迁移顺序

按"依赖少 / 风险低 / 复用度高"排序，先移**只读型**面板：

| 批次 | 面板                                                                     | 依据                                    |
| ---- | ------------------------------------------------------------------------ | --------------------------------------- |
| P2-1 | `StudentSchedulePanel`、`StudentCourseProgressList`、`StudentQuickStats` | 只读、无实时订阅                        |
| P2-2 | `StudentNotificationsWidget`（**先补真数据**，当前是空数组占位）         | 需接 `useStudentNotifications`          |
| P2-3 | `StudentAssignment*`（4 个面板）                                         | 有提交流程，需与 `assessment` 模块对齐  |
| P2-4 | `StudentLesson*`（含 `SegmentGateBanner` / `StudentCountdownBanner`）    | **实时 + 服务端门禁，风险最高，最后做** |

每批都必须：面板在旧壳与新壳**同时可用**（新壳里挂旧面板），确认等价后再摘旧的。

### P3 —— 切流

- 灰度：先按单个班级/教师开启（复用现有 settings 机制），再按比例；
- 回滚开关必须**一次点击**恢复全部流量到旧壳（P1 的 URL 开关升级为服务端/配置开关）。

### P4 —— 删除旧壳

- 仅在 P3 灰度全量稳定 ≥ 2 个版本后执行；
- 删除 `src/features/student` 前需重新评估覆盖率基线（见 `docs/experimental-modules.md` 的同类说明）。

## 四、门禁（每期都必须通过）

1. **默认路径零影响**：全量 E2E 中 22 条学生端 spec 必须全绿；
2. `tsc` + 全量单测 + lint 预算 + 格式门禁 + 覆盖率棘轮；
3. 新壳每加一个面板，必须在 P2 的 parity 文档里标为"已对齐"，并写明差在哪（若有）；
4. **不得新增未标注的占位实现**（`useState<any[]>([])` 这类必须带 `TODO(parity)` 注释并登记）。

## 五、风险与对策

| 风险                                    | 对策                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| 高估进度（以为在搬代码，实际在重写 UI） | 本文件第一节已把工作量口径钉死；每期按"面板数 × 单测 + E2E"估                           |
| 实时链路双跑（两个壳同时订阅 socket）   | P1 明确不订阅；P3 切流按班级灰度，同一时刻只有一个壳在跑                                |
| 环节门禁语义漂移                        | 服务端门禁（`/api/lessons/:id/segment-access`）是唯一权威；新壳只消费判定结果，不自己算 |
| 插件插槽不兼容                          | P2 每批都要验 `student.view` 扩展槽在新壳里能渲染                                       |
| 回滚不彻底                              | P1 的 URL 开关保持长期有效，作为最后一道手动回滚                                        |

## 六、当前进度

- [x] 代码级对齐分析（本文第一节）
- [x] P1：特性开关并行挂载（`src/components/StudentWorkspacePreview.tsx`）
- [ ] P2-1：只读面板迁移
- [ ] P3：灰度切流
- [ ] P4：删除旧壳
