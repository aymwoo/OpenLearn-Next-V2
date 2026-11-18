/**
 * Mode Pack 统一备课壳（P3）。
 *
 * flag 开启时替代 lesson_editor / xuean_editor 双硬编码主路径：
 * 按当前 activeSegment.type 决议 Mode Pack，再渲染对应 prep 面
 * （白板 → LessonEditorView；学案 → XueanEditor）。
 * 顶部环节条始终可见，保证混排课时可在单一壳内切换白板/学案环节。
 */
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useOptionalAppData } from '../../../context/AppDataContext';
import {
  DEFAULT_MODE_PACK_SEGMENT_TYPE,
  normalizeSegmentType,
  resolveModePackForSegment,
} from '../../../../packages/core/plugin-host/mode-pack';
import { isModePacksEnabled } from './flags';
import { WHITEBOARD_MODE_PACK, WHITEBOARD_MODE_PACK_ID } from './whiteboardPack';
import { XUEAN_MODE_PACK, XUEAN_MODE_PACK_ID } from './xueanPack';
import { registerWhiteboardModePack, unregisterWhiteboardModePack } from './registerWhiteboardModePack';
import { registerXueanModePack, unregisterXueanModePack } from './registerXueanModePack';

const LessonEditorView = lazy(() =>
  import('../../teacher/LessonEditorView').then((m) => ({ default: m.LessonEditorView })),
);
const XueanEditor = lazy(() => import('../../teacher/xuean/XueanEditor').then((m) => ({ default: m.XueanEditor })));

const BUILTIN_PACKS = [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK];

type PrepSegment = { id: string; title?: string; type?: string };

function PrepSegmentBar({
  segments,
  activeSegmentId,
  onSelect,
}: {
  segments: PrepSegment[];
  activeSegmentId: string | null;
  onSelect: (id: string) => void;
}) {
  if (segments.length === 0) return null;
  return (
    <div
      data-testid="mode-pack-prep-segment-bar"
      className="flex items-center gap-2 px-3 py-2 border-b border-theme bg-surface/90 shrink-0 overflow-x-auto"
      role="tablist"
      aria-label="备课环节"
    >
      {segments.map((seg) => {
        const active = seg.id === activeSegmentId;
        const type = normalizeSegmentType(seg.type);
        return (
          <button
            key={seg.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-segment-type={type}
            onClick={() => onSelect(seg.id)}
            className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
              active
                ? 'bg-primary-theme/15 border-primary-theme/40 text-primary-theme'
                : 'bg-transparent border-theme text-muted hover:text-main'
            }`}
          >
            <span className="mr-1.5 opacity-70">{type}</span>
            {seg.title || seg.id}
          </button>
        );
      })}
    </div>
  );
}

export function ModePackPrepShell() {
  const appData = useOptionalAppData();
  const timelineSegments = (appData?.timelineSegments ?? []) as PrepSegment[];
  const activeSegmentId = (appData?.activeSegmentId as string | null) ?? null;
  const setActiveSegmentId = appData?.setActiveSegmentId as ((id: string | null) => void) | undefined;

  useEffect(() => {
    if (!isModePacksEnabled()) return;
    registerWhiteboardModePack();
    registerXueanModePack();
    return () => {
      unregisterWhiteboardModePack();
      unregisterXueanModePack();
    };
  }, []);

  const activeSegment = timelineSegments.find((s) => s.id === activeSegmentId);
  const pack = useMemo(
    () => resolveModePackForSegment(BUILTIN_PACKS, normalizeSegmentType(activeSegment?.type)),
    [activeSegment?.type],
  );

  const prepId = pack?.prepContributionId ?? WHITEBOARD_MODE_PACK.prepContributionId;
  const isXuean = pack?.id === XUEAN_MODE_PACK_ID || prepId === XUEAN_MODE_PACK.prepContributionId;

  return (
    <div
      data-testid="mode-pack-prep-shell"
      data-pack-id={pack?.id ?? WHITEBOARD_MODE_PACK_ID}
      data-prep-id={prepId ?? ''}
      data-segment-type={normalizeSegmentType(activeSegment?.type) || DEFAULT_MODE_PACK_SEGMENT_TYPE}
      className="flex-1 min-h-0 flex flex-col"
    >
      <PrepSegmentBar
        segments={timelineSegments}
        activeSegmentId={activeSegmentId}
        onSelect={(id) => setActiveSegmentId?.(id)}
      />
      <Suspense
        fallback={
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-slate-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <span className="text-sm font-medium">加载备课面...</span>
          </div>
        }
      >
        {isXuean ? <XueanEditor /> : <LessonEditorView />}
      </Suspense>
    </div>
  );
}
