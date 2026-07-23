/**
 * AIService — kernel-level AI text generation.
 *
 * Implements IAIService with a two-tier fallback strategy:
 * 1. Third-party AI provider (OpenAI-compatible) configured in the DB
 *    `ai_providers` table — used when available and has a valid API key.
 * 2. Google Gemini via the `@google/genai` SDK — used as fallback when
 *    `GEMINI_API_KEY` is set in the environment and no third-party
 *    provider is configured.
 *
 * Mirrors the wrappedAI.generateText logic from PluginRuntime
 * (plugin-runtime/index.ts:364-440).  The pure business logic lives
 * here; the wrapper layer in PluginRuntime (createSafeFunction, try-catch,
 * console.error) is kept separate.
 *
 * ## Design decisions
 *
 * - **No console.error or try-catch**: Errors bubble to the caller.
 *   The PluginRuntime wrapper layer adds plugin-scoped error logging.
 * - **Constructor injection**: Receives `BetterSqlite3.Database` directly.
 * - **Dynamic import for @google/genai**: Deferred until fallback is
 *   actually needed so the import cost is only paid when the provider
 *   path is taken.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { IAIService } from './interfaces.js';
import { AIProviderGateway } from '../ai/provider/provider-gateway.js';
import { AIEventBus } from '../ai/event/ai-event-bus.js';
import { AIProviderConfig } from '../ai/types/index.js';

export class AIService implements IAIService {
  private gateway: AIProviderGateway;

  constructor(private db: BetterSqlite3.Database) {
    this.gateway = new AIProviderGateway(new AIEventBus());
  }

  async generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number },
  ): Promise<string> {
    // Query active third-party provider from DB
    const provider = this.db
      .prepare(
        "SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1",
      )
      .get() as
      | { id: string; name: string; api_url: string; api_key: string; model_name: string }
      | undefined;

    let config: AIProviderConfig | undefined;
    if (provider) {
      config = {
        id: provider.id,
        name: provider.name,
        apiUrl: provider.api_url,
        apiKey: provider.api_key,
        modelName: provider.model_name,
      };
    }

    return this.gateway.generateText(prompt, options, config);
  }
}
