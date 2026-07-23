/**
 * Unit tests for the Student Workspace Session persistence (P6-01).
 * Verifies localStorage-backed save/load/update/clear and auto-restore data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StudentWorkspaceSession } from '../student-workspace-session.js';

describe('StudentWorkspaceSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no session is stored', () => {
    const session = new StudentWorkspaceSession('s1');
    expect(session.load()).toBeNull();
  });

  it('saves and loads a session round-trip', () => {
    const session = new StudentWorkspaceSession('s1');
    session.save({
      studentId: 's1',
      openedWidgets: ['widget_student_whiteboard'],
      layout: { MainCanvas: ['widget_student_whiteboard'] },
      selectedResourceIds: ['r1'],
      activityState: {},
      aiConversation: [{ role: 'user', content: 'hi' }],
      updatedAt: Date.now(),
    });
    const loaded = session.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.studentId).toBe('s1');
    expect(loaded?.openedWidgets).toEqual(['widget_student_whiteboard']);
    expect(loaded?.aiConversation[0].content).toBe('hi');
  });

  it('updates (merges) and persists a patch', () => {
    const session = new StudentWorkspaceSession('s1');
    session.save({
      studentId: 's1',
      openedWidgets: [],
      layout: {},
      selectedResourceIds: [],
      activityState: {},
      aiConversation: [],
      updatedAt: Date.now(),
    });
    const next = session.update({ currentLessonId: 'les_9', selectedResourceIds: ['r9'] });
    expect(next.currentLessonId).toBe('les_9');
    expect(next.selectedResourceIds).toEqual(['r9']);
    expect(session.load()?.currentLessonId).toBe('les_9');
  });

  it('isolates sessions per student', () => {
    const a = new StudentWorkspaceSession('a');
    const b = new StudentWorkspaceSession('b');
    a.save({
      studentId: 'a',
      openedWidgets: ['wa'],
      layout: {},
      selectedResourceIds: [],
      activityState: {},
      aiConversation: [],
      updatedAt: Date.now(),
    });
    expect(b.load()).toBeNull();
    expect(a.load()?.openedWidgets).toEqual(['wa']);
  });

  it('clears a stored session', () => {
    const session = new StudentWorkspaceSession('s1');
    session.save({
      studentId: 's1',
      openedWidgets: [],
      layout: {},
      selectedResourceIds: [],
      activityState: {},
      aiConversation: [],
      updatedAt: Date.now(),
    });
    session.clear();
    expect(session.load()).toBeNull();
  });
});
