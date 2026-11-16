# 学生首屏布局约定 (Student Home Layout)

学生登录后进入的「系统总览」首屏（`StudentView` → `StudentDashboardPanel`）的布局契约。本页规定模块顺序、固定区与可自定义区的边界、移动端断点行为，以及插件可挂载的扩展点。修改首屏布局时必须同时更新本页。

> 来源：Gitee Issue `IKVKVF`（学生首屏布局优化）。适用范围：`0.7.17` 之后的版本（见 CHANGELOG `Unreleased`）。

---

## 1. 设计目标

学生进入首屏后应能在一屏内回答「现在该做什么」：

1. **待办优先**：未提交作业永远是第一优先级。
2. **最近课节**：给出最近一节要上的课与进入入口。
3. **再谈统计**：学情概览、成绩走势、长期学业轨迹属于回顾性信息，排在行动项之后。
4. **窄屏可用**：≤640px 时不出现横向溢出，操作工具条默认收起。

---

## 2. 首屏结构（自上而下）

```
┌──────────────────────────────────────────────────────────┐
│ ① 进行中课堂横幅（仅存在真实会话时显示）                  │
│ ② 学生身份头（头像 / 欢迎语 / 返回课堂）                  │
│ ③ 插件顶部激励挂件 student.dashboard.hero_widget          │
│ ④ 点名警报（有待回应点名时才显示，黄色高亮）              │
│ ⑤ 「现在该做什么」学习路径焦点区（固定，不进栅格）        │
│    待办作业 → 最近课节 → 继续学习                          │
│ ⑥ 栅格自定义工具条（窄屏折叠为「自定义布局」按钮）        │
│ ⑦ 可拖拽 / 可缩放组件栅格                                 │
│ ⑧ 悬浮快捷指令 FAB（右下角）                               │
└──────────────────────────────────────────────────────────┘
```

**固定区（①②③④⑤⑧）不参与自定义布局**：学生拖拽、折叠、重排任何组件都不会影响这些入口。`StudentLearningFocus`（⑤）依赖服务端 `/api/students/:id/dashboard` 返回的 `assignments` / `schedules` / `progress`，三项都为空时不渲染，避免留下空壳。

### 最近课节的取数规则

排课由服务端按「每周重复投影」返回，`scheduled_date` 已映射到**本周**对应日。前端按以下顺序取一节：

1. 今天且结束时间（`time_slot` 的结束段）尚未过去的课；
2. 本周晚于今天的最近一节；
3. 本周最早一节，日期 +7 天作为「下周」展示。

`status` 为 `cancelled` / `holiday` 的排课直接排除；未关联 `lesson_id` 的排课仍展示，但「进入课节」按钮禁用。

---

## 3. 栅格默认顺序（学习路径）

定义在 `src/features/student/types/dashboardLayout.ts` 的 `DEFAULT_WIDGET_LAYOUT`：

| 顺序 | 组件 ID                | 默认宽度 | 定位                    |
| ---- | ---------------------- | -------- | ----------------------- |
| 1    | `upcoming-assignments` | 2/3      | 当前待办与已交作业      |
| 2    | `schedules`            | 1/3      | 最近课节与出勤          |
| 3    | `course-progress`      | 1/2      | 在学课程进度与续学入口  |
| 4    | `quick-stats`          | 1/2      | 学情概览四宫格          |
| 5    | `assessments`          | 1/3      | 待完成 / 已完成的测评   |
| 6    | `progress-trends`      | 2/3      | 周度成绩走势            |
| 7    | `academic-trajectory`  | 整行     | 长期学业成长轨迹        |
| 8    | `academic-comparison`  | 整行     | 多学年对比              |
| 9    | `extension-views`      | 整行     | `student.view` 插件扩展 |

`LAYOUT_PRESETS` 提供「作业攻坚模式」「学情走势大屏」「双列紧凑并排」三种预设，切换后覆盖本地布局。

### 本地存储与版本

- 键名：`student_dashboard_layout_v3_<studentId>`。
- **提升 `DEFAULT_WIDGET_LAYOUT` 顺序时必须同步提升版本号**，否则老用户本地保存的旧顺序会继续生效，新首屏对老用户不可见。
- 版本号变更后旧键不再读取；学生仍可拖拽覆盖新默认值。

---

## 4. 响应式约定

| 场景           | 约定                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 页面外边距     | `p-3 sm:p-4 lg:p-6`，模块间距 `gap-4 lg:gap-6`                                             |
| 栅格           | `grid-cols-1` → `md:grid-cols-2` → `lg:grid-cols-12`（主题 `cardColumns` 可改为 1 / 3 列） |
| 自定义工具条   | ≥640px 常驻；<640px 折叠为「自定义布局」按钮（`aria-expanded`）                            |
| 组件头部控件   | <640px 隐藏「向前/向后移动」按钮，仅保留尺寸切换与折叠                                     |
| 组件内部布局   | 组件正文是 `@container`，内部用容器查询（`@md:`）按卡片自身宽度自适应，而非视口宽度        |
| 学情概览四宫格 | 窄屏 2 列，卡片容器 ≥28rem 时 4 列                                                         |

---

## 5. 插件扩展点

首屏承载插件的既有槽位（不得为此新增入口）：

| 槽位                            | 位置                          |
| ------------------------------- | ----------------------------- |
| `student.dashboard.hero_widget` | 身份头下方（固定区）          |
| `student.view`                  | `extension-views` 组件内      |
| `student.quick_actions.fab`     | 右下角悬浮按钮旁              |
| `student.quick_actions.item`    | 快捷指令菜单主列表            |
| `student.quick_actions.action`  | 快捷指令菜单操作区            |
| `student.fullscreen`            | 学生全屏视图（考试/答题模式） |

详见 [插件 UI 扩展槽位](../reference/plugin-ui-extension-slots.md)。

---

## 6. 与视图锁定、顶部导航的约束

- 学生视图切换唯一收口为 `setStudentViewStatus`（`src/hooks/useStudentViewState.ts`）。锁定期间只放行 `lesson`，`dashboard` / `assignment` 会被拦截。
- 因此首屏焦点区与栅格组件中的跳转全部复用 `setStudentViewStatus`，不得自行 `setState` 绕过拦截。
- 进行中课堂的返回入口同时存在于固定横幅、身份头按钮与快捷指令菜单；三者都读取同一个 `useStudentActiveSession` store（Issue #109），不要在组件内各自轮询。
