# OpenLearn Learning Analytics Engine Architecture & Design (学习分析引擎架构设计)

## 1. Overview (概述)

OpenLearn Learning Analytics Engine（学习分析引擎）是 OpenLearn 教学 OS 中统一的数据采集、规格归一化、事件流处理、指标推演与自动洞察中枢。

Analytics Engine 遵守**“只专注计算与推演，不涉及具体 UI 渲染”**的解耦原则。未来所有的上层展示与决策系统（**AI Agent**, **Teacher Dashboard**, **Student Dashboard**, **Assessment System**, **Recommendation**, **Digital Twin**）均建立在 Analytics Engine 吐出的计算模型之上。

---

## 2. Analytics Architecture (Mermaid 架构图)

```mermaid
graph TD
    subgraph Sources ["Classroom Telemetry Data Sources (全量数据源)"]
        S1["Lesson & Stage Engine"]
        S2["Teaching Object & Whiteboard"]
        S3["Code Runner Sandbox"]
        S4["Quiz & Assignment Subsystem"]
        S5["Plugin & AI System"]
        S6["Presence & Collaboration Engine"]
    end

    subgraph CoreEngine ["Learning Analytics Engine Core (分析引擎内核)"]
        Collector["Analytics Collector (全量统一采集器)"]
        Normalizer["Event Normalizer (规格化规范器)"]
        Stream["Event Stream Pipeline (发布/订阅/重放/窗口/聚合)"]
        Privacy["Privacy & Storage Manager (脱敏/匿名/快照/留存)"]
        MetricsEng["Metrics Engine (基础物理指标计算)"]
        IndicatorEng["Indicator Engine (高层概念指标合成)"]
        DomainEng["Domain Analytics Models (子域推演引擎)"]
        InsightEng["Insight Engine (规则引擎与自动洞察)"]
        Prediction["Prediction Provider Facade (学习/节奏预测)"]
        Publisher["Analytics Publisher (Dashboard 数据订阅)"]
    end

    subgraph Downstream ["Downstream Systems (未来上层消费系统)"]
        AI["AI Tutor & AI Planner"]
        Dash["Teacher & Student Dashboards"]
        Assessment["Assessment & Evaluation"]
        DigitalTwin["Classroom Digital Twin"]
      Recommendation["Personalized Recommendation"]
    end

    Sources --> Collector
    Collector --> Normalizer
    Normalizer --> Privacy
    Privacy --> Stream
    Stream --> MetricsEng
    MetricsEng --> IndicatorEng
    IndicatorEng --> InsightEng
    Stream --> DomainEng
    MetricsEng & IndicatorEng & InsightEng --> Publisher
    MetricsEng --> Prediction
    Publisher --> Downstream
    Prediction --> Downstream
```

---

## 3. Data Lineage (Mermaid 血缘关系图)

```mermaid
graph LR
    subgraph RawEvents ["Normalized Events"]
        E1["QuizSubmitted"]
        E2["CodeExecuted"]
        E3["WhiteboardEdited"]
        E4["PresenceChanged"]
    end

    subgraph Metrics ["Raw Metrics Engine"]
        M1["quizAccuracyRate"]
        M2["participationRate"]
        M3["codeExecutionCount"]
        M4["whiteboardEditCount"]
    end

    subgraph Indicators ["High-Level Indicators"]
        I1["thinkingActivityIndex"]
        I2["knowledgeMasteryIndex"]
        I3["collaborationIndex"]
    end

    subgraph Insights ["Automated Insights"]
        INS1["知识点答题正确率偏低预警"]
        INS2["课堂互动度偏低预警"]
    end

    E1 --> M1 & M2
    E2 --> M3 & M2
    E3 --> M4 & M2
    E4 --> M2

    M1 --> I2 & I1
    M2 --> I3
    M3 & M4 --> I1 & I3

    M1 & I2 --> INS1
    M2 & I3 --> INS2
```
