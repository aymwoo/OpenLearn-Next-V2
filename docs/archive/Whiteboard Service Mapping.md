# OpenLearn Whiteboard Service Mapping (白板服务映射分析)

## 1. Executive Summary (概述)

本报告评估现存 Whiteboard Runtime 组件在平台接入阶段，哪些组件应注册至 `PlatformServiceRegistry`，哪些保持为前端与交互层内部组件。

---

## 2. Platform Service Mapping Recommendation (服务映射推荐)

```
====================================================================
 Whiteboard Component        | Target Service Category | Lifetime
====================================================================
 WhiteboardEngine            | Platform Service        | Singleton / Scoped
 WhiteboardSyncService       | Platform Service        | Scoped
 StageViewBridge             | Helper Utility          | Transient
 InteractionEngine           | Internal UI Engine      | Transient
 CanvasModel                 | Internal State Model    | Transient
====================================================================
```

---

## 3. Recommended PlatformServiceRegistry Descriptors (服务描述符预设计)

```typescript
// Recommendation for future adoption:
registry.register({
  id: 'srv_whiteboard_engine',
  lifetime: 'Singleton',
  description: 'OpenLearn Central Whiteboard Engine Service',
});

registry.register({
  id: 'srv_whiteboard_sync_service',
  lifetime: 'Scoped',
  description: 'Realtime Multi-user Whiteboard Collaboration Service',
});
```
