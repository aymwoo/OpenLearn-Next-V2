/**
 * OpenLearn Classroom Runtime - Session Manager Subsystem
 * Manages Classroom Session creation, join, leave, reconnect, and destruction.
 */

import { UserParticipant, RuntimeEventMap } from './types.js';
import { RuntimeEventBus } from './event-bus.js';
import { RuntimeStateManager } from './state-manager.ts';

export interface ClassroomSessionData {
  readonly sessionId: string;
  readonly courseId?: string;
  readonly lessonId?: string;
  readonly teacher: UserParticipant;
  readonly students: ReadonlyArray<UserParticipant>;
  readonly createdAt: number;
  readonly status: 'created' | 'active' | 'destroyed';
}

export class ClassroomSessionManager {
  private activeSession: ClassroomSessionData | null = null;
  private eventBus: RuntimeEventBus;
  private stateManager: RuntimeStateManager;

  constructor(eventBus: RuntimeEventBus, stateManager: RuntimeStateManager) {
    this.eventBus = eventBus;
    this.stateManager = stateManager;
  }

  /**
   * Create a new Classroom Session.
   */
  public async createSession(
    sessionId: string,
    teacher: UserParticipant,
    courseId?: string,
    lessonId?: string
  ): Promise<ClassroomSessionData> {
    if (this.activeSession && this.activeSession.status === 'active') {
      await this.destroySession();
    }

    const session: ClassroomSessionData = {
      sessionId,
      courseId,
      lessonId,
      teacher,
      students: Object.freeze([]),
      createdAt: Date.now(),
      status: 'active',
    };

    this.activeSession = session;
    this.stateManager.updateState({
      lesson: {
        activeLessonId: lessonId,
        status: 'ready',
      },
    });

    await this.eventBus.publish('SessionCreated', {
      sessionId,
      teacherId: teacher.id,
      timestamp: Date.now(),
    });

    return session;
  }

  /**
   * Join a student into the active session.
   */
  public async joinSession(student: UserParticipant): Promise<boolean> {
    if (!this.activeSession || this.activeSession.status !== 'active') return false;

    const updatedStudents = [...this.activeSession.students.filter((s) => s.id !== student.id), { ...student, isOnline: true }];
    this.activeSession = {
      ...this.activeSession,
      students: Object.freeze(updatedStudents),
    };

    this.stateManager.addStudent(student);

    await this.eventBus.publish('StudentJoined', {
      student,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Leave a student from the active session.
   */
  public async leaveSession(studentId: string): Promise<boolean> {
    if (!this.activeSession || this.activeSession.status !== 'active') return false;

    const updatedStudents = this.activeSession.students.map((s) =>
      s.id === studentId ? { ...s, isOnline: false } : s
    );

    this.activeSession = {
      ...this.activeSession,
      students: Object.freeze(updatedStudents),
    };

    this.stateManager.removeStudent(studentId);

    await this.eventBus.publish('StudentLeft', {
      studentId,
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Reconnect a student back into active session.
   */
  public async reconnectSession(studentId: string): Promise<boolean> {
    if (!this.activeSession || this.activeSession.status !== 'active') return false;

    const existing = this.activeSession.students.find((s) => s.id === studentId);
    if (!existing) return false;

    const reconnected: UserParticipant = { ...existing, isOnline: true };
    return this.joinSession(reconnected);
  }

  /**
   * Destroy the current classroom session.
   */
  public async destroySession(): Promise<void> {
    if (!this.activeSession) return;

    this.activeSession = {
      ...this.activeSession,
      status: 'destroyed',
    };

    this.activeSession = null;
  }

  /**
   * Get active session details.
   */
  public getActiveSession(): ClassroomSessionData | null {
    return this.activeSession;
  }
}
