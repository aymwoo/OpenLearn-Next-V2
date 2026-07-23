/**
 * OpenLearn Classroom Runtime - Service Facade (Sprint P4-01)
 * Unified service entrypoint for classroom session creation and lifecycle orchestration.
 */

import { ClassroomSession } from './classroom-session.js';
import { ClassroomRegistry } from './classroom-registry.js';

export class ClassroomService {
  private sessions = new Map<string, ClassroomSession>();
  private registry: ClassroomRegistry;

  constructor(registry?: ClassroomRegistry) {
    this.registry = registry ?? new ClassroomRegistry();
  }

  public getRegistry(): ClassroomRegistry {
    return this.registry;
  }

  public createSession(classroomId: string): ClassroomSession {
    if (this.sessions.has(classroomId)) {
      throw new Error(`ClassroomService Error: Classroom session '${classroomId}' already exists.`);
    }
    const session = new ClassroomSession(classroomId);
    this.sessions.set(classroomId, session);
    return session;
  }

  public getSession(classroomId: string): ClassroomSession | undefined {
    return this.sessions.get(classroomId);
  }

  public listSessions(): ReadonlyArray<ClassroomSession> {
    return Object.freeze(Array.from(this.sessions.values()));
  }

  public disposeSession(classroomId: string): boolean {
    const session = this.sessions.get(classroomId);
    if (!session) return false;
    session.dispose();
    return this.sessions.delete(classroomId);
  }

  public clear(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.registry.clear();
  }
}
