/**
 * Mode Pack 大纲贡献决议（P4）。
 * 侧栏抽屉内大纲体按当前 segment.type → pack.outlineContributionId。
 */
import {
  normalizeSegmentType,
  resolveModePackForSegment,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';
import { WHITEBOARD_MODE_PACK } from './whiteboardPack';
import { XUEAN_MODE_PACK } from './xueanPack';

const BUILTIN_PACKS = [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK];

export type OutlineKind = 'whiteboard-pages' | 'xuean-activities' | 'extension';

export function resolveOutlineContribution(input: {
  segmentType?: string | null;
  packs?: readonly ModePackContribution[];
}): { kind: OutlineKind; outlineContributionId: string; packId: string } {
  const pack = resolveModePackForSegment(input.packs ?? BUILTIN_PACKS, normalizeSegmentType(input.segmentType));
  const outlineContributionId =
    pack?.outlineContributionId ?? WHITEBOARD_MODE_PACK.outlineContributionId ?? 'outline-whiteboard-pages';

  let kind: OutlineKind;
  if (outlineContributionId === XUEAN_MODE_PACK.outlineContributionId) {
    kind = 'xuean-activities';
  } else if (outlineContributionId === WHITEBOARD_MODE_PACK.outlineContributionId) {
    kind = 'whiteboard-pages';
  } else {
    kind = 'extension';
  }

  return {
    kind,
    outlineContributionId,
    packId: pack?.id ?? WHITEBOARD_MODE_PACK.id,
  };
}
