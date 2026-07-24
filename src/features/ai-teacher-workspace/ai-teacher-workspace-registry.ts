/**
 * OpenLearn AI Teacher Workspace Widget Registry (Sprint P5-05)
 * Integrates AI Teacher Assistant into Workspace Widget Registry.
 *
 * [P5-06 Review Fix] Aligned with WorkspaceSlotRegistry.register() API
 * and WorkspaceSlotProvider shape (id, slot, render, priority).
 */

import React from 'react';
import { WorkspaceSlotRegistry } from '../workspace/workspace-slot-registry.js';
import { WorkspaceSlotType } from '../workspace/workspace-types.js';
import { AITeacherWorkspaceWidget } from './ai-teacher-workspace-widget.js';

export interface AIWidgetDescriptor {
  id: string;
  name: string;
  slot: WorkspaceSlotType;
  component: React.ComponentType;
  provider: string;
  priority?: number;
}

export class AITeacherWorkspaceRegistry {
  private slotRegistry: WorkspaceSlotRegistry;
  private registeredWidgets = new Map<string, AIWidgetDescriptor>();

  constructor(slotRegistry?: WorkspaceSlotRegistry) {
    this.slotRegistry = slotRegistry ?? new WorkspaceSlotRegistry();
  }

  public registerAIWidget(descriptor: AIWidgetDescriptor): void {
    if (!descriptor || !descriptor.id) {
      throw new Error('AITeacherWorkspaceRegistry Error: AIWidgetDescriptor must have a valid ID.');
    }
    this.registeredWidgets.set(descriptor.id, descriptor);

    // Adapt to WorkspaceSlotProvider shape and use register() method
    const Component = descriptor.component;
    this.slotRegistry.register({
      id: descriptor.id,
      slot: descriptor.slot,
      priority: descriptor.priority ?? 10,
      render: (props?: Record<string, unknown>) => React.createElement(Component, props),
    });
  }

  public unregisterAIWidget(widgetId: string): boolean {
    const removed = this.registeredWidgets.delete(widgetId);
    if (removed) {
      this.slotRegistry.unregister(widgetId);
    }
    return removed;
  }

  public registerDefaultAIWidget(): void {
    this.registerAIWidget({
      id: 'widget_ai_teacher_workspace',
      name: 'AI Teacher Assistant Panel',
      slot: 'RightSidebar',
      component: AITeacherWorkspaceWidget,
      provider: 'official',
    });
  }

  public getWidget(id: string): AIWidgetDescriptor | undefined {
    return this.registeredWidgets.get(id);
  }

  public listWidgets(): ReadonlyArray<AIWidgetDescriptor> {
    return Object.freeze(Array.from(this.registeredWidgets.values()));
  }

  public clear(): void {
    for (const id of this.registeredWidgets.keys()) {
      this.slotRegistry.unregister(id);
    }
    this.registeredWidgets.clear();
  }
}

