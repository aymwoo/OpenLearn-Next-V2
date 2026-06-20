# Phase 14: 数据库结构设计与后端 DI 成绩对接服务 - Context

**Gathered:** 2026-06-20  
**Status:** Ready for planning  

<domain>
## Phase Boundary

本阶段的目标是为“学生作业提交、公开自由互评与教师评分”插件进行底层架构的搭建。这包含以下部分：
1. SQLite 数据库结构设计：建立作业提交物（assignment_submissions）、学生互评记录（assignment_peer_reviews）以及平时成绩/打分权重记录（assignment_grades）三张核心数据表。
2. 定义 `ISemesterGradeService` 服务：在后端的 `packages/core/di/interfaces.ts` 以及前端的 `src/plugin-host/types.ts` 中，声明接口定义与对应的 Token，并在宿主端提供实现，将其注册在 DI 容器中。
3. 对接前端 MFE 沙箱：将前端成绩服务的 Token 加入 `DI_WHITELIST`，以保证子应用与插件在 React 级别能无缝 resolve 该成绩同步接口。
4. 提供插件后端命令：注册并处理 `assignment.submit`、`assignment.peer_review`、`assignment.grade` 的后端 command 逻辑及安全防御。

本阶段不涉及前端具体的 UI 面板渲染，仅负责数据库迁移、服务注入及后端 Command 流程的贯通。

</domain>

<decisions>
## Implementation Decisions

### 数据库结构与生命周期 D-14-01
- **Submissions 表**：学生在当前课时（lessonId）中只允许存在一条对应的提交记录，但可多次更新。每次更新时 `version` 自动累加。
- **Peer Reviews 表**：学生只能评同班其他同学的作品。一个 reviewer_id 对同一份 submission_id 只能拥有唯一的一条有效评分与评语记录，若重复互评则进行 SQL 覆写更新。
- **Grades 成绩表**：包含平时平时最终折算分（calculated_final_score）、教师分、折算权重等，锁定状态（draft/confirmed）为 confirmed 时直连同步至宿主数据库的 `student_semester_reports`。

### DI 成绩同步契约 D-14-02
- 前后端 Token 必须严格满足 SemVer 契约和命名规范：
  - 后端：`@openlearn/core:ISemesterGradeService`，接口定义于 `packages/core/di/interfaces.ts`。
  - 前端：`@openlearn/frontend:ISemesterGradeService`，定义于 `src/plugin-host/types.ts`。
- `ISemesterGradeService` 提供唯一同步接口：
  `saveSemesterGrade(lessonId: string, studentId: string, grade: number): Promise<void>`
  直接更新宿主已有数据库中的 `student_semester_reports`（平时成绩与学期报告关联）。

### 安全白名单过滤 D-14-03
- 在 `src/mfe/MfeContextProvider.tsx` 中把 `@openlearn/frontend:ISemesterGradeService` 添加到 `DI_WHITELIST`。
- 在前端的宿主 `FrontendPluginHost` 实例化时，将对应的成绩服务实现注册到 `FrontendServiceRegistry`。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划与需求
- `.planning/ROADMAP.md` — Milestone v3.0 路线图，Phase 14 详情与成功标准
- `.planning/REQUIREMENTS.md` — PLUG-EVAL-01 ~ PLUG-EVAL-04 需求定义
- `.planning/STATE.md` — 项目决策与连续性历史状态

### 核心服务与加载代码
- `packages/core/di/interfaces.ts` — 核心后端服务 Token 库与类型规范
- `packages/core/db/index.ts` — SQLite 数据库初始化脚本
- `src/plugin-host/types.ts` — 前端服务 Token 与插件上下文契约
- `src/mfe/MfeContextProvider.tsx` — 前端微应用 DI 白名单

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db` singleton: 宿主后端已通过 `IDatabaseToken` 将 SQLite 的 `better-sqlite3` 实例注入到 Kernel。
- `Token` generic: `packages/core/di/token.ts` 中已实现的 Token 生成类。
- `commandBus.registerHandler`：可参照 `packages/plugins/management.ts` 的写法。

### Integration Points
- `packages/core/db/index.ts` — 在该文件的 `initializeDatabase` 逻辑中，添加三张表 `assignment_submissions`、`assignment_peer_reviews`、`assignment_grades` 的初始化语句。
- `packages/core/di/interfaces.ts` — 导出 `ISemesterGradeService` 及 `ISemesterGradeServiceToken`。
- `packages/core/kernel/index.ts` — 编写 `SemesterGradeService` 并在系统启动时注册到后端依赖容器中。
- `src/plugin-host/plugin-host.ts` — 编写前端 `SemesterGradeService` 实现，并在 `initialize` 时注册到前端 ServiceRegistry。

</code_context>

<specifics>
## Specific Ideas

- **平时平时最终成绩计算公式**：在 Command 阶段不处理此 UI 折算，后端主要存储原子数据。当教师发起 `assignment.grade` 时，前端会传递核算好的 calculated_final_score，后端在进行成绩记录并标记状态为 confirmed 时，顺便调用 `ISemesterGradeService` 保存至学期学业报告表中。
- **学期报告表的结构**：我们需要在 `db/index.ts` 中了解已有的学期报告表（例如 `student_semester_reports`）的字段规范，确保写入不报约束错误。

</specifics>

---
*Phase: 14-db-di*
*Context gathered: 2026-06-20*
