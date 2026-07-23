/**
 * OpenLearn Lesson Flow Engine - Teaching Context
 * Provides a unified context accessible by any object, plugin, or component in the classroom.
 */

import { TeachingContextData, Lesson, Flow, Stage, Activity, UserRef, UserRole } from './types.js';

export class TeachingContextManager {
  private data: TeachingContextData = {
    role: 'teacher',
    isPresentationMode: false,
  };

  private listeners = new Set<(context: TeachingContextData) => void>();

  public getContext(): TeachingContextData {
    return { ...this.data };
  }

  public updateContext(partial: Partial<TeachingContextData>): void {
    this.data = {
      ...this.data,
      ...partial,
    };
    this.notify();
  }

  public setCurrentLesson(lesson: Lesson | undefined): void {
    this.data.currentLesson = lesson;
    if (lesson) {
      this.data.teacher = lesson.teacher;
    }
    this.notify();
  }

  public setCurrentFlow(flow: Flow | undefined): void {
    this.data.currentFlow = flow;
    this.notify();
  }

  public setCurrentStage(stage: Stage | undefined): void {
    this.data.currentStage = stage;
    this.notify();
  }

  public setCurrentActivity(activity: Activity | undefined): void {
    this.data.currentActivity = activity;
    this.notify();
  }

  public setUser(user: UserRef): void {
    this.data.currentUser = user;
    this.data.role = user.role;
    this.notify();
  }

  public setPresentationMode(enabled: boolean): void {
    this.data.isPresentationMode = enabled;
    this.notify();
  }

  public subscribe(listener: (context: TeachingContextData) => void): () => void {
    this.listeners.add(listener);
    listener(this.getContext());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const ctx = this.getContext();
    for (const sub of this.listeners) {
      try {
        sub(ctx);
      } catch (err) {
        console.error('[TeachingContextManager] Listener error:', err);
      }
    }
  }
}
