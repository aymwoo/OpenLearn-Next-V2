import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClassroomService,
  ClassroomSession,
} from '../index.js';

describe('Sprint P4-01 Classroom Runtime Test Suite', () => {
  let service: ClassroomService;

  beforeEach(() => {
    service = new ClassroomService();
  });

  it('should execute full 9-stage unified classroom lifecycle state machine cleanly', () => {
    const session = service.createSession('cls_101');
    expect(session.getStage()).toBe('Create');

    const listenerSpy = vi.fn();
    session.addEventListener(listenerSpy);

    session.prepare();
    expect(session.getStage()).toBe('Prepare');

    session.ready();
    expect(session.getStage()).toBe('Ready');

    session.startTeaching();
    expect(session.getStage()).toBe('Teaching');

    session.pause();
    expect(session.getStage()).toBe('Paused');

    session.resume();
    expect(session.getStage()).toBe('Teaching'); // Resume transitions to Resumed then Teaching

    session.finish();
    expect(session.getStage()).toBe('Finished');

    session.archive();
    expect(session.getStage()).toBe('Archived');

    session.dispose();
    expect(session.getStage()).toBe('Disposed');

    expect(listenerSpy).toHaveBeenCalled();
  });

  it('should throw error on invalid state transitions', () => {
    const session = service.createSession('cls_invalid');
    expect(() => session.startTeaching()).toThrow('Invalid state transition');
    expect(() => session.finish()).toThrow('Invalid state transition');
  });

  it('should coordinate across 6 underlying runtimes in ClassroomContext', () => {
    const session = service.createSession('cls_coordinated');

    session.attachRuntimes({
      lessonSession: { id: 'ls_01' },
      whiteboardEngine: { id: 'wb_01' },
      aiRuntime: { id: 'ai_01' },
      pluginHost: { id: 'ph_01' },
      analyticsEngine: { id: 'an_01' },
      resourceRegistry: { id: 'rr_01' },
    });

    const ctx = session.getContext();
    expect((ctx.lessonSession as { id: string }).id).toBe('ls_01');
    expect((ctx.whiteboardEngine as { id: string }).id).toBe('wb_01');
    expect((ctx.aiRuntime as { id: string }).id).toBe('ai_01');
    expect((ctx.pluginHost as { id: string }).id).toBe('ph_01');
    expect((ctx.analyticsEngine as { id: string }).id).toBe('an_01');
    expect((ctx.resourceRegistry as { id: string }).id).toBe('rr_01');
  });

  it('should allow plugins to register classroom widgets, services, and action extensions via ClassroomRegistry', () => {
    const registry = service.getRegistry();

    registry.registerWidget({
      id: 'widget_plugin_chat',
      name: 'Classroom Live Chat',
      slot: 'RightSidebar',
    });

    const actionSpy = vi.fn().mockReturnValue({ executed: true });
    registry.registerActionExtension({
      id: 'action_plugin_reward',
      name: 'Grant Student Badge',
      handler: actionSpy,
    });

    expect(registry.listWidgets().length).toBe(1);

    const action = registry.getActionExtension('action_plugin_reward');
    const session = service.createSession('cls_plugin');
    const res = action?.handler(session.getContext());
    expect(res).toEqual({ executed: true });
  });
});
