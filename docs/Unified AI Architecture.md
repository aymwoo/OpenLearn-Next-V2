# OpenLearn Unified AI Architecture Specification (统一 AI 基础设施架构规范)

## 1. Overview (概述)

OpenLearn 统一 AI 基础设施（Unified AI Infrastructure）位于 `packages/core/ai/` 目录下。系统将 Provider 网关、Prompt 注册表、Context 服务、Tool 注册表、Conversation 会话服务、Streaming 服务、Memory 存储及 AI 事件总线统一集成于 `AIRuntimeKernel` 主控内核。

---

## 2. Current vs. Target Architecture Comparison (前后架构对比)

### 2.1 固有离散架构 (Current Legacy Architecture)

```mermaid
graph TD
    subgraph FragmentedCallsites ["Fragmented Callsites (分散请求)"]
        C1["server.ts Agent Chat"]
        C2["server.ts OCR Handler"]
        C3["server.ts Eval Handler"]
        C4["AIService.generateText"]
    end

    subgraph FragmentedLogic ["Fragmented Logic (重复解密与 Fetch)"]
        F1["Duplicated DB SELECT & decryptApiKey"]
        F2["Duplicated OpenAI Fetch & Header Building"]
        F3["Duplicated Gemini SDK Instantiation"]
    end

    C1 --> F1 & F2 & F3
    C2 --> F1 & F2 & F3
    C3 --> F1 & F2 & F3
    C4 --> F1 & F2 & F3
```

---

### 2.2 统一目标架构 (Target Unified Architecture)

```mermaid
graph TD
    subgraph Callsites ["Consolidated Callsites (统一调用源)"]
        C1["REST API / Agent Route"]
        C2["Lesson Flow Engine"]
        C3["Plugins & Third-party Tools"]
    end

    subgraph CoreKernel ["AIRuntimeKernel (packages/core/ai/)"]
        Gateway["AIProviderGateway (统一 Provider 网关)"]
        Prompts["PromptRegistry (集中式 Prompt 模版库)"]
        Contexts["AIContextService (多维上下文合成器)"]
        Tools["ToolRegistry (系统/插件工具注册表)"]
        Convs["ConversationService (多轮 Session 会话管理)"]
        Streams["StreamingService (SSE/流式响应)"]
        Memories["MemoryService (持久化内存)"]
        Events["AIEventBus (解耦 AI 事件总线)"]
    end

    subgraph Providers ["Unified Provider Endpoints"]
        GeminiSDK["@google/genai (GEMINI_API_KEY)"]
        OpenAIEndpoints["OpenAI / DeepSeek / Qwen / Ollama (HTTP)"]
    end

    Callsites --> CoreKernel
    Gateway --> GeminiSDK & OpenAIEndpoints
    CoreKernel --> Gateway & Prompts & Contexts & Tools & Convs & Streams & Memories & Events
```

---

## 3. Core Architecture Subsystems (核心子系统职责)

1. **`AIProviderGateway`**: 消除全局 4 处重复的 Provider 查询与 Fetch 逻辑，统一处理 OpenAI 兼容 HTTP 请求与 Gemini SDK 兜底。
2. **`PromptRegistry`**: 集中收拢所有 Agent 提示词、教学流程提示词、Quiz 生成提示词、OCR 提示词与评估提示词，支持模版插值。
3. **`AIContextService`**: 聚合 Teacher、Student、Lesson、Stage、Whiteboard 及 Analytics 上下文片段，合成标准化 AI 提示语。
4. **`ToolRegistry`**: 自动包装系统 Action 与插件工具，导出 OpenAI `function` 及 Gemini `tool` Schema。
5. **`ConversationService`**: 维护多轮对话历史记录、上下文窗口及 Tool 执行轨迹。
6. **`AIRuntimeKernel`**: Master 主控内核，连接所有子系统并暴露统一基础设施 API。
