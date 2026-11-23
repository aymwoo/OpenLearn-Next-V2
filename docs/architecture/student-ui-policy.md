# 学生端界面可见性策略（student-ui-policy）

> 状态：已实现（迁移 `078_student_ui_policies.sql`）
> 日期：2026-11-22
> 范围：教师按「我的全局 → 班级 → 课节」收敛学生首屏，学生只能在该范围内调整本地布局

本文描述学生端界面可见性策略：教师关闭某个功能或插件贡献后，学生首屏不再渲染对应模块，且学生本地布局不能把已被关闭的内容加回来。

---

## 1. 目标与非目标

### 目标

- **三层作用域**：`teacher`（教师全局）→ `class`（班级）→ `lesson`（课节），逐层继承、逐层覆盖。
- **只收敛界面**：隐藏卡片、区块、快捷指令与插件贡献，不改变数据权限与接口返回。
- **宽松读取**：服务端新增功能 ID 时，旧前端不会因为不认识新字段而整体回退。
- **严格写入**：未知功能 ID、未知字段、错误类型一律拒绝，避免「教师以为关了、学生仍能看到」。
- **共享契约**：前后端共用 `packages/core/student-ui-policy`，避免两套默认值与解析逻辑漂移。

### 非目标

- 不替代角色 / 班级 / 课节的对象级授权。
- 不控制教师端或管理端界面。
- 不隐藏作业、成绩等业务数据本身，只控制学生首屏是否展示入口。

---

## 2. 数据模型

单表存储，每层只保存教师显式设置的项：

```text
student_ui_policies
  id           TEXT PRIMARY KEY
  scope_type   TEXT CHECK (scope_type IN ('teacher','class','lesson'))
  scope_id     TEXT      -- teacher → users.id / class → classes.id / lesson → lessons.id
  policy_json  TEXT      -- StudentUiPolicyLayer
  updated_by   TEXT
  updated_at   INTEGER
  UNIQUE (scope_type, scope_id)
```

`policy_json` 的字段：

| 字段               | 说明                                                         |
| ------------------ | ------------------------------------------------------------ |
| `features`         | `Partial<Record<StudentUiFeatureId, boolean>>`，只记录显式项 |
| `hideGuidance`     | 是否隐藏身份头与组件副标题                                   |
| `hiddenPlugins`    | 隐藏的插件 id 列表                                           |
| `hiddenExtensions` | 隐藏的扩展点，格式为 `pluginId/extensionId`                  |

功能 ID 白名单见 `STUDENT_UI_FEATURE_IDS`（`section.*`、`widget.*`、`quick-action.*`），与前端 `DashboardWidgetId` 一一对应。

---

## 3. 生效解析

`resolveEffectiveStudentUiPolicy(layers, revision)` 是唯一解析入口，服务端与前端兜底共用：

- 初始值为 `STUDENT_UI_DEFAULT_FEATURES`（全部可见）。
- `teacher` 层：同一功能出现多个布尔值时取 `every(Boolean)`，任一教师层关闭即关闭。
- `class` 层：同样取 `every(Boolean)`（一个课节可能关联多个班级）。
- `lesson` 层：按顺序后者覆盖前者，课节设置优先级最高。
- `hideGuidance`：教师 / 班级层取「任一为 true」，课节层最后写入。
- `hiddenPlugins` / `hiddenExtensions`：所有层并集，只能越藏越多。
- `sources` 记录每个功能最终来自哪一层，`revision` 供前端缓存与排障。

读取侧使用 `normalizeEffectiveStudentUiPolicy(input)`：字段缺失、类型错误或未知功能 ID 会被忽略并回落到默认值，保证旧前端安全。

写入侧使用 `validateStudentUiPolicyDocument(input)`：

- `version` 必须为 `1`；
- 顶层字段只允许 `version / features / hideGuidance / hiddenPlugins / hiddenExtensions`；
- 功能 ID 必须在白名单内；
- 数组最多 200 项，单个 id 最长 160 字符。

---

## 4. HTTP 接口

路由注册在 `server/routes/student-ui-policy.ts`，由 `server.ts` 挂载。

| 方法     | 路径                               | 权限                               | 说明                                    |
| -------- | ---------------------------------- | ---------------------------------- | --------------------------------------- |
| `GET`    | `/api/students/:id/ui-policy`      | `requireScopedAuth('self')`        | 学生读取自己的生效策略，可带 `lessonId` |
| `GET`    | `/api/teacher/student-ui-policies` | `requireScopedAuth('class-staff')` | 教师读取某层的「已存 / 继承 / 生效」链  |
| `PUT`    | `/api/teacher/student-ui-policies` | `requireScopedAuth('class-staff')` | 写入某层策略，写前严格校验并记录审计    |
| `DELETE` | `/api/teacher/student-ui-policies` | `requireScopedAuth('class-staff')` | 删除某层策略，回落到上层                |

对象级授权：

- 学生只能读自己的策略；教师可读自己可见的学生策略。
- `teacher` 作用域只能由本人或管理员维护。
- `class` 作用域走 `authorizeClass(..., 'staff')`；`lesson` 作用域走 `authorizeLessonStaff`。
- 作用域不存在时返回 404；越权返回 403。
- 写入与删除成功后通过 `recordSecurityAudit` 记录 `student_ui_policy.updated` / `student_ui_policy.reset`。

---

## 5. 前端消费

`src/features/student/useStudentUiPolicy.ts` 负责取数与刷新：

- 进入 / 离开课堂立即重拉；
- 标签页重新可见、窗口聚焦时刷新；
- 60 秒轻量轮询；
- 请求失败保留上一次成功结果，首次失败回退「全部可见」，不因策略接口故障导致首屏空白。

`StudentView` 把策略传给 `StudentDashboardPanel`，面板负责落地：

- `features`：按 `section.*` / `widget.*` 控制区块与卡片；`extension-views` 关闭时整个插件卡片收起。
- `hideGuidance`：透传给身份头、学习焦点与各组件副标题。
- `hiddenPlugins` / `hiddenExtensions`：传给 `ExtensionPointRenderer` 的 `excludePluginIds` / `excludeExtensionIds`，在槽位分发前统一剔除。
- 快捷指令：`quick-action.*` 映射为 `hiddenQuickActionKeys`，`StudentQuickActionsFloatingMenu` 不再渲染对应入口。

学生端本地布局（`student_dashboard_layout_v4_*`）仍可调整顺序与显隐，但只能在教师允许的集合内生效；被策略关闭的模块不会因为本地布局而重新出现。

---

## 6. 测试

| 文件                                                                   | 覆盖                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/core/student-ui-policy/__tests__/policy.test.ts`             | 严格校验、宽松归一化、三层继承与并集语义、`sources`   |
| `server/__tests__/student-ui-policy.test.ts`                           | 读取 / 写入 / 删除、非法功能 ID、三层生效、对象级越权 |
| `src/features/student/__tests__/StudentDashboardPanel.policy.test.tsx` | 面板按 `features` / `hideGuidance` 渲染与隐藏         |
| `src/features/student/__tests__/useStudentUiPolicy.test.tsx`           | 首次取数、失败保留上次结果、`lessonId` 变化重拉       |
| `server/__tests__/route-scope-enforce.test.ts`                         | 路由已挂载且受作用域中间件约束                        |

---

## 7. 排障

- **学生说「卡片不见了」**：先查 `/api/students/:id/ui-policy` 返回的 `applied.sources`，确认是 `teacher` / `class` / `lesson` 哪一层关闭。
- **教师说「关了没生效」**：检查是否存在更高优先级的课节策略；`lesson` 层会覆盖班级与教师全局。
- **插件贡献仍出现**：确认 `hiddenExtensions` 使用的是 `pluginId/extensionId` 复合键，而不是单独的扩展 id。
- **旧前端异常**：读取侧应只调用 `normalizeEffectiveStudentUiPolicy`，不要直接信任接口字段。

---

## 8. 与其他子系统的关系

- **插件宿主**：策略只过滤渲染，不改变插件激活状态与权限；被隐藏的插件仍可被教师端使用。
- **课堂运行时**：学生端轮询依赖当前课节 `lessonId`，课节切换会触发重新取数。
- **学习分析 / 作业**：隐藏入口不等于撤销数据访问，相关接口权限保持不变。
