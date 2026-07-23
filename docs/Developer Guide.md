# OpenLearn Developer Guide - Lesson Session Runtime (开发者指南)

## 1. Executive Summary (概述)

本指南介绍如何在 OpenLearn 平台中使用 `LessonSessionManager` 创建与纳管 `LessonSession` 课堂运行时会话，并关联 AI、Whiteboard、Plugin 及 Analytics 上下文句柄。

---

## 2. Managing Lesson Session Lifecycle (管理会话生命周期)

```typescript
import {
  LessonSessionManager,
  LessonSessionContext,
} from './packages/core/bootstrap/index.js';

const manager = new LessonSessionManager();

const context: LessonSessionContext = {
  sessionId: 'sess_math_2026',
  lessonId: 'lesson_math_101',
  teacherId: 'teacher_smith',
  studentIds: ['student_alice', 'student_bob'],
  courseId: 'course_math',
};

const session = manager.createSession(context);

// Attach Subsystem Contexts
session.attachAIContext({ model: 'gemini-2.5' });
session.attachWhiteboard({ id: 'wb_math_2026' });

// Lifecycle Orchestration
manager.startSession('sess_math_2026');
manager.pauseSession('sess_math_2026');
manager.resumeSession('sess_math_2026');
manager.completeSession('sess_math_2026');
```
