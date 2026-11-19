/**
 * Issue #561：插件枚举 AI 提供商的两条宿主表面。
 *
 * - inline：`buildContext` → `wrapAI`，缺 `ai:invoke` 时拒绝，有能力时透传且不含密钥。
 * - worker：`ServiceHost` Barrier 3 与真实 `AIService.listProviders`。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ServiceRegistry } from '../../di/service-registry.js';
import { ResourceTracker } from '../resource-tracker.js';
import { buildContext } from '../context-builder.js';
import { PluginCapabilityDeniedError } from '../errors.js';
import { ServiceHost } from '../../worker-runtime/service-host.js';
import { AIService } from '../../di/ai-service.js';
import { encryptApiKey } from '../../di/api-key-crypto.js';
import { closeLessonInvocation, openLessonInvocation, runWithLessonViewer } from '../../di/lesson-viewer.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
  type ICommandBusService,
  type IEventBusService,
  type IActionRegistryService,
  type ICapabilityService,
  type IProcessService,
  type IStorageService,
  type IAIService,
  type AIProviderSummary,
} from '../../di/interfaces.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';

const SECRET = 'sk-live-teacher-kb-secret';
const AI_TOKEN = '@openlearn/core:IAIService';

function createBaseServiceRegistry(aiService: IAIService) {
  const registry = new ServiceRegistry();
  const noopAsync = vi.fn().mockResolvedValue(undefined);
  registry.register(ICommandBusServiceToken, {
    execute: noopAsync,
    registerHandler: noopAsync,
    unregisterHandler: noopAsync,
    createCommand: vi.fn(),
    setInterceptor: noopAsync,
  } as unknown as ICommandBusService);
  registry.register(IEventBusServiceToken, {
    publish: noopAsync,
    subscribe: noopAsync,
    unsubscribe: noopAsync,
  } as unknown as IEventBusService);
  registry.register(IActionRegistryServiceToken, {
    register: noopAsync,
    unregister: noopAsync,
    getAllActions: vi.fn().mockReturnValue([]),
    getAgentTools: vi.fn().mockReturnValue([]),
    getActionByToolName: vi.fn(),
    getActionByCommandType: vi.fn(),
  } as unknown as IActionRegistryService);
  registry.register(ICapabilityServiceToken, {
    grant: noopAsync,
    revokeAll: noopAsync,
    check: vi.fn(async () => false),
  } as unknown as ICapabilityService);
  registry.register(IProcessServiceToken, {
    spawn: vi.fn().mockResolvedValue('p1'),
    kill: noopAsync,
    registerHandler: noopAsync,
    unregisterHandler: noopAsync,
    registerInterval: vi.fn().mockResolvedValue('i1'),
    restore: noopAsync,
  } as unknown as IProcessService);
  registry.register(IStorageServiceToken, {
    get: vi.fn().mockResolvedValue(null),
    set: noopAsync,
    delete: noopAsync,
  } as unknown as IStorageService);
  registry.register(IAIServiceToken, aiService);
  return registry;
}

function manifest(capabilitiesProposed: string[]): Manifest {
  return {
    id: 'ext-ai-list',
    name: 'AI List',
    version: '1.0.0',
    main: 'index.js',
    capabilitiesProposed,
  };
}

function seedProviders(db: Database.Database) {
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
  insert.run('shared', 'Shared', 'https://shared.example/v1', cipher, 'shared-model', 'teacher-b', 1, 3, 3);
  insert.run('mine', 'Mine', 'https://mine.example/v1', cipher, 'mine-model', 'teacher-a', 0, 2, 2);
  insert.run('other', 'Other', 'https://other.example/v1', cipher, 'other-model', 'teacher-b', 0, 1, 1);
  return cipher;
}

function assertNoSecrets(rows: AIProviderSummary[], cipher: string) {
  const encoded = JSON.stringify(rows);
  expect(encoded).not.toContain(SECRET);
  expect(encoded).not.toContain(cipher);
  expect(encoded).not.toContain('api_key');
  expect(encoded).not.toContain('apiKey');
  expect(encoded).not.toContain('sk-l****cret');
}

describe('IAIService.listProviders 宿主表面', () => {
  let db: Database.Database;
  let aiService: AIService;
  let cipher: string;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    cipher = seedProviders(db);
    aiService = new AIService(db);
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorLog.mockRestore();
    db.close();
  });

  it('inline：未声明 ai:invoke 时拒绝，且不读取提供商', async () => {
    const spy = vi.spyOn(aiService, 'listProviders');
    const ctx = await buildContext(
      createBaseServiceRegistry(aiService),
      new ResourceTracker(),
      'ext-ai-list',
      manifest(['lesson:read']),
      { prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn(), all: vi.fn() }) },
    );

    await expect(ctx.services.ai?.listProviders?.()).rejects.toBeInstanceOf(PluginCapabilityDeniedError);
    await expect(ctx.services.ai?.listProviders?.()).rejects.toThrow(/ai:invoke/);
    expect(spy).not.toHaveBeenCalled();
    expect(errorLog.mock.calls.some((call: unknown[]) => String(call[0]).includes('ai.listProviders'))).toBe(true);
  });

  it('inline：声明 ai:invoke 后返回不含密钥的元数据，并忽略伪造的 userId', async () => {
    const ctx = await buildContext(
      createBaseServiceRegistry(aiService),
      new ResourceTracker(),
      'ext-ai-list',
      manifest(['ai:invoke']),
      { prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn(), all: vi.fn() }) },
    );

    const listed = await runWithLessonViewer({ userId: 'teacher-a', role: 'teacher' }, () =>
      (ctx.services.ai?.listProviders as unknown as (forged?: string) => Promise<AIProviderSummary[]>)('teacher-b'),
    );
    expect(listed.map((row) => row.id)).toEqual(['shared', 'mine']);
    assertNoSecrets(listed, cipher);
  });

  it('worker：未声明 ai:invoke 时 Barrier 3 拒绝，且未执行到服务', async () => {
    const spy = vi.spyOn(aiService, 'listProviders');
    const transport = { postMessage: vi.fn(), onMessage: vi.fn() };
    const host = new ServiceHost(
      {
        resolve: vi.fn(async () => undefined),
        resolveByName: vi.fn(async () => aiService),
        register: vi.fn(),
      } as never,
      { check: vi.fn(() => true), grant: vi.fn(), revokeAll: vi.fn() } as never,
      'plugin:ext-ai-list',
      ['lesson:read'],
      undefined,
      undefined,
      undefined,
      undefined,
      [AI_TOKEN],
    );

    await host.handleInvoke(
      { type: 'invoke', invokeId: 'deny', token: AI_TOKEN, method: 'listProviders', args: ['teacher-b'] },
      transport as never,
    );

    const msg = transport.postMessage.mock.calls[0][0];
    expect(msg.type).toBe('error');
    expect(JSON.stringify(msg)).toContain('ai:invoke');
    expect(JSON.stringify(msg)).toContain('listProviders');
    expect(spy).not.toHaveBeenCalled();
  });

  it('worker：声明 ai:invoke 后按绑定的登录用户列出元数据，RPC 参数不能越权', async () => {
    const transport = { postMessage: vi.fn(), onMessage: vi.fn() };
    const host = new ServiceHost(
      {
        resolve: vi.fn(async () => undefined),
        resolveByName: vi.fn(async () => aiService),
        register: vi.fn(),
      } as never,
      { check: vi.fn(() => true), grant: vi.fn(), revokeAll: vi.fn() } as never,
      'plugin:ext-ai-list',
      ['ai:invoke'],
      undefined,
      undefined,
      'ext-ai-list',
      undefined,
      [AI_TOKEN],
    );
    const invocationId = openLessonInvocation({ userId: 'teacher-a', role: 'teacher' });

    try {
      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'ok',
          token: AI_TOKEN,
          method: 'listProviders',
          args: ['teacher-b'],
          invocationId,
        } as never,
        transport as never,
      );
    } finally {
      closeLessonInvocation(invocationId);
    }

    const msg = transport.postMessage.mock.calls[0][0];
    if (msg.type !== 'result') {
      throw new Error(`expected result, got: ${JSON.stringify(msg)}`);
    }
    expect(msg.value.map((row: AIProviderSummary) => row.id)).toEqual(['shared', 'mine']);
    assertNoSecrets(msg.value, cipher);
  });
});
