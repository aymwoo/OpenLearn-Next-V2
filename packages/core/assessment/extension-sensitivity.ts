/**
 * 测评扩展槽的敏感字段契约（唯一真源）。
 *
 * 三处共用同一份定义，避免「manifest 允许、运行期不认」这类漂移：
 * - `packages/core/esm-loader/manifest-schema.ts`：安装期按槽位 allowlist 校验；
 * - `src/features/assessment/sensitive-props.ts`：运行期统一投影；
 * - `packages/plugin-sdk`：类型与构建期校验。
 *
 * 口径：
 * - L0（硬禁止）：学生可见槽位，声明任何敏感字段都不生效；
 * - L1（默认不含）：教师槽位但不涉及答案/个人数据，声明不生效；
 * - L2（声明后授予）：仅下面 `ASSESSMENT_SENSITIVE_SLOT_ALLOWLIST` 列出的槽位。
 */

export const SENSITIVE_FIELDS = ['answerKey', 'config', 'studentAnswer', 'studentIdentity'] as const;

export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

const SENSITIVE_FIELD_SET: ReadonlySet<string> = new Set(SENSITIVE_FIELDS);

/** 声明字段是否属于合法敏感字段名（拼错不能静默通过）。 */
export function isSensitiveField(value: unknown): value is SensitiveField {
  return typeof value === 'string' && SENSITIVE_FIELD_SET.has(value);
}

/**
 * L2 槽位 → 允许声明的敏感字段。
 *
 * 未列出的槽位一律视为 L0/L1：声明不生效（运行期）或安装失败（manifest）。
 */
export const ASSESSMENT_SENSITIVE_SLOT_ALLOWLIST: Readonly<Record<string, readonly SensitiveField[]>> = Object.freeze({
  'assessment.grading.answer.addon': Object.freeze([
    'answerKey',
    'config',
    'studentAnswer',
    'studentIdentity',
  ] as const),
  'assessment.editor.item.addon': Object.freeze(['answerKey', 'config'] as const),
  // 学生结果页：answerKey 仍受 resultVisibility / showAnalysis 双重条件约束；
  // studentAnswer / studentIdentity 只能是「本人」。
  'assessment.result.item.addon': Object.freeze(['answerKey', 'studentAnswer', 'studentIdentity'] as const),
});

/** 该槽位是否允许声明敏感字段（L2）。 */
export function isSensitiveSlot(slot: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASSESSMENT_SENSITIVE_SLOT_ALLOWLIST, slot);
}

/** 该槽位允许的敏感字段（未列出 → 空数组）。 */
export function allowedSensitiveFields(slot: string): readonly SensitiveField[] {
  return ASSESSMENT_SENSITIVE_SLOT_ALLOWLIST[slot] ?? [];
}

/** 槽位是否允许某个敏感字段。 */
export function isSensitiveFieldAllowed(slot: string, field: SensitiveField): boolean {
  return allowedSensitiveFields(slot).includes(field);
}
