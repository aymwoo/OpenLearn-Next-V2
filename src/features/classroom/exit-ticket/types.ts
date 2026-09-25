/**
 * Types for Adaptive Exit Ticket, Concept Wordcloud, and Knowledge Tree Lighting
 */

export interface AdaptiveCoreQuestion {
  id: string;
  question: string;
  options: Array<{ key: string; text: string }>;
  correctOption: string;
  explanation: string;
  scaffoldHint: string; // 答错时下发的支架提示
}

export interface AdaptiveChallengeQuestion {
  id: string;
  title: string;
  prompt: string;
  options: Array<{ key: string; text: string }>;
  correctOption: string;
  rewardBadge: string;
}

export type ExitTicketTier = 'passed' | 'remediation' | 'challenge_done';

export interface ExitTicketSubmission {
  studentId: string;
  studentName: string;
  rating: number; // 1~5
  puzzledConcept: string;
  feedbackNotes?: string;
  coreAnswer?: string;
  isCorrect?: boolean;
  tierLevel?: ExitTicketTier;
  challengeAnswer?: string;
  submittedAt?: number;
}

export interface ClusteredConcept {
  concept: string;
  frequency: number;
  weight: number; // 0.0 ~ 1.0
  remediationAdvice: string; // 教师2分钟收口总结建议话术
}

export interface KnowledgeTreeNode {
  id: string;
  name: string;
  phase: 'prerequisite' | 'core_lesson' | 'advanced_derivation';
  status: 'locked' | 'illuminating' | 'illuminated';
  masteryPercent: number; // 0 ~ 100
  connections: string[]; // 连接的下级节点 id
  description: string;
}
