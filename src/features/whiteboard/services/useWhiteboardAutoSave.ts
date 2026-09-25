import { useEffect, useState, useCallback, useRef } from 'react';
import {
  whiteboardAutoSaveRegistry,
  AutoSaveStatus,
  SaveElementHandler,
} from './whiteboard-autosave-manager';

export interface UseWhiteboardAutoSaveOptions {
  lessonId: string | null;
  onSaveToServer: SaveElementHandler;
  debounceDelay?: number;
  onStatusChange?: (status: AutoSaveStatus, lastSavedTime: Date | null) => void;
}

export function useWhiteboardAutoSave({
  lessonId,
  onSaveToServer,
  debounceDelay = 800,
  onStatusChange,
}: UseWhiteboardAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>(() => whiteboardAutoSaveRegistry.getStatus());
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(() =>
    whiteboardAutoSaveRegistry.getLastSavedTime(),
  );
  const [pendingCount, setPendingCount] = useState<number>(() =>
    whiteboardAutoSaveRegistry.getPendingCount(),
  );

  const onSaveToServerRef = useRef(onSaveToServer);
  onSaveToServerRef.current = onSaveToServer;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Sync configuration to registry singleton
  useEffect(() => {
    whiteboardAutoSaveRegistry.setLessonId(lessonId);
    whiteboardAutoSaveRegistry.setDebounceDelay(debounceDelay);
    whiteboardAutoSaveRegistry.setSaveHandler(async (lId, elId, data) => {
      return onSaveToServerRef.current(lId, elId, data);
    });
  }, [lessonId, debounceDelay]);

  // Subscribe to registry updates
  useEffect(() => {
    const unsubscribe = whiteboardAutoSaveRegistry.registerListener((newStatus, info) => {
      setStatus(newStatus);
      if (info?.lastSavedTime !== undefined) {
        setLastSavedTime(info.lastSavedTime);
      }
      if (info?.count !== undefined) {
        setPendingCount(info.count);
      }
      onStatusChangeRef.current?.(newStatus, info?.lastSavedTime ?? null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Flush on unmount or beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (whiteboardAutoSaveRegistry.getPendingCount() > 0) {
        void whiteboardAutoSaveRegistry.flush();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void whiteboardAutoSaveRegistry.flush();
    };
  }, []);

  const queueUpdate = useCallback((elementId: string, data: Record<string, any>) => {
    whiteboardAutoSaveRegistry.queueUpdate(elementId, data);
  }, []);

  const flush = useCallback(async () => {
    return whiteboardAutoSaveRegistry.flush();
  }, []);

  const cancel = useCallback(() => {
    whiteboardAutoSaveRegistry.cancel();
  }, []);

  return {
    status,
    lastSavedTime,
    pendingCount,
    queueUpdate,
    flush,
    cancel,
    registry: whiteboardAutoSaveRegistry,
  };
}
