import { describe, it, expect, beforeEach } from 'vitest';
import {
  ClassroomService,
  ClassroomContextFacade,
} from '../index.js';

describe('Sprint P4-02 Classroom Context Facade Test Suite', () => {
  let service: ClassroomService;

  beforeEach(() => {
    service = new ClassroomService();
  });

  it('should aggregate existing contexts without state duplication in ClassroomContextFacade', () => {
    const session = service.createSession('cls_facade_01');
    session.attachRuntimes({
      lessonSession: { lessonId: 'les_algebra' },
      whiteboardEngine: { canvasId: 'cv_01' },
      aiRuntime: { agentId: 'agent_tutor' },
      pluginHost: { pluginCount: 3 },
      analyticsEngine: { activeTrackers: 2 },
      resourceRegistry: { resourceCount: 5 },
    });

    const facade = new ClassroomContextFacade(session);

    expect(facade.classroomId).toBe('cls_facade_01');
    expect(facade.stage).toBe('Create');
    expect((facade.lesson as { lessonId: string }).lessonId).toBe('les_algebra');
    expect((facade.whiteboard as { canvasId: string }).canvasId).toBe('cv_01');
    expect((facade.ai as { agentId: string }).agentId).toBe('agent_tutor');
    expect((facade.plugin as { pluginCount: number }).pluginCount).toBe(3);
    expect((facade.analytics as { activeTrackers: number }).activeTrackers).toBe(2);
    expect((facade.resource as { resourceCount: number }).resourceCount).toBe(5);
  });

  it('should dynamically reflect stage changes from underlying ClassroomSession without stale copies', () => {
    const session = service.createSession('cls_facade_dynamic');
    const facade = new ClassroomContextFacade(session);

    expect(facade.stage).toBe('Create');

    session.prepare();
    expect(facade.stage).toBe('Prepare');

    session.ready();
    expect(facade.stage).toBe('Ready');

    session.startTeaching();
    expect(facade.stage).toBe('Teaching');
  });
});
