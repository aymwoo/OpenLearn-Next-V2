import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useEventBus, useCustomEvent, useEventPublish } from '../useEventBus';
import { frontendEventBus } from '../../services/event-bus';

describe('useEventBus hooks', () => {
  beforeEach(() => {
    frontendEventBus.clear();
  });

  describe('useEventBus', () => {
    it('subscribes on mount and receives events', async () => {
      const handler = vi.fn();

      renderHook(() => useEventBus('rollcall.picked', handler));

      expect(frontendEventBus.listenerCount('rollcall.picked')).toBe(1);

      await act(async () => {
        await frontendEventBus.emit('rollcall.picked', { studentId: 's1', studentName: 'Bob' });
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        { studentId: 's1', studentName: 'Bob' },
        expect.objectContaining({ type: 'rollcall.picked' }),
      );
    });

    it('unsubscribes automatically on unmount to prevent memory leaks', () => {
      const handler = vi.fn();
      const { unmount } = renderHook(() => useEventBus('whiteboard.element_created', handler));

      expect(frontendEventBus.listenerCount('whiteboard.element_created')).toBe(1);

      unmount();

      expect(frontendEventBus.listenerCount('whiteboard.element_created')).toBe(0);
    });

    it('invokes the latest handler closure without resubscribing on re-render', async () => {
      const callLog: number[] = [];

      const { rerender } = renderHook(
        ({ count }) => {
          useEventBus('whiteboard.page_changed', (payload) => {
            callLog.push(count + payload.pageIndex);
          });
        },
        { initialProps: { count: 10 } },
      );

      expect(frontendEventBus.listenerCount('whiteboard.page_changed')).toBe(1);

      // Re-render with new props
      rerender({ count: 20 });

      // Subscription should remain 1 (no re-subscribe loop)
      expect(frontendEventBus.listenerCount('whiteboard.page_changed')).toBe(1);

      await act(async () => {
        await frontendEventBus.emit('whiteboard.page_changed', { pageIndex: 5 });
      });

      // Should have used the latest count (20 + 5 = 25)
      expect(callLog).toEqual([25]);
    });
  });

  describe('useCustomEvent', () => {
    it('subscribes to DOM custom events and unpacks detail', () => {
      const handler = vi.fn();

      renderHook(() => useCustomEvent('openlearn:countdown:paused' as any, handler));

      const payload = {
        lessonId: 'L1',
        timeRemaining: 120,
        totalDuration: 300,
        isRunning: false,
        isPaused: true,
        label: 'Quiz',
        endsAt: null,
        updatedAt: Date.now(),
      };

      act(() => {
        window.dispatchEvent(
          new CustomEvent('openlearn:countdown:paused', {
            detail: payload,
          }),
        );
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual(payload);
    });

    it('cleans up DOM event listener on unmount', () => {
      const handler = vi.fn();
      const { unmount } = renderHook(() => useCustomEvent('openlearn:student_quick_actions:open' as any, handler));

      unmount();

      act(() => {
        window.dispatchEvent(new CustomEvent('openlearn:student_quick_actions:open'));
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('useEventPublish', () => {
    it('dispatches typed events and custom events correctly', async () => {
      const busHandler = vi.fn();
      const domHandler = vi.fn();

      frontendEventBus.subscribe('whiteboard.element_deleted', busHandler);
      window.addEventListener('openlearn:student_quick_actions:collapse', domHandler);

      const { result } = renderHook(() => useEventPublish());

      await act(async () => {
        await result.current.emit('whiteboard.element_deleted', { elementId: 'elem-99' });
        result.current.dispatchCustomEvent('openlearn:student_quick_actions:collapse' as any, undefined as any);
      });

      expect(busHandler).toHaveBeenCalledTimes(1);
      expect(busHandler.mock.calls[0][0].payload).toEqual({ elementId: 'elem-99' });

      expect(domHandler).toHaveBeenCalledTimes(1);

      window.removeEventListener('openlearn:student_quick_actions:collapse', domHandler);
    });
  });
});
