/**
 * ServiceHost 运行时能力判定 —— 必须以**管理员已审批（已授予）**的能力为准，
 * 而不是插件清单里自声明的能力（Issue #224）。
 *
 * 背景：
 * - 审批侧 `packages/core/plugin-host/lifecycle.ts` 的 `grantCapabilities` 只把
 *   「管理员已批准」的能力写入 CapabilityGuard 的授予表；未批准的不授予。
 * - 运行时侧 `packages/core/worker-runtime/service-host.ts` 此前直接用
 *   `manifestCapabilities`（插件自声明值）做判定 —— 审批对 worker 插件形同虚设。
 *
 * 本测试用**真实** CapabilityGuard 构造场景：
 * - 声明了但未审批 → 能力不生效（调用被拒）
 * - 已审批 → 能力生效（调用放行）
 * - 一项都没批 → 降级为只读（Barrier 2）
 */

import { describe, it, expect, vi } from 'vitest';
import { ServiceHost } from '../service-host.js';
import { CapabilityGuard } from '../../capability/guard/capability-guard.js';
import type { IWorkerTransport, InvokeMessage } from '../types.js';
import type { ServiceRegistry } from '../../di/service-registry.js';

// ── 测试脚手架 ───────────────────────────────────────────────────────────────

/** transport 收到的消息 —— 只声明断言用得到的字段，其余键放行。 */
interface MockWorkerMessage {
  type?: string;
  code?: string;
  message?: string;
  value?: unknown;
  [key: string]: unknown;
}

interface MockTransport extends IWorkerTransport {
  messages: MockWorkerMessage[];
}

function createMockTransport(): MockTransport {
  const messages: MockWorkerMessage[] = [];
  return {
    messages,
    postMessage: vi.fn((msg: unknown) => {
      messages.push(msg as MockWorkerMessage);
    }),
    onMessage: vi.fn(),
    terminate: vi.fn(async () => {}),
    id: 'mock-host',
  };
}

function createMockServiceRegistry(services: Record<string, unknown>): ServiceRegistry {
  return {
    resolveByName: vi.fn(async (name: string) => {
      const svc = services[name];
      if (!svc) throw new Error(`No provider for ${name}`);
      return svc;
    }),
    resolve: vi.fn(async () => {
      throw new Error('resolve() not expected — use resolveByName');
    }),
  } as unknown as ServiceRegistry;
}

const PROCESS_TOKEN = '@openlearn/core:IProcessService';
const STORAGE_TOKEN = 'test:Service';

/**
 * 构造一个 ServiceHost：manifest 自声明 `declared`，CapabilityGuard 授予表里只有 `granted`。
 */
function createHost(opts: {
  declared: string[];
  granted: string[];
  actorId?: string;
  services: Record<string, unknown>;
  allowedTokens: string[];
}) {
  const guard = new CapabilityGuard();
  for (const cap of opts.granted) {
    guard.grant(opts.actorId ?? 'plugin:test', cap);
  }
  const transport = createMockTransport();
  const host = new ServiceHost(
    createMockServiceRegistry(opts.services),
    guard,
    opts.actorId ?? 'plugin:test',
    opts.declared,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.allowedTokens,
  );
  return { host, transport };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('ServiceHost 运行时能力以已审批集合为准（Issue #224）', () => {
  it('声明了但管理员未审批的能力不生效 —— 注册后台任务被拒', async () => {
    const registerHandler = vi.fn(async () => ({ ok: true }));
    const { host, transport } = createHost({
      // 插件自声明了 task:register
      declared: ['task:register', 'test:cap'],
      // 但管理员只批了 test:cap
      granted: ['test:cap'],
      services: { [PROCESS_TOKEN]: { registerHandler } },
      allowedTokens: [PROCESS_TOKEN],
    });

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-1',
        token: PROCESS_TOKEN,
        method: 'registerHandler',
        args: [{ id: 'x' }],
      } as InvokeMessage,
      transport,
    );

    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('WorkerCapabilityError');
    expect(msg.message).toContain('task:register');
    expect(registerHandler).not.toHaveBeenCalled();
  });

  it('已审批的能力生效 —— 注册后台任务放行', async () => {
    const registerHandler = vi.fn(async () => ({ ok: true }));
    const { host, transport } = createHost({
      declared: ['task:register', 'test:cap'],
      granted: ['task:register', 'test:cap'],
      services: { [PROCESS_TOKEN]: { registerHandler } },
      allowedTokens: [PROCESS_TOKEN],
    });

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-2',
        token: PROCESS_TOKEN,
        method: 'registerHandler',
        args: [{ id: 'x' }],
      } as InvokeMessage,
      transport,
    );

    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0].type).toBe('result');
    expect(registerHandler).toHaveBeenCalled();
  });

  it('一项都没审批 —— 降级为只读（非 get 方法被拒）', async () => {
    const set = vi.fn(async () => 'written');
    const { host, transport } = createHost({
      declared: ['test:cap'],
      granted: [],
      services: { [STORAGE_TOKEN]: { get: vi.fn(async () => 'v'), set } },
      allowedTokens: [STORAGE_TOKEN],
    });

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-3',
        token: STORAGE_TOKEN,
        method: 'set',
        args: ['k', 'v'],
      } as InvokeMessage,
      transport,
    );

    expect(transport.messages).toHaveLength(1);
    const msg = transport.messages[0];
    expect(msg.type).toBe('error');
    expect(msg.code).toBe('WorkerCapabilityError');
    expect(msg.message).toContain('no granted capability');
    expect(set).not.toHaveBeenCalled();
  });

  it('一项都没审批 —— 只读方法仍放行', async () => {
    const get = vi.fn(async () => 'read-value');
    const { host, transport } = createHost({
      declared: ['test:cap'],
      granted: [],
      services: { [STORAGE_TOKEN]: { get } },
      allowedTokens: [STORAGE_TOKEN],
    });

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-4',
        token: STORAGE_TOKEN,
        method: 'get',
        args: ['k'],
      } as InvokeMessage,
      transport,
    );

    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0].type).toBe('result');
    expect(transport.messages[0].value).toBe('read-value');
  });

  it('授予表是唯一真源 —— 换一个 actor 不共享授予', async () => {
    const registerHandler = vi.fn(async () => ({ ok: true }));
    const { host, transport } = createHost({
      actorId: 'plugin:other',
      declared: ['task:register'],
      // 授予给的是 plugin:test，不是 plugin:other
      granted: [],
      services: { [PROCESS_TOKEN]: { registerHandler } },
      allowedTokens: [PROCESS_TOKEN],
    });

    await host.handleInvoke(
      {
        type: 'invoke',
        invokeId: 'inv-5',
        token: PROCESS_TOKEN,
        method: 'registerHandler',
        args: [{ id: 'x' }],
      } as InvokeMessage,
      transport,
    );

    expect(transport.messages[0].type).toBe('error');
    expect(registerHandler).not.toHaveBeenCalled();
  });
});
