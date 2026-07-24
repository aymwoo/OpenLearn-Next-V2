# OpenLearn Capability Policy Specification (能力治理策略规范)

## 1. Executive Summary (概述)

`PolicyEngine` 为平台提供自动化合规评估，涵盖安全策略 (Security Policy)、权限策略 (Permission Policy)、AI 策略 (AI Policy) 及插件策略 (Plugin Policy)。

---

## 2. Standard Governance Policies (标准策略集)

### 2.1 Security Policy (安全策略)
- **规则 1**: Internal (未审核) 级别的社区插件不得申请 `System` 提权角色。

### 2.2 AI Policy (AI 策略)
- **规则 2**: 标记为 `deprecated` 的 AI 能力禁止发起生成请求，引导迁移至最新版模型能力。

### 2.3 Plugin Policy (插件策略)
- **规则 3**: Community 级别插件在注册 Capability 时必须指定明确的 `owner` (所有者/维护团队)。
