/**
 * Unit tests for the Student Workspace Widget Registry (P6-01).
 * Verifies default-widget registration, plugin-widget gating, and slot mapping.
 */

import { describe, it, expect } from 'vitest';
import { StudentWidgetRegistry } from '../student-widget-registry.js';
import { StudentWorkspaceContext } from '../student-workspace-context.js';

function makeContext() {
  return new StudentWorkspaceContext({
    student: { id: 's1', name: 'Alice' },
    lessonId: 'les_1',
  });
}

describe('StudentWidgetRegistry', () => {
  it('registers the 8 official default widgets when no plugin host is given', () => {
    const reg = new StudentWidgetRegistry();
    reg.registerDefaultWidgets({
      studentId: 's1',
      lessonId: 'les_1',
      context: makeContext(),
    });
    const widgets = reg.listWidgets();
    expect(widgets.length).toBe(8);
    const ids = widgets.map((w) => w.id);
    expect(ids).toContain('widget_student_whiteboard');
    expect(ids).toContain('widget_student_lesson');
    expect(ids).toContain('widget_student_resources');
    expect(ids).toContain('widget_student_activities');
    expect(ids).toContain('widget_student_assignments');
    expect(ids).toContain('widget_student_ai_assistant');
    expect(ids).toContain('widget_student_broadcast');
    expect(ids).toContain('widget_student_notifications');
  });

  it('adds the plugin widget when a plugin host is provided', () => {
    const reg = new StudentWidgetRegistry();
    reg.registerDefaultWidgets({
      studentId: 's1',
      lessonId: 'les_1',
      context: makeContext(),
      pluginHost: {},
    });
    expect(reg.listWidgets().length).toBe(9);
    expect(reg.getWidget('widget_student_plugins')).toBeDefined();
  });

  it('maps widgets to the expected shell slots', () => {
    const reg = new StudentWidgetRegistry();
    reg.registerDefaultWidgets({ studentId: 's1', lessonId: 'les_1', context: makeContext() });
    const right = reg.slotRegistryRef.getProviders('RightSidebar').map((p) => p.id);
    expect(right).toContain('widget_student_assignments');
    expect(right).toContain('widget_student_ai_assistant');
    const main = reg.slotRegistryRef.getProviders('MainCanvas').map((p) => p.id);
    expect(main).toContain('widget_student_whiteboard');
  });

  it('unregisters and clears widgets', () => {
    const reg = new StudentWidgetRegistry();
    reg.registerDefaultWidgets({ studentId: 's1', lessonId: 'les_1', context: makeContext() });
    expect(reg.unregisterWidget('widget_student_whiteboard')).toBe(true);
    expect(reg.getWidget('widget_student_whiteboard')).toBeUndefined();
    reg.clear();
    expect(reg.listWidgets().length).toBe(0);
  });

  it('throws on a widget descriptor without an id', () => {
    const reg = new StudentWidgetRegistry();
    expect(() => reg.registerWidget({ id: '', name: 'x', slot: 'TopBar', component: () => null, provider: 'official' })).toThrow();
  });
});
