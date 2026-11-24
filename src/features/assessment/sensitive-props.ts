/**
 * 测评扩展槽敏感字段的统一投影（Q2 详设 §14）。
 *
 * 所有测评槽位在构造 props 时必须经过这里，而不是各自判断
 * `answerKey` / `config` / 学生身份。判定顺序固定：
 *
 * 1. 槽位不在 L2 allowlist → 不注入（学生槽位一律落到这一步）；
 * 2. 调用者角色不是教师/管理员 → 不注入；
 * 3. 扩展未声明 `requiresSensitive` → 不注入；
 * 4. 声明字段不在槽位允许集合 → 丢弃该字段；
 * 5. 声明字段不在授予集合（若启用授予）→ 丢弃该字段；
 * 6. 源数据缺失 → 不构造该字段（不要用 undefined 占位）。
 */
import {
  allowedSensitiveFields,
  isSensitiveField,
  type SensitiveField,
} from '../../../packages/core/assessment/extension-sensitivity.js';
import type { ExtensionPointConfig } from '../../plugin-host/types';

export type AssessmentViewer = 'teacher' | 'student';
export type AssessmentRole = 'teacher' | 'administrator' | 'student';

export interface AssessmentSensitiveInput {
  slot: string;
  viewer: AssessmentViewer;
  role: AssessmentRole;
  /**
   * 安装期授予的敏感字段集合。
   * - `undefined`：未启用授予存储（MVP 模式），声明即生效；
   * - `Set`：按交集判定（加固模式）。
   */
  granted?: ReadonlySet<SensitiveField>;
  /** 当前调用点能提供的敏感数据。缺失的字段不会被构造。 */
  source: Partial<Record<SensitiveField, unknown>>;
}

export interface AssessmentSensitiveResult {
  sensitiveAccess: boolean;
  sensitive?: Partial<Record<SensitiveField, unknown>>;
}

/**
 * 解析某个扩展可获得的敏感字段。
 *
 * 返回值为要合并进扩展 props 的对象：始终含 `sensitiveAccess`；
 * 仅当至少一个字段通过全部闸门时才附带 `sensitive`。
 */
export function projectAssessmentSensitive(
  ext: Pick<ExtensionPointConfig, 'requiresSensitive'>,
  input: AssessmentSensitiveInput,
): AssessmentSensitiveResult {
  const allowed = new Set<string>(allowedSensitiveFields(input.slot));
  if (allowed.size === 0) return { sensitiveAccess: false };
  // 学生只允许 result.item.addon（且只能拿到「本人」字段）；其余学生槽位一律 L0。
  const isStudentSelfSlot = input.viewer === 'student' && input.slot === 'assessment.result.item.addon';
  if (!isStudentSelfSlot && input.role !== 'teacher' && input.role !== 'administrator') {
    return { sensitiveAccess: false };
  }
  if (input.viewer === 'student' && !isStudentSelfSlot) return { sensitiveAccess: false };

  const declared = Array.isArray(ext.requiresSensitive) ? ext.requiresSensitive : [];
  if (declared.length === 0) return { sensitiveAccess: false };

  const sensitive: Partial<Record<SensitiveField, unknown>> = {};
  for (const field of declared) {
    if (!isSensitiveField(field)) continue;
    if (!allowed.has(field)) continue;
    if (input.granted && !input.granted.has(field)) continue;
    if (!Object.prototype.hasOwnProperty.call(input.source, field)) continue;
    const value = input.source[field];
    if (value === undefined) continue;
    sensitive[field] = value;
  }

  if (Object.keys(sensitive).length === 0) return { sensitiveAccess: false };
  return { sensitiveAccess: true, sensitive };
}

/** 便捷包装：直接产出可传给 `ExtensionPointRenderer.resolveExtensionProps` 的回调。 */
export function createAssessmentSensitiveResolver(
  input: AssessmentSensitiveInput,
): (ext: ExtensionPointConfig) => Record<string, unknown> {
  return (ext) => {
    const result = projectAssessmentSensitive(ext, input);
    return result.sensitive ? { sensitiveAccess: true, sensitive: result.sensitive } : { sensitiveAccess: false };
  };
}
