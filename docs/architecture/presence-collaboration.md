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
