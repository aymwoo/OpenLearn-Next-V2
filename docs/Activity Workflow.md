# OpenLearn Activity Workflow Specification (互动教学活动注册表规范)

## 1. Executive Summary (概述)

在 Product Phase Sprint P3-03 中，成功构建了 **Activity Workflow Registry**（位于 `src/features/activity-workflow/`）。

活动注册表集中托管官方 5 大核心互动活动 (`Quiz`, `Poll`, `Brainstorm`, `Discussion`, `Assignment`)，将它们转换为标准 Provider。第三方插件可以通过注册 `IActivityProvider` 扩充自定义互动教学活动（如 `PluginActivity`），重用已有的活动执行逻辑。

---

## 2. Activity Provider Interface (活动 Provider 接口)

```typescript
export type ActivityType =
  | 'Quiz'
  | 'Poll'
  | 'Brainstorm'
  | 'Discussion'
  | 'Assignment'
  | 'PluginActivity';

export interface ActivityDescriptor {
  readonly id: string;
  readonly title: string;
  readonly type: ActivityType;
  readonly description?: string;
  readonly config?: Record<string, unknown>;
}

export interface IActivityProvider {
  readonly id: string;
  readonly type: ActivityType;
  readonly createActivity: (title: string, config?: Record<string, unknown>) => ActivityDescriptor;
  readonly executeActivity?: (descriptor: ActivityDescriptor, context?: unknown) => unknown;
}
```

---

## 3. Usage & Plugin Activity Extension Example (使用与插件扩充范例)

```typescript
import {
  ActivityRegistry,
  registerDefaultActivities,
  IActivityProvider,
} from './src/features/activity-workflow/index.js';

const registry = new ActivityRegistry();

// 1. Register 5 default official activities
registerDefaultActivities(registry);

// 2. Register Plugin Activity Provider
const pluginProvider: IActivityProvider = {
  id: 'provider_plugin_code_challenge',
  type: 'PluginActivity',
  createActivity: (title, config) => ({
    id: `act_code_${Date.now()}`,
    title: title || 'Live Coding Challenge',
    type: 'PluginActivity',
    config,
  }),
};

registry.registerProvider(pluginProvider);

// 3. Create Activity
const quiz = registry.createActivity('Quiz', 'Pop Quiz 101');
const codeChallenge = registry.createActivity('PluginActivity', 'Python Challenge', { lang: 'py' });
```
