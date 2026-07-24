# OpenLearn Presence SDK & Plugin Extension (状态 SDK 手册)

## 1. Overview (概述)

`PresenceManager` 开放了第三方插件扩展接口。插件开发者不仅可以查询与订阅已有实体的 Presence，还可以通过 `registerPresence()` 扩展自定义实体 Presence（如 **Robot Presence**, **Simulation Presence**, **VR Presence**）。

此外，`PresenceTimelineLogger` 记录的全量时间序列状态日志可直接服务于**课堂回放 (Replay)**、**AI 分析** 与 **学习评估**。

---

## 2. Presence Timeline Architecture (Mermaid 时间线结构图)

```mermaid
timeline
    title 课堂 Presence Timeline 历史轨迹
    00:00 : 教师 (Preparing) : 学生 (Online)
    05:00 : 教师 (Teaching) : 导入短视频 (Running)
    15:00 : 教师 (Explaining) : 学生 (Listening) : AI (Thinking)
    25:00 : 教师 (Observing) : 学生 (Coding) : 练习二 (Writing)
    35:00 : 学生 (Need Help) : 教师 (Answering)
    45:00 : 课堂 Stage (Completed) : 全员 (Finished)
```

---

## 3. Extension API Handbook (扩展 API 手册)

### 3.1 `getPresence(id: string): PresenceEntity | undefined`
获取指定 ID 实体的只读 Presence 快照（自动执行 Privacy 隐私洗脱）。

### 3.2 `watchPresence(id: string, callback: (entity: PresenceEntity) => void): () => void`
精准监听单一实体的状态变更。

### 3.3 `queryPresence(filter: (e: PresenceEntity) => boolean): ReadonlyArray<PresenceEntity>`
按条件筛选查询符合要求的实体（如查询所有 `focus === 'Distracted'` 的学生）。

### 3.4 `registerPresence(definition: CustomPresenceDefinition): void`
插件注册自定义 Presence 类型：

```typescript
import { CustomPresenceDefinition } from '@openlearn/plugin-sdk';

const VRRobotPresence: CustomPresenceDefinition = {
  type: 'vr_robot_assistant',
  name: '3D VR 助教机器人',
  defaultStatus: 'Idle',
  rolesAllowed: ['ai', 'plugin'],
  providerFn: async (entityId) => {
    return {
      activity: '巡视 3D 虚拟实验室中',
      connectionState: 'connected',
    };
  },
};

// 注册至 PresenceManager
presenceManager.registerPresence(VRRobotPresence);
```
