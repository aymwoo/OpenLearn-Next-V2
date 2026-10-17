/**
 * 组卷快照（Issue #100 讨论结论 Q6 = a：**组卷即快照**）。
 *
 * 把一道题从题库（或临时题）加入试卷时，就复制一份完整的 `assessment_items` 行：
 * - 草稿自包含 → 不存在"题库条目被删导致草稿残缺"，也不需要软删 / FK 约束；
 * - 发布只改 `assessments.status`（幂等、可重入），不需要批量物化；
 * - 试卷改版 = 「复制为新试卷」，已发布版本永不被就地改写。
 *
 * `bankItemId` 仅作溯源，可为 null。
 */
import type { QuestionTypeRegistry } from './question-types/registry.js';
import type { AssessmentItemRecord, AssessmentStatus } from './types.js';

/** 只有草稿可编辑；published / closed / archived 一律只读。 */
export function isAssessmentEditable(status: AssessmentStatus): boolean {
  return status === 'draft';
}

/** 允许的状态迁移；`null` 表示非法迁移。 */
export function nextAssessmentStatus(
  from: AssessmentStatus,
  action: 'publish' | 'close' | 'archive' | 'reopen',
): AssessmentStatus | null {
  if (action === 'publish') return from === 'draft' ? 'published' : null;
  if (action === 'close') return from === 'published' ? 'closed' : null;
  if (action === 'archive') return from === 'published' || from === 'closed' ? 'archived' : null;
  if (action === 'reopen') return from === 'closed' ? 'published' : null;
  return null;
}

export interface ItemSnapshotInput {
  id: string;
  assessmentId: string;
  bankItemId?: string | null;
  section?: string | null;
  sortOrder: number;
  type: string;
  stem: string;
  config: Record<string, unknown>;
  answerKey?: unknown;
  maxScore: number;
}

/**
 * 校验一道题能否进入试卷。返回 `null` 表示通过。
 *
 * 校验三层：题型已注册 → 展示配置合法 → 标准答案格式合法（**允许没有答案**，
 * 此时该题判分进人工队列，不阻止组卷）。
 */
export function validateItemSnapshot(
  registry: QuestionTypeRegistry,
  input: Pick<ItemSnapshotInput, 'type' | 'stem' | 'config' | 'answerKey' | 'maxScore'>,
): string | null {
  const definition = registry.get(input.type);
  if (!definition) return `未注册的题型：${input.type}`;
  if (typeof input.stem !== 'string' || !input.stem.trim()) return '题干不能为空';
  if (typeof input.maxScore !== 'number' || !Number.isFinite(input.maxScore) || input.maxScore <= 0) {
    return 'maxScore 必须是正数';
  }
  const configError = definition.validateConfig(input.config);
  if (configError) return `题目配置非法：${configError}`;
  const keyError = definition.validateAnswerKey?.(input.config, input.answerKey);
  if (keyError) return `标准答案非法：${keyError}`;
  return null;
}

/**
 * 生成快照行。**调用前必须先用 {@link validateItemSnapshot} 校验**；
 * 这里再做一次浅拷贝，保证调用方后续改动原对象不会污染快照。
 */
export function buildItemSnapshot(input: ItemSnapshotInput): AssessmentItemRecord {
  return {
    id: input.id,
    assessmentId: input.assessmentId,
    bankItemId: input.bankItemId ?? null,
    section: input.section ?? null,
    sortOrder: input.sortOrder,
    type: input.type,
    stem: input.stem,
    config: structuredClone(input.config ?? {}),
    answerKey: input.answerKey === undefined ? null : structuredClone(input.answerKey),
    maxScore: input.maxScore,
  };
}

/** 从题库条目生成快照（`question_bank_items` 一行 → `assessment_items` 一行）。 */
export function snapshotFromBankItem(
  bankItem: {
    id: string;
    type: string;
    stem: string;
    config: unknown;
    answerKey?: unknown;
    maxScore?: number;
  },
  target: { id: string; assessmentId: string; sortOrder: number; section?: string | null; maxScore?: number },
): ItemSnapshotInput {
  return {
    id: target.id,
    assessmentId: target.assessmentId,
    bankItemId: bankItem.id,
    section: target.section ?? null,
    sortOrder: target.sortOrder,
    type: bankItem.type,
    stem: bankItem.stem,
    config: (bankItem.config ?? {}) as Record<string, unknown>,
    answerKey: bankItem.answerKey ?? null,
    maxScore: target.maxScore ?? bankItem.maxScore ?? 1,
  };
}
