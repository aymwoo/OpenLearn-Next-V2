# OpenLearn Provider Gateway Specification (Provider 网关规范)

## 1. Overview (概述)

`AIProviderGateway` 是统一的 AI 模型路由网关，负责解决 DB 第三方 AI Provider 请求与环境变量 `GEMINI_API_KEY` 之间的路由、重试、日志记录与自动降级。

---

## 2. Gateway Flow (Mermaid 网关推演流向图)

```mermaid
graph TD
    subgraph Client ["Capability / AIService"]
        Req["generateText(prompt, options, config)"]
    end

    subgraph Gateway ["AIProviderGateway Routing Logic"]
        CheckDB{"DB 中配置了 active provider 并且含有有效 API Key?"}
        OpenAIBranch["拼装 /chat/completions 原生 Fetch 请求"]
        GeminiBranch["动态导入 @google/genai SDK 并调用 gemini-3.5-flash"]
    end

    subgraph Endpoints ["External Model Providers"]
        DBProvider["OpenAI / DeepSeek / Qwen / Ollama"]
        GeminiCloud["Google Gemini API"]
    end

    Req --> CheckDB
    CheckDB -- Yes --> OpenAIBranch --> DBProvider
    CheckDB -- No / Fallback --> GeminiBranch --> GeminiCloud
```

---

## 3. Resilience & Telemetry (容错与监控)

1. **自动降级 (Automatic Fallback)**: 当 DB 指定的 AI Provider 返回 5xx 或网络超时错误时，网关将自动降级至系统 Gemini 兜底。
2. **统一日志 (Unified Telemetry)**: 每次网关调用的输入/输出长度、响应延时 (Latency) 和 Provider ID 均会自动输出至 `CapabilityLogger` 与 `AIEventBus` 中。
