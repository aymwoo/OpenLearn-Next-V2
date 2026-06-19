import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  IEventBusServiceToken,
  IDatabaseToken,
  IAIServiceToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

interface StoredAIProvider {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  model_name: string;
}

export function hasDataSubmission(htmlContent: string): boolean {
  // Check for LMS methods or postMessage calls
  return /LMS\.submit|LMS\.finish|LMS_SUBMIT|LMS_FINISH|parent\.postMessage|window\.parent\.postMessage/i.test(htmlContent);
}

export function hasScoreDisplay(htmlContent: string): boolean {
  // Match common score display terms
  return /score|grade|point|得分|成绩|分数|百分/i.test(htmlContent);
}

export function cleanHtmlOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '');
    cleaned = cleaned.replace(/\n```$/, '');
  }
  return cleaned.trim();
}

export async function injectScoreSubmissionUsingAI(db: any, htmlContent: string): Promise<string> {
  const prompt = `You are a professional web developer. Your task is to safely and minimally modify the provided HTML content of an interactive courseware to automatically submit/report the student's score to the LMS/parent window.

Requirements:
1. Find where the score or grade is calculated, displayed, or updated in the HTML (usually in <script> blocks, e.g. when checking answers, rendering results, or clicking submit/finish).
2. Inject a call to 'LMS.submit({ score: Number(scoreVal), completion: 1 })' at the exact place where the score becomes available or is displayed. Ensure that 'scoreVal' is parsed as a number.
3. If there is already a custom submission/result showing button (e.g. "Check answers", "Submit", "完成"), also ensure that clicking that button triggers the 'LMS.submit' call.
4. If there is a score display element (like <div id="score">), you can listen to its content changes or modify the function that updates its text to trigger 'LMS.submit'.
5. Make the modification safe, limited, and minimal. Do not rewrite the entire structure. Keep all styling, styles, and other scripts intact.
6. Return ONLY the modified HTML code. Do not wrap it in markdown code blocks, do not write explanations. Just output the raw modified HTML.

Here is the original HTML code:
${htmlContent}
`;

  let text = '';
  const provider = db.prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != "" LIMIT 1').get() as StoredAIProvider | undefined;

  if (provider && provider.api_key && provider.api_key.trim()) {
    let chatUrl = provider.api_url.trim();
    if (!chatUrl.endsWith('/chat/completions')) {
      chatUrl = chatUrl.endsWith('/') ? chatUrl + 'chat/completions' : chatUrl + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.api_key.trim()}`
    };

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 8192
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    text = data.choices?.[0]?.message?.content?.trim() || '';
  } else {
    // Gemini fallback
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error('AI provider is not configured and GEMINI_API_KEY is missing.');
    }
    const ai = new GoogleGenAI({ apiKey: geminiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.2 }
    });
    text = response.text?.trim() || '';
  }

  return cleanHtmlOutput(text);
}

export const AiSubmitInjectorPlugin = {
  manifest: {
    id: '@openlearn/plugin-ai-submit-injector',
    name: 'AI Submit Injector Plugin',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IAIService@^1.0.0',
    ],
    capabilitiesProposed: [],
  },
  activate: async (ctx: PluginContext) => {
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);
    const aiService = ctx.services.ai;

    await eventBus.subscribe('courseware.uploaded', async (event: any) => {
      const payload = event.payload;
      if (!payload || !payload.uuid || !payload.entry || payload.name?.startsWith('[自动提交版]')) {
        return;
      }

      const filePath = path.resolve(process.cwd(), 'storage', 'courseware', payload.uuid, payload.entry);
      if (!fs.existsSync(filePath)) {
        return;
      }

      try {
        const htmlContent = fs.readFileSync(filePath, 'utf-8');
        if (!hasDataSubmission(htmlContent) && hasScoreDisplay(htmlContent)) {
          const prompt = `You are a professional web developer. Your task is to safely and minimally modify the provided HTML content of an interactive courseware to automatically submit/report the student's score to the LMS/parent window.

Requirements:
1. Find where the score or grade is calculated, displayed, or updated in the HTML (usually in <script> blocks, e.g. when checking answers, rendering results, or clicking submit/finish).
2. Inject a call to 'LMS.submit({ score: Number(scoreVal), completion: 1 })' at the exact place where the score becomes available or is displayed. Ensure that 'scoreVal' is parsed as a number.
3. If there is already a custom submission/result showing button (e.g. "Check answers", "Submit", "完成"), also ensure that clicking that button triggers the 'LMS.submit' call.
4. If there is a score display element (like <div id="score">), you can listen to its content changes or modify the function that updates its text to trigger 'LMS.submit'.
5. Make the modification safe, limited, and minimal. Do not rewrite the entire structure. Keep all styling, styles, and other scripts intact.
6. Return ONLY the modified HTML code. Do not wrap it in markdown code blocks, do not write explanations. Just output the raw modified HTML.

Here is the original HTML code:
${htmlContent}
`;
          const responseText = await aiService.generateText(prompt);
          const modified = cleanHtmlOutput(responseText);

          if (modified && modified !== htmlContent) {
            const newUuid = uuidv7();
            const newCwId = 'cw_' + crypto.randomBytes(8).toString('hex');
            const newStorageDir = path.resolve(process.cwd(), 'storage', 'courseware', newUuid);
            fs.mkdirSync(newStorageDir, { recursive: true });
            fs.writeFileSync(path.join(newStorageDir, payload.entry), modified);

            db.prepare(
              'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(newCwId, newUuid, `[自动提交版] ${payload.name}`, 'html', payload.entry, Date.now() + 10);

            await eventBus.publish({
              id: uuidv7(),
              type: 'courseware.uploaded',
              source: 'ai.submit-injector',
              payload: { id: newCwId, uuid: newUuid, name: `[自动提交版] ${payload.name}`, entry: payload.entry },
              timestamp: Date.now() + 10,
              correlationId: event.id
            });
          }
        }
      } catch (err) {
        console.error('[AI Submit Injector Plugin] Error handling upload:', err);
      }
    });
  },
  deactivate: async () => {
    // Handlers automatically disposed by ResourceTracker
  }
};
