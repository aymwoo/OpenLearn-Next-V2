# OpenLearn Analytics SDK & Plugin Extension Handbook (分析 SDK 手册)

## 1. Overview (概述)

`AnalyticsEngineKernel` 提供了插件扩展能力。第三方插件可以通过 Analytics SDK 注册自定义物理指标、合成概念指标、自定义数据采集器与洞察规则。

---

## 2. Plugin Extension APIs (插件扩展 API)

### 2.1 `registerMetric(definition: CustomMetricDefinition): void`
注册自定义物理指标：

```typescript
import { CustomMetricDefinition } from '@openlearn/plugin-sdk';

const CustomCodeComplexityMetric: CustomMetricDefinition = {
  name: 'codeComplexityIndex',
  description: '代码圈复杂度均值',
  computeFn: (events) => {
    const codeEvents = events.filter((e) => e.eventType === 'CodeExecuted');
    return codeEvents.length * 1.2;
  },
};

analyticsEngine.registerMetric(CustomCodeComplexityMetric);
```

### 2.2 `registerIndicator(definition: CustomIndicatorDefinition): void`
注册自定义高层概念指标：

```typescript
import { CustomIndicatorDefinition } from '@openlearn/plugin-sdk';

const CustomCreativityIndicator: CustomIndicatorDefinition = {
  name: 'creativityIndex',
  description: '课堂白板创意发散指数',
  computeFn: (metrics) => {
    return Math.min(100, metrics.whiteboardEditCount * 8);
  },
};

analyticsEngine.registerIndicator(CustomCreativityIndicator);
```

### 2.3 `registerInsight(rule: CustomInsightRule): void`
注册自定义洞察规则：

```typescript
import { CustomInsightRule } from '@openlearn/plugin-sdk';

const CustomAbnormalErrorRule: CustomInsightRule = {
  id: 'rule_code_syntax_spike',
  evaluateFn: (metrics, indicators) => {
    if (metrics.codeExecutionCount > 10 && indicators.thinkingActivityIndex < 30) {
      return {
        id: 'ins_syntax_spike',
        title: '代码语法错误异常突增',
        description: '大量学生在练习中遭遇语法报错，建议提示语言规范。',
        severity: 'warning',
        category: 'mastery',
        recommendation: '下发代码语法参考卡片',
        timestamp: Date.now(),
      };
    }
    return null;
  },
};

analyticsEngine.registerInsight(CustomAbnormalErrorRule);
```
