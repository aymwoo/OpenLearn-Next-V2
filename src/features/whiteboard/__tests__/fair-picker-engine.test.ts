import { describe, it, expect } from 'vitest';
import {
  calculateStudentWeight,
  filterCandidatesByTier,
  pickStudentFairly,
  type PickerStudent,
} from '../services/fair-picker-engine';

describe('FairPickerEngine', () => {
  const mockStudents: PickerStudent[] = [
    {
      id: 's1',
      name: '张明',
      lesson_picked_count: 0,
      term_picked_count: 0,
      tier: 'basic',
    },
    {
      id: 's2',
      name: '李华',
      lesson_picked_count: 1,
      term_picked_count: 1,
      tier: 'intermediate',
    },
    {
      id: 's3',
      name: '王超',
      lesson_picked_count: 0,
      term_picked_count: 3,
      tier: 'advanced',
    },
    {
      id: 's4',
      name: '赵丽',
      lesson_picked_count: 2,
      term_picked_count: 4,
      tier: 'basic',
    },
  ];

  describe('calculateStudentWeight', () => {
    it('calculates maximum weight (1.0) for a student with zero picks', () => {
      const weight = calculateStudentWeight(mockStudents[0]);
      expect(weight).toBe(1.0);
    });

    it('heavily penalizes students picked in the current lesson (factor 3)', () => {
      // s2: 1 / (1 + 3*1 + 1) = 1/5 = 0.2
      const weight = calculateStudentWeight(mockStudents[1]);
      expect(weight).toBeCloseTo(0.2, 4);
    });

    it('accounts for term-wide pick counts', () => {
      // s3: 1 / (1 + 3*0 + 3) = 1/4 = 0.25
      const weight = calculateStudentWeight(mockStudents[2]);
      expect(weight).toBeCloseTo(0.25, 4);
    });

    it('reduces weight appropriately for frequently picked students', () => {
      // s4: 1 / (1 + 3*2 + 4) = 1/11 ~= 0.0909
      const weight = calculateStudentWeight(mockStudents[3]);
      expect(weight).toBeCloseTo(1 / 11, 4);
    });
  });

  describe('filterCandidatesByTier', () => {
    it('filters candidates by requested difficulty tier', () => {
      const { filtered, fallback } = filterCandidatesByTier(mockStudents, 'basic');
      expect(fallback).toBe(false);
      expect(filtered.length).toBe(2);
      expect(filtered.map((s) => s.id)).toEqual(['s1', 's4']);
    });

    it('gracefully falls back to all candidates if no student matches requested tier', () => {
      const singleGroup: PickerStudent[] = [
        { id: 's1', name: '张明', tier: 'basic' },
      ];
      const { filtered, fallback } = filterCandidatesByTier(singleGroup, 'advanced');
      expect(fallback).toBe(true);
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe('s1');
    });

    it('handles empty input gracefully', () => {
      const { filtered, fallback } = filterCandidatesByTier([], 'intermediate');
      expect(fallback).toBe(false);
      expect(filtered).toEqual([]);
    });
  });

  describe('pickStudentFairly', () => {
    it('returns null when candidates list is empty', () => {
      expect(pickStudentFairly([])).toBeNull();
    });

    it('returns the single candidate directly', () => {
      const result = pickStudentFairly([mockStudents[0]]);
      expect(result).not.toBeNull();
      expect(result?.student.id).toBe('s1');
      expect(result?.weight).toBe(1.0);
    });

    it('picks the candidate based on weighted probability accurately via mock RNG', () => {
      // Weights: s1=1.0, s2=0.2. Total=1.2
      const pair = [mockStudents[0], mockStudents[1]];

      // RNG returning 0.1 -> randomPoint = 0.1 * 1.2 = 0.12 <= 1.0 (s1)
      const pick1 = pickStudentFairly(pair, () => 0.1);
      expect(pick1?.student.id).toBe('s1');

      // RNG returning 0.95 -> randomPoint = 0.95 * 1.2 = 1.14 > 1.0 (s2)
      const pick2 = pickStudentFairly(pair, () => 0.95);
      expect(pick2?.student.id).toBe('s2');
    });
  });
});
