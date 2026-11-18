/**
 * 教师中栏 tab → 学生课中 tab 广播映射（单一真值）。
 * submissions / top_performers / segment_main 对学生无对应面，回落 courseware。
 */
export type TeacherMiddleTab = 'whiteboard' | 'submissions' | 'assignment' | 'top_performers' | 'segment_main';

export type StudentLessonTab = 'whiteboard' | 'courseware' | 'assignment' | 'xuean';

export function mapTeacherMiddleTabToStudentTab(tab: TeacherMiddleTab): StudentLessonTab {
  if (tab === 'submissions' || tab === 'top_performers' || tab === 'segment_main') {
    return 'courseware';
  }
  return tab;
}
