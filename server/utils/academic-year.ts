export const ACADEMIC_YEAR_RE = /^\d{4}-\d{4}$/;

/**
 * 学年字符串必须是 `YYYY-YYYY` 且第二年 = 第一年 + 1。
 */
export function isValidAcademicYear(value: unknown): value is string {
  if (typeof value !== 'string' || !ACADEMIC_YEAR_RE.test(value)) return false;
  const [start, end] = value.split('-').map(Number);
  return end === start + 1;
}

/**
 * 标准化外部输入；非法值返回 null（表示「未分类/不筛选」）。
 */
export function normalizeAcademicYear(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'all') return null;
  return isValidAcademicYear(trimmed) ? trimmed : null;
}

/**
 * 根据日期（YYYY-MM-DD 或 Unix ms）推导所属学年。
 * startMonth 默认 9，表示 9 月起算新学年。
 */
export function deriveAcademicYear(
  date: string | number | Date,
  startMonth = 9,
): string | null {
  let year: number;
  let month: number; // 0-based
  if (typeof date === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
    if (!m) return null;
    year = Number(m[1]);
    month = Number(m[2]) - 1;
  } else {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    year = d.getFullYear();
    month = d.getMonth();
  }

  const academicStartYear = month + 1 >= startMonth ? year : year - 1;
  return `${academicStartYear}-${academicStartYear + 1}`;
}

/**
 * 根据当前日期与学年起始月推算当前学年。
 */
export function getCurrentAcademicYear(startMonth = 9, now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const academicStartYear = month >= startMonth ? year : year - 1;
  return `${academicStartYear}-${academicStartYear + 1}`;
}
