import { describe, it, expect } from 'vitest';
import {
  buildAgentSystemInstruction,
  buildAgentFinalMessage,
  normalizeToolSchema,
  buildOpenAITools,
} from '../ai-agent.js';
import type { AgentChatAttachment } from '../context.js';

/**
 * Characterization tests for the pure AI-agent helpers extracted from
 * server.ts into server/ai-agent.ts. These pin the exact emitted strings /
 * shapes so a future refactor cannot silently change chat behavior.
 *
 * The network-bearing helpers (executeAgentToolCall / runGeminiAgentChat /
 * runOpenAIAgentChat) are exercised separately (or skipped) because they make
 * outbound requests or mutate kernel state — see the skip block at the bottom.
 */
describe('AI-agent pure helpers', () => {
  it('buildAgentSystemInstruction("zh") contains the Chinese base instruction', () => {
    const out = buildAgentSystemInstruction('zh');
    expect(typeof out).toBe('string');
    expect(out).toContain('OS Agent');
    // Without a lesson id there should be no "current selected lesson" context.
    expect(out).not.toContain('current selected lesson ID');
  });

  it('buildAgentSystemInstruction("en", lessonId) injects the lesson context', () => {
    const out = buildAgentSystemInstruction('en', 'lesson-123');
    expect(out).toContain('OS kernel agent');
    expect(out).toContain('lesson-123');
    expect(out).toContain('current selected lesson ID');
  });

  it('buildAgentFinalMessage appends the attached reference files section', () => {
    const attachments: AgentChatAttachment[] = [
      { name: 'notes.md', content: 'hello world' },
      { name: 'big.zip', content: 'data:application/zip;base64,AAAA' },
    ];
    const out = buildAgentFinalMessage('hi there', attachments);
    expect(out).toContain('hi there');
    expect(out).toContain('[Attached Reference Files]');
    expect(out).toContain('notes.md');
    expect(out).toContain('big.zip');
    // The base64/zip attachment is referenced rather than inlined.
    expect(out).toContain('ATTACHMENT_BASE64:1');
  });

  it('buildAgentFinalMessage without attachments returns the message unchanged', () => {
    expect(buildAgentFinalMessage('only message')).toBe('only message');
  });

  it('normalizeToolSchema lower-cases types and recurses into properties/items', () => {
    const schema = {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING' },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
    };
    const out = normalizeToolSchema(schema);
    expect(out).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
  });

  it('normalizeToolSchema passes through primitives and preserves unknown keys', () => {
    expect(normalizeToolSchema('foo')).toBe('foo');
    expect(normalizeToolSchema(null)).toBe(null);
    expect(normalizeToolSchema(42)).toBe(42);
    const out = normalizeToolSchema({ description: 'x', type: 'STRING' });
    expect(out).toEqual({ description: 'x', type: 'string' });
  });

  it('buildOpenAITools returns an array derived from the action registry', () => {
    // Uses the real kernelContainer singleton (lazy proxy) — just assert shape.
    const tools = buildOpenAITools();
    expect(Array.isArray(tools)).toBe(true);
    if (tools.length > 0) {
      expect(tools[0]).toHaveProperty('type', 'function');
      expect(tools[0].function).toHaveProperty('name');
      expect(tools[0].function).toHaveProperty('parameters');
    }
  });
});

/**
 * Network-dependent helpers are intentionally NOT exercised against real
 * services. `executeAgentToolCall`, `runGeminiAgentChat`, and
 * `runOpenAIAgentChat` all perform outbound requests (Gemini SDK / OpenAI-style
 * fetch) or mutate kernel state. Covering them properly would require overriding
 * the `kernelContainer` proxy singleton, which is out of scope for this
 * characterization test of the pure helpers. They are preserved verbatim in
 * server/ai-agent.ts and still invoked by the server via ServerContext.
 */
describe.skip('AI-agent network helpers (require live AI providers)', () => {
  it('executeAgentToolCall / runGeminiAgentChat / runOpenAIAgentChat are skipped', () => {
    // See comment above.
  });
});
