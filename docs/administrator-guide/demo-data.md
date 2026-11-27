# 演示数据（Demo Data）一键初始化与清理

> 适用版本：v0.8.0+（数据矩阵 v2）｜ 入口：**系统设置 → 演示数据（Demo）**
> 权限：仅 `administrator`

用于 Demo 演示与功能验收：一条命令铺好一整套可用的教学数据，演示完一键清除，**系统本身不受任何影响**。

---

## 1. 快速上手

| 操作   | 入口                                          | 说明                                         |
| ------ | --------------------------------------------- | -------------------------------------------- |
| 初始化 | 系统设置 → 演示数据 → **一键初始化演示数据**  | 播种是**幂等**的，已播种时再点不会产生第二份 |
| 重置   | 同上，已有数据时按钮变为 **重置并重新初始化** | 先清理再重新播种                             |
| 清理   | 系统设置 → 演示数据 → **一键清理演示数据**    | 只删除演示数据，需二次确认                   |

演示教师账号在初始化成功后显示在面板上，可直接用它登录走通教师侧全流程。学生账号也可用学号 + 同一密码登录学生端。

---

## 2. 会创建什么

数据矩阵 v2 覆盖**小学信息科技**四条内容主线（依据《义务教育信息科技课程标准（2022 年版）》），并铺满教学环节与闭环数据：

| 类型               | 数量  | 说明                                                                   |
| ------------------ | ----- | ---------------------------------------------------------------------- |
| 教师账号           | 2     | `demo_teacher`（主讲，管 1、3 班）、`demo_teacher_b`（协同，管 2 班）  |
| 学生账号           | 24    | `DEMO-S01`…`DEMO-S24`，学号即登录名，与教师同一密码                    |
| 机房               | 2     | `demo-lab-1` / `demo-lab-2`，均 6 行 × 4 列                            |
| 座位               | 24    | 一班/二班在机房一错行、三班在机房二，互不重叠                          |
| 班级               | 3     | 三年级(1)班 / 五年级(1)班 / 五年级(2)班，口令 `1001` / `1002` / `1003` |
| 分组               | 6     | 每班 2 组、每组 4 人，组长在成员列表内                                 |
| 课程中心           | 1     | 四主线单元课程，24 名学生全部选课                                      |
| 白板课             | 2     | 探秘二进制（数据与编码）/ 玩转排序（身边的算法）                       |
| 学案课             | 2     | 网络安全小卫士（在线学习与生活）/ 智能红绿灯（过程与控制）             |
| 课表               | 8     | 覆盖 3 个班、4 门课，含 `scheduled` / `completed` / `cancelled` 三态   |
| 教学环节           | —     | 白板课 5 种环节（导入/精讲/实践/测验/总结）+ 学案课 3 种环节           |
| 白板元素           | 17    | 演示文稿、测验、点名、计时、作业、代码沙箱、数学函数、互动课件等       |
| 学案活动           | 13    | 阅读/提交/测验/问卷/讨论/课件/创作/表单 8 种类型全覆盖                 |
| 首页块             | 6     | 学案首页、互动课件、学习目标、资源                                     |
| 互动 Surface       | 7     | 白板元素 / 学案活动 / 学案块 / 课时提交四类容器绑定                    |
| 作业               | 4     | 含 `coursewareUuid` / `activityId` 成绩项去重键                        |
| 测评               | 1 卷  | 3 题（单选/多选/判断）+ 2 名学生完整作答                               |
| 考试 / 成绩        | 1 / 8 | 一场单元测验 + 8 条成绩                                                |
| 考勤 / 签到 / 进度 | 各 8  | 课堂闭环基础数据                                                       |
| 积分 / 奖励        | 8 / 2 | 积分流水 + 学分发放 + 2 项奖励及兑换记录                               |
| 讨论 / 互评        | 3 / 2 | 学案讨论串 + 学生互评                                                  |

**合计约 278 条登记记录**（以面板 `total` 显示为准）。

### 2.1 教师与学生账号

| 账号             | 角色    | 密码        | 说明                                        |
| ---------------- | ------- | ----------- | ------------------------------------------- |
| `demo_teacher`   | teacher | `Demo@2026` | 主讲教师，管理 1、3 班                      |
| `demo_teacher_b` | teacher | `Demo@2026` | 协同教师，仅管理 2 班（演示多教师授权隔离） |
| `DEMO-S01`…`S24` | student | `Demo@2026` | 学生端用学号登录                            |

### 2.2 课程与教学环节

| 课程                                  | 模式 | 环节                                                    |
| ------------------------------------- | ---- | ------------------------------------------------------- |
| `[演示] 探秘二进制——数据是怎么表示的` | 白板 | 导入 → 概念精讲 → 动手实践 → 随堂测验（门禁）→ 课堂总结 |
| `[演示] 玩转排序——让数据排好队`       | 白板 | 同上 5 环节                                             |
| `[演示] 网络安全小卫士——保护个人信息` | 学案 | 预习 → 研读 → 练习（8 种活动类型）                      |
| `[演示] 智能红绿灯——生活中的自动控制` | 学案 | 预习 → 研读 → 练习（5 种活动类型）                      |

学案课写入 `delivery_mode = 'xuean'` 与内置模式包 `mode_pack_id = '@openlearn/mode-xuean'`；互动课件块按课程包 v3 规范建立 `lesson_block` 类型的 LearningSurface 并回写 `surface_id`，学生端可正常渲染课件而非原始 JSON。

---

## 3. 为什么清理不会误伤

这是本功能最关键的设计约束。

### 3.1 用登记表而非命名匹配

播种时，每一条**实际创建的行**都会登记进 `demo_data_registry` 表：

```sql
CREATE TABLE demo_data_registry (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
```

清理时**只删除登记过的行**，按依赖倒序删（Surface 作答 → Surface → 活动 → 课程 → 座位 → 课表 → 学生 → 班级 → 机房 → 账号），删完清空登记表。

> 早期实现依赖 `title LIKE 'E2E %'` 这类模糊匹配，无法区分"演示数据"与"恰好同名的真实数据"。
> 登记表方案不依赖任何命名约定，因此不存在误删可能。

### 3.2 管理员账号硬保护

清理逻辑对 `users.role = 'administrator'` 有显式分支：**即使有人把管理员账号误登记进表，清理也会跳过它**并在响应的 `skippedAdministrators` 字段计数（正常情况恒为 0，作为审计信号保留）。

### 3.3 ID 命名空间隔离

所有演示 ID 落在 `demo-` 命名空间（用户为 `usr_demo_*`），真实数据的 UUID / `usr_*` 不会落入该空间。播种前还会按此命名空间清空旧版残留（旧播种器用相同的确定性 ID 但没有登记表），因此从旧版本升级无需手工清理。

---

## 4. API

三个端点全部要求 `administrator` 角色。

### `GET /api/demo-data/status`

```json
{
  "success": true,
  "result": {
    "seeded": true,
    "total": 278,
    "counts": { "lesson": 4, "class": 3, "student": 24, "user": 2, "lab": 2, "...": "..." },
    "demoTeacherExists": true,
    "seededAt": 1750000000000,
    "demo": {
      "lessonId": "demo-lesson",
      "lessonIds": ["demo-lesson", "demo-lesson-sort", "demo-lesson-xuean-net", "demo-lesson-xuean-traffic"],
      "whiteboardLessonIds": ["demo-lesson", "demo-lesson-sort"],
      "xueanLessonIds": ["demo-lesson-xuean-net", "demo-lesson-xuean-traffic"],
      "classIds": ["demo-class", "demo-class-2", "demo-class-3"],
      "labIds": ["demo-lab-1", "demo-lab-2"],
      "studentIds": ["demo-stu-01", "..."],
      "scheduleIds": ["demo-schedule", "..."],
      "teacherUsernames": ["demo_teacher", "demo_teacher_b"],
      "teacherUsername": "demo_teacher",
      "scheduleId": "demo-schedule"
    },
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
    "before": { "总": "清理前状态" },
    "report": { "removed": { "各类型删除数": 0 }, "skippedAdministrators": 0, "totalRemoved": 278 },
    "after": { "总": "清理后状态" }
  },
  "message": "已清理 278 条演示数据，系统本身未受影响。"
}
```

---

## 5. 兼容说明

`POST /api/admin/seed-demo` 仍可使用（新手引导 `HelpTour` 依赖它），现在**委托给同一份实现**，响应字段保持向后兼容（`classId` / `scheduleId` / `lessonId`）。这三个字段仍指向 `demo-class` / `demo-schedule` / `demo-lesson`（二进制白板课）。

原实现有两个安全问题，一并修掉：

1. `lessonId` 取自 `SELECT id FROM lessons LIMIT 1` —— 它**劫持一门真实课程**而非自建课程，导致演示数据清理无法安全删除。
2. 学生按 `student_number`（`S001`…）复用 —— 这些学号可能与真实学生冲突，一旦命中就会把**真实学生**链接进演示班级。

---

## 6. 相关文件

| 文件                                    | 职责                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `server/services/demo-data.ts`          | 播种 / 清理 / 状态查询的纯逻辑、数据矩阵定义                    |
| `server/routes/demo-data.ts`            | REST 端点（管理员专属）                                         |
| `src/features/admin/DemoDataPanel.tsx`  | 系统设置中的面板 UI                                             |
| `migrations/015_demo_data_registry.sql` | 登记表建表                                                      |
| `server/__tests__/demo-data.test.ts`    | 23 项测试（全矩阵 / 双模式 / Surface / 幂等 / 精确清理 / 升级） |
