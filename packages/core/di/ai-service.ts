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

import crypto from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import type { IAIService } from './interfaces.js';
import { AIProviderGateway } from '../ai/provider/provider-gateway.js';
import { AIEventBus } from '../ai/event/ai-event-bus.js';
import { AIProviderConfig } from '../ai/types/index.js';

function decryptKeyIfNeeded(encrypted: string): string {
  if (!encrypted) return '';
  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted;
  try {
    const rawKey = process.env.ENCRYPTION_KEY;
    if (!rawKey) return encrypted;
    const key = rawKey.length === 64 ? Buffer.from(rawKey, 'hex') : crypto.createHash('sha256').update(rawKey).digest();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch {
    return encrypted;
  }
}

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

    const config: AIProviderConfig = {
      id: provider.id,
      name: provider.name,
      apiUrl: provider.api_url,
      apiKey: decryptKeyIfNeeded(provider.api_key),
      modelName: provider.model_name,
    };

    return this.gateway.generateText(prompt, options, config);
  }
}

