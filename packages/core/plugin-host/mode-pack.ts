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

/** 内置白板包 id（服务端模式包目录与前端工作区共用同一常量） */
export const BUILTIN_WHITEBOARD_MODE_PACK_ID = '@openlearn/mode-whiteboard';

/** 内置学案包 id */
export const BUILTIN_XUEAN_MODE_PACK_ID = '@openlearn/mode-xuean';

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
  /**
   * 课中侧栏大纲贡献（P4）。
   * 宿主按当前环节类型决议后渲染；白板包通常贡献页面列表，学案包贡献活动列表。
   * 不替代 timeline；仅替换/补充「环节抽屉内大纲体」。
   */
  outlineContributionId?: string;
}

/**
 * 宿主内置的两个 Mode Pack。
 *
 * 服务端 `/api/mode-packs` 目录与前端工作区注册共用这份声明，避免 id /
 * 环节类型在多处硬编码后漂移。第三方插件通过 `contributes['mode.pack']`
 * 追加自己的包，不在此列表中。
 */
export const BUILTIN_WHITEBOARD_MODE_PACK: ModePackContribution = {
  id: BUILTIN_WHITEBOARD_MODE_PACK_ID,
  label: '互动白板',
  labelEn: 'Interactive Whiteboard',
  segmentTypes: [DEFAULT_MODE_PACK_SEGMENT_TYPE],
  isDefault: true,
  prepContributionId: 'prep-whiteboard',
  outlineContributionId: 'outline-whiteboard-pages',
  teacherWorkspaceId: 'mode-whiteboard-teacher',
  studentWorkspaceId: 'mode-whiteboard-student',
};

export const BUILTIN_XUEAN_MODE_PACK: ModePackContribution = {
  id: BUILTIN_XUEAN_MODE_PACK_ID,
  label: '学案学习',
  labelEn: 'Guided Study (Xuean)',
  segmentTypes: ['xuean'],
  isDefault: false,
  prepContributionId: 'prep-xuean',
  outlineContributionId: 'outline-xuean-activities',
  teacherWorkspaceId: 'mode-xuean-teacher',
  studentWorkspaceId: 'mode-xuean-student',
  adapterIds: ['xuean-adapter'],
  channels: ['xuean:task'],
};

export const BUILTIN_MODE_PACKS: readonly ModePackContribution[] = [
  BUILTIN_WHITEBOARD_MODE_PACK,
  BUILTIN_XUEAN_MODE_PACK,
];

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

/**
 * 扩展点 / Mode Pack 共用的环节类型覆盖规则：
 * - 精确相等
 * - 或声明前缀（`xuean` 覆盖 `xuean:study`）
 */
export function extensionCoversSegmentType(
  declared: string | null | undefined,
  segmentType: string | null | undefined,
): boolean {
  if (declared === undefined || declared === null) return true;
  const want = normalizeSegmentType(segmentType);
  const have = String(declared).trim();
  if (!have) return true;
  return want === have || want.startsWith(`${have}:`);
}

/** 某 Mode Pack 是否覆盖该（已归一化的）环节类型 */
export function modePackCoversSegmentType(pack: ModePackContribution, segmentType: string): boolean {
  const normalized = normalizeSegmentType(segmentType);
  if (pack.segmentTypes.includes(normalized)) return true;
  return pack.segmentTypes.some((declared) => extensionCoversSegmentType(declared, normalized));
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
