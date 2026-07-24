# CommandBus & EventBus 核心事件指令管道

实现位于 `packages/core/command-bus/` 与 `packages/core/event-bus/`。

- **CommandBus**: 1-to-1 严格指令管道（如 `lesson.create`, `whiteboard.draw`）。
- **EventBus**: 1-to-N 异步事件广播（如 `lesson.created`, `assignment.graded`）。
