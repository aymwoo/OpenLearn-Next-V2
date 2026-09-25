import type { CoPilotReflectionReport, PacingAlert } from './types';

export interface TelemetryInput {
  lessonTitle: string;
  durationMin: number;
  totalStudents: number;
  quizAccuracy: number;
  interactiveCount: number; // 提问与互动参与人次
  pacingData: {
    CLEAR: number;
    CONFUSED: number;
    TOO_FAST: number;
  };
  primaryPuzzledConcept?: string;
  lectureMin?: number;
}

/**
 * 教学副驾反思与学情量化归因启发式引擎
 */
export function generateCoPilotReflection(input: TelemetryInput): CoPilotReflectionReport {
  const duration = Math.max(1, input.durationMin || 45);
  const totalStudents = Math.max(1, input.totalStudents || 30);
  const lectureMinutes = input.lectureMin ?? Math.round(duration * 0.68); // 默认约 68% 讲授
  const lectureRatio = Math.min(100, Math.round((lectureMinutes / duration) * 100));
  const recommendedLectureMaxRatio = 55;

  // 互动覆盖率估算 (人次 / 总人数，封顶 100%)
  const rawCoverage = Math.round((input.interactiveCount / totalStudents) * 100);
  const interactionCoverage = Math.min(100, Math.max(0, rawCoverage));

  const totalPacing = input.pacingData.CLEAR + input.pacingData.CONFUSED + input.pacingData.TOO_FAST || 1;
  const clearPercent = Math.round((input.pacingData.CLEAR / totalPacing) * 100);
  const confusedPercent = Math.round((input.pacingData.CONFUSED / totalPacing) * 100);
  const fastPercent = Math.round((input.pacingData.TOO_FAST / totalPacing) * 100);

  const pacingAlerts: PacingAlert[] = [];
  const primaryConcept = input.primaryPuzzledConcept || '核心公式与模型应用';

  // 模拟/推算困惑波峰时序
  if (confusedPercent >= 10) {
    pacingAlerts.push({
      minute: Math.round(duration * 0.5), // 约课程中间
      type: 'CONFUSED',
      count: input.pacingData.CONFUSED,
      percentage: confusedPercent,
      contextConcept: primaryConcept,
    });
  }
  if (fastPercent >= 8) {
    pacingAlerts.push({
      minute: Math.round(duration * 0.7),
      type: 'TOO_FAST',
      count: input.pacingData.TOO_FAST,
      percentage: fastPercent,
      contextConcept: '难点推导与变式迁移',
    });
  }

  // 1. 课堂亮点 (Strengths)
  const strengths: CoPilotReflectionReport['strengths'] = [];
  if (input.quizAccuracy >= 80) {
    strengths.push({
      title: '核心概念掌握扎实',
      description: `随堂检测整体正答率达 ${input.quizAccuracy}%，知识点理解转化率高，学生具备良好的基础认知。`,
      metricTag: `正答率 ${input.quizAccuracy}%`,
    });
  } else if (input.quizAccuracy >= 60) {
    strengths.push({
      title: '主干知识形成基本框架',
      description: `全班 ${input.quizAccuracy}% 的学生能够正确解答核心随堂测验，课堂学习目标初步达成。`,
      metricTag: `正答率 ${input.quizAccuracy}%`,
    });
  }

  if (clearPercent >= 75) {
    strengths.push({
      title: '课堂主线节奏适宜',
      description: `晴雨表显示 ${clearPercent}% 的学生反馈授课节奏平稳清晰，教学演示与板书逻辑易于吸收。`,
      metricTag: `满意度 ${clearPercent}%`,
    });
  }

  if (input.interactiveCount >= totalStudents * 0.8) {
    strengths.push({
      title: '随堂互动积极热烈',
      description: `互动总人次达到 ${input.interactiveCount} 次，抢答器与投票工具有效调动了课堂气氛。`,
      metricTag: `${input.interactiveCount} 人次`,
    });
  }

  if (strengths.length === 0) {
    strengths.push({
      title: '全流程教学数据完整沉淀',
      description: '师生完整经历了课前预习、课中探究到结课通票的全闭环，为学情复盘提供了完整数据支撑。',
    });
  }

  // 2. 薄弱点与量化归因 (Bottlenecks)
  const bottlenecks: CoPilotReflectionReport['bottlenecks'] = [];

  if (lectureRatio > recommendedLectureMaxRatio) {
    bottlenecks.push({
      title: '教师单向讲授用时偏高',
      description: `讲授时间占比达 ${lectureRatio}%（超出推荐阈值 ${recommendedLectureMaxRatio}%），学生的自主探究与互评表达时间受到挤压。`,
      attribution: '课堂结构失衡：讲解与演算过多，留白探究时间不足。',
      metricTag: `讲授 ${lectureRatio}%`,
    });
  }

  if (interactionCoverage < 45) {
    bottlenecks.push({
      title: '抽问互动覆盖面受限',
      description: `提问与深度互动覆盖率仅 ${interactionCoverage}%，存在部分静默或后排学生未被有效触达。`,
      attribution: '抽问模式偏向主动举手或集中在前排学生，未充分启动公平分层点名。',
      metricTag: `覆盖率 ${interactionCoverage}%`,
    });
  }

  if (confusedPercent >= 15 || input.quizAccuracy < 70) {
    bottlenecks.push({
      title: `重难点卡点聚集: ${primaryConcept}`,
      description: `约 ${confusedPercent}% 的学生在晴雨表或通票中反馈概念理解存在卡点，测验正答率仅 ${input.quizAccuracy}%。`,
      attribution: '该知识点抽象度高，缺乏从直观物理/生活情境到符号推导的认知阶梯。',
      metricTag: `困惑占比 ${confusedPercent}%`,
    });
  }

  if (bottlenecks.length === 0) {
    bottlenecks.push({
      title: '高阶探究挑战度可进一步释放',
      description: '大部分学生已轻松掌握基础内容，基础题训练比重稍显冗余，需提供拔高挑战。',
      attribution: '整体练习梯级跨度偏平缓，学优生潜力尚未完全激发。',
    });
  }

  // 3. 下一课时针对性教学策略 (Actionable Suggestions)
  const actionableSuggestions: CoPilotReflectionReport['actionableSuggestions'] = [];

  if (confusedPercent >= 15 || input.quizAccuracy < 75) {
    actionableSuggestions.push({
      title: '下节课前 3 分钟针对性温故练习',
      suggestion: `在下堂课「课前就绪」阶段，推送针对“${primaryConcept}”的 2 道情境化变式微练习，现场纠正认知误区。`,
      timing: 'next_pre_class',
    });
  }

  if (lectureRatio > recommendedLectureMaxRatio) {
    actionableSuggestions.push({
      title: '重构课堂结构，增加拼板探究与画廊互评',
      suggestion: '下节课建议采用「随堂拼板教学」，将 15 分钟的例题讲解拆为“小组白板分工探索 + 画廊互评展台”，提升生生互动。',
      timing: 'next_in_class',
    });
  }

  if (interactionCoverage < 50) {
    actionableSuggestions.push({
      title: '启用分层随机点名轮盘 (Fair Tiered Picker)',
      suggestion: '授课时开启“分层公平模式”，系统将自动优先呼叫本学期发言频次较低的学生，并根据问题难度精准匹配。',
      timing: 'next_in_class',
    });
  }

  actionableSuggestions.push({
    title: '课后启动差异化分流作业派发',
    suggestion: '依据当堂测评结果，为 A/B/C 三个梯队分别派发拓展探究题、核心巩固题及微课补强包，落实因材施教。',
    timing: 'homework',
  });

  return {
    lectureRatio,
    recommendedLectureMaxRatio,
    interactionCoverage,
    pacingAlerts,
    strengths,
    bottlenecks,
    actionableSuggestions,
  };
}
