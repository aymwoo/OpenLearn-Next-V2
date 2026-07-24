# OpenLearn Capability Namespace Specification (能力命名空间规范)

## 1. Executive Summary (概述)

为了防止各模块能力名称发生冲突，平台推行**点分式命名空间规范 (Dot-separated Namespace)**。

---

## 2. Capability Namespace (Mermaid 命名空间层级图)

```mermaid
graph TD
    Root["Root Namespaces"]
    LessonNS["lesson.* (教学流程与教案)"]
    WhiteboardNS["whiteboard.* (白板图表与选区)"]
    AiNS["ai.* (文本补全/多轮对话/OCR)"]
    PluginNS["plugin.* (第三方插件扩展)"]
    AnalyticsNS["analytics.* (指标分析与建议)"]

    Root --> LessonNS & WhiteboardNS & AiNS & PluginNS & AnalyticsNS

    LessonNS --> L1["lesson.generate.quiz"]
    LessonNS --> L2["lesson.generate.summary"]

    WhiteboardNS --> W1["whiteboard.generate.diagram"]
    WhiteboardNS --> W2["whiteboard.beautify.layout"]

    AiNS --> A1["ai.completion"]
    AiNS --> A2["ai.chat"]

    PluginNS --> P1["plugin.translate"]
    PluginNS --> P2["plugin.code_eval"]

    AnalyticsNS --> AN1["analytics.generate.insight"]
```

---

## 3. Namespace Syntax Rules (命名规则)

- 统一采用小写字母、数字与下划线，使用英文句号分隔：`[domain].[action].[subject]`
- 正式注册前由 `NamespaceManager` 进行正则表达与碰撞断言。
