# OpenLearn AI Runtime Configuration Analysis (AI 运行时配置分析报告)

## 1. Executive Summary (概述)

本报告审查 AI Runtime 的配置来源、环境变量、API Key 加密机制以及运行时选项。

---

## 2. Configuration Sources (配置来源分析)

1. **Environment Variables (`.env`)**:
   - `GEMINI_API_KEY`: 默认 Google Gemini 模型密钥
   - `GEMINI_MODEL_NAME`: 默认 Gemini 模型类型（如 `gemini-2.5-flash`）
   - `ALLOWED_ORIGINS`: CORS 允许来源

2. **SQLite Database Configuration (`ai_providers` Table)**:
   - 支持动态存取第三方自定义 Provider API Endpoint (`api_url`, `model_name`)。
   - `api_key`: 使用 `server/utils/crypto.ts` 实施 AES-256-GCM 加密存储防泄露。

3. **Runtime Options**:
   - `max_tokens`, `temperature`, `timeoutMs` (默认 15000ms 超时控制)。

---

## 3. Configuration System Integration Recommendation (接入推荐)

在后续演进中，可将 `GEMINI_API_KEY` 与默认 LLM 超时配置封装为 `PlatformConfigurationSystem` 的配置节点（Category: `Infrastructure` / `AI`），享有只读防护与动态事件监听。
