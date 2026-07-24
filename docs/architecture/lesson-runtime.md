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
    
    F2 --> S1["Stage 1: 个人独立答题 (5 min)"]
    F2 --> S2["Stage 2: 小组讨论 (10 min)"]
    
    S2 --> A1["Activity 1: 协作白板绘图"]
    S2 --> A2["Activity 2: AI 自动评估批改"]
```

---

## 核心类型定义 (`lesson-engine/index.ts`)

```typescript
export interface Lesson {
  id: string;
  title: string;
  subject: string;
  grade: string;
  flows: Flow[];
  createdAt: number;
  updatedAt: number;
}

export interface Flow {
  id: string;
  name: string;
  stages: Stage[];
}

export interface Stage {
  id: string;
  title: string;
  durationMinutes: number;
  activities: Activity[];
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  config: ActivityConfig;
}
```

---

## 课程生命周期状态机

```mermaid
stateDiagram-v2
    [*] --> Draft: 创建课程
    Draft --> Preparing: 备课完成 / 载入课件
    Preparing --> InProgress: 教师开启授课
    InProgress --> Paused: 暂停课堂
    Paused --> InProgress: 恢复课堂
    InProgress --> Completed: 下课 / 总结
    Completed --> Archived: 归档归纳
```
