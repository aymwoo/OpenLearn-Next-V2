# 演示数据（Demo Data）一键初始化与清理

> 适用版本：v0.5.0+ ｜ 入口：**系统设置 → 演示数据（Demo）**
> 权限：仅 `administrator`

用于 Demo 演示与功能验收：一条命令铺好一整套可用的教学数据，演示完一键清除，**系统本身不受任何影响**。

---

## 1. 快速上手

| 操作 | 入口 | 说明 |
| --- | --- | --- |
| 初始化 | 系统设置 → 演示数据 → **一键初始化演示数据** | 播种是**幂等**的，已播种时再点不会产生第二份 |
| 重置 | 同上，已有数据时按钮变为 **重置并重新初始化** | 先清理再重新播种 |
| 清理 | 系统设置 → 演示数据 → **一键清理演示数据** | 只删除演示数据，需二次确认 |

演示教师账号在初始化成功后显示在面板上，可直接用它登录走通教师侧全流程。

---

## 2. 会创建什么

| 类型 | 数量 | 标识 |
| --- | --- | --- |
| 演示课程 | 1 | `demo-lesson` —《[演示] 初中信息技术 · 第一单元》 |
| 演示班级 | 2 | `demo-class`（一年级(1)班）、`demo-class-2`（一年级(2)班） |
| 演示学生 | 12 | `demo-stu-01` … `demo-stu-12`，学号 `DEMO-S01` … `DEMO-S12` |
| 演示教师 | 1 | `demo_teacher` / `Demo@2026`，角色 `teacher` |
| 演示课表 | 1 | `demo-schedule`，指向演示课程与演示班级 |
| 班级关系 | 12 | 学生轮流分配到两个班，保证两班都有学生 |

合计 29 条记录。

---

## 3. 为什么清理不会误伤

这是本功能最关键的设计约束。

### 3.1 用登记表而非命名匹配

播种时，每一条**实际创建的行**都会登记进 `demo_data_registry` 表：

```sql
CREATE TABLE demo_data_registry (
  entity_type TEXT NOT NULL,   -- lesson / class / student / user / schedule / class_student
  entity_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
```

清理时**只删除登记过的行**，按依赖倒序删（课表 → 班级关系 → 学生 → 课程 → 班级 → 账号），删完清空登记表。

> 早期实现依赖 `title LIKE 'E2E %'` 这类模糊匹配，无法区分"演示数据"与"恰好同名的真实数据"。
> 登记表方案不依赖任何命名约定，因此不存在误删可能。

### 3.2 管理员账号硬保护

清理逻辑对 `users.role = 'administrator'` 有显式分支：**即使有人把管理员账号误登记进表，清理也会跳过它**并在响应的 `skippedAdministrators` 字段计数（正常情况恒为 0，作为审计信号保留）。

### 3.3 学号命名空间隔离

演示学生学号用 `DEMO-S01` 形式，与真实学号（`S001` 之类）天然不冲突。

---

## 4. API

三个端点全部要求 `administrator` 角色。

### `GET /api/demo-data/status`

```json
{
  "success": true,
  "result": {
    "seeded": true,
    "total": 29,
    "counts": { "lesson": 1, "class": 2, "student": 12, "user": 1, "schedule": 1, "class_student": 12 },
    "demoTeacherExists": true,
    "seededAt": 1750000000000,
    "demo": { "lessonId": "demo-lesson", "classIds": ["demo-class", "demo-class-2"], "...": "..." },
    "credentials": { "username": "demo_teacher", "password": "Demo@2026", "name": "演示教师" }
  }
}
```

### `POST /api/demo-data/seed`

幂等。已播种时直接返回现有数据，不做任何写入。

加 `?reset=true` 则先清理再重新播种。

### `POST /api/demo-data/cleanup`

**必须**显式传确认标识，否则返回 400：

```json
{ "confirm": "PURGE_DEMO_DATA" }
```

响应：

```json
{
  "success": true,
  "result": {
    "before": { /* 清理前状态 */ },
    "report": { "removed": { /* 各类型删除数 */ }, "skippedAdministrators": 0, "totalRemoved": 29 },
    "after": { /* 清理后状态 */ }
  },
  "message": "已清理 29 条演示数据，系统本身未受影响。"
}
```

---

## 5. 兼容说明

`POST /api/admin/seed-demo` 仍可使用（新手引导 `HelpTour` 依赖它），现在**委托给同一份实现**，响应字段保持向后兼容（`classId` / `scheduleId` / `lessonId`）。

原实现有两个安全问题，一并修掉：

1. `lessonId` 取自 `SELECT id FROM lessons LIMIT 1` —— 它**劫持一門真实课程**而非自建一门，导致演示数据清理无法安全删除。
2. 学生按 `student_number`（`S001`…）复用 —— 这些学号可能与真实学生冲突，一旦命中就会把**真实学生**链接进演示班级。

播种前会先清空"演示 ID 命名空间"（`demo-*`）下的旧版残留，因此从旧版本升级无需手工清理。

---

## 6. 相关文件

| 文件 | 职责 |
| --- | --- |
| `server/services/demo-data.ts` | 播种 / 清理 / 状态查询的纯逻辑 |
| `server/routes/demo-data.ts` | REST 端点（管理员专属） |
| `src/features/admin/DemoDataPanel.tsx` | 系统设置中的面板 UI |
| `migrations/015_demo_data_registry.sql` | 登记表建表 |
| `server/__tests__/demo-data.test.ts` | 17 项测试（幂等 / 作用域 / 管理员硬保护 / 升级场景） |
