# Lesson Runtime 课程引擎

Lesson Runtime（`packages/core/lesson-engine/`）是 OpenLearn V2 教学流程编排的核心引擎，管理从备课、授课到课后分析的全生命周期状态流转。

---

## 领域模型与层级关系

课程（Lesson）遵循四层分层结构：

```
Lesson (课程)
 └── Flow (教学流)
      └── Stage (教学阶段 / 环节)
           └── Activity (教学活动)
```

```mermaid
graph TD
    L["Lesson (课程)"] --> F1["Flow 1: 导学与讲解"]
    L --> F2["Flow 2: 随堂互动与分组练习"]
    L --> F3["Flow 3: 总结与评测"]

    F2 --> S1["Stage 1: 个人独立答题 (estimatedDurationSeconds = 300)"]
    F2 --> S2["Stage 2: 小组讨论 (estimatedDurationSeconds = 600)"]

    S2 --> A1["Activity 1: 协作白板绘图"]
    S2 --> A2["Activity 2: AI 自动评估批改"]
```

---

## 核心类型定义 (`lesson-engine/types.ts`)

领域类型全部定义在 `packages/core/lesson-engine/types.ts`；`index.ts` 只是 `export *` 的 barrel，**不重复定义**。

```typescript
export type LessonStatus = 'idle' | 'draft' | 'ready' | 'active' | 'paused' | 'completed';
export type StageCompletionStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type ActivityStatus = 'idle' | 'active' | 'paused' | 'completed' | 'skipped';
export type UserRole = 'teacher' | 'student' | 'administrator' | 'assistant';

export interface UserRef {
  id: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export interface Lesson {
  id: string;
  title: string;
  subject: string;
  grade: string;
  teacher: UserRef;
  durationMinutes: number;
  status: LessonStatus;
  flows: Flow[];
  activeFlowId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  version: number;
  stages: Stage[];
  isCurrent?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Stage {
  id: string;
  title: string;
  estimatedDurationSeconds: number;
  teachingGoals: string[];
  knowledgePoints: string[];
  completionStatus: StageCompletionStatus;
  assignee: 'teacher' | 'student' | 'group' | string;
  activities: Activity[];
  locked?: boolean;
  metadata?: Record<string, unknown>;
  analytics?: StageAnalytics;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  config: ActivityConfig;
  status: ActivityStatus;
  teachingObjects: TeachingObject[];
  metadata?: Record<string, unknown>;
}
```

> ⚠️ 常见误写：`Stage` 的时长字段是 `estimatedDurationSeconds`（**秒**），
> 不是 `durationMinutes`；`durationMinutes` 属于 `Lesson`（课程整体时长，单位为分钟）。
> 另注意 `Stage` 还带 `teachingGoals` / `knowledgePoints` / `assignee` / `locked` / `analytics` 等字段。

---

## 课程生命周期状态机

状态机类 `LessonStateMachine` 与转换表 `VALID_LESSON_TRANSITIONS` 定义在
`packages/core/lesson-engine/state-machine.ts`，非法转换抛 `InvalidLessonStateTransitionError`。

```typescript
export const VALID_LESSON_TRANSITIONS: Record<LessonStatus, readonly LessonStatus[]> = {
  idle: ['draft', 'ready', 'active'],
  draft: ['ready', 'active', 'idle'],
  ready: ['active', 'idle'],
  active: ['paused', 'completed'],
  paused: ['active', 'completed'],
  completed: ['idle'],
};
```

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> draft: 开始备课
    idle --> ready: 载入课件后就绪
    idle --> active: 直接开课
    draft --> ready: 备课完成
    draft --> active: 教师开启授课
    draft --> idle: 放弃备课
    ready --> active: 教师开启授课
    ready --> idle: 撤销就绪
    active --> paused: 暂停课堂
    active --> completed: 下课 / 总结
    paused --> active: 恢复课堂
    paused --> completed: 下课 / 总结
    completed --> idle: 归档归纳（复位）
```

- `LessonRuntime` 构造时以 `new LessonStateMachine('idle')` 建机，未开课课程停留在 `idle`。
- `completed` **不是**终态，可回到 `idle`；`reset()` 也强制回到 `idle`。
- `active → active`（重复开课）被显式拒绝并抛 `InvalidLessonStateTransitionError`。
- 每次跃迁由 `LessonRuntime` 注册的监听器发布 `LessonStateChanged` 事件。

> 完整状态语义、监听器与异常字段见 [课程生命周期状态机](lesson-lifecycle)。

---

## 教学环节流转门禁管道 (Stage Guard Pipeline)

为了支持**自主闯关学习（Mastery Learning）**与个性化学习节奏，`LessonRuntime` 内置了 `stageGuard`（`StageGuardPipeline`）责任链门禁管道，支持第三方插件向环节流转注册前置进入条件（如测验达标、文件提交等）：

```typescript
export interface StageGuard {
  readonly id: string;
  readonly name: string;
  readonly priority?: number; // 优先级，升序执行，默认 100
  canEnterStage(ctx: StageGuardContext): Promise<StageGuardResult>;
}
```

### 核心运行规则

1. **失效即拒绝 (Fail-Close)**：
   - 当某个第三方插件的守卫执行超时（默认 1500ms）或抛出未捕获异常时，系统记录告警日志并**拒绝进入该环节**。
   - 改为 Fail-Close 的原因：门禁的语义是「未满足前置条件不得进入」。若插件慢或崩就放行，等于让**学生跳过必修环节**（如免做随堂测验）。
   - 拒绝原因会明确指出是哪个门禁插件超时/出错，避免师生误判为自己没达标。
   - **向后兼容**：需要旧行为的部署方可在构造时显式传 `{ onGuardFailure: 'fail-open' }`；用 `onFailure` 钩子上报守卫失效事件。
2. **全部满足组合规则 (AND Conjunction)**：
   - 环节切换时依次执行所有适用的守卫；所有守卫均返回 `allowed: true` 时才允许进入。
   - 若有守卫拒绝，系统会自动将所有未满足的原因通过 `；` 聚合（例如 `“随堂测验需达到80分；尚未提交实验报告”`），并在学生端友好展示。
3. **教师特权穿透 (Teacher Override)**：
   - 教师端发起全班统一跳转（`TeacherJump` / `StudentSynced`）拥有最高优先权，可穿透学生个人门禁限制，确保课堂集中秩序可控。
