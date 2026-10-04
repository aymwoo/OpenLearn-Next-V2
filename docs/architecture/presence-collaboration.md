# Real-time Presence & Collaboration 实时在线与协同引擎

# Real-time Presence & Collaboration 实时在线与协同引擎

OpenLearn V2 在 `packages/core/presence-engine/` 与 `packages/core/collaboration-engine/` 中提供了面向大规模智慧课堂的在线感知（Presence Engine）与多人分组协同（Collaboration Engine）。

---

## 1. Presence Engine (在线感知引擎)

`PresenceEngineKernel` 负责捕捉与分析课堂中所有参与实体的状态变化。全部类型定义见 `packages/core/presence-engine/types.ts`。

### 实体类型 (`EntityType`)

共 **10** 个取值，**全部为小写**字符串字面量：

```typescript
export type EntityType =
  | 'teacher' | 'student' | 'assistant' | 'ai' | 'plugin'
  | 'whiteboard' | 'teaching_object' | 'lesson' | 'stage' | 'group';
```

> 注意大小写：`EntityType` 是小写，而同文件中的 `EntityRole`、`FocusState`、`ConnectionState` 等类型是 PascalCase 或小写混合，各不相同。实体在 `PresenceEntity.type` 字段上使用小写形式。

### 核心指标与感知维度

- **`FocusState`**：共 **5** 个取值 —— `'Focused'`（专注）、`'Distracted'`（走神）、`'Inactive'`（不活跃）、`'Minimized'`（最小化）、`'Background'`（后台）。**不存在** `'Unfocused'`。
- **`ConnectionState`**：共 **4** 个取值，**全部为小写** —— `'connected'`、`'reconnecting'`、`'disconnected'`、`'offline'`。与 `FocusState` 的 PascalCase 不同，且多一个 `offline`。
- **`InteractionSignal`**：`'Raise Hand'` / `'Question'` / `'Agree'` / `'Disagree'` / `'Need Help'` / `'Finished'` / `'None'`。
- **`PresenceDashboardMetrics`**：实时计算 `onlineCount`、`activeCount`、`focusCount`、`handRaiseCount`、`helpRequestCount`、`taskCompletionRate`、`aiWorkStatus`、`activePluginCount` 与 `timestamp`。
- **`EntityStatus`**：是 `TeacherStatus` / `StudentStatus` / `AIStatus` / `PluginStatus` / `WhiteboardStatus` / `StageStatus` / `GroupStatus` 的并集再放宽为 `string`，因此各实体可携带各自领域的状态词（`TeacherStatus` 如 `'Preparing'` / `'Teaching'`，`StudentStatus` 如 `'Online'` / `'Coding'`，`StageStatus` 如 `'Running'` / `'Completed'` 等）。

---

## 2. Collaboration Engine (教学协同引擎)

`CollaborationEngineKernel` 负责处理分组协作（Group Workspaces）、共享对象锁（ObjectLock）及实时数据同步消息（SyncMessage）。全部类型定义见 `packages/core/collaboration-engine/types.ts`。

### 协同模式 (`CollaborationMode`)

共 **7** 个取值，**均为带空格的英文短语**（由 `CollaborationModeManager` 管理，构造时以 `'Teacher Presentation'` 为默认并立即套用其权限矩阵）：

| 取值                    | 含义                       |
| ----------------------- | -------------------------- |
| `'Teacher Presentation'` | 教师讲授演示（默认模式）   |
| `'Teacher + Student'`    | 师生共同操作               |
| `'Student Independent'`  | 学生个人独立               |
| `'Small Group'`          | 小组协同                   |
| `'Whole Class'`          | 全班协同                   |
| `'Teacher Review'`       | 教师评审                   |
| `'AI Assisted'`          | AI 辅助模式                |

> 代码中**不存在** `Broadcast` / `InteractiveGroup` / `Individual` 这三个标识符——`Broadcast` 是 `CollaborationPermission` 中的一个权限名，不是模式名。`CollaborationModeManager.setMode` 每次切换都会重新 `applyModePermissions(nextMode)` 并通知订阅者。

### 参与者与权限

- **`ParticipantRole`**：`'Teacher'` / `'Teaching Assistant'` / `'Student'` / `'Observer'` / `'AI Tutor'` / `'AI Assistant'` / `'Plugin'`。
- **`CollaborationPermission`**：共 **12** 项 —— `'Whiteboard Edit'` / `'Whiteboard View'` / `'Comment'` / `'Annotation'` / `'Run Code'` / `'Submit Quiz'` / `'Create Object'` / `'Delete Object'` / `'Broadcast'` / `'Group Switch'` / `'Teacher Review'` / `'AI Operation'`，由 `PermissionMatrixManager` 按当前 `CollaborationMode` 套用。
- **`SharedObjectData.mode`**：`'sync'` / `'copy'` / `'mirror'` / `'reference'`，控制小组间对象共享语义。

### 共享对象锁 (ObjectLock)

在小组协同或师生协同绘制时，通过对象锁避免多端同时修改同一白板组件：

```typescript
export interface ObjectLock {
  readonly objectId: string;
  readonly lockedBy: string; // 锁定者的 User ID
  readonly lockedAt: number;
  readonly expiresAt: number;
}
```

> 时间戳字段名是 **`lockedAt`**，不是 `acquiredAt`。该接口由 `SharedObjectManager` 持有，四字段全部 `readonly`。

### 同步消息 (`SyncMessage`)

`SyncType` 共 6 个取值：`'object_sync'` / `'selection_sync'` / `'viewport_sync'` / `'pointer_sync'` / `'stage_sync'` / `'lesson_sync'`，由前端的 `frontendEventBus` 按类型分发（**代码中不存在名为 `SyncEngine` 的类**——协作同步当前没有独立的引擎层）。

---

## 3. Student Exception Telemetry (学生端异常遥测与健康诊断)

在智慧在线课堂中，学生端的运行时异常（脚本错误、网络故障、资源加载失败、课件崩溃等）需要被教师端和运维审计日志感知，同时不能过度干扰学生正常的课堂专注度。

### 遥测架构流水线

```text
[学生端浏览器]
  │ (React ErrorBoundary / window.onerror / unhandledrejection / 5xx)
  ▼
[useGlobalErrorCapture] ──注册订阅──> [errorStore.registerErrorListener]
  │
  ├─ 1. WebSocket 链路 (优先): socket.emit('student-client-error', payload)
  └─ 2. HTTP Fallback (离线/重连兜底): POST /api/diagnostics/report
        │
        ▼
   [Server presence.ts / routes/workspace.ts]
        │
        ├─ 审计日志落盘: kernel.eventBus.publish({ type: 'student.client_error', payload }) -> SQLite events 表
        └─ 教师端实时广播: io.to(`lesson:${lessonId}`).emit('student-error-alert', payload)
              │
              ▼
         [教师端 LiveClassroomView & SystemErrorCenterModal]
              ├─ 顶部栏: 「学生端异常 (N)」一键查看
              ├─ 学生列表 / 头像圈: 红色脉冲异常角标
              └─ 诊断中心: 双标签页切换，支持堆栈排查与一键导出 Markdown 诊断报告
```

### 极简低干扰 UI 设计

- **学生端**：默认隐藏冗长错误气泡与堆栈，仅在屏幕左下角（`fixed bottom-5 left-5`）展示极简感叹号圆形图标加红色数字角标，点击后可调起轻量诊断弹窗，保障课堂沉浸感。
- **教师/管理端**：享有完整的错误感知与跨端排查能力，实时掌握全班学生的设备与网络健康度。
