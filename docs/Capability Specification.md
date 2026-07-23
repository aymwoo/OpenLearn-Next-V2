# OpenLearn Capability Specification (能力规格说明书)

## 1. Executive Summary (概述)

OpenLearn Capability Specification（能力规格说明）为平台内所有能力（AI, Plugin, Lesson, Notebook, Analytics, Whiteboard）定义了统一的元数据、Schema 约束、生命周期及所有权规范，确保能力治理体系具备完整的强类型审计依据。

---

## 2. Specification Schema Definition (规格 JSON / TS 结构)

```typescript
export interface GovernanceSpecification {
  readonly id: string;                        // 全局唯一 Capability ID
  readonly namespace: string;                 // 规范化 Namespace (例如: 'lesson.generate.quiz')
  readonly displayName: string;               // 可读名称
  readonly description: string;               // 功能描述
  readonly version: string;                   // SemVer 版本号 (例: '1.0.0')
  readonly provider: string;                  // 提供者标识
  readonly category: GovernanceCategory;      // Teaching | Assessment | Whiteboard | Notebook | AI | Analytics 等
  readonly permission: ReadonlyArray<string>; // 访问角色
  readonly inputSchema: Record<string, unknown>; // JSON Schema
  readonly outputSchema: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly dependencies: ReadonlyArray<CapabilityDependencySpec>; // 依赖树
  readonly owner: string;                     // 维护者
  readonly license: string;                   // 许可协议
  readonly visibility: VisibilityTier;       // Public | Private | Protected
  readonly deprecated: boolean;               // 是否已废弃
  readonly tags: ReadonlyArray<string>;       // 检索标签
  readonly approvalTier: ApprovalTier;       // Official | Community | Experimental | Internal
  readonly status: CapabilityLifecycleStatus; // Draft | Experimental | Preview | Stable | Deprecated | Archived
}
```
