export type GroupingStrategy = 'homogeneous' | 'heterogeneous' | 'random';
export type StudentTier = 'basic' | 'intermediate' | 'advanced';

export interface StudentCandidate {
  id: string;
  name: string;
  tier?: StudentTier;
  score?: number;
}

export interface BreakoutGroup {
  id: string;
  name: string;
  memberIds: string[];
  color: string;
  focusTier?: StudentTier | 'balanced';
  likesCount?: number;
  inquiryTags?: string[];
  isSpotlight?: boolean;
}

export const GROUP_COLORS = [
  'bg-indigo-500',
  'bg-cyan-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-teal-500',
];

/**
 * 同质分层分组算法：
 * 将学生按学情梯队（advanced -> intermediate -> basic）聚合，同层学生在同组进行针对性攻坚
 */
export function groupStudentsHomogeneous(
  students: StudentCandidate[],
  groupCount: number = 4,
): BreakoutGroup[] {
  if (groupCount <= 0) return [];
  const count = Math.max(1, groupCount);

  // 排序：advanced (优) -> intermediate (中) -> basic (潜)
  const tierWeight: Record<StudentTier, number> = {
    advanced: 3,
    intermediate: 2,
    basic: 1,
  };

  const sorted = [...students].sort((a, b) => {
    const wa = a.tier ? tierWeight[a.tier] : a.score !== undefined ? a.score : 2;
    const wb = b.tier ? tierWeight[b.tier] : b.score !== undefined ? b.score : 2;
    return wb - wa;
  });

  const groups: BreakoutGroup[] = Array.from({ length: count }, (_, i) => {
    let focusTier: StudentTier | 'balanced' = 'intermediate';
    if (i === 0) focusTier = 'advanced';
    else if (i === count - 1) focusTier = 'basic';

    const tierLabel = focusTier === 'advanced' ? '拔高组' : focusTier === 'basic' ? '基础组' : '进阶组';
    return {
      id: `group-${i + 1}`,
      name: `第 ${i + 1} 组 (${tierLabel})`,
      memberIds: [],
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      focusTier,
      likesCount: 0,
      inquiryTags: [],
      isSpotlight: false,
    };
  });

  // 按梯队切片连续填装
  const chunkSize = Math.ceil(sorted.length / count);
  for (let i = 0; i < sorted.length; i++) {
    const targetGroupIdx = Math.min(Math.floor(i / chunkSize), count - 1);
    groups[targetGroupIdx].memberIds.push(sorted[i].id);
  }

  return groups;
}

/**
 * 异质互助拼板分组算法（以优带新）：
 * 轮转蛇形或分池轮流抽取，确保每个小组均衡包含不同梯队学生
 */
export function groupStudentsHeterogeneous(
  students: StudentCandidate[],
  groupCount: number = 4,
): BreakoutGroup[] {
  if (groupCount <= 0) return [];
  const count = Math.max(1, groupCount);

  const tierWeight: Record<StudentTier, number> = {
    advanced: 3,
    intermediate: 2,
    basic: 1,
  };

  const sorted = [...students].sort((a, b) => {
    const wa = a.tier ? tierWeight[a.tier] : a.score !== undefined ? a.score : 2;
    const wb = b.tier ? tierWeight[b.tier] : b.score !== undefined ? b.score : 2;
    return wb - wa;
  });

  const groups: BreakoutGroup[] = Array.from({ length: count }, (_, i) => ({
    id: `group-${i + 1}`,
    name: `第 ${i + 1} 协作组 (拼板互助)`,
    memberIds: [],
    color: GROUP_COLORS[i % GROUP_COLORS.length],
    focusTier: 'balanced',
    likesCount: 0,
    inquiryTags: [],
    isSpotlight: false,
  }));

  // 蛇形交替分发：第一轮 0->count-1，第二轮 count-1->0，确保各组均有骨干引领
  let forward = true;
  let gIndex = 0;

  for (let i = 0; i < sorted.length; i++) {
    groups[gIndex].memberIds.push(sorted[i].id);
    if (forward) {
      if (gIndex === count - 1) {
        forward = false;
      } else {
        gIndex++;
      }
    } else {
      if (gIndex === 0) {
        forward = true;
      } else {
        gIndex--;
      }
    }
  }

  return groups;
}

/**
 * 随机均分分组算法
 */
export function groupStudentsRandom(
  students: StudentCandidate[],
  groupCount: number = 4,
  rng: () => number = Math.random,
): BreakoutGroup[] {
  if (groupCount <= 0) return [];
  const count = Math.max(1, groupCount);

  const shuffled = [...students].sort(() => rng() - 0.5);

  const groups: BreakoutGroup[] = Array.from({ length: count }, (_, i) => ({
    id: `group-${i + 1}`,
    name: `第 ${i + 1} 小组`,
    memberIds: [],
    color: GROUP_COLORS[i % GROUP_COLORS.length],
    focusTier: 'balanced',
    likesCount: 0,
    inquiryTags: [],
    isSpotlight: false,
  }));

  shuffled.forEach((student, index) => {
    const gIndex = index % count;
    groups[gIndex].memberIds.push(student.id);
  });

  return groups;
}

/**
 * 统一分组分发总线
 */
export function executeGrouping(
  students: StudentCandidate[],
  groupCount: number = 4,
  strategy: GroupingStrategy = 'heterogeneous',
  rng: () => number = Math.random,
): BreakoutGroup[] {
  if (strategy === 'homogeneous') {
    return groupStudentsHomogeneous(students, groupCount);
  }
  if (strategy === 'heterogeneous') {
    return groupStudentsHeterogeneous(students, groupCount);
  }
  return groupStudentsRandom(students, groupCount, rng);
}
