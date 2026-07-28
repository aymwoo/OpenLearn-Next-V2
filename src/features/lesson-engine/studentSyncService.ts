/**
 * OpenLearn Lesson Flow Engine - Student Synchronization Service
 * Handles real-time synchronization for student devices matching teacher's active Stage & Activity.
 */

import { frontendEventBus } from '../../services/event-bus.js';
import { useLessonEngineStore } from './lessonEngineStore.js';

export class StudentSyncService {
  private isListening = false;
  private unsubscribeFn?: () => void;

  public initialize(): void {
    if (this.isListening) return;

    // Listen to real-time events published via frontendEventBus
    frontendEventBus.subscribe('StudentSynced', (event) => {
      this.handleStudentSynced(event.payload as any);
    });

    frontendEventBus.subscribe('TeacherJump', (event) => {
      this.handleTeacherJump(event.payload as any);
    });

    this.isListening = true;
  }

  private handleStudentSynced(payload: {
    lessonId: string;
    stageId: string;
    activityId?: string;
  }): void {
    const store = useLessonEngineStore.getState();
    // Only auto-jump if user is student or student sync is enabled
    if (store.currentUser.role === 'student' && payload.stageId) {
      store.jumpStage(payload.stageId, payload.activityId);
    }
  }

  private handleTeacherJump(payload: {
    lessonId: string;
    targetStageId: string;
    targetActivityId?: string;
  }): void {
    const store = useLessonEngineStore.getState();
    if (store.currentUser.role === 'student') {
      store.jumpStage(payload.targetStageId, payload.targetActivityId);
    }
  }

  public destroy(): void {
    if (this.unsubscribeFn) {
      this.unsubscribeFn();
    }
    this.isListening = false;
  }
}

export const studentSyncService = new StudentSyncService();
