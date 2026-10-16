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

export function getCurrentAcademicYear(startMonth = 9, now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const academicStartYear = month >= startMonth ? year : year - 1;
  return `${academicStartYear}-${academicStartYear + 1}`;
}
