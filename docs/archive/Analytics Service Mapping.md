# OpenLearn Analytics Service Mapping (分析服务映射分析)

## 1. Executive Summary (概述)

本报告评估现存 Analytics Runtime 组件在平台接入阶段，哪些组件应注册至 `PlatformServiceRegistry`，哪些保持为内部组件。

---

## 2. Platform Service Mapping Recommendation (服务映射推荐)

```
====================================================================
 Analytics Component         | Target Service Category | Lifetime
====================================================================
 AnalyticsEngine             | Platform Service        | Singleton
 TelemetryCollector          | Platform Service        | Singleton
 MetricsAggregator           | Helper Service          | Scoped
 DashboardReporter           | Helper Utility          | Transient
====================================================================
```

---

## 3. Recommended PlatformServiceRegistry Descriptors (服务描述符预设计)

```typescript
// Recommendation for future adoption:
registry.register({
  id: 'srv_analytics_engine',
  lifetime: 'Singleton',
  description: 'OpenLearn Telemetry & Learning Analytics Central Service',
});

registry.register({
  id: 'srv_telemetry_collector',
  lifetime: 'Singleton',
  description: 'Platform Telemetry Collector & Event Tracker',
});
```
