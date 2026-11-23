# HTTP API 总览

> 路由文件与端点数量随版本增长，本表为当前快照。
> 本文件给「路径 → 文件 → 鉴权级别」的映射，不逐条列签名（签名以源码为准）。
> 活动协议的 canonical 路由、307 兼容别名与观测端点见 §3.1。

---

## 1. 通用约定

| 项           | 约定                                                                           | 证据                                            |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| 基址         | 同源，无 `/api/v1` 版本前缀                                                    | `server/routes/*.ts` 内均为 `/api/...` 绝对路径 |
| 认证         | Cookie session（`getCookieToken`）                                             | `server/middleware/auth.ts`                     |
| 错误体       | `{ success: false, code?, error }`                                             | `server/utils/error-handler.ts` L27-79          |
| 成功体       | 各路由自定义；多数直接返回对象或数组，命令端点固定 `{ success: true, result }` | `server/routes/os.ts` L128                      |
| 请求体上限   | 全局 2MB；特定上传端点由 `mountLargeBodyParsers` 放宽                          | `server.ts` L300-304                            |
| 4xx/5xx 差异 | 4xx 透传 message + code；5xx 生产环境替换为通用文案且丢 code                   | 同上 L61-79                                     |

---

## 2. 端点分布（按文件）

> 端点数按 `app.<method>(...)` 注册次数统计，包含兼容跳转与 `410` 占位端点。

| 文件                               | 端点数      | 主前缀                                                                                                       | 说明                                                    |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `roster.ts`                        | **57**      | `/api/classes`、`/api/students`、`/api/auth`、`/api/users`、`/api/labs`                                      | 班级/学生/账号/机房，最大的 CRUD 面                     |
| `lesson-activities.ts`             | **51**      | `/api/lesson-activities`、`/api/lessons/:lessonId/*`、`/api/blocks`、`/api/courses`                          | 学案活动、内容块、课程编排与讨论                        |
| `plugins.ts`                       | **44**      | `/api/plugins`、`/api/ai-providers`、`/api/site-settings`                                                    | 插件安装/启停/市场、AI provider、站点设置               |
| `classroom.ts`                     | **37**      | `/api/classroom/sessions`                                                                                    | 课堂会话、倒计时、视图状态、点名、抢答                  |
| `assessments.ts`                   | **35**      | `/api/assessments`、`/api/assessment-attempts`、`/api/question-bank`                                         | 测评全流程                                              |
| `lessons.ts`                       | **30**      | `/api/lessons`                                                                                               | 课节 CRUD、时间轴、环节                                 |
| `courseware.ts`                    | 17          | `/api/courseware`                                                                                            | 课件上传/确认/作答                                      |
| `os.ts`                            | 17          | `/api/commands`、`/api/agent`、`/api/activities`（兼容别名）、`/api/upload`                                  | **命令入口**、AI Agent、旧活动别名                      |
| `grading.ts`                       | 16          | `/api/classes/:id/*`、`/api/exams`、`/api/schedules`                                                         | 考勤汇总、成绩权重、考试                                |
| `schedules.ts`                     | 9           | `/api/schedules`、`/api/timetable`                                                                           | 课表与冲突检测                                          |
| `classroom-peer-review.ts`         | 7           | `/api/classroom/sessions/:id/peer-review`                                                                    | 同伴互评、展示作品、弹幕                                |
| `assignment-read.ts`               | 12          | `/api/classes/:classId/learning-surface-assignments`、`/api/lessons/:lessonId/learning-surface-lesson-evals` | LearningSurface 作业 / 随堂评测读路径与旧班级读路径 410 |
| `classroomflowserver.ts`           | 12          | `/api/classroomflowserver/*`                                                                                 | 课堂积分、兑换、消息与提交投影                          |
| `learning-surface-assignments.ts`  | 12          | `/api/learning-surface-assignments`                                                                          | 作业定义、AI 生成、附件、提交、互评与评分写入           |
| `learning-surfaces.ts`             | 12          | `/api/learning-surfaces`、`/api/learning-surface-attempts`、`/api/learning-surface-renderers`                | Surface 管理、attempt 状态与渲染器目录                  |
| `themes.ts`                        | 12          | `/api/themes`                                                                                                | 第三方主题包安装/启停/偏好隔离                          |
| `assignment-hub.ts`                | 6           | `/api/assignments`                                                                                           | 旧写端点 410 + 附件 GC；读路由见 `assignment-read.ts`   |
| `assignments.ts`                   | 5           | `/api/classes/:id/assignments`、`/api/assignments/:id/submissions`                                           | 旧班级作业读路径 410 + 旧写端点 410                     |
| `admin.ts`                         | 5           | `/api/system/*`、`/api/admin/*`                                                                              | 加密状态、升级检查、批量导入                            |
| `files.ts`                         | 5           | `/api/files/:assetId`、`/api/admin/file-storage/*`                                                           | 统一文件读取网关与存储策略                              |
| `processes.ts`                     | 5           | `/api/approvals`、`/api/processes`                                                                           | 高危命令审批、长任务日志                                |
| `resources.ts`                     | 5           | `/api/resources`                                                                                             | 资源库                                                  |
| `activity-providers.ts`            | 4           | `/api/activity-providers`、`/api/activity-runs`                                                              | 活动定义目录与运行生命周期（canonical）                 |
| `classroom-extras.ts`              | 4           | `/api/classroom/:lessonId/*`                                                                                 | 家长通知、掌握度预测                                    |
| `classroom-preset-polls.ts`        | 4           | `/api/lessons/:lessonId/preset-polls`                                                                        | 预设投票题 CRUD                                         |
| `classroom-teaching-modes.ts`      | 4           | `/api/classroom/teaching-modes`                                                                              | 教学模式配置 CRUD                                       |
| `runtime-policies.ts`              | 4           | `/api/admin/runtime-policies`、`/api/feature-flags`、`/api/bridge/hook-telemetry`                            | 运行时策略、站点功能开关、桥接遥测                      |
| `student-ui-policy.ts`             | 4           | `/api/students/:id/ui-policy`、`/api/teacher/student-ui-policies`                                            | 学生端界面策略读取与教师端管理                          |
| `workspace.ts`                     | 4           | `/api/events`、`/api/vfs`、`/api/diagnostics`                                                                | 事件流、虚拟文件系统、诊断                              |
| `bridge.ts`                        | 3           | `/bridge.js`、`/runtime/:uuid`                                                                               | LMS 桥与运行时注入                                      |
| `course-packages.ts`               | 3           | `/api/course-packages`                                                                                       | 课程包导入导出                                          |
| `demo-data.ts`                     | 3           | `/api/demo-data`                                                                                             | 演示数据 seed/cleanup                                   |
| `extension-points.ts`              | 3           | `/api/system/*`                                                                                              | 扩展点/活动完成/旧别名用量观测（管理员）                |
| `health.ts`                        | 3           | `/health`、`/health/ready`、`/metrics`                                                                       | 探针与指标（**无 `/api` 前缀**）                        |
| `learning-surface-lesson-evals.ts` | 2           | `/api/learning-surface-lesson-evals`                                                                         | 课时级随堂评测读路径                                    |
| `client-errors.ts`                 | 1           | `/api/client-errors`                                                                                         | 前端错误上报                                            |
| `mode-packs.ts`                    | 1           | `/api/mode-packs`                                                                                            | 内置与已激活插件模式包目录                              |
| `plugin-api-gateway.ts`            | 0（中间件） | `/api/plugins/:id/*`                                                                                         | 插件 REST 网关，`plugins.ts` 挂载                       |
| `shared.ts`                        | 0（工具）   | —                                                                                                            | 路由公共依赖                                            |

---

## 3. 关键端点（有代表性的 12 个）

| 端点                                                | 文件:行                     | 鉴权                                     | 说明                         |
| --------------------------------------------------- | --------------------------- | ---------------------------------------- | ---------------------------- |
| `POST /api/commands`                                | `os.ts` L169                | `requireAuth('teacher','administrator')` | **唯一命令入口**，10s 超时   |
| `GET /api/commands/registered`                      | `os.ts` L199                | `requireScopedAuth('authenticated')`     | 列出全部 ActionDescriptor    |
| `GET /api/activity-providers`                       | `activity-providers.ts` L46 | `authenticated`                          | 活动定义目录（`role` 过滤）  |
| `POST /api/agent/chat`                              | `os.ts` L278                | `self` + `aiLimiter`                     | AI 对话（流式）              |
| `GET /api/agent/personas`                           | `os.ts` L270                | `authenticated`                          | AI 人格列表                  |
| `POST /api/classroom/sessions/:lessonId/init`       | `classroom.ts`              | 班级权限                                 | 初始化课堂会话               |
| `POST /api/classroom/sessions/:lessonId/view-state` | `classroom.ts`              | 班级权限                                 | 视图状态同步（**独立限流**） |
| `POST /api/courseware/upload`                       | `courseware.ts`             | 教师                                     | 课件上传（大 body 解析器）   |
| `POST /api/plugins/install-from-url`                | `plugins.ts`                | 管理员                                   | 插件安装                     |
| `POST /api/approvals/:id/approve`                   | `processes.ts`              | 管理员                                   | 批准高危命令                 |
| `GET /health/ready`                                 | `health.ts` L148            | 无                                       | 就绪探针，失败返回 503       |
| `GET /metrics`                                      | `health.ts` L169            | `METRICS_TOKEN` 或管理员                 | Prometheus                   |

---

### 3.1 活动协议路由族（canonical / 别名 / 观测）

canonical 入口（前端与插件应使用这些路径）：

| 端点                                                                                                                                                           | 文件:行                          | 鉴权                                             | 说明                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `GET /api/activity-providers`                                                                                                                                  | `activity-providers.ts` L46      | `authenticated`                                  | 活动定义目录，`role=all` 或具体角色                   |
| `POST /api/activity-providers/:providerId/runs`                                                                                                                | `activity-providers.ts` L61      | `authenticated`                                  | 启动运行，成功 201；`PERMISSION_DENIED` → 403         |
| `GET /api/activity-runs`                                                                                                                                       | `activity-providers.ts` L87      | `authenticated`                                  | `active=1` 只列 running/paused；`state=` 可查任意状态 |
| `POST /api/activity-runs/:runId/{pause,resume,finish}`                                                                                                         | `activity-providers.ts` L102     | `authenticated`                                  | 非法状态迁移返回 409                                  |
| `PUT/DELETE /api/lesson-activities/:id`、`POST .../progress`、`.../progress/verify`、`.../nudge`、`.../peer-review`、`GET/POST .../{peer-reviews,discussions}` | `lesson-activities.ts` L331-1056 | `class-staff` / `class-member` / `authenticated` | 学案活动内容与作答（按端点区分鉴权）                  |
| `GET /api/system/extension-points`                                                                                                                             | `extension-points.ts` L25        | `admin`                                          | 未知扩展槽与当前 strict/warn/lenient 模式             |
| `GET /api/system/activity-completions`                                                                                                                         | `extension-points.ts` L35        | `admin`                                          | `activity.completed` 来源/类型聚合与最近 20 条        |
| `GET /api/system/legacy-activity-routes`                                                                                                                       | `extension-points.ts` L39        | `admin`                                          | 旧别名按 `METHOD + 路由模式` 的调用计数               |

学案讨论接口：`GET /api/lesson-activities/:id/discussions` 返回帖子数组，并附带联表得到的
`author_name`（优先 `students.name`，回退 `users.name`）。`POST` 同一路径接收
`{ content, parentId? }`；`content` 截断到 2000 字符，`parentId` 必须属于同一活动，否则返回 400。

兼容别名（**307**，仅过渡期保留）：

- 响应头固定带 `Deprecation: true` 与 `Link: <canonical>; rel="successor-version"`。
- `GET /api/activities` → `/api/activity-providers`；`GET /api/activities/running` → `/api/activity-runs?active=1`；`POST /api/activities/:id/start` → `/api/activity-providers/:id/runs`；`pause` / `resume` / `finish` 先解析该 provider 的最近活跃运行，再重定向到 `/api/activity-runs/:runId/*`。
- 学案 item 级旧路径 `/api/activities/:id/*` 由 `lesson-activities.ts` 按方法静态分派；无法归类时 `app.all('/api/activities/:id')` 兜底：不存在返回 404，既像 provider 又像 lesson-activity 返回 409 并要求改用显式路径。
- 别名命中计入 `GET /api/system/legacy-activity-routes`；前端已无调用，摘除前以此数据评估外部客户端依赖。

---

## 4. 插件自定义 REST 路由

插件通过 `manifest.api.routes` 声明，由 `plugin-api-gateway.ts` 统一代理到 `/api/plugins/:id/*`。

| 事实            | 值                                        | 证据                                   |
| --------------- | ----------------------------------------- | -------------------------------------- |
| 挂载路径        | 恒为 `/api/plugins/{manifest.id}/*`       | `manifest-schema.ts` L747-758 注释     |
| `api.baseRoute` | **no-op**，写了不生效                     | 同上                                   |
| 请求体上限      | 1MB，超出 413                             | `plugin-api-gateway.ts` L58 / L309-312 |
| 默认限流        | 120 次/分钟，超出 429                     | 同文件 L371                            |
| SSE 并发        | 5 条，超出 429                            | 同文件                                 |
| 超时            | 返回 504                                  | 同文件 L560                            |
| 鉴权            | `api.routes` 声明需鉴权但无 session → 401 | 同文件 L350                            |

示例插件的路由声明与实测见
[../examples/lab-seat-walkthrough.md](../examples/lab-seat-walkthrough.md) 与
[../development/manifest-reference.md](../development/manifest-reference.md) §6。

---

## 5. 鉴权写法速查

```text
requireAuth('teacher', 'administrator')     → 角色白名单，路由层拦截
requireScopedAuth('self')                   → 已登录 + 必须校验归属（handler 责任）
requireScopedAuth('class-member')           → 已登录 + 班级成员校验
requireScopedAuth('admin')                  → 仅管理员，中间件直接拦
无守卫                                       → 公开（仅 /health、登录、静态资源）
```

`requireScopedAuth` 的值域与语义见
[../subsystems/observability-and-security.md](../subsystems/observability-and-security.md) §2.1。

**审计**：`ROUTE_SCOPE_ENFORCE=true` 时，任何「用了 `requireAuth` 但未声明 scope」的路由会让启动失败。

---

## 6. 落地新端点时的检查清单

```text
[ ] 路径是否该走 /api/commands 而不是新开 REST（需要能力分级就必须走命令）
[ ] 是否用了 requireScopedAuth 并声明正确 scope
[ ] 错误是否带 status（否则一律 500，前端拿不到 code）
[ ] 是否在 CORS / CSRF 豁免清单之外仍能正常工作
[ ] 是否受 writeLimiter 影响（高频端点需申请独立限流器）
[ ] 新表是否已进 migrations/ 并考虑保留策略
[ ] 需要实时推送时，是否在 SOCKET_ROUTES 加了一行
```
