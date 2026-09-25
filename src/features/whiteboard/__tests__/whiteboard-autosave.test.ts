import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  WhiteboardAutoSaveManager,
  whiteboardAutoSaveRegistry,
  type SaveElementHandler,
} from '../services/whiteboard-autosave-manager';
import { frontendEventBus } from '../../../services/event-bus';

describe('WhiteboardAutoSaveManager', () => {
  let manager: WhiteboardAutoSaveManager;
  let saveMock: Mock<SaveElementHandler>;

  beforeEach(() => {
    vi.useFakeTimers();
    saveMock = vi.fn<SaveElementHandler>().mockResolvedValue(true);
    manager = new WhiteboardAutoSaveManager({
      debounceDelay: 500,
      saveHandler: saveMock,
    });
    manager.setLessonId('lesson-test-123');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should initialize with correct initial status', () => {
    expect(manager.getLessonId()).toBe('lesson-test-123');
    expect(manager.getStatus()).toBe('saved');
    expect(manager.getPendingCount()).toBe(0);
    expect(manager.getDebounceDelay()).toBe(500);
  });

  it('should queue updates and debounce multiple updates for the same element', async () => {
    manager.queueUpdate('elem-1', { x: 10, y: 20 });
    expect(manager.getStatus()).toBe('pending');
    expect(manager.getPendingCount()).toBe(1);

    // Merge another update for the same element before timeout
    manager.queueUpdate('elem-1', { x: 30, text: 'Hello' });
    expect(manager.getPendingCount()).toBe(1);
    expect(saveMock).not.toHaveBeenCalled();

    // Fast-forward past debounce delay
    await vi.advanceTimersByTimeAsync(500);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('lesson-test-123', 'elem-1', {
      x: 30,
      y: 20,
      text: 'Hello',
    });
    expect(manager.getStatus()).toBe('saved');
    expect(manager.getPendingCount()).toBe(0);
    expect(manager.getLastSavedTime()).not.toBeNull();
  });

  it('should save multiple distinct elements in a batch flush', async () => {
    manager.queueUpdate('elem-1', { x: 10 });
    manager.queueUpdate('elem-2', { color: 'blue' });
    expect(manager.getPendingCount()).toBe(2);

    await vi.advanceTimersByTimeAsync(500);

    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenCalledWith('lesson-test-123', 'elem-1', { x: 10 });
    expect(saveMock).toHaveBeenCalledWith('lesson-test-123', 'elem-2', { color: 'blue' });
    expect(manager.getPendingCount()).toBe(0);
    expect(manager.getStatus()).toBe('saved');
  });

  it('should allow immediate flush without waiting for debounce timer', async () => {
    manager.queueUpdate('elem-1', { width: 100 });
    expect(saveMock).not.toHaveBeenCalled();

    const success = await manager.flush();
    expect(success).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(manager.getPendingCount()).toBe(0);
    expect(manager.getStatus()).toBe('saved');
  });

  it('should notify registered listeners when status or pending count changes', async () => {
    const listenerMock = vi.fn();
    const unsubscribe = manager.registerListener(listenerMock);

    // Should receive initial notification
    expect(listenerMock).toHaveBeenCalledWith('saved', expect.objectContaining({ count: 0 }));

    manager.queueUpdate('elem-1', { opacity: 0.5 });
    expect(listenerMock).toHaveBeenCalledWith('pending', expect.objectContaining({ count: 1 }));

    await vi.advanceTimersByTimeAsync(500);
    expect(listenerMock).toHaveBeenCalledWith('saving', expect.objectContaining({ count: 1 }));
    expect(listenerMock).toHaveBeenCalledWith('saved', expect.objectContaining({ count: 0 }));

    unsubscribe();
    manager.queueUpdate('elem-2', { text: 'test' });
    // After unsubscribe, listener should not receive more updates
    const callCount = listenerMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(listenerMock.mock.calls.length).toBe(callCount);
  });

  it('should support plugin interceptors to cancel save if conditions are not met', async () => {
    const interceptor = vi.fn().mockReturnValue(false); // cancel save
    const unregisterInterceptor = manager.registerInterceptor(interceptor);

    manager.queueUpdate('elem-1', { text: 'blocked' });
    const success = await manager.flush();

    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(success).toBe(false);
    expect(saveMock).not.toHaveBeenCalled();
    expect(manager.getPendingCount()).toBe(1);

    unregisterInterceptor();
    // Flush again after unregistering interceptor
    const nextSuccess = await manager.flush();
    expect(nextSuccess).toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(manager.getPendingCount()).toBe(0);
  });

  it('should handle save handler failures and set status to error', async () => {
    saveMock.mockResolvedValueOnce(false);

    manager.queueUpdate('elem-1', { text: 'fail-elem' });
    const success = await manager.flush();

    expect(success).toBe(false);
    expect(manager.getStatus()).toBe('error');
    expect(manager.getLastError()).not.toBeNull();
    // Element should remain pending for retry
    expect(manager.getPendingCount()).toBe(1);

    // Next retry succeeds
    saveMock.mockResolvedValueOnce(true);
    const retrySuccess = await manager.flush();
    expect(retrySuccess).toBe(true);
    expect(manager.getStatus()).toBe('saved');
    expect(manager.getPendingCount()).toBe(0);
  });

  it('should broadcast lifecycle events via frontendEventBus', async () => {
    const publishedEvents: any[] = [];
    const unsub1 = frontendEventBus.subscribe('whiteboard.autosave.pending', (event) => {
      publishedEvents.push(event);
    });
    const unsub2 = frontendEventBus.subscribe('whiteboard.autosave.saving', (event) => {
      publishedEvents.push(event);
    });
    const unsub3 = frontendEventBus.subscribe('whiteboard.autosave.saved', (event) => {
      publishedEvents.push(event);
    });

    manager.queueUpdate('elem-1', { x: 50 });
    await vi.advanceTimersByTimeAsync(500);

    unsub1();
    unsub2();
    unsub3();

    const eventTypes = publishedEvents.map((e) => e.type);
    expect(eventTypes).toContain('whiteboard.autosave.pending');
    expect(eventTypes).toContain('whiteboard.autosave.saving');
    expect(eventTypes).toContain('whiteboard.autosave.saved');
  });

  it('should clear queue on cancel()', () => {
    manager.queueUpdate('elem-1', { x: 99 });
    expect(manager.getPendingCount()).toBe(1);
    expect(manager.getStatus()).toBe('pending');

    manager.cancel();
    expect(manager.getPendingCount()).toBe(0);
    expect(manager.getStatus()).toBe('saved');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('should verify global singleton whiteboardAutoSaveRegistry operates correctly', () => {
    expect(whiteboardAutoSaveRegistry).toBeInstanceOf(WhiteboardAutoSaveManager);
    whiteboardAutoSaveRegistry.setLessonId('global-lesson-test');
    expect(whiteboardAutoSaveRegistry.getLessonId()).toBe('global-lesson-test');
    whiteboardAutoSaveRegistry.cancel();
  });
});
