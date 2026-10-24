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
export function deriveAcademicYear(date: string | number | Date, startMonth = 9): string | null {
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

/**
 * 从学期名称推导学年（如 "2026年春季学期" -> "2025-2026"；"2025年秋季学期" -> "2025-2026"）
 */
export function deriveAcademicYearFromSemesterName(semesterName: string, startMonth = 9): string | null {
  const m = /(\d{4})/.exec(semesterName || '');
  if (!m) return null;
  const year = Number(m[1]);
  const lower = (semesterName || '').toLowerCase();
  // 春季学期通常属于上一年度学年；秋季学期属于本年度学年
  const academicStartYear = lower.includes('春') ? year - 1 : year;
  return `${academicStartYear}-${academicStartYear + 1}`;
}

/**
 * 解析并标准化外部输入的学年列表字符串（逗号分隔或数组）
 * 过滤非法学年并按升序排列
 */
export function parseAcademicYearList(input: unknown): string[] {
  if (!input) return [];
  let rawList: string[] = [];
  if (Array.isArray(input)) {
    rawList = input.map(String);
  } else if (typeof input === 'string') {
    rawList = input.split(',').map((s) => s.trim());
  }
  const validYears = new Set<string>();
  for (const item of rawList) {
    if (isValidAcademicYear(item)) {
      validYears.add(item);
    }
  }
  return Array.from(validYears).sort((a, b) => a.localeCompare(b));
}

/**
 * 获取相邻学年（如 2025-2026 前一年为 2024-2025，后一年为 2026-2027）
 */
export function getAdjacentAcademicYear(year: string, offset = -1): string | null {
  if (!isValidAcademicYear(year)) return null;
  const start = parseInt(year.split('-')[0], 10);
  const targetStart = start + offset;
  return `${targetStart}-${targetStart + 1}`;
}

/**
 * 获取默认对比学年（当前学年及前一学年）
 */
export function getDefaultComparisonAcademicYears(startMonth = 9, now: Date = new Date()): [string, string] {
  const current = getCurrentAcademicYear(startMonth, now);
  const prev =
    getAdjacentAcademicYear(current, -1) ||
    `${parseInt(current.split('-')[0], 10) - 1}-${parseInt(current.split('-')[0], 10)}`;
  return [prev, current];
}
