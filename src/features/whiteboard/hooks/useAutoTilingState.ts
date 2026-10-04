import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from '../../../services/event-bus';
import {
  computeTiling,
  toTileCandidate,
  toTiledGeometry,
  isTileableType,
  geometryKeys,
  extractGeometry,
  sameGeometry,
  detectTilingSplitters,
  applySplitterDrag,
  applyContainerSplit,
  sortCandidatesForTiling,
  type TileCandidate,
  type BoxWithId,
  type TilingSplitter,
  type DropZoneActionType,
  type StackDirection,
} from '../utils/auto-tiling';
import { parseElementData } from '../utils/element-cache';

export interface WhiteboardElement {
  id: string;
  type: string;
  data: string;
}

export interface WhiteboardPageItem {
  id: string;
  title?: string;
  name?: string;
  sortOrder?: number;
  [key: string]: any;
}

const DEFAULT_ELEMENT_SIZE: Record<string, { width: number; height: number }> = {
  quiz: { width: 340, height: 380 },
  timer: { width: 280, height: 200 },
  assignment: { width: 340, height: 400 },
  rollcall: { width: 340, height: 420 },
  'html-applet': { width: 400, height: 300 },
  'code-sandbox': { width: 400, height: 320 },
  'math-graph': { width: 400, height: 350 },
  presentation: { width: 600, height: 400 },
  plugin: { width: 500, height: 400 },
};

export function getDefaultElementSize(type: string, data: any): { width: number; height: number } {
  const preset = DEFAULT_ELEMENT_SIZE[type];
  if (preset) {
    return { width: data?.width || preset.width, height: data?.height || preset.height };
  }
  return { width: data?.width || 300, height: data?.height || 300 };
}

export interface UseAutoTilingStateParams {
  containerSize: { width: number; height: number };
  safeElements: WhiteboardElement[];
  getCurrentPageElements: () => WhiteboardElement[];
  onElementUpdate?: (elementId: string, data: any) => Promise<void>;
  lessonId: string;
  readOnly: boolean;
  setLocalGeometry: (id: string, geo: Record<string, number>) => void;
  localGeometryRef: React.MutableRefObject<Map<string, Record<string, number>>>;
  localGeometryVersion: number;
  currentPage: number;
  activeSegmentId?: string | null;
  pages: WhiteboardPageItem[];
  tileSplitPreferenceRef: React.MutableRefObject<StackDirection | undefined>;
  setIsSyncing: (syncing: boolean) => void;
}

export interface ActiveSplitterDragState {
  splitter: TilingSplitter;
  startPointerPos: number;
  initialBoxes: BoxWithId[];
}

export function useAutoTilingState({
  containerSize,
  safeElements,
  getCurrentPageElements,
  onElementUpdate,
  lessonId,
  readOnly,
  setLocalGeometry,
  localGeometryRef,
  localGeometryVersion,
  currentPage,
  activeSegmentId,
  pages,
  tileSplitPreferenceRef,
  setIsSyncing,
}: UseAutoTilingStateParams) {
  const [autoTileEnabled, setAutoTileEnabled] = useState(false);
  const [activeSplitterDrag, setActiveSplitterDrag] = useState<ActiveSplitterDragState | null>(null);
  const activeSplitterDragRef = useRef<ActiveSplitterDragState | null>(null);

  useEffect(() => {
    activeSplitterDragRef.current = activeSplitterDrag;
  }, [activeSplitterDrag]);

  // 1. 指定列表平铺
  const applyAutoTilingForElements = useCallback(
    async (targetElements: WhiteboardElement[], forcedStackDirection?: StackDirection, customIdsOrder?: string[]) => {
      if (!onElementUpdate) return;
      if (containerSize.width <= 0 || containerSize.height <= 0) return;

      const tileableElements = targetElements.filter((el) => isTileableType(el.type));
      if (tileableElements.length === 0) return;

      const candidates: TileCandidate[] = [];
      const rawDataById = new Map<string, Record<string, any>>();
      const tileOrderMap = new Map<string, number | undefined>();

      let detectedStackDir: StackDirection | undefined = forcedStackDirection ?? tileSplitPreferenceRef.current;

      for (const el of tileableElements) {
        const data = parseElementData(el, null);
        if (!data) continue;
        if (!detectedStackDir && data.tileStackDir) {
          detectedStackDir = data.tileStackDir;
        }
        const candidate = toTileCandidate(el, data, getDefaultElementSize(el.type, data));
        if (!candidate) continue;
        candidates.push(candidate);
        rawDataById.set(el.id, data);
        if (customIdsOrder) {
          const idx = customIdsOrder.indexOf(el.id);
          tileOrderMap.set(el.id, idx >= 0 ? idx : undefined);
        } else {
          tileOrderMap.set(el.id, typeof data.tileOrder === 'number' ? data.tileOrder : undefined);
        }
      }
      if (candidates.length === 0) return;

      const sortedCandidates = sortCandidatesForTiling(candidates, tileOrderMap);
      const results = computeTiling(sortedCandidates, containerSize, {
        stackDirection: detectedStackDir,
      });
      if (results.length === 0) return;

      let changed = false;
      setIsSyncing(true);
      try {
        for (let i = 0; i < sortedCandidates.length; i += 1) {
          const candidate = sortedCandidates[i];
          const current = rawDataById.get(candidate.id);
          if (!current) continue;
          const geometry = toTiledGeometry(candidate, results[i]) as Record<string, number>;
          const keys = geometryKeys(candidate.shape);
          if (
            sameGeometry(current, geometry, keys) &&
            current.tileOrder === i &&
            current.tileStackDir === detectedStackDir
          ) {
            continue;
          }
          changed = true;
          setLocalGeometry(candidate.id, geometry);
          const patch: Record<string, any> = {
            ...current,
            ...geometry,
            tileOrder: i,
            tileStackDir: detectedStackDir,
          };
          if (!current.__preTile) {
            patch.__preTile = extractGeometry(current, candidate.shape);
          }
          patch.__tiled = geometry;
          const targetEl =
            targetElements.find((e) => e.id === candidate.id) || safeElements.find((e) => e.id === candidate.id);
          if (targetEl) {
            targetEl.data = JSON.stringify(patch);
          }
          await onElementUpdate(candidate.id, patch);
        }
        if (!changed) return;
        frontendEventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_updated',
          source: 'whiteboard',
          payload: { lessonId },
          timestamp: Date.now(),
          correlationId: lessonId,
        });
      } finally {
        setIsSyncing(false);
      }
    },
    [onElementUpdate, containerSize, safeElements, lessonId, setLocalGeometry, tileSplitPreferenceRef, setIsSyncing],
  );

  // 2. 当前视口平铺
  const applyAutoTiling = useCallback(
    async (forcedStackDirection?: StackDirection, customIdsOrder?: string[]) => {
      const visibleElements = getCurrentPageElements().filter((el) => isTileableType(el.type));
      await applyAutoTilingForElements(visibleElements, forcedStackDirection, customIdsOrder);
    },
    [getCurrentPageElements, applyAutoTilingForElements],
  );

  // 3. 交换平铺元素
  const swapTileElements = useCallback(
    async (idA: string, idB: string) => {
      if (!onElementUpdate || idA === idB) return;
      const elA = safeElements.find((el) => el.id === idA);
      const elB = safeElements.find((el) => el.id === idB);
      if (!elA || !elB) return;

      const dataA = parseElementData(elA, null);
      const dataB = parseElementData(elB, null);
      if (!dataA || !dataB) return;

      const geoA = extractGeometry(dataA, elA.type === 'circle' ? 'circle' : 'rect');
      const geoB = extractGeometry(dataB, elB.type === 'circle' ? 'circle' : 'rect');
      const localA = localGeometryRef.current.get(idA);
      const localB = localGeometryRef.current.get(idB);
      const effectiveGeoA = { ...geoA, ...(localA || {}) };
      const effectiveGeoB = { ...geoB, ...(localB || {}) };

      const currentTiles = getCurrentPageElements().filter((el) => isTileableType(el.type));
      const indexA = currentTiles.findIndex((el) => el.id === idA);
      const indexB = currentTiles.findIndex((el) => el.id === idB);
      const orderA = typeof dataA.tileOrder === 'number' ? dataA.tileOrder : indexA >= 0 ? indexA : 0;
      const orderB = typeof dataB.tileOrder === 'number' ? dataB.tileOrder : indexB >= 0 ? indexB : 1;

      const patchA: Record<string, any> = {
        ...dataA,
        ...effectiveGeoB,
        tileOrder: orderB,
      };
      const patchB: Record<string, any> = {
        ...dataB,
        ...effectiveGeoA,
        tileOrder: orderA,
      };

      if (!dataA.__preTile) {
        patchA.__preTile = extractGeometry(dataA, elA.type === 'circle' ? 'circle' : 'rect');
      }
      if (!dataB.__preTile) {
        patchB.__preTile = extractGeometry(dataB, elB.type === 'circle' ? 'circle' : 'rect');
      }
      patchA.__tiled = effectiveGeoB;
      patchB.__tiled = effectiveGeoA;

      setLocalGeometry(idA, effectiveGeoB);
      setLocalGeometry(idB, effectiveGeoA);

      setIsSyncing(true);
      try {
        await Promise.all([onElementUpdate(idA, patchA), onElementUpdate(idB, patchB)]);
        frontendEventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_updated',
          source: 'whiteboard',
          payload: { lessonId },
          timestamp: Date.now(),
          correlationId: lessonId,
        });
      } finally {
        setIsSyncing(false);
      }
    },
    [onElementUpdate, safeElements, getCurrentPageElements, setLocalGeometry, localGeometryRef, lessonId, setIsSyncing],
  );

  // 4. 还原平铺前状态
  const restoreAutoTiling = useCallback(async () => {
    if (!onElementUpdate) return;
    const restores: { id: string; patch: Record<string, any> }[] = [];

    for (const el of safeElements) {
      const data = parseElementData(el, null);
      if (!data || !data.__preTile) continue;
      const { __preTile, __tiled, tileOrder, ...rest } = data;
      const keys = geometryKeys(el.type === 'circle' ? 'circle' : 'rect');
      const untouched = !__tiled || sameGeometry(data, __tiled, keys);
      restores.push({ id: el.id, patch: untouched ? { ...rest, ...__preTile } : rest });
    }
    if (restores.length === 0) return;

    setIsSyncing(true);
    try {
      for (const { id, patch } of restores) {
        const shape = patch.radius !== undefined ? 'circle' : 'rect';
        setLocalGeometry(id, extractGeometry(patch, shape));
        await onElementUpdate(id, patch);
      }
      frontendEventBus.publish({
        id: uuidv7(),
        type: 'whiteboard.element_updated',
        source: 'whiteboard',
        payload: { lessonId },
        timestamp: Date.now(),
        correlationId: lessonId,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [onElementUpdate, safeElements, lessonId, setLocalGeometry, setIsSyncing]);

  // 5. 定向切分插入
  const insertTileInDirection = useCallback(
    async (sourceId: string, targetId: string, actionType: DropZoneActionType) => {
      if (!onElementUpdate || sourceId === targetId) return;

      const visibleElements = getCurrentPageElements().filter((el) => isTileableType(el.type));
      const currentBoxes: BoxWithId[] = visibleElements.map((el) => {
        const data = parseElementData(el);
        const defaultSize = getDefaultElementSize(el.type, data);
        const overlay = localGeometryRef.current.get(el.id);
        return {
          id: el.id,
          x: overlay?.x ?? data.x ?? 0,
          y: overlay?.y ?? data.y ?? 0,
          width: overlay?.width ?? data.width ?? defaultSize.width,
          height: overlay?.height ?? data.height ?? defaultSize.height,
        };
      });

      const padding = 12;
      const activeContainerArea = {
        x: padding,
        y: padding,
        width: Math.max(0, containerSize.width - padding * 2),
        height: Math.max(0, containerSize.height - padding * 2),
      };

      const patches = applyContainerSplit(sourceId, targetId, actionType, currentBoxes, activeContainerArea);
      if (Object.keys(patches).length === 0) return;

      setIsSyncing(true);
      try {
        for (const [id, patch] of Object.entries(patches)) {
          const currentBox = currentBoxes.find((b) => b.id === id);
          if (currentBox) {
            setLocalGeometry(id, {
              x: currentBox.x,
              y: currentBox.y,
              width: currentBox.width,
              height: currentBox.height,
              ...patch,
            });
          }
        }

        await Promise.all(
          Object.entries(patches).map(async ([id, patch]) => {
            const el = safeElements.find((item) => item.id === id);
            if (!el) return;
            const data = parseElementData(el, {});
            const shape = el.type === 'circle' ? 'circle' : 'rect';
            const baseGeo = extractGeometry(data, shape);
            const updatedGeo = { ...baseGeo, ...patch };
            setLocalGeometry(id, updatedGeo);
            await onElementUpdate(id, { ...data, ...patch, __tiled: updatedGeo });
          }),
        );

        frontendEventBus.publish({
          id: uuidv7(),
          type: 'whiteboard.element_updated',
          source: 'whiteboard',
          payload: { lessonId },
          timestamp: Date.now(),
          correlationId: lessonId,
        });
      } finally {
        setIsSyncing(false);
      }
    },
    [onElementUpdate, safeElements, getCurrentPageElements, containerSize, setLocalGeometry, localGeometryRef, lessonId, setIsSyncing],
  );

  // 6. 开关切换
  const handleToggleAutoTile = useCallback(() => {
    if (autoTileEnabled) {
      void restoreAutoTiling();
    }
    setAutoTileEnabled(!autoTileEnabled);
  }, [autoTileEnabled, restoreAutoTiling]);

  // 7. 当前所有处于平铺模式下的组件包围盒
  const currentTilingBoxes = useMemo<BoxWithId[]>(() => {
    if (!autoTileEnabled) return [];
    const visible = getCurrentPageElements().filter((el) => isTileableType(el.type));
    return visible.map((el) => {
      let data: Record<string, any> = {};
      try {
        data = JSON.parse(el.data);
      } catch {}
      const defaultSize = getDefaultElementSize(el.type, data);
      const overlay = localGeometryRef.current.get(el.id);
      return {
        id: el.id,
        x: overlay?.x ?? data.x ?? 0,
        y: overlay?.y ?? data.y ?? 0,
        width: overlay?.width ?? data.width ?? defaultSize.width,
        height: overlay?.height ?? data.height ?? defaultSize.height,
      };
    });
  }, [
    autoTileEnabled,
    safeElements,
    currentPage,
    activeSegmentId,
    pages,
    localGeometryVersion,
    getCurrentPageElements,
    localGeometryRef,
  ]);

  // 8. 平铺分割线
  const tilingSplitters = useMemo(() => {
    if (!autoTileEnabled || currentTilingBoxes.length < 2) return [];
    return detectTilingSplitters(currentTilingBoxes);
  }, [autoTileEnabled, currentTilingBoxes]);

  // 9. 分割条按下
  const handleSplitterPointerDown = useCallback(
    (e: React.PointerEvent, splitter: TilingSplitter) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const startPointerPos = splitter.orientation === 'horizontal' ? e.clientY : e.clientX;
      setActiveSplitterDrag({
        splitter,
        startPointerPos,
        initialBoxes: currentTilingBoxes,
      });
    },
    [readOnly, currentTilingBoxes],
  );

  // 10. 自动平铺联动副作用
  const applyAutoTilingRef = useRef(applyAutoTiling);
  useEffect(() => {
    applyAutoTilingRef.current = applyAutoTiling;
  }, [applyAutoTiling]);

  const tileableIdsKey = useMemo(() => {
    if (!autoTileEnabled) return '';
    return getCurrentPageElements()
      .filter((el) => isTileableType(el.type))
      .map((el) => el.id)
      .join('|');
  }, [autoTileEnabled, safeElements, currentPage, activeSegmentId, pages, getCurrentPageElements]);

  useEffect(() => {
    if (!autoTileEnabled || !tileableIdsKey) return;
    void applyAutoTilingRef.current();
  }, [autoTileEnabled, tileableIdsKey]);

  useEffect(() => {
    if (!autoTileEnabled) return;
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const timer = setTimeout(() => {
      void applyAutoTilingRef.current();
    }, 250);
    return () => clearTimeout(timer);
  }, [autoTileEnabled, containerSize.width, containerSize.height]);

  // 11. 分割线拖拽手势全局监听
  useEffect(() => {
    if (!activeSplitterDrag) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!activeSplitterDragRef.current) return;
      const { splitter, startPointerPos, initialBoxes } = activeSplitterDragRef.current;
      const isHorizontal = splitter.orientation === 'horizontal';
      const currentPos = isHorizontal ? e.clientY : e.clientX;
      const delta = currentPos - startPointerPos;

      const patches = applySplitterDrag(splitter, delta, initialBoxes);
      for (const [id, patch] of Object.entries(patches)) {
        const currentBox = initialBoxes.find((b) => b.id === id);
        if (currentBox) {
          setLocalGeometry(id, {
            x: currentBox.x,
            y: currentBox.y,
            width: currentBox.width,
            height: currentBox.height,
            ...patch,
          });
        }
      }
    };

    const onPointerUp = async () => {
      if (!activeSplitterDragRef.current) return;
      const { splitter, startPointerPos, initialBoxes } = activeSplitterDragRef.current;
      const isHorizontal = splitter.orientation === 'horizontal';
      const currentPos = isHorizontal ? window.event ? (window.event as any).clientY : 0 : 0;
      // Using delta directly
      setActiveSplitterDrag(null);

      if (onElementUpdate && initialBoxes.length > 0) {
        setIsSyncing(true);
        try {
          await Promise.all(
            initialBoxes.map(async (box) => {
              const el = safeElements.find((item) => item.id === box.id);
              if (!el) return;
              try {
                const data = JSON.parse(el.data);
                const local = localGeometryRef.current.get(box.id);
                if (local) {
                  await onElementUpdate(box.id, { ...data, ...local, __tiled: local });
                }
              } catch {}
            }),
          );
          frontendEventBus.publish({
            id: uuidv7(),
            type: 'whiteboard.element_updated',
            source: 'whiteboard',
            payload: { lessonId },
            timestamp: Date.now(),
            correlationId: lessonId,
          });
        } finally {
          setIsSyncing(false);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeSplitterDrag, onElementUpdate, safeElements, lessonId, setLocalGeometry, localGeometryRef, setIsSyncing]);

  return {
    autoTileEnabled,
    setAutoTileEnabled,
    handleToggleAutoTile,
    currentTilingBoxes,
    tilingSplitters,
    activeSplitterDrag,
    setActiveSplitterDrag,
    activeSplitterDragRef,
    handleSplitterPointerDown,
    applyAutoTiling,
    applyAutoTilingForElements,
    swapTileElements,
    restoreAutoTiling,
    insertTileInDirection,
  };
}
