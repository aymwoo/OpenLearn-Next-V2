# 前端旧路径迁移计划（Phase 2.4）

> 生成日期：2026-11-21
> 范围：`src/` 中对 `/api/activities/*` 的全部引用。
> 当前后端已保留 307 alias，所有路径仍可用；本计划只列迁移建议，**不改前端代码**。

## 总览

- **迁移状态（2026-11-21）**：
  - 批 1（学案 5 处）已完成：`ca60140`
  - 批 2（provider 6 处）已完成：`eacb196`
  - `src/` 中 `/api/activities` 旧路径剩余：**0**
- 旧路径引用（迁移前）：**11 处**
- 额外发现：**0 处**（与 Phase 1 报告的 11 处一致）
- P0（已坏）：**0**
- P1（307 可用，多一跳，需迁移）：**11 → 已完成**
- P2（可等）：**0**

## 清单

### A. activity-ecosystem（6 处）

文件：`src/features/activity-ecosystem/activity-service.ts`

| 行 | 当前路径 | 应迁到 | 优先级 | 备注 |
|---|---|---|---|---|
| 36 | `GET /api/activities?role=` | `GET /api/activity-providers?role=` | P1 | 响应形状不变（`{activities}`），纯路径替换 |
| 48 | `GET /api/activities/running` | `GET /api/activity-runs?active=1` | P1 | **响应形状变化**：`{activities}` → `{runs}`，需前端适配 |
| 60 | `POST /api/activities/:id/finish` | `POST /api/activity-runs/:runId/finish` | P1 | **需保存 runId**：start 响应新增 `runId`，不能再用 activity id |
| 72 | `POST /api/activities/:id/pause` | `POST /api/activity-runs/:runId/pause` | P1 | 同上 |
| 84 | `POST /api/activities/:id/resume` | `POST /api/activity-runs/:runId/resume` | P1 | 同上 |
| 104 | `POST /api/activities/:id/start` | `POST /api/activity-providers/:id/runs` | P1 | 返回 201 + `runId`；前端需持久化 runId 供 pause/resume/finish |

**结论：** 这 6 处不是纯 URL 替换；`start` 后必须保存 `runId`，`running` 需适配新响应结构。建议一次性改完，避免半迁移状态。

### B. 学案活动（5 处）

文件：`src/services/lessonActivitiesService.ts`

| 行 | 当前路径 | 应迁到 | 优先级 | 备注 |
|---|---|---|---|---|
| 25 | `PUT /api/activities/:id` | `PUT /api/lesson-activities/:id` | P1 | 纯路径替换 |
| 35 | `DELETE /api/activities/:id` | `DELETE /api/lesson-activities/:id` | P1 | 纯路径替换 |
| 104 | `POST /api/activities/:activityId/progress` | `POST /api/lesson-activities/:id/progress` | P1 | 纯路径替换 |
| 118 | `POST /api/activities/:activityId/progress/verify` | `POST /api/lesson-activities/:id/progress/verify` | P1 | 纯路径替换 |
| 129 | `POST /api/activities/:activityId/nudge` | `POST /api/lesson-activities/:id/nudge` | P1 | 纯路径替换 |

**结论：** 这 5 处可纯前端替换，无需后端配合。

## 迁移顺序建议

1. 先改 B（学案 5 处，零契约变化）；
2. 再改 A 的 list/running（2 处，需适配响应）；
3. 最后改 A 的 start/pause/resume/finish（4 处，需保存 `runId`，一次提交）。

## 需前端配合

- `activity-service.ts` 需要新增 `runId` 状态（内存或 store），并在 start 后保存。
- `running` 列表需要从 `{activities}` 改为 `{runs}` 适配。
- 前端代码不在本次任务范围内，Phase 2 未修改 `src/`。
