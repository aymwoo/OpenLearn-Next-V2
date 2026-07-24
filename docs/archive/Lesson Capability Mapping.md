# OpenLearn Lesson Capability Mapping (课程能力映射分析)

## 1. Executive Summary (概述)

本报告分析 Lesson Engine 向平台 `CapabilityRuntime` / `CapabilityRegistry` 暴露的能力清单。

---

## 2. Lesson Capability Mapping (能力映射清单)

```
====================================================================
 Capability ID              | Category   | Implementation File
====================================================================
 capability_lesson          | AI / Lesson| capabilities/lesson-capability.ts
 cap_lesson_session_control | Teaching   | lesson-session-manager.ts
 cap_lesson_course_loading  | Curriculum | CourseRuntimeService
 cap_lesson_activity_sched  | Flow       | ActivityEngine
====================================================================
```

---

## 3. Capability Governance (能力治理)

现存 `LessonCapability` (`capability_lesson`) 已经实现了标准 `IAICapability` 契约，支持自动生成教案大纲、分发随堂任务与输出互动提示。
