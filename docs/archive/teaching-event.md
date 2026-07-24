# OpenLearn Teaching Event Bus Specification

> **Target Module**: `src/features/whiteboard/teaching-object/event/teaching-event-bus.ts`  
> **Status**: Approved & Integrated

---

## 1. Teaching Event Flow Diagram (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant QuizWidget as Teaching Object (Quiz)
    participant EB as TeachingEventBus
    participant Assessment as AssessmentInterface
    participant Analytics as LearningAnalyticsEngine
    participant AI as AIInterface

    Student->>QuizWidget: Submit Answer
    QuizWidget->>EB: emit("QuizSubmitted", { objectId, studentId, selectedOption })
    EB->>Assessment: score(objectId, studentId, score, maxScore)
    EB->>Analytics: recordSubmission(objectId, isCorrect)
    EB->>AI: evaluate(quizObj, studentAnswer)
    AI-->>QuizWidget: AI Feedback & Hint
```

---

## 2. Event Types & Payloads

| Event Type | Payload Attributes | Description |
|---|---|---|
| **`ObjectStarted`** | `{ objectId, timestamp }` | Triggered when a teaching object begins runtime execution |
| **`ObjectFinished`** | `{ objectId, timestamp }` | Triggered when object execution finishes |
| **`QuizSubmitted`** | `{ objectId, studentId, selectedOption }` | Student submits a quiz response |
| **`QuizGraded`** | `{ objectId, studentId, score, isPassed }` | Teacher or system scores a submission |
| **`CodeExecuted`** | `{ objectId, code, output, executionTimeMs }` | Code sandbox finishes execution |
| **`StudentAnswered`** | `{ objectId, studentId, answerPayload }` | Student completes a worksheet/assignment task |
| **`TeacherReviewed`** | `{ objectId, teacherId, feedback }` | Teacher provides feedback on work |
| **`AIFinished`** | `{ objectId, prompt, result }` | AI assistant completes response generation |
| **`PluginUpdated`** | `{ objectId, pluginId, state }` | Third-party plugin updates its internal state |
