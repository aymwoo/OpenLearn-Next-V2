/**
 * Mode Pack 统一备课壳（P3）。
 *
 * flag 开启时替代 lesson_editor / xuean_editor 双硬编码主路径：
 * 按当前 activeSegment.type 决议 Mode Pack，再渲染对应 prep 面
 * （白板 → LessonEditorView；学案 → XueanEditor）。
 * 顶部环节条始终可见，保证混排课时可在单一壳内切换白板/学案环节。
 */
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useOptionalAppData } from '../../../context/AppDataContext';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { useOptionalPluginHost } from '../../../plugin-host/plugin-host-context';
import {
  DEFAULT_MODE_PACK_SEGMENT_TYPE,
  normalizeSegmentType,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';
import { isModePacksEnabled } from './flags';
import { useModePackCatalog } from './useModePackCatalog';
import { resolvePrepFace } from './resolvePrepFace';
import { WHITEBOARD_MODE_PACK, WHITEBOARD_MODE_PACK_ID } from './whiteboardPack';
import { XUEAN_MODE_PACK } from './xueanPack';
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

export function ModePackPrepShell({ requestedTab }: { requestedTab?: string | null }) {
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

  const catalog = useModePackCatalog();
  const pluginHost = useOptionalPluginHost();
  const lessonId = (appData?.selectedLesson as string | null | undefined) ?? null;
  const lang = appData?.lang === 'en' ? 'en' : 'zh';

  const packs = useMemo(() => {
    const merged = new Map<string, ModePackContribution>();
    for (const pack of BUILTIN_PACKS) merged.set(pack.id, pack);
    for (const pack of catalog) {
      if (!merged.has(pack.id)) merged.set(pack.id, pack);
    }
    return Array.from(merged.values());
  }, [catalog]);

  const activeSegment = timelineSegments.find((s) => s.id === activeSegmentId);
  const currentLesson = (
    appData?.lessons as Array<{ id: string; mode_pack_id?: string | null; delivery_mode?: string | null }> | undefined
  )?.find((lesson) => lesson.id === lessonId);

  // 优先级：当前环节 → 课时模式包/交付模式 → 请求的 teacherTab。
  const face = useMemo(
    () =>
      resolvePrepFace({
        activeSegmentType: activeSegment?.type,
        lessonModePackId: currentLesson?.mode_pack_id,
        lessonDeliveryMode: currentLesson?.delivery_mode,
        requestedTab,
        packs,
      }),
    [activeSegment?.type, currentLesson?.mode_pack_id, currentLesson?.delivery_mode, requestedTab, packs],
  );

  const pack = face.pack;
  const prepId = face.prepId ?? WHITEBOARD_MODE_PACK.prepContributionId;
  const isXuean = face.kind === 'xuean';
  const isWhiteboard = face.kind === 'whiteboard';
  const hasPrepExtension =
    !isXuean &&
    !isWhiteboard &&
    (pluginHost?.getExtensions('classroom.prep' as never) ?? []).some((ext) => {
      const cfg = (ext as { slotProps?: Record<string, unknown> }).slotProps ?? {};
      const declared = cfg.prepContributionId;
      return typeof declared !== 'string' || !declared || declared === prepId;
    });

  const warnedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isXuean || isWhiteboard || hasPrepExtension) {
      warnedRef.current = null;
      return;
    }
    if (!prepId || warnedRef.current === pack?.id) return;
    warnedRef.current = pack?.id ?? '';
    console.warn(`[mode-pack] 备课面贡献未注册，回退白板：pack=${pack?.id} prep=${prepId}`);
  }, [pack?.id, prepId, isXuean, isWhiteboard, hasPrepExtension]);

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
        {isXuean ? (
          <XueanEditor />
        ) : isWhiteboard || !hasPrepExtension ? (
          <LessonEditorView />
        ) : (
          <ExtensionPointRenderer
            slot="classroom.prep"
            slotProps={{
              packId: pack?.id,
              prepContributionId: prepId,
              segment: activeSegment,
              lessonId,
              lang,
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
