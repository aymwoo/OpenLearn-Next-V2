/**
 * 跨包备课拖放路由（P3）。
 * 不合并 activities / timeline 表：按 segment.type 决议 Mode Pack，再交给对应写入面。
 */
import {
  normalizeSegmentType,
  resolveModePackForSegment,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';
import { WHITEBOARD_MODE_PACK, WHITEBOARD_MODE_PACK_ID } from './whiteboardPack';
import { XUEAN_MODE_PACK, XUEAN_MODE_PACK_ID } from './xueanPack';

export type PrepDropKind = 'whiteboard-element' | 'xuean-activity';

export type PrepDropRoute = {
  kind: PrepDropKind;
  packId: string;
  segmentType: string;
  /** 建议写入 activity.config_json.segmentId 或白板 page.segmentId */
  segmentId?: string | null;
};

const DEFAULT_PACKS = [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK];

export function routePrepDrop(input: {
  segmentType?: string | null;
  segmentId?: string | null;
  packs?: readonly ModePackContribution[];
}): PrepDropRoute {
  const segmentType = normalizeSegmentType(input.segmentType);
  const pack = resolveModePackForSegment(input.packs ?? DEFAULT_PACKS, segmentType);
  const packId = pack?.id ?? WHITEBOARD_MODE_PACK_ID;
  if (packId === XUEAN_MODE_PACK_ID) {
    return { kind: 'xuean-activity', packId, segmentType, segmentId: input.segmentId ?? null };
  }
  return { kind: 'whiteboard-element', packId, segmentType, segmentId: input.segmentId ?? null };
}
