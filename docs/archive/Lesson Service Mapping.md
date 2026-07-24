# OpenLearn Lesson Service Mapping (课程服务映射分析)

## 1. Executive Summary (概述)

本报告评估现存 Lesson Engine 组件在平台接入阶段，哪些组件应注册至 `PlatformServiceRegistry`，哪些保持为领域内部组件。

---

## 2. Platform Service Mapping Recommendation (服务映射推荐)

```
====================================================================
 Lesson Component            | Target Service Category | Lifetime
====================================================================
 LessonSessionManager        | Platform Service        | Singleton
 CourseRuntimeService        | Platform Service        | Singleton
 LessonStateController       | Helper Utility          | Transient
 LessonSession               | Domain Runtime Object   | Scoped / Transient
====================================================================
```

---

## 3. Recommended PlatformServiceRegistry Descriptors (服务描述符预设计)

```typescript
// Recommendation for future adoption:
registry.register({
  id: 'srv_lesson_session_manager',
  lifetime: 'Singleton',
  description: 'OpenLearn Central Lesson Session Runtime Manager',
});

registry.register({
  id: 'srv_course_runtime_service',
  lifetime: 'Singleton',
  description: 'Course & Syllabus Orchestration Service',
});
```
