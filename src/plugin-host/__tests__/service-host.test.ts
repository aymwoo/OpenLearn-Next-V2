// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceHost } from '../service-host';
import { FrontendServiceRegistry } from '../service-registry';
import type { IWorkerTransport } from '../../../packages/core/worker-runtime/types';
import type { ISocketService } from '../types';

// ── Mock Transport ───────────────────────────────────────────────────────

function createMockTransport(): IWorkerTransport {
  return {
    id: 'test-transport',
    postMessage: vi.fn(),
    onMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Mock Socket Service ──────────────────────────────────────────────────

function createMockSocketService(): ISocketService {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ServiceHost', () => {
  let registry: FrontendServiceRegistry;
  let transport: IWorkerTransport;
  let host: ServiceHost;

  const TEST_ACTOR = 'plugin:test-plugin';
  const TEST_CAPS = ['test:read', 'test:write'];

  beforeEach(() => {
    registry = new FrontendServiceRegistry();
    transport = createMockTransport();
    host = new ServiceHost(registry, TEST_ACTOR, TEST_CAPS);
  });

  describe('constructor', () => {
    it('stores actorId from constructor', () => {
      expect(host.actorId).toBe(TEST_ACTOR);
    });
  });

  describe('handleInvoke', () => {
    it('resolves service and executes method, returns result', async () => {
      const mockService = {
        getData: vi.fn().mockResolvedValue({ items: [1, 2, 3] }),
      };
      await registry.register('@openlearn/frontend:IFrontendAPI', mockService);

      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'abc',
          token: '@openlearn/frontend:IFrontendAPI',
          method: 'getData',
          args: ['/api/items'],
        },
        transport,
      );

      expect(mockService.getData).toHaveBeenCalledWith('/api/items');
      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'result',
        invokeId: 'abc',
        value: { items: [1, 2, 3] },
      });
    });

    it('sends error for unknown token', async () => {
      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'xyz',
          token: '@openlearn/frontend:UnknownService',
          method: 'get',
          args: [],
        },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          invokeId: 'xyz',
        }),
      );
    });

    it('sends error for missing method on resolved service', async () => {
      await registry.register('@openlearn/frontend:IStorageService', {});

      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'def',
          token: '@openlearn/frontend:IStorageService',
          method: 'nonExistentMethod',
          args: [],
        },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          invokeId: 'def',
          message: expect.stringContaining('nonExistentMethod'),
        }),
      );
    });

    it('blocks non-get methods when manifestCapabilities is empty', async () => {
      const restrictedHost = new ServiceHost(registry, TEST_ACTOR, []);

      await registry.register('@openlearn/frontend:IStorageService', {
        set: vi.fn(),
      });

      await restrictedHost.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'ghi',
          token: '@openlearn/frontend:IStorageService',
          method: 'set',
          args: ['key', 'value'],
        },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          invokeId: 'ghi',
          message: expect.stringContaining('Capability denied'),
        }),
      );
    });

    it('allows get methods when manifestCapabilities is empty', async () => {
      const restrictedHost = new ServiceHost(registry, TEST_ACTOR, []);

      const mockService = { getData: vi.fn().mockResolvedValue('result') };
      await registry.register('@openlearn/frontend:IFrontendAPI', mockService);

      await restrictedHost.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'jkl',
          token: '@openlearn/frontend:IFrontendAPI',
          method: 'getData',
          args: [],
        },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'result',
          invokeId: 'jkl',
          value: 'result',
        }),
      );
    });

    it('serializes errors with capped stack trace', async () => {
      await registry.register('@openlearn/frontend:IFrontendAPI', {
        getData: vi.fn().mockRejectedValue(new Error('Something broke')),
      });

      await host.handleInvoke(
        {
          type: 'invoke',
          invokeId: 'mno',
          token: '@openlearn/frontend:IFrontendAPI',
          method: 'getData',
          args: [],
        },
        transport,
      );

      expect(transport.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          invokeId: 'mno',
          message: 'Something broke',
          code: 'Error',
          stack: expect.any(String),
        }),
      );
    });
  });

  describe('handleSubscribe / handleUnsubscribe', () => {
    let socketService: ISocketService;

    beforeEach(() => {
      socketService = createMockSocketService();
      host = new ServiceHost(registry, TEST_ACTOR, TEST_CAPS, socketService);
    });

    it('subscribes to socket events via handleSubscribe', async () => {
      // handleSubscribe is called via handleMessage
      await host.handleMessage(
        {
          type: 'subscribe',
          subId: 'sub1',
          eventType: 'lesson.created',
        },
        transport,
      );

      expect(socketService.on).toHaveBeenCalledWith(
        'lesson.created',
        expect.any(Function),
      );
    });

    it('forwards socket events via transport', async () => {
      await host.handleMessage(
        {
          type: 'subscribe',
          subId: 'sub1',
          eventType: 'lesson.created',
        },
        transport,
      );

      // Get the handler that was registered with socketService.on
      const forwardHandler = (socketService.on as any).mock.calls[0][1];

      // Simulate a socket event
      const eventPayload = { id: 'lesson-1', title: 'Math' };
      forwardHandler(eventPayload);

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'event',
        subId: 'sub1',
        event: expect.objectContaining({
          type: 'lesson.created',
          payload: eventPayload,
        }),
      });
    });

    it('unsubscribes from socket events via handleUnsubscribe', async () => {
      await host.handleMessage(
        {
          type: 'subscribe',
          subId: 'sub1',
          eventType: 'lesson.created',
        },
        transport,
      );

      await host.handleMessage(
        {
          type: 'unsubscribe',
          subId: 'sub1',
        },
        transport,
      );

      expect(socketService.off).toHaveBeenCalled();
    });

    it('logs warning when no socket service is available', async () => {
      const noSocketHost = new ServiceHost(registry, TEST_ACTOR, TEST_CAPS);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await noSocketHost.handleMessage(
        {
          type: 'subscribe',
          subId: 'sub1',
          eventType: 'lesson.created',
        },
        transport,
      );

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('handleMessage dispatch', () => {
    it('silently ignores activated messages', async () => {
      await host.handleMessage({ type: 'activated' }, transport);
      expect(transport.postMessage).not.toHaveBeenCalled();
    });

    it('silently ignores deactivated messages', async () => {
      await host.handleMessage({ type: 'deactivated' }, transport);
      expect(transport.postMessage).not.toHaveBeenCalled();
    });

    it('silently ignores unknown message types', async () => {
      await host.handleMessage({ type: 'unknown-type' }, transport);
      expect(transport.postMessage).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('clears all subscriptions', async () => {
      const socketService = createMockSocketService();
      host = new ServiceHost(registry, TEST_ACTOR, TEST_CAPS, socketService);

      // Create a subscription
      await host.handleMessage(
        {
          type: 'subscribe',
          subId: 'sub1',
          eventType: 'lesson.created',
        },
        transport,
      );

      expect(socketService.on).toHaveBeenCalledTimes(1);

      // Dispose
      host.dispose();

      // The cleanup function should have called socketService.off
      expect(socketService.off).toHaveBeenCalled();
    });

    it('can be called multiple times (idempotent)', () => {
      expect(() => {
        host.dispose();
        host.dispose();
        host.dispose();
      }).not.toThrow();
    });
  });
});
