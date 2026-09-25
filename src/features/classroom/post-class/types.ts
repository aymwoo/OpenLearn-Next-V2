export type ReflectionType = 'highlight' | 'bottleneck' | 'action_item';

export interface PacingAlert {
  minute: number;
  type: 'CONFUSED' | 'TOO_FAST';
  count: number;
  percentage: number;
  contextConcept?: string;
}

export interface CoPilotReflectionReport {
  lectureRatio: number; // 0 - 100
  recommendedLectureMaxRatio: number; // usually 55%
  interactionCoverage: number; // 0 - 100
  pacingAlerts: PacingAlert[];
  strengths: {
    title: string;
    description: string;
    metricTag?: string;
  }[];
  bottlenecks: {
    title: string;
    description: string;
    attribution: string;
    metricTag?: string;
  }[];
  actionableSuggestions: {
    title: string;
    suggestion: string;
    timing: 'next_pre_class' | 'next_in_class' | 'homework';
  }[];
}

export type FollowupTierType = 'TIER_A_ADVANCED' | 'TIER_B_STANDARD' | 'TIER_C_REINFORCE';

export interface TierStudentItem {
  studentId: string;
  studentName: string;
  studentNumber: string;
  quizScore: number | null;
  exitRating: number | null;
  puzzledConcept?: string;
}

export interface FollowupTierGroup {
  tier: FollowupTierType;
  title: string;
  subtitle: string;
  badgeColor: string;
  packageTitle: string;
  packageDescription: string;
  resourceCount: number;
  resourceType: 'challenge_task' | 'standard_quiz' | 'micro_lesson_card';
  students: TierStudentItem[];
}

export interface StudentPersonalDigest {
  studentId: string;
  studentName: string;
  studentNumber: string;
  attendance: string;
  quizScore: number | null;
  accuracy: number | null;
  pollsAnswered: number;
  exitRating: number | null;
  puzzledConcept?: string;
  tier: FollowupTierType;
  tierLabel: string;
  badges: {
    id: string;
    name: string;
    icon: string;
    desc: string;
  }[];
  teacherNote: string;
  parentReportText: string;
}
