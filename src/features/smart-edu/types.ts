export interface SmartEduCourseResource {
  id: string;
  code: string;
  title: string;
  subject: 'information_tech' | 'physics' | 'general_tech' | 'math';
  grade: 'high_1' | 'high_2' | 'high_3' | 'junior' | 'primary';
  edition: 'zhejiang' | 'pep' | 'sujiao' | 'jk';
  awardLevel: 'national_gold' | 'national_silver' | 'ministry_excellent';
  teacherName: string;
  schoolName: string;
  summary: string;
  tags: string[];
  coverGradient: string;
  timeline: Array<{
    id: string;
    title: string;
    type: 'lecture' | 'practice' | 'discussion' | 'quiz';
    duration: number;
    description: string;
  }>;
}

export interface SmartEduStatus {
  connected: boolean;
  endpoint: string;
  rttMs: number;
  certValidUntil: string;
  channelStatus: string;
  syncedCoursesCount: number;
  syncMode: string;
  lastHeartbeat: string;
}
