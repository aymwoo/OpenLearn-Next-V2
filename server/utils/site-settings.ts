import type Database from 'better-sqlite3';

const HAN_CHAR_RE = /\p{Script=Han}/u;
const MAX_LOOKUP_NAME_LEN = 64;

/**
 * 读取站点设置中的「登录页公开查询学号」开关。
 * 未显式配置或缺失记录时默认返回 true（贴合机房/课堂开箱即用体验）。
 */
export function isPublicStudentLookupEnabled(db: Database.Database): boolean {
  try {
    const row = db.prepare('SELECT allow_public_student_lookup FROM site_settings WHERE id = ?').get('global') as
      { allow_public_student_lookup?: number | null } | undefined;
    if (!row || row.allow_public_student_lookup === undefined || row.allow_public_student_lookup === null) {
      return true;
    }
    return Boolean(row.allow_public_student_lookup);
  } catch {
    // 兼容极简单元测试表未含该列的场景，保持默认开启行为
    return true;
  }
}

/**
 * 校验并规范化公开学号查询的学生姓名参数。
 * 要求：至少包含 1 个汉字或至少 2 个非空白字符，且长度不超过 64 个字符。
 */
export function validatePublicStudentLookupName(
  rawName: unknown,
): { ok: true; name: string } | { ok: false; error: string } {
  const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      error: '请输入学生姓名（至少 2 个字符或 1 个汉字） / Please enter a student name (at least 2 characters)',
    };
  }
  if (trimmed.length > MAX_LOOKUP_NAME_LEN) {
    return {
      ok: false,
      error: '查询姓名过长，请控制在 64 个字符以内 / Query name must not exceed 64 characters',
    };
  }
  const compactLen = trimmed.replace(/\s+/g, '').length;
  if (!HAN_CHAR_RE.test(trimmed) && compactLen < 2) {
    return {
      ok: false,
      error: '请输入至少 2 个字符或 1 个汉字 / Please enter at least 2 characters (or 1 Chinese character)',
    };
  }
  return { ok: true, name: trimmed };
}
