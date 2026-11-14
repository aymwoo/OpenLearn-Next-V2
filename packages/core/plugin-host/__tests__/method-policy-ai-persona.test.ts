import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ServiceRegistry } from '../../di/service-registry.js';
import { ResourceTracker } from '../resource-tracker.js';
import { buildContext } from '../context-builder.js';
import { checkMethodPolicy, CAP_AI_PERSONA } from '../method-policy.js';
import { PluginCapabilityDeniedError } from '../errors.js';
import { ServiceHost } from '../../worker-runtime/service-host.js';
import { CapabilityGuard } from '../../capability/index.js';
import { PluginHost } from '../index.js';
import { EsmLoader } from '../../esm-loader/esm-loader.js';
import { createPluginsDir, cleanupPluginsDir } from './helpers/plugins-dir.js';
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
} from '../../di/interfaces.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';

function createBaseServiceRegistry(aiServiceMock: Record<string, unknown>) {
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
  const capGrants = new Map<string, Set<string>>();
  registry.register(ICapabilityServiceToken, {
    grant: vi.fn(async (actorId: string, cap: string) => {
      if (!capGrants.has(actorId)) capGrants.set(actorId, new Set());
      capGrants.get(actorId)!.add(cap);
    }),
    revokeAll: vi.fn(async (actorId: string) => {
      capGrants.delete(actorId);
    }),
    check: vi.fn(async (actorId: string, cap: string) => capGrants.get(actorId)?.has(cap) ?? false),
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
  registry.register(IAIServiceToken, aiServiceMock as unknown as IAIService);
  return registry;
}

describe('IKVA8R · ai:persona 能力门禁与双向生命周期清理', () => {
  const CORE = {
    storageService: '@openlearn/core:IStorageService',
    aiService: '@openlearn/core:IAIService',
    processService: '@openlearn/core:IProcessService',
    actionRegistry: '@openlearn/core:IActionRegistryService',
  } as const;

  let aiServiceMock: {
    generateText: ReturnType<typeof vi.fn>;
    registerAIPersona: ReturnType<typeof vi.fn>;
    unregisterAIPersona: ReturnType<typeof vi.fn>;
    listAIPersonas: ReturnType<typeof vi.fn>;
    registerAIContextProvider: ReturnType<typeof vi.fn>;
    unregisterAIContextProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    aiServiceMock = {
      generateText: vi.fn().mockResolvedValue('ok'),
      registerAIPersona: vi.fn(),
      unregisterAIPersona: vi.fn(),
      listAIPersonas: vi.fn().mockReturnValue([]),
      registerAIContextProvider: vi.fn(),
      unregisterAIContextProvider: vi.fn(),
    };
  });

  it('checkMethodPolicy: registerAIPersona 与 registerAIContextProvider 需要 ai:persona 能力（fail-closed）', () => {
    expect(
      checkMethodPolicy({ token: CORE.aiService, method: 'registerAIPersona', args: [], caps: [], tokens: CORE }),
    ).toContain(CAP_AI_PERSONA);
    expect(
      checkMethodPolicy({
        token: CORE.aiService,
        method: 'registerAIContextProvider',
        args: [],
        caps: ['ai:invoke'],
        tokens: CORE,
      }),
    ).toContain(CAP_AI_PERSONA);

    expect(
      checkMethodPolicy({
        token: CORE.aiService,
        method: 'registerAIPersona',
        args: [],
        caps: [CAP_AI_PERSONA],
        tokens: CORE,
      }),
    ).toBeNull();
    expect(
      checkMethodPolicy({
        token: CORE.aiService,
        method: 'registerAIContextProvider',
        args: [],
        caps: [CAP_AI_PERSONA],
        tokens: CORE,
      }),
    ).toBeNull();
  });

  it('Inline buildContext(wrapAI): 未声明 ai:persona 时拒绝 registerAIPersona 与 registerAIContextProvider', async () => {
    const registry = createBaseServiceRegistry(aiServiceMock);
    const tracker = new ResourceTracker();
    const manifest: Manifest = {
      id: 'ext-no-cap',
      name: 'No Cap',
      version: '1.0.0',
      main: 'index.js',
      capabilitiesProposed: ['lesson:read'],
    };
    const db = { prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn() }) };
    const ctx = await buildContext(registry, tracker, 'ext-no-cap', manifest, db);

    expect(() =>
      ctx.services.ai?.registerAIPersona?.({
        id: 'blocked_persona',
        nameZh: '被拒角色',
        nameEn: 'Blocked',
        instructionZh: 'x',
        instructionEn: 'x',
      }),
    ).toThrow(PluginCapabilityDeniedError);

    expect(() => ctx.services.ai?.registerAIContextProvider?.('blocked_ctx', () => 'slice')).toThrow(
      PluginCapabilityDeniedError,
    );
    expect(aiServiceMock.registerAIPersona).not.toHaveBeenCalled();
    expect(aiServiceMock.registerAIContextProvider).not.toHaveBeenCalled();
  });

  it('Inline buildContext(wrapAI): 声明 ai:persona 后允许注册并在 disposeAll 时自动注销', async () => {
    const registry = createBaseServiceRegistry(aiServiceMock);
    const tracker = new ResourceTracker();
    const manifest: Manifest = {
      id: 'ext-with-cap',
      name: 'With Cap',
      version: '1.0.0',
      main: 'index.js',
      capabilitiesProposed: [CAP_AI_PERSONA],
    };
    const db = { prepare: vi.fn().mockReturnValue({ get: vi.fn(), run: vi.fn() }) };
    const ctx = await buildContext(registry, tracker, 'ext-with-cap', manifest, db);

    ctx.services.ai?.registerAIPersona?.({
      id: 'allowed_persona',
      nameZh: '允许角色',
      nameEn: 'Allowed',
      instructionZh: '系统指令',
      instructionEn: 'System instruction',
      mode: 'replace',
      basePolicy: 'drop',
    });
    ctx.services.ai?.registerAIContextProvider?.('allowed_ctx', () => 'context slice');

    expect(aiServiceMock.registerAIPersona).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'allowed_persona', registeredBy: 'ext-with-cap', mode: 'replace' }),
    );
    expect(aiServiceMock.registerAIContextProvider).toHaveBeenCalledWith(
      'allowed_ctx',
      expect.any(Function),
      'ext-with-cap',
    );

    tracker.disposeAll('ext-with-cap');
    expect(aiServiceMock.unregisterAIPersona).toHaveBeenCalledWith('allowed_persona', 'ext-with-cap');
    expect(aiServiceMock.unregisterAIContextProvider).toHaveBeenCalledWith('allowed_ctx', 'ext-with-cap');
  });

  it('Worker ServiceHost: 缺 ai:persona 时拒绝 RPC；授权后强制注入 registeredBy 并在 dispose() 自动注销', async () => {
    const registry = createBaseServiceRegistry(aiServiceMock);
    const capGuard = new CapabilityGuard();
    capGuard.grant('plugin:ext-worker-cap', 'lesson:read');

    const postMessage = vi.fn();
    const fakeTransport = {
      postMessage,
      onMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Parameters<ServiceHost['handleInvoke']>[1];

    const deniedHost = new ServiceHost(
      registry,
      capGuard,
      'plugin:ext-worker-cap',
      ['lesson:read'],
      undefined,
      undefined,
      'ext-worker-cap',
      'ext-worker-cap',
      ['@openlearn/core:IAIService'],
    );

    await deniedHost.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-1',
        token: '@openlearn/core:IAIService',
        method: 'registerAIPersona',
        args: [{ id: 'w1', nameZh: 'W1', nameEn: 'W1', instructionZh: 'x', instructionEn: 'x' }],
      },
      fakeTransport,
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        invokeId: 'inv-1',
        message: expect.stringContaining(CAP_AI_PERSONA),
      }),
    );
    expect(aiServiceMock.registerAIPersona).not.toHaveBeenCalled();

    // 授予 ai:persona 后应成功并被篡改/强绑定 registeredBy，且 dispose 时自动清理
    postMessage.mockClear();
    capGuard.grant('plugin:ext-worker-cap', CAP_AI_PERSONA);
    deniedHost.setManifestCapabilities(['lesson:read', CAP_AI_PERSONA]);

    await deniedHost.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-2',
        token: '@openlearn/core:IAIService',
        method: 'registerAIPersona',
        args: [
          {
            id: 'worker_persona',
            nameZh: 'Worker 角色',
            nameEn: 'Worker Persona',
            instructionZh: '指令',
            instructionEn: 'Instruction',
            registeredBy: 'spoofed-plugin',
          },
        ],
      },
      fakeTransport,
    );
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', invokeId: 'inv-2' }));
    expect(aiServiceMock.registerAIPersona).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'worker_persona', registeredBy: 'ext-worker-cap' }),
    );

    await deniedHost.dispose();
    expect(aiServiceMock.unregisterAIPersona).toHaveBeenCalledWith('worker_persona', 'ext-worker-cap');
  });

  it('PluginHost 声明式 contributes["ai.persona.provider"]: 需 ai:persona 能力门禁且停用时回收', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY, name TEXT, manifest TEXT, source_code TEXT, file_path TEXT,
        status TEXT, created_at INTEGER, loader_version TEXT, zip_package BLOB,
        version TEXT, execution_mode TEXT DEFAULT 'inline'
      );
      CREATE TABLE IF NOT EXISTS plugin_capability_grants (
        plugin_id TEXT NOT NULL, capability TEXT NOT NULL, approved_at INTEGER, PRIMARY KEY (plugin_id, capability)
      );
    `);

    const pluginsDir = createPluginsDir('ai-persona-declarative');
    const registry = createBaseServiceRegistry(aiServiceMock);
    const host = new PluginHost(
      registry,
      new (class extends EsmLoader {
        async load(): Promise<never> {
          throw new Error('unused');
        }
      })(),
      db,
      pluginsDir,
    );

    const manifestNoCap: Manifest = {
      id: '@openlearn/test-decl-nocap',
      name: 'Decl No Cap',
      version: '1.0.0',
      main: 'index.js',
      contributes: {
        'ai.persona.provider': [
          {
            id: 'decl_blocked',
            nameZh: '未授权声明角色',
            nameEn: 'Unauthorized Decl Persona',
            instructionZh: '不应生效',
            instructionEn: 'Should not register',
          },
        ],
      },
    };
    host.registerPreloadedPlugin('@openlearn/test-decl-nocap', {
      manifest: manifestNoCap,
      activate: async () => {},
    });
    await host.activatePlugin('@openlearn/test-decl-nocap');
    expect(aiServiceMock.registerAIPersona).not.toHaveBeenCalled();

    const manifestWithCap: Manifest = {
      id: '@openlearn/test-decl-cap',
      name: 'Decl With Cap',
      version: '1.0.0',
      main: 'index.js',
      capabilitiesProposed: [CAP_AI_PERSONA],
      contributes: {
        'ai.persona.provider': [
          {
            id: 'decl_allowed',
            nameZh: '声明式角色',
            nameEn: 'Declarative Persona',
            instructionZh: '已授权生效',
            instructionEn: 'Registered declaratively',
            mode: 'replace',
            basePolicy: 'drop',
          },
        ],
      },
    };
    host.registerPreloadedPlugin('@openlearn/test-decl-cap', {
      manifest: manifestWithCap,
      activate: async () => {},
    });
    await host.activatePlugin('@openlearn/test-decl-cap');
    expect(aiServiceMock.registerAIPersona).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'decl_allowed', registeredBy: '@openlearn/test-decl-cap' }),
    );

    await host.deactivatePlugin('@openlearn/test-decl-cap');
    expect(aiServiceMock.unregisterAIPersona).toHaveBeenCalledWith('decl_allowed', '@openlearn/test-decl-cap');

    cleanupPluginsDir(pluginsDir);
    db.close();
  });
});
