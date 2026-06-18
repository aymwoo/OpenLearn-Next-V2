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

export class AIService implements IAIService {
  constructor(private db: BetterSqlite3.Database) {}

  async generateText(
    prompt: string,
    options?: { systemInstruction?: string; temperature?: number },
  ): Promise<string> {
    // 1. Try third-party AI provider from DB
    const provider = this.db
      .prepare(
        "SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1",
      )
      .get() as
      | { id: string; name: string; api_url: string; api_key: string; model_name: string }
      | undefined;

    if (provider) {
      let cleanUrl = provider.api_url.trim();
      if (!cleanUrl.endsWith('/chat/completions')) {
        cleanUrl = cleanUrl.endsWith('/')
          ? cleanUrl + 'chat/completions'
          : cleanUrl + '/chat/completions';
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.api_key.trim()}`,
      };

      const messages: { role: string; content: string }[] = [];
      if (options?.systemInstruction) {
        messages.push({
          role: 'system',
          content: options.systemInstruction,
        });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(cleanUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: provider.model_name,
          messages,
          temperature: options?.temperature ?? 0.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `AI provider request failed (${response.status}): ${errorText || response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('AI provider returned no text content');
      }
      return content.trim();
    }

    // 2. Fallback to Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: geminiKey });

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.2,
        },
      });

      if (!response.text) {
        throw new Error('Gemini API returned no text content');
      }
      return response.text.trim();
    }

    throw new Error(
      'No AI providers or Gemini API key configured in the system.',
    );
  }
}
