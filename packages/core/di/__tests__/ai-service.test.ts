/**
 * Unit tests for AIService — kernel-level AI text generation.
 *
 * Covers IAIService.generateText behaviors:
 * - Throws when no provider and no Gemini key configured
 * - Falls back to Gemini SDK when GEMINI_API_KEY is set (mock)
 * - Prefers DB provider when one is configured (mock fetch)
 *
 * Uses in-memory SQLite (:memory:) for test isolation.
 * All network dependencies are mocked via vi.mock / vi.stubEnv.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Top-level module mock for @google/genai so it hoists correctly.
// Each test can override the default behaviour via mockGeneratorFn().
let mockGeneratorFn: () => unknown = () => {
  throw new Error('Mock not configured for this test');
};

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    public apiKey: string;
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
    get models() {
      return {
        generateContent: vi.fn().mockImplementation(() => mockGeneratorFn()),
      };
    }
  },
}));

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
    // Reset mock state between tests
    mockGeneratorFn = () => {
      throw new Error('Mock not configured for this test');
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
  });

  it('generateText 应在无 provider 且无 Gemini key 时抛异常', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(aiService.generateText('hello')).rejects.toThrow(
      /No AI providers or Gemini API key/,
    );
  });

  it('generateText 应在无 provider 但 Gemini key 存在时调用 Gemini', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    // Configure mock to return a fake Gemini response
    mockGeneratorFn = () => Promise.resolve({ text: 'Gemini response text' });

    const result = await aiService.generateText('hello');
    expect(result).toBe('Gemini response text');
  });

  it('generateText 应优先使用 DB 中的 provider', async () => {
    // Clear Gemini key so it doesn't interfere
    vi.stubEnv('GEMINI_API_KEY', '');

    // Insert a test provider into the in-memory DB
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'p1',
      'test-provider',
      'https://api.test.com',
      'key123',
      'gpt-4',
      Date.now(),
      Date.now(),
    );

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
