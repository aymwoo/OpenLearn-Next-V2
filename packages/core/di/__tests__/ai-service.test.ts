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
import { encryptApiKey } from '../api-key-crypto.js';
import { runWithLessonViewer } from '../lesson-viewer.js';
import type { AIProviderSummary } from '../interfaces.js';

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
    ).run('p1', 'test-provider', 'https://api.test.com', encryptApiKey('key123'), 'gpt-4', Date.now(), Date.now());

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

const SECRET = 'sk-live-teacher-kb-secret';
const PUBLIC_KEYS = ['api_url', 'created_at', 'id', 'is_shared', 'model_name', 'name', 'owner_id', 'updated_at'];

function assertPublicProvider(row: AIProviderSummary, cipher: string) {
  expect(Object.keys(row).sort()).toEqual([...PUBLIC_KEYS].sort());
  const encoded = JSON.stringify(row);
  expect(encoded).not.toContain(SECRET);
  expect(encoded).not.toContain(cipher);
  expect(encoded).not.toContain('api_key');
  expect(encoded).not.toContain('apiKey');
  expect(encoded).not.toContain('sk-l****cret');
}

describe('AIService.listProviders', () => {
  let db: Database.Database;
  let aiService: AIService;

  beforeEach(() => {
    db = new Database(':memory:');
    aiService = new AIService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('没有 ai_providers 表时返回空列表', async () => {
    await expect(aiService.listProviders()).resolves.toEqual([]);
  });

  it('升级前的库（无 owner 列）只返回元数据，且不含密钥', async () => {
    db.exec(`CREATE TABLE ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT,
      model_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const cipher = encryptApiKey(SECRET);
    db.prepare(
      'INSERT INTO ai_providers (id, name, api_url, api_key, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('p-legacy', 'Legacy', 'https://api.example.com/v1', cipher, 'demo-model', 10, 11);

    const listed = await aiService.listProviders();
    expect(listed).toEqual([
      {
        id: 'p-legacy',
        name: 'Legacy',
        api_url: 'https://api.example.com/v1',
        model_name: 'demo-model',
        owner_id: null,
        is_shared: true,
        created_at: 10,
        updated_at: 11,
      },
    ]);
    assertPublicProvider(listed[0], cipher);
  });

  it('按当前登录用户收窄，忽略调用方传入的 userId，且最多 500 条', async () => {
    db.exec(`CREATE TABLE ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT,
      model_name TEXT NOT NULL,
      owner_id TEXT,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const cipher = encryptApiKey(SECRET);
    const insert = db.prepare(
      `INSERT INTO ai_providers
        (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('shared', 'Shared', 'https://shared.example/v1', cipher, 'shared-model', 'teacher-b', 1, 30, 30);
    insert.run('mine', 'Mine', 'https://mine.example/v1', cipher, 'mine-model', 'teacher-a', 0, 20, 20);
    insert.run('other', 'Other', 'https://other.example/v1', cipher, 'other-model', 'teacher-b', 0, 10, 10);
    insert.run('preset', 'Preset', 'https://preset.example/v1', cipher, 'preset-model', null, 0, 5, 5);

    const unbound = await aiService.listProviders();
    expect(unbound.map((row) => row.id)).toEqual(['shared', 'preset']);
    expect(unbound.find((row) => row.id === 'preset')?.is_shared).toBe(true);
    for (const row of unbound) assertPublicProvider(row, cipher);

    const asTeacherA = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      (aiService.listProviders as unknown as (forgedUserId?: string) => Promise<AIProviderSummary[]>).call(
        aiService,
        'teacher-b',
      ),
    );
    expect(asTeacherA.map((row) => row.id)).toEqual(['shared', 'mine', 'preset']);
    expect(asTeacherA.find((row) => row.id === 'mine')).toMatchObject({
      owner_id: 'teacher-a',
      is_shared: false,
      model_name: 'mine-model',
    });
    expect(asTeacherA.find((row) => row.id === 'shared')?.is_shared).toBe(true);
  });

  it('与 GET /api/ai-providers 一样最多返回 500 条，且按 created_at 倒序', async () => {
    db.exec(`CREATE TABLE ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT,
      model_name TEXT NOT NULL,
      owner_id TEXT,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const cipher = encryptApiKey(SECRET);
    const insert = db.prepare(
      `INSERT INTO ai_providers
        (id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 501; i += 1) {
      insert.run(`bulk-${i}`, 'Bulk', 'https://bulk.example/v1', cipher, 'bulk-model', null, 1, i, i);
    }
    const capped = await aiService.listProviders();
    expect(capped).toHaveLength(500);
    expect(capped[0]?.id).toBe('bulk-500');
    expect(capped[499]?.id).toBe('bulk-1');
    expect(capped.some((row) => row.id === 'bulk-0')).toBe(false);
    assertPublicProvider(capped[0], cipher);
  });
});
