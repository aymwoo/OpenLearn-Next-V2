/**
 * Types and interfaces for the Peer Review & Showcase subsystem
 * Based on Stitch Screen 21e2dac185074bb6ad4e7ce9671327ee
 * ("OpenLearn Next - 全班大屏作业互评与协同赏析模式")
 */

export interface PeerMatchingItem {
  id: string;
  code: string; // e.g. '#P01'
  reviewerName: string;
  reviewerGroup?: string;
  targetStudentName: string;
  targetWorkTitle: string;
  status: 'submitted' | 'in_progress' | 'completed' | 'improvement';
  statusLabel: string;
  score?: number;
  maxScore?: number;
  stars?: number;
  progressPercent?: number;
  comment?: string;
  isAnonymous?: boolean;
}

export interface LivePeerBadge {
  id: string;
  senderName: string;
  receiverName: string;
  badgeTitle: string;
  emoji: string;
  tagColor: string;
  timestamp?: string;
}

export interface SpotlightWorkItem {
  id: string;
  slot: 'A' | 'B';
  studentName: string;
  studentInitial: string;
  workTitle: string;
  workSubtitle: string;
  /** 真实评分（0-5）；平台无评分来源时为 undefined，UI 显示「—」 */
  rating?: number;
  /** 真实评阅人数；无来源时为 0 */
  reviewCount?: number;
  badges: Array<{ label: string; colorClass: string }>;
  /** 展示用图形类型（纯渲染选择，非数据）；缺省时组件回退 polygon_spiral */
  visualType?: 'polygon_spiral' | 'rect_matrix' | 'custom';
  visualBadgeText?: string;
  /** 代码片段标题与内容：真实作品无代码源时为空，UI 显示占位说明 */
  codeTitle?: string;
  codeLines?: Array<{
    text: string;
    isHighlight?: boolean;
    isSuccess?: boolean;
    indent?: number;
    comment?: string;
  }>;
}

export interface TeacherPeerAnnotation {
  id: string;
  authorType: 'teacher' | 'peer';
  authorRole: string;
  authorName: string;
  timeAgo: string;
  content: string;
  borderColor: string;
}

export interface RubricDimensionItem {
  id: string;
  label: string;
  percentage: number;
  colorClass: string;
  barColorClass: string;
}

export interface NominatedStudent {
  rank: number;
  name: string;
  votes: number;
  workTitle: string;
  honorTitle: string;
  rankBadgeClass: string;
  tagBadgeClass: string;
}

export interface DanmakuItem {
  id: string;
  sender: string;
  text: string;
  type?: 'text' | 'voice' | 'badge';
  voiceDuration?: number;
  topPercent: number; // 10% - 80%
  color?: string;
}

export interface PeerReviewState {
  stage: string;
  isLocked: boolean;
  isDualScreen: boolean;
  isAnonymous: boolean;
  timeRemainingSeconds: number;
  totalTimeSeconds: number;
  isPaused: boolean;
  completedReviews: number;
  totalStudents: number;
  totalLikes: number;
  totalNominations: number;
  showVoiceDanmaku: boolean;
  showDanmaku: boolean;
}
