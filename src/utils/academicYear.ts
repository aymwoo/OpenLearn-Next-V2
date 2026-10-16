export const ACADEMIC_YEAR_RE = /^\d{4}-\d{4}$/;

export function isValidAcademicYear(value: unknown): value is string {
  if (typeof value !== 'string' || !ACADEMIC_YEAR_RE.test(value)) return false;
  const [start, end] = value.split('-').map(Number);
  return end === start + 1;
}

export function normalizeAcademicYear(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'all' || trimmed === '') return null;
  return isValidAcademicYear(trimmed) ? trimmed : null;
}

export function deriveAcademicYear(
  date: string | number | Date,
  startMonth = 9,
): string | null {
  let year: number;
  let month: number;
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
