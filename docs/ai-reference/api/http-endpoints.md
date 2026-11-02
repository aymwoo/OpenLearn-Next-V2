# HTTP API 总览

> 24 个路由文件，其中 22 个直接注册端点，共 **313 个端点**。
> 本文件给「路径 → 文件 → 鉴权级别」的映射，不逐条列签名（签名以源码为准）。

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

| 文件                       | 端点数      | 主前缀                                                                  | 说明                                      |
| -------------------------- | ----------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `roster.ts`                | **53**      | `/api/classes`、`/api/students`、`/api/auth`、`/api/users`、`/api/labs` | 班级/学生/账号/机房，最大的 CRUD 面       |
| `classroom.ts`             | **45**      | `/api/classroom/sessions`                                               | 课堂会话、倒计时、视图状态、点名、抢答    |
| `plugins.ts`               | **37**      | `/api/plugins`、`/api/ai-providers`、`/api/site-settings`               | 插件安装/启停/市场、AI provider、站点设置 |
| `assessments.ts`           | **35**      | `/api/assessments`、`/api/assessment-attempts`、`/api/question-bank`    | 测评全流程                                |
| `lessons.ts`               | **30**      | `/api/lessons`                                                          | 课节 CRUD、时间轴、环节                   |
| `courseware.ts`            | 16          | `/api/courseware`                                                       | 课件上传/确认/作答                        |
| `grading.ts`               | 16          | `/api/classes/:id/*`、`/api/exams`、`/api/schedules`                    | 考勤汇总、成绩权重、考试                  |
| `os.ts`                    | 14          | `/api/commands`、`/api/agent`、`/api/activities`、`/api/upload`         | **命令入口**、AI Agent、活动生态          |
| `assignment-hub.ts`        | 10          | `/api/assignments`                                                      | 作业 CRUD + 附件 + 提交                   |
| `schedules.ts`             | 9           | `/api/schedules`、`/api/timetable`                                      | 课表与冲突检测                            |
| `assignments.ts`           | 7           | `/api/classes/:id/assignments`、`/api/assignments/:id/submissions`      | 作业生成/提交/评分                        |
| `classroom-peer-review.ts` | 7           | `/api/classroom/sessions/:id/peer-review`                               | 同伴互评、展示作品、弹幕                  |
| `admin.ts`                 | 5           | `/api/system/*`、`/api/admin/*`                                         | 加密状态、升级检查、批量导入              |
| `processes.ts`             | 5           | `/api/approvals`、`/api/processes`                                      | 高危命令审批、长任务日志                  |
| `resources.ts`             | 5           | `/api/resources`                                                        | 资源库                                    |
| `workspace.ts`             | 4           | `/api/events`、`/api/vfs`、`/api/diagnostics`                           | 事件流、虚拟文件系统、诊断                |
| `bridge.ts`                | 3           | `/bridge.js`、`/runtime/:uuid`                                          | LMS 桥与运行时注入                        |
| `course-packages.ts`       | 3           | `/api/course-packages`                                                  | 课程包导入导出                            |
| `demo-data.ts`             | 3           | `/api/demo-data`                                                        | 演示数据 seed/cleanup                     |
| `health.ts`                | 3           | `/health`、`/health/ready`、`/metrics`                                  | 探针与指标（**无 `/api` 前缀**）          |
| `classroom-extras.ts`      | 2           | `/api/classroom/:lessonId/*`                                            | 家长通知、掌握度预测                      |
| `client-errors.ts`         | 1           | `/api/client-errors`                                                    | 前端错误上报                              |
| `plugin-api-gateway.ts`    | 0（中间件） | `/api/plugins/:id/*`                                                    | 插件 REST 网关，`plugins.ts` L21 挂载     |
| `shared.ts`                | 0（工具）   | —                                                                       | 路由公共依赖                              |

---

## 3. 关键端点（有代表性的 12 个）

| 端点                                                | 文件:行          | 鉴权                                     | 说明                         |
| --------------------------------------------------- | ---------------- | ---------------------------------------- | ---------------------------- |
| `POST /api/commands`                                | `os.ts` L112     | `requireAuth('teacher','administrator')` | **唯一命令入口**，10s 超时   |
| `GET /api/commands/registered`                      | `os.ts` L134     | `requireScopedAuth('authenticated')`     | 列出全部 ActionDescriptor    |
| `GET /api/activities`                               | `os.ts` L146     | `authenticated`                          | 活动生态描述符               |
| `POST /api/agent/chat`                              | `os.ts` L278     | `self` + `aiLimiter`                     | AI 对话（流式）              |
| `GET /api/agent/personas`                           | `os.ts` L270     | `authenticated`                          | AI 人格列表                  |
| `POST /api/classroom/sessions/:lessonId/init`       | `classroom.ts`   | 班级权限                                 | 初始化课堂会话               |
| `POST /api/classroom/sessions/:lessonId/view-state` | `classroom.ts`   | 班级权限                                 | 视图状态同步（**独立限流**） |
| `POST /api/courseware/upload`                       | `courseware.ts`  | 教师                                     | 课件上传（大 body 解析器）   |
| `POST /api/plugins/install-from-url`                | `plugins.ts`     | 管理员                                   | 插件安装                     |
| `POST /api/approvals/:id/approve`                   | `processes.ts`   | 管理员                                   | 批准高危命令                 |
| `GET /health/ready`                                 | `health.ts` L148 | 无                                       | 就绪探针，失败返回 503       |
| `GET /metrics`                                      | `health.ts` L169 | `METRICS_TOKEN` 或管理员                 | Prometheus                   |

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
