# OpenLearn Analytics Capability Mapping (分析能力映射分析)

## 1. Executive Summary (概述)

本报告分析 Analytics Runtime 子系统向平台 `CapabilityRuntime` / `CapabilityRegistry` 暴露的能力清单。

---

## 2. Analytics Capability Mapping (能力映射清单)

```
====================================================================
 Capability ID              | Category   | Implementation File
====================================================================
 capability_analytics       | AI / Metrics| capabilities/analytics-capability.ts
 cap_analytics_collector    | Telemetry  | TelemetryCollector
 cap_analytics_aggregation  | Metrics    | MetricsAggregator
 cap_analytics_reporting    | Dashboard  | DashboardReporter
====================================================================
```

---

## 3. Capability Governance (能力治理)

现存 `AnalyticsCapability` (`capability_analytics`) 已经实现了标准 `IAICapability` 契约，支持在遥测指标积累后自动调用 LLM 生成教学洞察报告。
