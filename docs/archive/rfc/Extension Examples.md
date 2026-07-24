# RFC-100 Extension Examples (扩展注册与实现范例)

## 1. Defining an Extension Point (声明扩展点范例)

```typescript
import { ExtensionPoint } from './RFC-100.md';

export const QuizToolExtensionPoint: ExtensionPoint = {
  id: 'ext_point_quiz_tool',
  name: 'Quiz Tool Extension Point',
  category: 'UI',
  description: 'Extension point allowing plugins to insert custom quiz tools into the Toolbar slot',
};
```

---

## 2. Registering a UI Slot Contribution (UI 插槽注册范例)

```typescript
// Registering a Quiz Injector button into the 'Toolbar' UI Slot
contributionRegistry.registerSlotContribution({
  slot: 'Toolbar',
  id: 'contrib_quiz_injector',
  name: 'Quiz Injector',
  render: () => '<button id="btn-quiz">Inject Quiz</button>',
});
```

---

## 3. Emitting Standard Past-Tense Events (发射标准事件范例)

```typescript
eventBus.publish({
  id: 'evt_lesson_101',
  type: 'LessonStarted',
  source: 'LessonSessionManager',
  payload: { lessonId: 'les_101', timestamp: Date.now() },
  timestamp: Date.now(),
});
```

---

## 4. Encapsulating a Workspace Widget (工作区 Widget 范例)

```typescript
export const WhiteboardWidget = {
  id: 'widget_whiteboard',
  name: 'Interactive Whiteboard Widget',
  slot: 'WorkspacePanel',
  component: 'InteractiveWhiteboard',
};
```
