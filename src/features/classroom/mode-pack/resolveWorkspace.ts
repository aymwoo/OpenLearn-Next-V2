/**
 * 宿主工作区决议（P0/P1）。
 *
 * flag 关闭 → 始终 legacy（既有白板中栏路径）。
 * flag 开启 → 按归一化 segment.type 匹配 Mode Pack；无包则仍 legacy。
 */
import {
  normalizeSegmentType,
  resolveModePackForSegment,
  type ModePackContribution,
  DEFAULT_MODE_PACK_SEGMENT_TYPE,
} from '../../../../packages/core/plugin-host/mode-pack';
import { isModePacksEnabled } from './flags';

export type WorkspaceResolution =
  { kind: 'legacy'; segmentType: string } | { kind: 'mode-pack'; segmentType: string; pack: ModePackContribution };

export function resolveWorkspace(input: {
  segmentType?: string | null;
  packs?: readonly ModePackContribution[];
  /** 测试或调用方可强制；默认读 isModePacksEnabled() */
  enabled?: boolean;
}): WorkspaceResolution {
  const enabled = input.enabled ?? isModePacksEnabled();
  const segmentType = normalizeSegmentType(input.segmentType);

  if (!enabled) {
    return { kind: 'legacy', segmentType };
  }

  const pack = resolveModePackForSegment(input.packs ?? [], segmentType);
  if (!pack) {
    return { kind: 'legacy', segmentType: segmentType || DEFAULT_MODE_PACK_SEGMENT_TYPE };
  }
  return { kind: 'mode-pack', segmentType, pack };
}
