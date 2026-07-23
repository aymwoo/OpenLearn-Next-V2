# OpenLearn Capability Lifecycle & Dependency Specification (能力生命周期与依赖图规范)

## 1. Executive Summary (概述)

规范定义了 Capability 从草案 (`Draft`) 到归档 (`Archived`) 的 6 阶段转换状态机，以及 DAG 依赖树拓扑循环检测规则。

---

## 2. Capability Lifecycle (Mermaid 生命周期状态机图)

```mermaid
stateDiagram-v2
    [*] --> Draft: 创建草案
    Draft --> Experimental: 发布实验版
    Draft --> Preview: 发布预览版
    Draft --> Archived: 归档作废
    Experimental --> Preview: 升至预览
    Experimental --> Stable: 升至稳定版
    Experimental --> Deprecated: 废弃
    Preview --> Stable: 确认稳定
    Preview --> Deprecated: 标记废弃
    Stable --> Deprecated: 标记废弃
    Deprecated --> Archived: 永久归档
    Archived --> [*]
```

---

## 3. Capability Dependency Graph (Mermaid 依赖图示例)

```mermaid
graph TD
    CapA["Capability A (Lesson Quiz)"]
    CapB["Capability B (AI Completion)"]
    CapC["Capability C (Analytics Logger)"]

    CapA -->|Requires| CapB
    CapA -->|Requires| CapC
    CapB -->|Requires| CapC

    note["DependencyGraph 自动检测环状依赖 (如 C -> A)，拒绝非法注册"]
```
