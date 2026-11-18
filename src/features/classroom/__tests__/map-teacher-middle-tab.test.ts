import { describe, it, expect } from 'vitest';
import { mapTeacherMiddleTabToStudentTab } from '../map-teacher-middle-tab';

describe('mapTeacherMiddleTabToStudentTab', () => {
  it('透传 whiteboard / assignment', () => {
    expect(mapTeacherMiddleTabToStudentTab('whiteboard')).toBe('whiteboard');
    expect(mapTeacherMiddleTabToStudentTab('assignment')).toBe('assignment');
  });

  it('教师专用中栏回落 courseware', () => {
    expect(mapTeacherMiddleTabToStudentTab('submissions')).toBe('courseware');
    expect(mapTeacherMiddleTabToStudentTab('top_performers')).toBe('courseware');
    expect(mapTeacherMiddleTabToStudentTab('segment_main')).toBe('courseware');
  });
});
