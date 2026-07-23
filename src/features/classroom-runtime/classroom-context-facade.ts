/**
 * OpenLearn Classroom Context - Unified Context Facade (Sprint P4-02)
 * Aggregates existing contexts into a single API facade without state duplication.
 */

import { ClassroomSession } from './classroom-session.js';
import { ClassroomStage } from './classroom-types.js';

export class ClassroomContextFacade {
  private session: ClassroomSession;

  constructor(session: ClassroomSession) {
    if (!session) {
      throw new Error('ClassroomContextFacade Error: ClassroomSession must be provided.');
    }
    this.session = session;
  }

  public get classroomId(): string {
    return this.session.getContext().classroomId;
  }

  public get stage(): ClassroomStage {
    return this.session.getStage();
  }

  public get lesson(): unknown {
    return this.session.getContext().lessonSession;
  }

  public get whiteboard(): unknown {
    return this.session.getContext().whiteboardEngine;
  }

  public get ai(): unknown {
    return this.session.getContext().aiRuntime;
  }

  public get plugin(): unknown {
    return this.session.getContext().pluginHost;
  }

  public get analytics(): unknown {
    return this.session.getContext().analyticsEngine;
  }

  public get resource(): unknown {
    return this.session.getContext().resourceRegistry;
  }

  public getSession(): ClassroomSession {
    return this.session;
  }
}
