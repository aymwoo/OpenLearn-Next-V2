export type PickerTier = 'basic' | 'intermediate' | 'advanced';
export type PickerMode = 'fair_all' | 'tiered';
export type EvaluationRating = 'excellent' | 'good' | 'encourage';

export interface PickerStudent {
  id: string;
  name: string;
  email?: string;
  student_number?: string;
  term_picked_count?: number;
  lesson_picked_count?: number;
  last_picked_time?: number | null;
  total_reward_coins?: number;
  tier?: PickerTier;
}

export interface EvaluationRewardConfig {
  rating: EvaluationRating;
  label: string;
  labelEn: string;
  score: number;
  rewardCoins: number;
  badge: string;
  colorClass: string;
}

export const EVALUATION_CONFIGS: Record<EvaluationRating, EvaluationRewardConfig> = {
  excellent: {
    rating: 'excellent',
    label: '卓越表现',
    labelEn: 'Excellent',
    score: 3,
    rewardCoins: 10,
    badge: '🌟',
    colorClass: 'from-amber-400 to-yellow-500 text-yellow-950',
  },
  good: {
    rating: 'good',
    label: '良好完成',
    labelEn: 'Good',
    score: 2,
    rewardCoins: 5,
    badge: '👍',
    colorClass: 'from-emerald-400 to-teal-500 text-emerald-950',
  },
  encourage: {
    rating: 'encourage',
    label: '值得鼓励',
    labelEn: 'Encourage',
    score: 1,
    rewardCoins: 2,
    badge: '💪',
    colorClass: 'from-orange-400 to-amber-500 text-orange-950',
  },
};

/**
 * 计算候选学生的公平抽问权重
 * 规则：W_i = 1 / (1 + 3 * C_lesson + C_term)
 * 本堂课已抽中次数衰减因子为 3，学期累计抽中次数衰减因子为 1
 */
export function calculateStudentWeight(student: PickerStudent): number {
  const lessonCount = Math.max(0, student.lesson_picked_count || 0);
  const termCount = Math.max(0, student.term_picked_count || 0);
  return 1 / (1 + 3 * lessonCount + termCount);
}

/**
 * 分层过滤候选人池
 * 若指定梯度有对应学生，返回该梯度的学生集合；若为空，则优雅回退至全员
 */
export function filterCandidatesByTier(
  students: PickerStudent[],
  difficulty: PickerTier,
): { filtered: PickerStudent[]; fallback: boolean } {
  if (!students || students.length === 0) {
    return { filtered: [], fallback: false };
  }
  const tiered = students.filter((s) => s.tier === difficulty);
  if (tiered.length > 0) {
    return { filtered: tiered, fallback: false };
  }
  return { filtered: students, fallback: true };
}

/**
 * 公平加权轮盘抽问算法核心函数
 * @param candidates 候选学生池
 * @param rng 可选伪随机数生成器（便于测试注入）
 * @returns 选中的学生及计算出的权重
 */
export function pickStudentFairly(
  candidates: PickerStudent[],
  rng: () => number = Math.random,
): { student: PickerStudent; weight: number } | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1) {
    return { student: candidates[0], weight: calculateStudentWeight(candidates[0]) };
  }

  const weights = candidates.map((s) => calculateStudentWeight(s));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  if (totalWeight <= 0) {
    const idx = Math.floor(rng() * candidates.length);
    return { student: candidates[idx], weight: 1 };
  }

  const randomPoint = rng() * totalWeight;
  let runningSum = 0;

  for (let i = 0; i < candidates.length; i++) {
    runningSum += weights[i];
    if (randomPoint <= runningSum || i === candidates.length - 1) {
      return { student: candidates[i], weight: weights[i] };
    }
  }

  return { student: candidates[0], weight: weights[0] };
}
