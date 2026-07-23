# OpenLearn Platform Permission Specification (平台权限规范)

## 1. Executive Summary (概述)

本文档规范 OpenLearn 平台基础设施权限模型与鉴权机制。

---

## 2. API Contract & Data Structures (接口与数据结构)

```typescript
export interface PermissionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly category: 'Platform' | 'Infrastructure' | 'Capability' | 'Configuration' | 'Lifecycle' | 'Reserved';
  readonly description?: string;
  readonly defaultPolicy?: 'Allow' | 'Deny' | 'Default' | 'Inherited' | 'Reserved';
}

export interface PermissionContext {
  readonly subject: string;
  readonly target: string;
  readonly permission: string;
  readonly source?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
  result?: PermissionResult;
}
```

---

## 3. Scope Boundaries & Prohibited Uses (作用域边界与禁用原则)

### 允许使用场景：
- 校验 Platform Builder / Worker / Kernel 组件是否拥有访问特定配置参数的权限
- 校验内部子系统是否具备执行 Capability 或更改 Lifecycle 状态的权限

### 绝对禁止使用场景：
- 校验 User Role (Admin / Teacher / Student / Parent)
- 校验 课堂 / 班级 / 课程 访问控制与业务 API 权限
- 校验 插件市场与应用授权规则
