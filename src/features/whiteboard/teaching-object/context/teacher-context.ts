import type { PresentationMode, TeachingRole } from '../types.js';

export interface TeacherContextState {
  teacherId: string;
  courseId?: string;
  lessonId?: string;
  currentStepIndex: number;
  presentationMode: PresentationMode;
  isLessonActive: boolean;
}

export class TeacherContextManager {
  private state: TeacherContextState = {
    teacherId: 'teacher-default',
    currentStepIndex: 0,
    presentationMode: 'present',
    isLessonActive: true,
  };

  public getContext(): TeacherContextState {
    return { ...this.state };
  }

  public setContext(patch: Partial<TeacherContextState>): void {
    this.state = { ...this.state, ...patch };
  }

  public setPresentationMode(mode: PresentationMode): void {
    this.state.presentationMode = mode;
  }
}

export const teacherContextManager = new TeacherContextManager();
