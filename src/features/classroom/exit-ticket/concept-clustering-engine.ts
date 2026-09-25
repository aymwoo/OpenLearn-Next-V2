import type { ClusteredConcept } from './types';

const STOP_WORDS = new Set([
  '老师', '今天', '这个', '我们', '概念', '感觉', '还是', '什么', '没有',
  '关于', '为什么', '有点', '不太', '不懂', '听不懂', '不是很', '想问',
  '请问', '这道题', '课件', '大家', '自己', '一些', '可以', '需要', '以及',
  'the', 'a', 'an', 'and', 'or', 'in', 'of', 'to', 'is', 'for', 'with',
]);

const CANONICAL_CONCEPT_MAP: Record<string, { standard: string; advice: string }> = {
  微元: {
    standard: '变力做功与微元累加法',
    advice: '提示学生：变力无法直接用 W=Fs，必须将位移无限细分为小段 Δs，在每小段内力近似恒定，其几何本质即为 F-s 图象下的面积！',
  },
  积分: {
    standard: '变力做功与微元累加法',
    advice: '提示学生：微元积分在物理上的直观体现就是曲线下的梯形累加，重点理解“以恒代变”的思想。',
  },
  临界: {
    standard: '斜面滑动临界条件与摩擦突变',
    advice: '强调静摩擦力与滑动摩擦力的突变边界：当 tanθ=μ 时物块恰好匀速下滑；若外界压力突变，摩擦力立刻进入动摩擦计算。',
  },
  摩擦: {
    standard: '斜面滑动临界条件与摩擦突变',
    advice: '引导学生回顾摩擦力性质三步判断法：先定接触面、再找相对运动趋势、最后联立平衡方程。',
  },
  动量: {
    standard: '动量与机械能综合转化边界',
    advice: '请全班同学牢记：系统不受外力则动量必然守恒；但机械能守恒要求无摩擦生热（内能损耗），两者切忌混淆。',
  },
  守恒: {
    standard: '动量与机械能综合转化边界',
    advice: '提醒学生先画出始末状态示意图，明确研究对象是单个质点还是系统，再列守恒守恒方程。',
  },
  公式: {
    standard: '公式推导步骤与符号正负定义',
    advice: '板书提示：先规定正方向！标量与矢量运算法则不同，动能定理 W总=ΔEk 是标量式，无需分解正交方向。',
  },
  单位: {
    standard: '国际单位制量纲核验',
    advice: '交卷前花10秒做量纲检查：功的单位是 N·m (焦耳 J)，等式两侧单位必须严格自洽。',
  },
};

/**
 * 聚类全班学生填写的疑点概念，并输出 Top 卡点与教师 2 分钟收口教学建议
 */
export function clusterPuzzledConcepts(
  rawInputs: string[],
  topN = 3,
): ClusteredConcept[] {
  if (!rawInputs || rawInputs.length === 0) {
    return [
      {
        concept: '变力做功微元累加与动能定理',
        frequency: 1,
        weight: 0.5,
        remediationAdvice: '提示学生重点掌握 F-s 图象面积求功的物理思想，下课前再强调一遍标量方程特性。',
      },
      {
        concept: '动量守恒与机械能转化临界条件',
        frequency: 1,
        weight: 0.5,
        remediationAdvice: '引导学生分清动量守恒与机械能守恒的适用前提，防止在有摩擦碰撞时误用机械能守恒。',
      },
    ];
  }

  const clusterCounts: Record<string, { count: number; advice: string }> = {};

  for (const raw of rawInputs) {
    if (!raw || typeof raw !== 'string') continue;
    const clean = raw.trim();
    if (!clean) continue;

    let matched = false;
    const matchedStandards = new Set<string>();
    for (const [key, config] of Object.entries(CANONICAL_CONCEPT_MAP)) {
      if (clean.includes(key)) {
        matchedStandards.add(config.standard);
      }
    }

    if (matchedStandards.size > 0) {
      for (const std of matchedStandards) {
        const config = Object.values(CANONICAL_CONCEPT_MAP).find((c) => c.standard === std);
        if (!clusterCounts[std]) {
          clusterCounts[std] = { count: 0, advice: config?.advice || '' };
        }
        clusterCounts[std].count += 1;
      }
      matched = true;
    }

    if (!matched) {
      // 简单分词与去除停用词
      const words = clean.split(/[\s,，、。！？；;]+/);
      for (const w of words) {
        if (w.length >= 2 && !STOP_WORDS.has(w)) {
          const fallbackStandard = w.length > 10 ? w.slice(0, 10) : w;
          if (!clusterCounts[fallbackStandard]) {
            clusterCounts[fallbackStandard] = {
              count: 0,
              advice: `针对「${fallbackStandard}」，建议教师在下课前引导全班回顾核心定义与典型例题解题步骤。`,
            };
          }
          clusterCounts[fallbackStandard].count += 1;
        }
      }
    }
  }

  const totalHits = Object.values(clusterCounts).reduce((sum, item) => sum + item.count, 0) || 1;

  const sorted = Object.entries(clusterCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([concept, data]) => ({
      concept,
      frequency: data.count,
      weight: parseFloat((data.count / totalHits).toFixed(2)),
      remediationAdvice: data.advice,
    }));

  if (sorted.length === 0) {
    return [
      {
        concept: '本堂综合概念融合',
        frequency: 1,
        weight: 1.0,
        remediationAdvice: '全班掌握度整体良好，教师可进行常规要点归纳并下发课后拓展题。',
      },
    ];
  }

  return sorted;
}
