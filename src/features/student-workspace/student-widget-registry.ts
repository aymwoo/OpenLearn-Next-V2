/**
 * OpenLearn Student Workspace — Widget Registry (Sprint P6-01)
 *
 * Mirrors the established AITeacherWorkspaceRegistry pattern: it adapts
 * official/plugin widget components into the shared WorkspaceSlotRegistry so
 * they render in the Workspace Shell. It does NOT introduce a new registry —
 * it reuses WorkspaceSlotRegistry. Only permissions, layout and exposed
 * capabilities differ from the Teacher Workspace.
 */

import React from 'react';
import { WorkspaceSlotRegistry } from '../workspace/workspace-slot-registry.js';
import type { WorkspaceSlotType } from '../workspace/workspace-types.js';
import {
  StudentWhiteboardWidget,
  StudentLessonWidget,
  StudentResourcesWidget,
  StudentActivitiesWidget,
  StudentAssignmentsWidget,
  StudentBroadcastWidget,
  StudentAILearningAssistantWidget,
  StudentNotificationsWidget,
  StudentPluginWidgets,
} from './widgets/student-default-widgets.js';
import type { StudentWorkspaceContext } from './student-workspace-context.js';

export interface StudentWidgetDescriptor {
  id: string;
  name: string;
  slot: WorkspaceSlotType;
  component: React.ComponentType<any>;
  provider: string;
  priority?: number;
}

export interface StudentDefaultWidgetInit {
  studentId: string;
  lessonId?: string;
  lang?: 'en' | 'zh';
  context: StudentWorkspaceContext;
  pluginHost?: unknown;
}

export class StudentWidgetRegistry {
  private slotRegistry: WorkspaceSlotRegistry;
  private registeredWidgets = new Map<string, StudentWidgetDescriptor>();

  constructor(slotRegistry?: WorkspaceSlotRegistry) {
    this.slotRegistry = slotRegistry ?? new WorkspaceSlotRegistry();
  }

  public get slotRegistryRef(): WorkspaceSlotRegistry {
    return this.slotRegistry;
  }

  /** Register an external (e.g. plugin) widget component. */
  public registerWidget(descriptor: StudentWidgetDescriptor): void {
    if (!descriptor || !descriptor.id) {
      throw new Error('StudentWidgetRegistry Error: StudentWidgetDescriptor must have a valid ID.');
    }
    this.registeredWidgets.set(descriptor.id, descriptor);
    const Component = descriptor.component;
    this.slotRegistry.register({
      id: descriptor.id,
      slot: descriptor.slot,
      priority: descriptor.priority ?? 10,
      render: (props?: Record<string, unknown>) => React.createElement(Component, props),
    });
  }

  public unregisterWidget(widgetId: string): boolean {
    const removed = this.registeredWidgets.delete(widgetId);
    if (removed) {
      this.slotRegistry.unregister(widgetId);
    }
    return removed;
  }

  /** Register the canonical Student Workspace default widgets. */
  public registerDefaultWidgets(init: StudentDefaultWidgetInit): void {
    const { studentId, lessonId, lang = 'en', context, pluginHost } = init;

    this.mountWidget(
      'widget_student_whiteboard',
      'Whiteboard',
      'MainCanvas',
      StudentWhiteboardWidget,
      {},
      'official',
    );
    this.mountWidget(
      'widget_student_lesson',
      'Lesson',
      'LeftSidebar',
      StudentLessonWidget,
      { context },
      'official',
    );
    this.mountWidget(
      'widget_student_resources',
      'Resources',
      'LeftSidebar',
      StudentResourcesWidget,
      {},
      'official',
    );
    this.mountWidget(
      'widget_student_activities',
      'Activities',
      'BottomPanel',
      StudentActivitiesWidget,
      {},
      'official',
    );
    this.mountWidget(
      'widget_student_assignments',
      'Assignments',
      'RightSidebar',
      StudentAssignmentsWidget,
      { studentId, lessonId, lang },
      'official',
      20,
    );
    this.mountWidget(
      'widget_student_ai_assistant',
      'AI Learning Assistant',
      'RightSidebar',
      StudentAILearningAssistantWidget,
      {},
      'official',
      10,
    );
    this.mountWidget(
      'widget_student_broadcast',
      'Teacher Broadcast',
      'BottomPanel',
      StudentBroadcastWidget,
      { context },
      'official',
    );
    this.mountWidget(
      'widget_student_notifications',
      'Notifications',
      'FloatingArea',
      StudentNotificationsWidget,
      { studentId, lang },
      'official',
    );

    // Plugin-extensible widgets only when a plugin host is provided.
    if (pluginHost) {
      this.mountWidget(
        'widget_student_plugins',
        'Plugin Widgets',
        'FloatingArea',
        StudentPluginWidgets,
        {},
        'plugin',
      );
    }
  }

  public getWidget(id: string): StudentWidgetDescriptor | undefined {
    return this.registeredWidgets.get(id);
  }

  public listWidgets(): ReadonlyArray<StudentWidgetDescriptor> {
    return Object.freeze(Array.from(this.registeredWidgets.values()));
  }

  public clear(): void {
    for (const id of this.registeredWidgets.keys()) {
      this.slotRegistry.unregister(id);
    }
    this.registeredWidgets.clear();
  }

  private mountWidget(
    id: string,
    name: string,
    slot: WorkspaceSlotType,
    Component: React.ComponentType<any>,
    props: Record<string, unknown>,
    provider: string,
    priority = 10,
  ): void {
    this.registeredWidgets.set(id, { id, name, slot, component: Component, provider, priority });
    this.slotRegistry.register({
      id,
      slot,
      priority,
      render: () => React.createElement(Component, props),
    });
  }
}
