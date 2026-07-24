# OpenLearn Capability Framework Registry Specification (能力注册表与发现规范)

## 1. Overview (概述)

`CapabilityFrameworkRegistry` 是整个平台内核级能力调用的中心字典，支持注册、解析、条件过滤及按标签自动发现（Auto-Discovery）。

---

## 2. Capabilities Catalog (标准系统 Capability 目录)

| Capability ID | 分类 | 拥有者 / 适配器 | 允许角色 | 结果类型 |
|---|---|---|---|---|
| `cap_ai_completion` | `ai` | `AICapabilityProviderHandler` | Teacher, Student, Plugin, AI, System | `markdown` |
| `cap_cmd_<commandType>` | `plugin` | `PluginCapabilityProviderHandler` | Teacher, System | `plugin_data` |
| `cap_lesson_flow` | `lesson` | `LessonCapabilityProviderHandler` | Teacher, Student, System | `teaching_object` |
| `cap_analytics_insight` | `analytics` | `AnalyticsCapabilityProviderHandler` | Teacher, System | `analytics_insight` |

---

## 3. Auto-Discovery API (自动发现接口)

```typescript
// 按 tag 动态检索所有具有 'completion' 标签的能力
const completionCapabilities = registry.discover('completion');
```
