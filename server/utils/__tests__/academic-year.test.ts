import { describe, it, expect } from 'vitest';
import {
  isValidAcademicYear,
  normalizeAcademicYear,
  deriveAcademicYear,
  getCurrentAcademicYear,
  parseAcademicYearList,
  getAdjacentAcademicYear,
  getDefaultComparisonAcademicYears,
} from '../academic-year.js';

describe('academic-year utils', () => {
  it('validates contiguous years', () => {
    expect(isValidAcademicYear('2025-2026')).toBe(true);
    expect(isValidAcademicYear('2025-2024')).toBe(false);
    expect(isValidAcademicYear('2025')).toBe(false);
  });

  it('normalizes values', () => {
    expect(normalizeAcademicYear('2025-2026')).toBe('2025-2026');
    expect(normalizeAcademicYear('all')).toBeNull();
    expect(normalizeAcademicYear('bad')).toBeNull();
  });

  it('derives year from dates using start month 9', () => {
    expect(deriveAcademicYear('2025-08-31')).toBe('2024-2025');
    expect(deriveAcademicYear('2025-09-01')).toBe('2025-2026');
    expect(deriveAcademicYear('2025-01-01')).toBe('2024-2025');
  });

  it('computes current year', () => {
    expect(getCurrentAcademicYear(9, new Date('2025-08-15'))).toBe('2024-2025');
    expect(getCurrentAcademicYear(9, new Date('2025-09-15'))).toBe('2025-2026');
  });

  it('parses academic year lists with filtering and ordering', () => {
    expect(parseAcademicYearList('2025-2026, 2024-2025, invalid, 2025-2026')).toEqual(['2024-2025', '2025-2026']);
    expect(parseAcademicYearList(['2026-2027', '2024-2025'])).toEqual(['2024-2025', '2026-2027']);
    expect(parseAcademicYearList(null)).toEqual([]);
    expect(parseAcademicYearList('')).toEqual([]);
  });

  it('calculates adjacent academic years', () => {
    expect(getAdjacentAcademicYear('2025-2026', -1)).toBe('2024-2025');
    expect(getAdjacentAcademicYear('2025-2026', 1)).toBe('2026-2027');
    expect(getAdjacentAcademicYear('invalid', -1)).toBeNull();
  });

  it('generates default comparison academic years (prev & curr)', () => {
    const fixedNow = new Date('2025-10-01');
    expect(getDefaultComparisonAcademicYears(9, fixedNow)).toEqual(['2024-2025', '2025-2026']);
  });
});
