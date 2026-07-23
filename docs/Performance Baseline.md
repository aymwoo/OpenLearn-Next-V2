# OpenLearn Performance Baseline Report (性能基线测试报告)

## 1. Executive Summary (概述)

本报告基于 Vitest 运行期采集的数据，建立 Platform Kernel v1.0 启动性能、耗时分布、内存消耗与容器解算成本基线。

---

## 2. Benchmark Metrics (性能基线指标)

```
====================================================================
 Metric Category            | Benchmark Value       | Status
====================================================================
 Pipeline Total Startup     | ~1 ms                 | Excellent
 Stage: StartupStage        | < 1 ms                | Excellent
 Stage: RegistrationStage   | < 1 ms                | Excellent
 Stage: InitializationStage | < 1 ms                | Excellent
 Stage: ActivationStage     | < 1 ms                | Excellent
 Stage: ReadyStage          | < 1 ms                | Excellent
 Service Resolution Cost    | < 0.05 ms per resolve | Excellent
 DI Container Resolution    | < 0.1 ms (Recursive)  | Excellent
 Full Test Suite (178 tests)| 11.23 s               | Pass
 Heap Memory Usage          | ~68 MB (Node Runtime) | Nominal
====================================================================
```

---

## 3. Performance Assessment (性能评估)

- **Zero Overheads**: Pipeline 5 阶段采用异步轻量 Task 封装，微秒级调度切换。
- **Resolution Speed**: `PlatformContainer` 与 `PlatformServiceRegistry` 的单例查找代价为 $O(1)$ Hash Map 索引，瞬态工厂解算开销极低。
