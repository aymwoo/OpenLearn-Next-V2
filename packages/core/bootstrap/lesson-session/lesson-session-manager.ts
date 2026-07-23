/**
 * OpenLearn Platform Kernel - Lesson Session Manager (Sprint A2)
 * Handles lifecycle orchestration for Lesson Sessions.
 */

import { LessonSession } from './lesson-session.js';
import { LessonSessionContext } from './lesson-session-types.js';

export class LessonSessionManager {
  private _sessions = new Map<string, LessonSession>();

  public createSession(context: LessonSessionContext): LessonSession {
    if (this._sessions.has(context.sessionId)) {
      throw new Error(`LessonSessionManager collision: Session '${context.sessionId}' already exists.`);
    }
    const session = new LessonSession(context);
    this._sessions.set(context.sessionId, session);
    return session;
  }

  public findSession(sessionId: string): LessonSession | undefined {
    return this._sessions.get(sessionId);
  }

  public startSession(sessionId: string): void {
    const session = this.getOrThrow(sessionId);
    session.start();
  }

  public pauseSession(sessionId: string): void {
    const session = this.getOrThrow(sessionId);
    session.pause();
  }

  public resumeSession(sessionId: string): void {
    const session = this.getOrThrow(sessionId);
    session.resume();
  }

  public completeSession(sessionId: string): void {
    const session = this.getOrThrow(sessionId);
    session.complete();
  }

  public disposeSession(sessionId: string): void {
    const session = this.getOrThrow(sessionId);
    session.dispose();
    this._sessions.delete(sessionId);
  }

  public listSessions(): ReadonlyArray<LessonSession> {
    return Object.freeze(Array.from(this._sessions.values()));
  }

  private getOrThrow(sessionId: string): LessonSession {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`LessonSessionManager error: Session '${sessionId}' not found.`);
    }
    return session;
  }
}
