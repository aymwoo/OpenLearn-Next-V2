/**
 * Unit tests for AIService — kernel-level AI text generation.
 *
 * Covers IAIService.generateText behaviors:
 * - Throws when no provider is configured
 * - Uses DB provider when one is configured (mock fetch)
 *
 * Uses in-memory SQLite (:memory:) for test isolation.
 * All network dependencies are mocked via vi.spyOn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AIService } from '../ai-service.js';

describe('AIService', () => {
  let db: Database.Database;
  let aiService: AIService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT,
      model_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    aiService = new AIService(db);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it('generateText 应在无 provider 时抛异常', async () => {
    await expect(aiService.generateText('hello')).rejects.toThrow('未检测到可用的 AI 提供商');
  });

  it('generateText 应在 provider 存在时调用 OpenAI 兼容接口', async () => {
    // Insert a test provider into the in-memory DB
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('p1', 'test-provider', 'https://api.test.com', 'key123', 'gpt-4', Date.now(), Date.now());

    // Mock global fetch to return a fake provider response
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'provider response text' } }],
      }),
    } as Response);

    const result = await aiService.generateText('hello');
    expect(result).toBe('provider response text');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/chat/completions'),
      expect.any(Object),
    );

    fetchMock.mockRestore();
  });
});
