import type {
  FollowupTierType,
  FollowupTierGroup,
  TierStudentItem,
  StudentPersonalDigest,
} from './types';

export interface RawStudentRecord {
  id: string;
  name: string;
  studentNumber: string;
  attendance: string;
  quizScore: number | null;
  accuracy: number | null;
  pollsAnswered: number;
  rating: number | null;
  puzzledConcept?: string;
  status?: string;
  note?: string;
}

/**
 * 依据测验得分与 Exit Ticket 综合判定学生所处梯队
 */
export function classifyStudentTier(student: RawStudentRecord): FollowupTierType {
  const score = student.quizScore ?? (student.rating ? student.rating * 20 : 75);

  if (score >= 90 && (student.rating === null || student.rating >= 4)) {
    return 'TIER_A_ADVANCED';
  }

  if (score < 70 || (student.rating !== null && student.rating <= 2)) {
    return 'TIER_C_REINFORCE';
  }

  return 'TIER_B_STANDARD';
}

/**
 * 将班级学生按能力与掌握度聚类为三级差异化课后跟进任务组
 */
export function buildFollowupTiers(
  students: RawStudentRecord[],
  lessonTitle: string = '本节课',
): FollowupTierGroup[] {
  const tierAStudents: TierStudentItem[] = [];
  const tierBStudents: TierStudentItem[] = [];
  const tierCStudents: TierStudentItem[] = [];

  students.forEach((s) => {
    const tier = classifyStudentTier(s);
    const item: TierStudentItem = {
      studentId: s.id,
      studentName: s.name,
      studentNumber: s.studentNumber,
      quizScore: s.quizScore,
      exitRating: s.rating,
      puzzledConcept: s.puzzledConcept,
    };

    if (tier === 'TIER_A_ADVANCED') {
      tierAStudents.push(item);
    } else if (tier === 'TIER_C_REINFORCE') {
      tierCStudents.push(item);
    } else {
      tierBStudents.push(item);
    }
  });

  return [
    {
      tier: 'TIER_A_ADVANCED',
      title: 'A 梯队 · 通关拔高型',
      subtitle: '核心概念已通关，重在发展高阶思维与探究迁移',
      badgeColor: 'emerald',
      packageTitle: `【拔高拓展包】${lessonTitle} 高阶物理探究与综合挑战题`,
      packageDescription: '包含 1 道开放性工程探究任务 + 1 道多情境复合受力分析变式题。',
      resourceCount: 2,
      resourceType: 'challenge_task',
      students: tierAStudents,
    },
    {
      tier: 'TIER_B_STANDARD',
      title: 'B 梯队 · 稳健巩固型',
      subtitle: '概念掌握良好，重在变式巩固与答题熟练度',
      badgeColor: 'blue',
      packageTitle: `【稳健巩固包】${lessonTitle} 核心考点过关精选 3 题`,
      packageDescription: '针对随堂测典型考点进行正向迁移演练，强化解题规范与公式应用。',
      resourceCount: 3,
      resourceType: 'standard_quiz',
      students: tierBStudents,
    },
    {
      tier: 'TIER_C_REINFORCE',
      title: 'C 梯队 · 支架补强型',
      subtitle: '部分公式或步骤存在卡点，重在微课回放与图解纠错',
      badgeColor: 'amber',
      packageTitle: `【认知支架包】${lessonTitle} 疑难突破微课 + 概念梳理卡`,
      packageDescription: '内含授课核心片断 3 分钟精要回放、公式符号图解对照卡及 1 道阶梯式填空提示题。',
      resourceCount: 2,
      resourceType: 'micro_lesson_card',
      students: tierCStudents,
    },
  ];
}

/**
 * 生成学生个人课节报告卡与家长同步文案
 */
export function generateStudentPersonalDigest(
  student: RawStudentRecord,
  lessonTitle: string = '本堂课',
  className: string = '高一(1)班',
): StudentPersonalDigest {
  const tier = classifyStudentTier(student);
  const tierMap: Record<FollowupTierType, string> = {
    TIER_A_ADVANCED: 'A 梯队 (卓越拔高)',
    TIER_B_STANDARD: 'B 梯队 (扎实巩固)',
    TIER_C_REINFORCE: 'C 梯队 (定向强基)',
  };

  const badges: StudentPersonalDigest['badges'] = [];

  // 勋章判定
  if (student.pollsAnswered >= 3) {
    badges.push({
      id: 'active_buzzer',
      name: '抢答先锋',
      icon: '⚡',
      desc: `随堂主动互动抢答 ${student.pollsAnswered} 次，思维敏捷`,
    });
  }
  if ((student.quizScore ?? 0) >= 90) {
    badges.push({
      id: 'accuracy_master',
      name: '神准解题官',
      icon: '🎯',
      desc: '随堂测验答题全对，高阶概念迁移达成',
    });
  }
  if (student.rating && student.rating >= 4) {
    badges.push({
      id: 'confidence_star',
      name: '自信领航者',
      icon: '⭐',
      desc: '结课通票自我评估满分，对本节主干理解胸有成竹',
    });
  }
  if (badges.length === 0) {
    badges.push({
      id: 'persistent_scholar',
      name: '笃学潜能星',
      icon: '🌱',
      desc: '全过程完整参与课堂互动，具备持续突破潜力',
    });
  }

  // 教师建议与家长文案
  let teacherNote = '课堂表现沉稳，建议继续保持严谨求真的探究态度。';
  let parentAction = '已完成当堂标准练习，今晚请鼓励孩子保持复习习惯。';

  if (tier === 'TIER_A_ADVANCED') {
    teacherNote = '知识掌握扎实全面，主动参与探究，具备出色的自学与迁移能力。';
    parentAction = '孩子今天课堂表现卓越，系统已为其匹配课后拔高拓展题，鼓励孩子勇于挑战！';
  } else if (tier === 'TIER_C_REINFORCE') {
    teacherNote = `在个别难点推导（${student.puzzledConcept || '概念公式转换'}）上略显困惑，已下发定向微课补强包。`;
    parentAction = '孩子课堂听讲认真，为帮助巩固重难点，老师已下发 3 分钟精要微课，请协助孩子抽空温习。';
  }

  const parentReportText = `【${className}·课堂成长日报】
亲爱的 ${student.name} 家长：
您好！孩子在今天的《${lessonTitle}》课程中：
· 随堂测验得分：${student.quizScore !== null ? `${student.quizScore} 分` : '—'}
· 课堂互动答题：${student.pollsAnswered} 次
· 通票自评星级：${student.rating !== null ? `${student.rating} 星` : '—'}
· 荣获荣誉勋章：${badges.map((b) => `${b.icon} ${b.name}`).join('、')}
【教师评价】：${teacherNote}
【课后跟进】：${parentAction}`;

  return {
    studentId: student.id,
    studentName: student.name,
    studentNumber: student.studentNumber,
    attendance: student.attendance,
    quizScore: student.quizScore,
    accuracy: student.accuracy,
    pollsAnswered: student.pollsAnswered,
    exitRating: student.rating,
    puzzledConcept: student.puzzledConcept,
    tier,
    tierLabel: tierMap[tier],
    badges,
    teacherNote,
    parentReportText,
  };
}
