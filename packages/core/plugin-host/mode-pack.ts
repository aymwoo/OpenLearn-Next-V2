/**
 * Mode Pack（教学模式包 / 交付引擎）契约。
 *
 * 与门户 `teachingModeId`（讲授/探究等风格标签）正交：
 * - teachingModeId：会话标签，不驱动工作区
 * - Mode Pack：按 `segment.type` 路由的备课面 + 双端工作区 + Adapter + channel
 *
 * 宿主在启用 `classroom.flow.mode_packs` 时，必须先把缺省环节类型归一为
 * {@link DEFAULT_MODE_PACK_SEGMENT_TYPE}，再交给 `classroom.active_segment.*` 分发。
 */

/** 旧 timeline 无 type 时的默认交付类型（白板包） */
export const DEFAULT_MODE_PACK_SEGMENT_TYPE = 'whiteboard' as const;

/** Mode Pack 在 manifest.contributes['mode.pack'] 中的声明形态 */
export interface ModePackContribution {
  /** 全局唯一，建议 `@openlearn/mode-*` 或 `ext-*:mode-*` */
  id: string;
  /** 展示名 */
  label: string;
  /** 英文名（可选） */
  labelEn?: string;
  /** 本包认领的环节类型（如 whiteboard / xuean:study）；可多值 */
  segmentTypes: string[];
  /** 是否为缺省无 type 环节的回落包（通常仅白板包为 true） */
  isDefault?: boolean;
  /** 备课面入口（teacher.panel / 专用 prep 槽的贡献 id，可选） */
  prepContributionId?: string;
  /** 教师课中工作区扩展 id（classroom.active_segment.main） */
  teacherWorkspaceId?: string;
  /** 学生课中工作区扩展 id（classroom.active_segment.student_main） */
  studentWorkspaceId?: string;
  /** SubmissionAdapter id 列表（可选） */
  adapterIds?: string[];
  /** ClassroomMessage channel 名列表（可选） */
  channels?: string[];
}

/**
 * 归一化环节类型：空 / 缺省 → 白板默认类型。
 * 宿主在 Mode Pack 路径上必须使用本函数，再做 targetType 匹配。
 */
export function normalizeSegmentType(type: string | null | undefined): string {
  if (typeof type === 'string') {
    const trimmed = type.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return DEFAULT_MODE_PACK_SEGMENT_TYPE;
}

/** 某 Mode Pack 是否覆盖该（已归一化的）环节类型 */
export function modePackCoversSegmentType(pack: ModePackContribution, segmentType: string): boolean {
  const normalized = normalizeSegmentType(segmentType);
  if (pack.segmentTypes.includes(normalized)) return true;
  // 前缀约定：声明 `xuean` 可覆盖 `xuean:study`
  return pack.segmentTypes.some((declared) => normalized === declared || normalized.startsWith(`${declared}:`));
}

/**
 * 在已注册的 Mode Pack 中决议覆盖某环节的包。
 * 优先精确/前缀匹配；若无匹配且存在 isDefault 包则回落；否则 null。
 */
export function resolveModePackForSegment(
  packs: readonly ModePackContribution[],
  segmentType: string | null | undefined,
): ModePackContribution | null {
  const normalized = normalizeSegmentType(segmentType);
  const exact = packs.find((p) => modePackCoversSegmentType(p, normalized));
  if (exact) return exact;
  return packs.find((p) => p.isDefault) ?? null;
}
