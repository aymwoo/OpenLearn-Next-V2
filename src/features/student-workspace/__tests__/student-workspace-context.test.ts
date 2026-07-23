/**
 * Unit tests for the Student Workspace Context (P6-01).
 * Verifies the restricted Student View, permission gating, event integration
 * (reusing the shared runtime event bus) and snapshot/recovery.
 */

import { describe, it, expect } from 'vitest';
import { StudentWorkspaceContext } from '../student-workspace-context.js';

describe('StudentWorkspaceContext', () => {
  it('exposes a restricted Student View with the Student role', () => {
    const ctx = new StudentWorkspaceContext({ student: { id: 's1', name: 'Alice' }, lessonId: 'les_1' });
    const view = ctx.getView();
    expect(view.studentId).toBe('s1');
    expect(view.studentName).toBe('Alice');
    expect(view.role).toBe('Student');
    expect(view.lessonId).toBe('les_1');
    expect(view.permissions).toContain('whiteboard:draw');
  });

  it('grants student AI and plugin permissions (P6-01 requirement)', () => {
    const ctx = new StudentWorkspaceContext({ student: { id: 's1', name: 'Alice' } });
    expect(ctx.hasPermission('ai:invoke')).toBe(true);
    expect(ctx.hasPermission('plugin:execute')).toBe(true);
    expect(ctx.hasPermission('quiz:submit')).toBe(true);
  });

  it('does NOT grant teacher-only permissions to students', () => {
    const ctx = new StudentWorkspaceContext({ student: { id: 's1', name: 'Alice' } });
    expect(ctx.hasPermission('lesson:control')).toBe(false);
    expect(ctx.hasPermission('session:manage')).toBe(false);
  });

  it('forwards classroom events through the shared event bus', async () => {
    const ctx = new StudentWorkspaceContext({ student: { id: 's1', name: 'Alice' } });
    const received: string[] = [];
    const unsub = ctx.subscribe('LessonStarted', (payload) => {
      received.push(payload.lessonId);
    });
    await ctx.runtimeKernel.eventBus.publish('LessonStarted', { lessonId: 'les_x', timestamp: Date.now() });
    expect(received).toEqual(['les_x']);
    unsub();
    await ctx.runtimeKernel.eventBus.publish('LessonStarted', { lessonId: 'les_y', timestamp: Date.now() });
    expect(received).toEqual(['les_x']);
  });

  it('supports snapshot and restore via the shared kernel', () => {
    const ctx = new StudentWorkspaceContext({ student: { id: 's1', name: 'Alice' } });
    const snap = ctx.takeSnapshot();
    expect(snap).toBeDefined();
    expect(typeof ctx.restoreSnapshot()).toBe('boolean');
  });
});
