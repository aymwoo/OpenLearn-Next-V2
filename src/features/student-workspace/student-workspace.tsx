/**
 * OpenLearn Student Workspace — Workspace Component (Sprint P6-01)
 *
 * Top-level React component that composes the SHARED Workspace Shell
 * (WorkspaceProvider + WorkspaceLayout + WorkspaceSlotRegistry) with the SHARED
 * Classroom Runtime (via StudentWorkspaceContext). It reuses the exact same
 * infrastructure as the Teacher Workspace — only the layout, permissions and
 * exposed capabilities differ.
 */

import React, { useEffect, useState } from 'react';
import { WorkspaceProvider } from '../workspace/workspace-context.js';
import { WorkspaceLayout } from '../workspace/workspace-layout.js';
import { WorkspaceSlotRegistry } from '../workspace/workspace-slot-registry.js';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context.js';
import { StudentWorkspaceContext } from './student-workspace-context.js';
import { StudentWidgetRegistry } from './student-widget-registry.js';
import { StudentWorkspaceSession } from './student-workspace-session.js';
import type { StudentWorkspaceInit, StudentWorkspaceLang } from './student-workspace-types.js';

export interface StudentWorkspaceProps extends StudentWorkspaceInit {}

export const StudentWorkspace: React.FC<StudentWorkspaceProps> = (props) => {
  const {
    student,
    lessonId,
    courseId,
    teacherId,
    teacherName,
    lang = 'en' as StudentWorkspaceLang,
    autoRestore = true,
    pluginHost,
  } = props;

  // One-time creation of the shared runtime context, slot registry, widget
  // registry and session — exactly like the Teacher Workspace composition.
  const [context] = useState(
    () =>
      new StudentWorkspaceContext({
        student,
        lessonId,
        courseId,
        teacherId,
        teacherName,
        lang,
      })
  );
  const [slotRegistry] = useState(() => new WorkspaceSlotRegistry());
  const [widgetRegistry] = useState(() => {
    const registry = new StudentWidgetRegistry(slotRegistry);
    registry.registerDefaultWidgets({
      studentId: student.id,
      lessonId,
      lang,
      context,
      pluginHost,
    });
    return registry;
  });
  const [session] = useState(() => new StudentWorkspaceSession(student.id));

  // Restore the persisted session automatically.
  useEffect(() => {
    if (!autoRestore) return;
    context.restoreSnapshot();
    const saved = session.load();
    if (saved?.currentLessonId) {
      // Lesson id restored from the previous session.
      void saved.currentLessonId;
    }
  }, [autoRestore, context, session]);

  // Persist the current lesson whenever a lesson starts.
  useEffect(() => {
    const unsub = context.subscribe('LessonStarted', (payload) => {
      session.update({ currentLessonId: payload.lessonId });
    });
    return () => {
      unsub();
    };
  }, [context, session]);

  // Persist & dispose on unmount.
  useEffect(() => {
    return () => {
      context.takeSnapshot();
      const widgets = widgetRegistry.listWidgets().map((w) => w.id);
      const existing = session.load();
      session.save({
        studentId: student.id,
        openedWidgets: widgets,
        layout: existing?.layout ?? {},
        currentLessonId: existing?.currentLessonId ?? lessonId,
        selectedResourceIds: existing?.selectedResourceIds ?? [],
        activityState: existing?.activityState ?? {},
        aiConversation: existing?.aiConversation ?? [],
        updatedAt: Date.now(),
      });
      void context.dispose();
    };
  }, [context, session, widgetRegistry, student.id, lessonId]);

  const content = (
    <WorkspaceProvider registry={slotRegistry}>
      <WorkspaceLayout />
    </WorkspaceProvider>
  );

  if (pluginHost) {
    return (
      <PluginHostProvider host={pluginHost as any}>
        {content}
      </PluginHostProvider>
    );
  }
  return content;
};

export default StudentWorkspace;
