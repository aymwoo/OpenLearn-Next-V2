# OpenLearn Runtime API Reference (运行时扩展 API 参考)

## 1. Overview (概述)

`ClassroomRuntimeKernel` 开放了全套解耦的 Plugin & Extension API。第三方插件与核心子模块无需修改 Runtime 源码，即可通过暴露的 API 注册模块、服务、生命周期钩子以及自定义调度任务。

---

## 2. Core Extension APIs (扩展 API 手册)

### 2.1 `registerModule(module: IRuntimeModule): void`
注册动态模块（如 Whiteboard Module, Quiz Module, Blockly Module, Jupyter Module, AI Tutor Module）。

```typescript
kernel.registerModule({
  id: 'mod_jupyter_lab',
  name: 'Jupyter Lab Coding Module',
  version: '1.0.0',
  initialize: async (ctx) => { /* 初始化逻辑 */ },
  start: async (ctx) => { /* 启动逻辑 */ },
  stop: async (ctx) => { /* 停止逻辑 */ },
  dispose: async () => { /* 销毁逻辑 */ },
});
```

### 2.2 `registerService<T extends IRuntimeService>(service: T): void`
向中央 Service Registry 注册自定义服务。

```typescript
kernel.registerService({
  serviceId: 'service_vr_render',
  name: 'VR Rendering Service',
  initialize: async (ctx) => {},
  dispose: async () => {},
});
```

### 2.3 `registerRuntimeHook<T>(hookName: RuntimeHookName, callback: RuntimeHookCallback<T>): () => void`
注册 Runtime 生命周期拦截钩子。

支持钩子名称：
- `beforeLessonStart`
- `afterLessonStart`
- `beforeStageChange`
- `afterStageChange`
- `beforePluginLoad`
- `afterPluginLoad`
- `beforeStudentJoin`
- `afterStudentJoin`

```typescript
const unregister = kernel.registerRuntimeHook('beforeStageChange', async (payload, ctx) => {
  console.log('即将切换 Stage:', payload);
});
```

### 2.4 `scheduleTask<T>(name: string, taskFn: () => Promise<T>, priority?: TaskPriority, delayMs?: number): Promise<T>`
提交优先级调度任务。

```typescript
import { TaskPriority } from '@openlearn/plugin-sdk';

await kernel.scheduleTask(
  '紧急阶段跳转通知',
  async () => {
    // 任务逻辑
  },
  TaskPriority.Immediate
);
```

---

## 3. Session & Permission APIs (会话与权限 API)

### `sessionManager.createSession(sessionId, teacher, courseId?, lessonId?)`
创建全新课堂会话实体。

### `sessionManager.joinSession(student)`
学生加入会话，自动更新 State Tree 并广播 `StudentJoined`。

### `permissionManager.hasPermission(role, permission)`
校验特定角色是否拥有特定权限（`lesson:control`, `stage:navigate`, `whiteboard:draw`, `quiz:submit`, `plugin:execute`, `ai:invoke`, `session:manage`）。
