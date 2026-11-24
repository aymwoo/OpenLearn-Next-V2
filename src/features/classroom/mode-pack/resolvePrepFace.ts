/**
 * 备课面决议（课程编辑入口）。
 *
 * 一个课程编辑入口需要决定渲染白板编辑器、学案编辑器，还是第三方 prep 扩展。
 * 优先级固定为：
 *   1. 当前环节类型（混排课程按环节切换）；
 *   2. 课时绑定的模式包 / 交付模式（无环节或环节未带类型时）；
 *   3. 请求的 teacherTab（最后的兜底）。
 */
import {
  normalizeSegmentType,
  resolveModePackForSegment,
  type ModePackContribution,
} from '../../../../packages/core/plugin-host/mode-pack';
import { resolveLessonModePackDeliveryMode } from '../../../../packages/core/plugin-host/course-delivery-mode';
import { WHITEBOARD_MODE_PACK } from './whiteboardPack';
import { XUEAN_MODE_PACK } from './xueanPack';

export type PrepFaceKind = 'whiteboard' | 'xuean' | 'extension';

export interface ResolvePrepFaceInput {
  activeSegmentType?: string | null;
  lessonModePackId?: string | null;
  lessonDeliveryMode?: string | null;
  requestedTab?: string | null;
  packs?: readonly ModePackContribution[];
}

export interface ResolvedPrepFace {
  kind: PrepFaceKind;
  pack: ModePackContribution;
  prepId: string | null;
}

function kindOf(pack: ModePackContribution): PrepFaceKind {
  if (pack.prepContributionId === XUEAN_MODE_PACK.prepContributionId) return 'xuean';
  if (pack.prepContributionId === WHITEBOARD_MODE_PACK.prepContributionId) return 'whiteboard';
  return 'extension';
}

export function resolvePrepFace(input: ResolvePrepFaceInput): ResolvedPrepFace {
  const packs = input.packs && input.packs.length > 0 ? input.packs : [WHITEBOARD_MODE_PACK, XUEAN_MODE_PACK];
  const activeType =
    typeof input.activeSegmentType === 'string' && input.activeSegmentType.trim()
      ? input.activeSegmentType.trim()
      : null;

  let pack: ModePackContribution | null = null;

  if (activeType) {
    pack = resolveModePackForSegment(packs, normalizeSegmentType(activeType));
  } else {
    const lessonPackId =
      typeof input.lessonModePackId === 'string' && input.lessonModePackId.trim()
        ? input.lessonModePackId.trim()
        : null;
    if (lessonPackId) {
      pack = packs.find((candidate) => candidate.id === lessonPackId) ?? null;
    }

    // 只有课时确实带了模式信息时才按 delivery_mode 兜底；否则把决定权留给 requestedTab。
    if (!pack && (lessonPackId || input.lessonDeliveryMode != null)) {
      const deliveryMode = resolveLessonModePackDeliveryMode(lessonPackId, input.lessonDeliveryMode);
      const wantedId = deliveryMode === 'xuean' ? XUEAN_MODE_PACK.id : WHITEBOARD_MODE_PACK.id;
      pack = packs.find((candidate) => candidate.id === wantedId) ?? null;
    }

    if (!pack && input.requestedTab === 'xuean_editor') {
      pack = packs.find((candidate) => candidate.id === XUEAN_MODE_PACK.id) ?? null;
    }
  }

  const resolved = pack ?? WHITEBOARD_MODE_PACK;
  return {
    kind: kindOf(resolved),
    pack: resolved,
    prepId: resolved.prepContributionId ?? null,
  };
}
