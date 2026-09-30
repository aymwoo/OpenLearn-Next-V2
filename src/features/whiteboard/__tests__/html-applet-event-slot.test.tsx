import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { whiteboardEventSlot } from '../events/WhiteboardEventSlot';
import { useWhiteboardEvents } from '../events/useWhiteboardEvents';

afterEach(() => cleanup());

function HookProbe({ filter }: { filter: { types?: string[] } }) {
  const events = useWhiteboardEvents(filter, { replay: 0, maxItems: 10 });
  return (
    <ul data-testid="probe">
      {events.map((e) => (
        <li key={e.id} data-testid={`probe-item-${e.payload.value}`}>
          {String(e.payload.value)}
        </li>
      ))}
    </ul>
  );
}

describe('useWhiteboardEvents hook', () => {
  it('appends new events to state on ingest', () => {
    const { getByTestId } = render(<HookProbe filter={{ types: ['x'] }} />);
    act(() => {
      whiteboardEventSlot.ingest({
        source: 'manual',
        type: 'x',
        payload: { value: 'a' },
      });
    });
    expect(getByTestId('probe-item-a')).toBeTruthy();
    act(() => {
      whiteboardEventSlot.ingest({
        source: 'manual',
        type: 'x',
        payload: { value: 'b' },
      });
    });
    expect(getByTestId('probe-item-b')).toBeTruthy();
  });

  it('replays existing matching events on mount when replay is enabled', () => {
    whiteboardEventSlot.ingest({
      source: 'manual',
      type: 'y',
      payload: { value: 'pre' },
    });
    function MountReplayProbe() {
      const events = useWhiteboardEvents({ types: ['y'] }, { replay: 1, maxItems: 10 });
      return (
        <ul data-testid="mount-probe">
          {events.map((e) => (
            <li key={e.id} data-testid={`mount-item-${e.payload.value}`}>
              {String(e.payload.value)}
            </li>
          ))}
        </ul>
      );
    }
    const { getByTestId } = render(<MountReplayProbe />);
    expect(getByTestId('mount-item-pre')).toBeTruthy();
  });

  it('replay option pulls historical events', async () => {
    whiteboardEventSlot.ingest({
      source: 'manual',
      type: 'z',
      payload: { value: 'h1' },
    });
    whiteboardEventSlot.ingest({
      source: 'manual',
      type: 'z',
      payload: { value: 'h2' },
    });

    function ReplayProbe() {
      const events = useWhiteboardEvents({ types: ['z'] }, { replay: 5, maxItems: 10 });
      return (
        <ul data-testid="replay-probe">
          {events.map((e) => (
            <li key={e.id}>{String(e.payload.value)}</li>
          ))}
        </ul>
      );
    }

    const { findByText } = render(<ReplayProbe />);
    expect(await findByText('h1')).toBeTruthy();
    expect(await findByText('h2')).toBeTruthy();
  });

  it('respects maxItems ring truncation', () => {
    function TruncatedProbe() {
      const events = useWhiteboardEvents({ types: ['t'] }, { replay: 0, maxItems: 3 });
      return <div data-testid="count">{events.length}</div>;
    }
    const { getByTestId } = render(<TruncatedProbe />);
    act(() => {
      for (let i = 0; i < 8; i++) {
        whiteboardEventSlot.ingest({
          source: 'manual',
          type: 't',
          payload: { value: i },
        });
      }
    });
    expect(getByTestId('count').textContent).toBe('3');
  });

  it('handles unsubscribe on unmount without throwing and cleans up subscription', () => {
    let receivedEventsCount = 0;
    function Probe() {
      const events = useWhiteboardEvents({ types: ['um'] }, { replay: 0 });
      receivedEventsCount = events.length;
      return null;
    }
    const { unmount } = render(<Probe />);
    expect(receivedEventsCount).toBe(0);

    act(() => {
      whiteboardEventSlot.ingest({ source: 'manual', type: 'um', payload: { val: 1 } });
    });
    expect(receivedEventsCount).toBe(1);

    unmount();

    expect(() => {
      act(() => {
        whiteboardEventSlot.ingest({ source: 'manual', type: 'um', payload: { val: 2 } });
      });
    }).not.toThrow();
    // After unmount, the unmounted component's state is not updated
    expect(receivedEventsCount).toBe(1);
  });
});
