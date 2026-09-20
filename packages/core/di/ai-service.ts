/**
 * AIService — kernel-level AI text generation.
 *
 * Implements IAIService using configured third-party AI providers (OpenAI-compatible)
 * from the DB `ai_providers` table.
 *
 * Mirrors the wrappedAI.generateText logic from PluginRuntime.
 * The pure business logic lives here; the wrapper layer in PluginRuntime
 * (createSafeFunction, try-catch, console.error) is kept separate.
 *
 * ## Design decisions
 *
 * - **No console.error or try-catch**: Errors bubble to the caller.
 *   The PluginRuntime wrapper layer adds plugin-scoped error logging.
 * - **Constructor injection**: Receives `BetterSqlite3.Database` directly.
 * - **Provider Enforcement**: Requires an active AI provider configured in the
 *   database. If no provider is available, throws a user-friendly error.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { IAIService } from './interfaces.js';
import { AIProviderGateway } from '../ai/provider/provider-gateway.js';
import { AIEventBus } from '../ai/event/ai-event-bus.js';
import { AIProviderConfig } from '../ai/types/index.js';
import { decryptApiKey, looksLikeCiphertext } from './api-key-crypto.js';

export class AIService implements IAIService {
  private gateway: AIProviderGateway;

  constructor(private db: BetterSqlite3.Database) {
    this.gateway = new AIProviderGateway(new AIEventBus());
  }

  async generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number; maxTokens?: number },
  ): Promise<string> {
    // Query active third-party provider from DB
    const provider = this.db
      .prepare(
        "SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1",
      )
      .get() as { id: string; name: string; api_url: string; api_key: string; model_name: string } | undefined;

    if (!provider || !provider.api_key) {
      throw new Error('未检测到可用的 AI 提供商。请前往「系统管理 -> AI 提供商管理」添加并配置大模型服务。');
    }

    // 与 server/utils/crypto.ts 共用同一套密钥解析（含 .env 回退），避免
    // “AI Provider 测试通过、插件调用 401” 的解密分叉。
    const apiKey = decryptApiKey(provider.api_key);
    if (!apiKey || !apiKey.trim()) {
      throw new Error('AI Provider API Key 解密为空，请前往「系统管理 -> AI 提供商管理」重新保存密钥。');
    }
    if (looksLikeCiphertext(apiKey)) {
      // 解密失败时 decryptApiKey 会原样返回密文；此处显式报错，避免把密文当 Bearer
      // 发给上游后得到一个难以定位的 401。
      throw new Error(
        'AI Provider API Key 解密失败：ENCRYPTION_KEY 与加密时不一致（常见于 PM2 将 ENCRYPTION_KEY 置空或密钥被轮换）。' +
          '请恢复原 ENCRYPTION_KEY，或前往「系统管理 -> AI 提供商管理」重新保存 API Key。',
      );
    }

    const config: AIProviderConfig = {
      id: provider.id,
      name: provider.name,
      apiUrl: provider.api_url,
      apiKey,
      modelName: provider.model_name,
    };

    return this.gateway.generateText(prompt, options, config);
  }
}

