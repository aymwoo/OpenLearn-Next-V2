// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserWorkerTransport } from '../../../packages/core/worker-runtime/transport';
import { WorkerTransportError } from '../../../packages/core/worker-runtime/errors';

// ── Mock Worker ──────────────────────────────────────────────────────────

/**
 * A minimal mock Worker class for testing BrowserWorkerTransport.
 *
 * Since vitest runs in `node` environment (no real Web Worker API),
 * we create a mock that mimics the Web Worker interface:
 * - postMessage() stores the message for verification
 * - onmessage can be set as a callback
 * - terminate() marks the worker as terminated
 * - onerror can be set as a callback
 */
class MockWorker {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public postedMessages: unknown[] = [];
  public terminated = false;

  postMessage(msg: unknown): void {
    this.postedMessages.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  /**
   * Simulate receiving a message from the Worker.
   * Calls the registered onmessage handler.
   */
  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  /**
   * Simulate a Worker error.
   * Calls the registered onerror handler.
   */
  simulateError(error: Error): void {
    if (this.onerror) {
      this.onerror({ error, message: error.message } as ErrorEvent);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('BrowserWorkerTransport', () => {
  let mockWorker: MockWorker;
  let transport: BrowserWorkerTransport;

  beforeEach(() => {
    mockWorker = new MockWorker();
    transport = new BrowserWorkerTransport(mockWorker as unknown as Worker);
  });

  describe('constructor', () => {
    it('generates a unique id with browser-worker prefix', () => {
      expect(transport.id).toMatch(/^browser-worker:\d+$/);
    });

    it('sets up worker.onmessage to route to registered handler', () => {
      expect(mockWorker.onmessage).toBeInstanceOf(Function);
    });

    it('sets up worker.onerror to log errors', () => {
      expect(mockWorker.onerror).toBeInstanceOf(Function);
    });
  });

  describe('postMessage', () => {
    it('delegates to worker.postMessage', () => {
      const msg = { type: 'invoke', invokeId: '123' };
      transport.postMessage(msg);
      expect(mockWorker.postedMessages).toHaveLength(1);
      expect(mockWorker.postedMessages[0]).toBe(msg);
    });

    it('throws WorkerTransportError on postMessage failure', () => {
      const failingWorker = {
        postMessage: () => {
          throw new Error('Worker terminated');
        },
      } as unknown as Worker;
      const failingTransport = new BrowserWorkerTransport(failingWorker);

      expect(() => failingTransport.postMessage({})).toThrow(WorkerTransportError);
    });
  });

  describe('onMessage', () => {
    it('registers a message handler', () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      mockWorker.simulateMessage({ type: 'activated' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ type: 'activated' });
    });

    it('replaces previous handler when called again', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      transport.onMessage(handler1);
      transport.onMessage(handler2);

      mockWorker.simulateMessage({ type: 'result' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('does not call handler when no handler is registered', () => {
      mockWorker.simulateMessage({ type: 'activated' });
      // Should not throw
    });
  });

  describe('terminate', () => {
    it('calls worker.terminate()', async () => {
      await transport.terminate();
      expect(mockWorker.terminated).toBe(true);
    });

    it('returns a Promise that resolves', async () => {
      await expect(transport.terminate()).resolves.toBeUndefined();
    });
  });

  describe('bidirectional communication', () => {
    it('supports round-trip message flow', () => {
      const handler = vi.fn();
      transport.onMessage(handler);

      // Worker sends to main
      transport.postMessage({ type: 'invoke', invokeId: 'abc', token: 'test', method: 'get', args: [] });
      expect(mockWorker.postedMessages).toHaveLength(1);
      expect(mockWorker.postedMessages[0]).toMatchObject({
        type: 'invoke',
        invokeId: 'abc',
        token: 'test',
      });

      // Main sends back to Worker
      mockWorker.simulateMessage({ type: 'result', invokeId: 'abc', value: 42 });
      expect(handler).toHaveBeenCalledWith({ type: 'result', invokeId: 'abc', value: 42 });
    });
  });
});
