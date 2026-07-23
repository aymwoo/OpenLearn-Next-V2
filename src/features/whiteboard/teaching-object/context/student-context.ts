import type { TeachingRole } from '../types.js';

export interface StudentContextState {
  currentRole: TeachingRole;
  studentId?: string;
  studentName?: string;
}

export class StudentContextManager {
  private state: StudentContextState = {
    currentRole: 'teacher',
  };

  public getRole(): TeachingRole {
    return this.state.currentRole;
  }

  public setRole(role: TeachingRole, studentId?: string, studentName?: string): void {
    this.state = {
      currentRole: role,
      studentId,
      studentName,
    };
  }
}

export const studentContextManager = new StudentContextManager();
