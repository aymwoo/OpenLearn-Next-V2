import { describe, it, expect } from 'vitest';
import {
  groupStudentsHomogeneous,
  groupStudentsHeterogeneous,
  groupStudentsRandom,
  executeGrouping,
  type StudentCandidate,
} from '../breakout-engine';

describe('BreakoutGroupingEngine', () => {
  const mockStudents: StudentCandidate[] = [
    { id: 's1', name: '优等生A', tier: 'advanced', score: 95 },
    { id: 's2', name: '优等生B', tier: 'advanced', score: 92 },
    { id: 's3', name: '中坚生C', tier: 'intermediate', score: 80 },
    { id: 's4', name: '中坚生D', tier: 'intermediate', score: 78 },
    { id: 's5', name: '中坚生E', tier: 'intermediate', score: 75 },
    { id: 's6', name: '中坚生F', tier: 'intermediate', score: 72 },
    { id: 's7', name: '基础生G', tier: 'basic', score: 60 },
    { id: 's8', name: '基础生H', tier: 'basic', score: 55 },
  ];

  it('partitions students homogeneously by tiers (同质分层分组)', () => {
    const groups = groupStudentsHomogeneous(mockStudents, 4);
    expect(groups.length).toBe(4);

    // Group 1 (拔高组) should contain top students
    expect(groups[0].memberIds).toContain('s1');
    expect(groups[0].memberIds).toContain('s2');

    // Group 4 (基础组) should contain basic tier students
    expect(groups[3].memberIds).toContain('s7');
    expect(groups[3].memberIds).toContain('s8');
  });

  it('balances students heterogeneously via snake distribution (异质互助拼板)', () => {
    const groups = groupStudentsHeterogeneous(mockStudents, 2);
    expect(groups.length).toBe(2);

    // Both groups should receive one of the top students (s1, s2)
    expect(groups[0].memberIds.includes('s1') || groups[0].memberIds.includes('s2')).toBe(true);
    expect(groups[1].memberIds.includes('s1') || groups[1].memberIds.includes('s2')).toBe(true);

    // Both groups should also receive one of the basic students (s7, s8)
    expect(groups[0].memberIds.includes('s7') || groups[0].memberIds.includes('s8')).toBe(true);
    expect(groups[1].memberIds.includes('s7') || groups[1].memberIds.includes('s8')).toBe(true);
  });

  it('distributes students evenly with random grouping strategy', () => {
    const groups = groupStudentsRandom(mockStudents, 4, () => 0.5);
    expect(groups.length).toBe(4);
    const totalAssigned = groups.reduce((acc, g) => acc + g.memberIds.length, 0);
    expect(totalAssigned).toBe(mockStudents.length);
  });

  it('routes correctly via executeGrouping dispatcher', () => {
    const homo = executeGrouping(mockStudents, 2, 'homogeneous');
    expect(homo[0].name).toContain('拔高组');

    const hetero = executeGrouping(mockStudents, 2, 'heterogeneous');
    expect(hetero[0].name).toContain('拼板互助');
  });

  it('gracefully handles empty inputs and edge group counts', () => {
    expect(executeGrouping([], 4)).toEqual([
      expect.objectContaining({ memberIds: [] }),
      expect.objectContaining({ memberIds: [] }),
      expect.objectContaining({ memberIds: [] }),
      expect.objectContaining({ memberIds: [] }),
    ]);
    expect(executeGrouping(mockStudents, 0)).toEqual([]);
  });
});
