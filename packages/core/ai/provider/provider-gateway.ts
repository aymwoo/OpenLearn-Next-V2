/**
 * OpenLearn AI Infrastructure - Unified AI Provider Gateway
 * Single source of truth for OpenAI-compatible HTTP endpoints.
 */

import { AIProviderConfig, AIGenerateOptions } from '../types/index.js';
import { AIEventBus } from '../event/ai-event-bus.js';

export class AIProviderGateway {
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
  }

  public async generateText(prompt: string, options?: AIGenerateOptions, config?: AIProviderConfig): Promise<string> {
    if (!config || !config.apiKey || !config.apiKey.trim()) {
      throw new Error('未检测到可用的 AI 提供商。请前往「系统管理 -> AI 提供商管理」添加并配置大模型服务。');
    }

    const startTime = Date.now();
    const providerId = config.id;
    const modelName = config.modelName;

    this.eventBus.publish('ModelStarted', {
      providerId,
      modelName,
      promptLength: prompt.length,
    });

    try {
      const resultText = await this.callOpenAICompatible(prompt, options, config);

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
    config?: AIProviderConfig,
  ): Promise<string> {
    let cleanUrl = config!.apiUrl.trim();
    if (!cleanUrl.endsWith('/chat/completions')) {
      cleanUrl = cleanUrl.endsWith('/') ? cleanUrl + 'chat/completions' : cleanUrl + '/chat/completions';
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
}
