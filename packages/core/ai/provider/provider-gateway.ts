/**
 * OpenLearn AI Infrastructure - Unified AI Provider Gateway
 * Single source of truth for OpenAI-compatible HTTP endpoints & Google Gemini SDK calls.
 */

import { AIProviderConfig, AIGenerateOptions } from '../types/index.js';
import { AIEventBus } from '../event/ai-event-bus.js';

export class AIProviderGateway {
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
  }

  public async generateText(
    prompt: string,
    options?: AIGenerateOptions,
    config?: AIProviderConfig
  ): Promise<string> {
    const startTime = Date.now();
    const providerId = config?.id || 'system-gemini';
    const modelName = config?.modelName || 'gemini-3.5-flash';

    this.eventBus.publish('ModelStarted', {
      providerId,
      modelName,
      promptLength: prompt.length,
    });

    try {
      let resultText = '';

      if (config && config.apiKey && config.apiKey.trim()) {
        // OpenAI-compatible HTTP Request Branch
        resultText = await this.callOpenAICompatible(prompt, options, config);
      } else {
        // Google Gemini SDK Fallback Branch
        resultText = await this.callGeminiFallback(prompt, options);
      }

      this.eventBus.publish('ModelFinished', {
        providerId,
        durationMs: Date.now() - startTime,
        tokenCount: resultText.length,
      });

      return resultText;
    } catch (err: unknown) {
      console.error(`[AIProviderGateway] Provider call failed (${providerId}):`, err);
      throw err;
    }
  }

  private async callOpenAICompatible(
    prompt: string,
    options?: AIGenerateOptions,
    config?: AIProviderConfig
  ): Promise<string> {
    let cleanUrl = config!.apiUrl.trim();
    if (!cleanUrl.endsWith('/chat/completions')) {
      cleanUrl = cleanUrl.endsWith('/')
        ? cleanUrl + 'chat/completions'
        : cleanUrl + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config!.apiKey!.trim()}`,
    };

    const messages: { role: string; content: string }[] = [];
    if (options?.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(cleanUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config!.modelName,
        messages,
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI Provider Request Failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('AI Provider returned no content');
    }

    return content.trim();
  }

  private async callGeminiFallback(prompt: string, options?: AIGenerateOptions): Promise<string> {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey || geminiKey.trim() === '' || geminiKey.trim() === 'MY_GEMINI_API_KEY') {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: geminiKey.trim() });

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: options?.systemInstruction,
        temperature: options?.temperature ?? 0.2,
      },
    });

    if (!response.text) {
      throw new Error('Gemini API returned empty text');
    }

    return response.text.trim();
  }
}
