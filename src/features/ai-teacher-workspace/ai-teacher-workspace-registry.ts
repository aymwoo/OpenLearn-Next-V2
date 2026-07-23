/**
 * OpenLearn AI Teacher Workspace Widget Registry (Sprint P5-05)
 * Integrates AI Teacher Assistant into Workspace Widget Registry.
 */

import { WorkspaceSlotRegistry } from '../workspace/workspace-slot-registry.js';
import { AITeacherWorkspaceWidget } from './ai-teacher-workspace-widget.js';

export interface AIWidgetDescriptor {
  id: string;
  name: string;
  slot: string;
  component: React.ComponentType;
  provider: string;
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

    // Register into Workspace Slot Registry (e.g. RightSidebar or FloatingArea)
    this.slotRegistry.registerProvider({
      slot: descriptor.slot as any,
      providerId: descriptor.id,
      component: descriptor.component,
      priority: 10,
    });
  }

  public registerDefaultAIWidget(): void {
    this.registerAIWidget({
      id: 'widget_ai_teacher_workspace',
      name: 'AI Teacher Assistant Panel',
      slot: 'RightSidebar',
      component: AITeacherWorkspaceWidget as any,
      provider: 'official',
    });
  }

  public getWidget(id: string): AIWidgetDescriptor | undefined {
    return this.registeredWidgets.get(id);
  }

  public listWidgets(): ReadonlyArray<AIWidgetDescriptor> {
    return Object.freeze(Array.from(this.registeredWidgets.values()));
  }
}
