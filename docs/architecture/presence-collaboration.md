# Real-time Presence & Collaboration 实时在线与协同引擎

OpenLearn V2 在 `packages/core/presence-engine/` 与 `packages/core/collaboration-engine/` 中提供了面向大规模智慧课堂的在线感知（Presence Engine）与多人分组协同（Collaboration Engine）。

---

## 1. Presence Engine (在线感知引擎)

`PresenceEngineKernel` 负责捕捉与分析课堂中所有参与实体（实体类型包括 `Teacher`, `Student`, `AI`, `Plugin`, `Whiteboard`, `Stage`, `Group`）的状态变化。

### 核心指标与感知维度

- **FocusState**: 专注于课堂（`Focused`）、离屏/掉线（`Unfocused`）、离开界面（`Background`）。
- **ConnectionState**: 在线（`Connected`）、重连中（`Reconnecting`）、离线（`Disconnected`）。
- **Presence Dashboard Metrics**: 实时计算全班专注率、离屏人数、在路线率。

---

## 2. Collaboration Engine (教学协同引擎)

`CollaborationEngineKernel` 负责处理分组协作（Group Workspaces）、共享对象锁（ObjectLock）及实时数据同步消息（SyncMessage）。

### 协同模式 (CollaborationMode)

- `Broadcast`: 教师广播模式（学生只读）。
- `InteractiveGroup`: 小组互动模式（组内自由编辑与对象锁定）。
- `Individual`: 个人独立练习模式。

### 共享对象锁 (ObjectLock)

在小组协同或师生协同绘制时，通过对象锁避免多端同时修改同一白板组件：

```typescript
export interface ObjectLock {
  objectId: string;
  lockedBy: string; // 锁定者的 User ID
  acquiredAt: number;
  expiresAt: number;
}
```

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

