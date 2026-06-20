// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { EventBus } from '../../../packages/core/event-bus';
import { FrontendServiceRegistry } from '../../plugin-host/service-registry';
import { MfeServiceRegistryProxy, SocketBridge } from '../MfeContextProvider';
import { MfeEventBusWrapper } from '../MfeLoaderCore';

describe('Phase 12 DI & Context Bridging', () => {
  describe('Zustand State Sync', () => {
    it('syncs state updates between host store and subscribers', () => {
      const store = createStore((set) => ({
        val: 1,
        setVal: (val: number) => set({ val }),
      }));
      
      const states: any[] = [];
      const unsubscribe = store.subscribe((state: any) => states.push(state.val));
      
      store.getState().setVal(2);
      expect(store.getState().val).toBe(2);
      expect(states).toEqual([2]);
      unsubscribe();
    });
  });

  describe('DI Proxy Whitelisting', () => {
    it('allows whitelisted service resolution', async () => {
      const registry = new FrontendServiceRegistry();
      const mockApi = { get: vi.fn() };
      await registry.register('@openlearn/frontend:IFrontendAPI', mockApi);

      const proxy = new MfeServiceRegistryProxy(registry);
      const resolved = await proxy.resolve('@openlearn/frontend:IFrontendAPI');
      expect(resolved).toBe(mockApi);
    });

    it('denies access to non-whitelisted private services', async () => {
      const registry = new FrontendServiceRegistry();
      await registry.register('private-service', {});

      const proxy = new MfeServiceRegistryProxy(registry);
      await expect(proxy.resolve('private-service')).rejects.toThrow('Access Denied');
    });
  });

  describe('EventBus Wrapper & Socket Bridge', () => {
    it('completes event metadata and publishes locally', async () => {
      const hostBus = new EventBus();
      const mockSocket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
      const bridge = new SocketBridge(mockSocket, hostBus);
      const wrapper = new MfeEventBusWrapper('test-mfe', hostBus, bridge, mockSocket);

      const events: any[] = [];
      hostBus.subscribe('test-event', (e) => events.push(e));

      await wrapper.publish({ id: '', type: 'test-event', source: '', payload: { ok: true }, timestamp: 0 });
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe('test-mfe');
      expect(events[0].payload).toEqual({ ok: true });
    });

    it('intercepts and emits server events to WebSocket', async () => {
      const hostBus = new EventBus();
      const mockSocket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
      const bridge = new SocketBridge(mockSocket, hostBus);
      const wrapper = new MfeEventBusWrapper('test-mfe', hostBus, bridge, mockSocket);

      await wrapper.publish({ id: '1', type: 'server:test-msg', source: 'test-mfe', payload: 'hello', timestamp: 123 });
      expect(mockSocket.emit).toHaveBeenCalledWith('test-msg', 'hello');
    });

    it('bridges server subscriptions with reference-counting', () => {
      const hostBus = new EventBus();
      const mockSocket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
      const bridge = new SocketBridge(mockSocket, hostBus);
      const wrapper1 = new MfeEventBusWrapper('mfe-1', hostBus, bridge, mockSocket);
      const wrapper2 = new MfeEventBusWrapper('mfe-2', hostBus, bridge, mockSocket);

      const unsub1 = wrapper1.subscribe('server:chat', vi.fn());
      expect(mockSocket.on).toHaveBeenCalledTimes(1);

      const unsub2 = wrapper2.subscribe('server:chat', vi.fn());
      expect(mockSocket.on).toHaveBeenCalledTimes(1); // Not registered again (count = 2)

      unsub1();
      expect(mockSocket.off).not.toHaveBeenCalled(); // Not unregistered yet (count = 1)

      unsub2();
      expect(mockSocket.off).toHaveBeenCalledTimes(1); // Unregistered when count hits 0
    });
  });
});
