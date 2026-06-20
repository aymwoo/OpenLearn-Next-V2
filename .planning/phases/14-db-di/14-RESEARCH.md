# Phase 14: 数据库结构设计与后端 DI 成绩对接服务 - Technical Research

**Conducted:** 2026-06-20  
**Phase:** Phase 14  
**Status:** Completed  

---

## 1. Domain & Boundaries

### In Scope
- **数据库结构设计**：在 SQLite 初始化中新建 `plugin_submissions`、`plugin_peer_reviews`、`plugin_grades` 三张表以支持上传文件元数据、互评、最终成绩及其权重。
- **成绩服务 DI 契约**：在后端 `packages/core/di/interfaces.ts` 及前端 `src/plugin-host/types.ts` 中完成 `ISemesterGradeService` 接口和 Token 的定义。
- **学期成绩对接实现**：在后端 `packages/core/kernel/index.ts` 中实现 `SemesterGradeService`，支持利用 lessonId 动态计算 classId 并向宿主的 `assignments` 及 `assignment_submissions` 结构写入最终得分，以实现自动融入学期平时作业成绩（assignment_score）核算。
- **前端 DI 代理白名单**：在 `src/mfe/MfeContextProvider.tsx` 中把 `@openlearn/frontend:ISemesterGradeService` 添加到 `DI_WHITELIST`。
- **后端命令与 API 封装**：注册 `assignment.submit`、`assignment.peer_review`、`assignment.grade` 的 Handler，作为插件后端的核心逻辑。

### Out of Scope
- 本阶段**不涉及**前端任何具体的 UI 界面（这些属于 Phase 15 和 Phase 16 实施内容）。
- 不处理文件的具体物理上传上传过程（本阶段只对数据库插入接口及命令参数校验进行测试）。

---

## 2. Technical Approach

### 2.1 数据库模式设计 (SQLite)

为避免与已有系统表产生命名冲突，自定义插件表一律加上 `plugin_` 前缀。

```sql
-- 1. 作业提交物表（一个学生在某个 lesson 只能存在一条作品，但支持多次提交覆写版本）
CREATE TABLE IF NOT EXISTS plugin_submissions (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(lesson_id, student_id)
);

-- 2. 互评表（一个学生对某次 submission 仅能打分一次，再次提交执行 ON CONFLICT 覆写）
CREATE TABLE IF NOT EXISTS plugin_peer_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(submission_id, reviewer_id)
);

-- 3. 教师打分与平时成绩确认表
CREATE TABLE IF NOT EXISTS plugin_grades (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL UNIQUE,
  teacher_score INTEGER,
  teacher_comment TEXT,
  teacher_weight REAL NOT NULL DEFAULT 0.6,
  peer_weight REAL NOT NULL DEFAULT 0.4,
  calculated_final_score INTEGER,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' (草稿), 'confirmed' (已确认同步)
  graded_at INTEGER
);
```

### 2.2 ISemesterGradeService 接口与 DI 设计

为了把平时最终分无缝计入学期成绩且对已有计算逻辑无任何破坏，平时成绩服务实现将通过操作宿主的 `assignments` 及 `assignment_submissions` 来同步平时分。

#### 接口定义 (interfaces.ts)
```typescript
export interface ISemesterGradeService {
  saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>;
}

export const ISemesterGradeServiceToken = new Token<ISemesterGradeService>(
  '@openlearn/core:ISemesterGradeService'
);
```

#### 宿主端实现逻辑 (SemesterGradeService)
1. 从 `schedules` 表中通过 `lessonId` 检索关联的 `classId`：
   `SELECT class_id FROM schedules WHERE lesson_id = ?` (若无则抛错)。
2. 定义一个特定的平时作业代表，ID 设为 `plugin-lesson-${lessonId}`。
3. 检查 `assignments` 中是否存在该作业记录，若不存在则创建：
   `INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (...)`
4. 将学生平时成绩以 `status = 'graded'` 的形式写入或更新到宿主的 `assignment_submissions` 中：
   `INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status) VALUES (...) ON CONFLICT(...) DO UPDATE SET score = excluded.score, status = excluded.status`

---

## 3. Validation Architecture

本阶段将利用 **Vitest** 进行单元测试及集成测试：

1. **迁移验证**：调用 `initializeDatabase` 后，查询 SQLite `sqlite_master` 确认三张 `plugin_` 表是否存在，字段约束是否满足要求。
2. **DI 注册测试**：验证 `SemesterGradeService` 已被注册入宿主核心 DI 容器，且通过 `ISemesterGradeServiceToken` 可成功 resolve。
3. **对接同步测试**：
   - 模拟调用 `saveSemesterGrade` 方法。
   - 校验宿主的 `assignments` 表及 `assignment_submissions` 表已被自动填充或更新为对应的数据。
   - 验证向 `student_semester_reports` 的平时分查询中，该成绩能自动参与平均分配。
4. **Command Handler 业务规则校验**：
   - 测试 `assignment.submit` 能够正常执行入库，且版本自增。
   - 测试 `assignment.peer_review` 不允许学生自评（当 `student_id === reviewer_id` 时抛出能力或业务规则异常）。
   - 测试 `assignment.peer_review` 覆写。

---

## 4. Codebase Patterns & Reusable Assets

- **Idempotent DB Migrations**: 参照 `packages/core/db/index.ts` 中的 `CREATE TABLE IF NOT EXISTS` 范式编写 idempotent 数据库建表方法。
- **Token Registration**: 参照 `packages/core/kernel/index.ts` 中 `bootstrapSystemPlugins()` 注册 Builtin/Management 插件的方式，实现我们这套作业插件命令的注入与服务注入。

---

## 5. Integration Points

1. `packages/core/db/index.ts` — 数据库初始表声明中。
2. `packages/core/di/interfaces.ts` — 后端 Token 与接口。
3. `src/plugin-host/types.ts` — 前端 Token 与接口声明。
4. `src/mfe/MfeContextProvider.tsx` — 前端 DI 白名单过滤。
5. `packages/core/kernel/index.ts` — 注册 `ISemesterGradeService` 后端实现。
6. `src/plugin-host/plugin-host.ts` — 注册 `ISemesterGradeService` 前端代理，通过 `FrontendAPI` 将请求路由至后端。

---
*Phase: 14-db-di*
*Research complete*
