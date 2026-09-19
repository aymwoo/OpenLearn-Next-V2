# AI Runtime 内核

`AIRuntimeKernel` 与 `AIProviderGateway` 在 `packages/core/ai/` 中实现，提供统一的 OpenAI 兼容大语言模型接入架构。

## 核心特性
- **动态多 Provider 网关**：支持通过管理后台动态添加与管理多个第三方 AI 提供商（如 DeepSeek、Qwen、Ollama、OpenAI 等）。
- **凭据安全加密**：所有 Provider 的 API Key 均采用 AES-256-GCM 算法加密存储于 SQLite 数据库中。
- **内核级 DI 契约**：通过 `IAIService` / `IAIServiceToken` 提供标准化 `generateText` 接口，无缝服务于插件系统与平台内核。
- **AI 遥测总线**：内置 `AIEventBus`，统一分发 `ModelStarted`、`ModelFinished` 等生命周期事件。
- **未配置拦截保护**：当系统未配置任何激活的 AI Provider 时，内核统一拦截并抛出标准化提示，前端提供醒目配置引导。

