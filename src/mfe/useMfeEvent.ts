import { useEffect } from 'react';
import { useMfeContext } from './useMfeContext';
import type { PlatformEvent } from '../../packages/core/event-bus';

export function useMfeEvent(
  eventType: string,
  handler: (event: PlatformEvent) => void
) {
  const { infra } = useMfeContext();

  useEffect(() => {
    if (!infra.eventBus) return;
    const unsubscribe = infra.eventBus.subscribe(eventType, handler);
    return () => {
      unsubscribe();
    };
  }, [eventType, handler, infra.eventBus]);
}
