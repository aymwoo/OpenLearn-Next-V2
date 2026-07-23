/**
 * OpenLearn Classroom Runtime - Registry (Sprint P4-01)
 * Central registry for classroom widgets, services, and plugin action extensions.
 */

import { ClassroomServiceDescriptor, ClassroomActionExtension } from './classroom-types.js';

export class ClassroomRegistry {
  private services = new Map<string, ClassroomServiceDescriptor>();
  private actions = new Map<string, ClassroomActionExtension>();
  private widgets = new Map<string, { id: string; name: string; slot: string }>();

  public registerService(service: ClassroomServiceDescriptor): void {
    if (!service || !service.id) {
      throw new Error('ClassroomRegistry Error: ClassroomServiceDescriptor must have a valid ID.');
    }
    this.services.set(service.id, service);
  }

  public unregisterService(serviceId: string): boolean {
    return this.services.delete(serviceId);
  }

  public getService(serviceId: string): ClassroomServiceDescriptor | undefined {
    return this.services.get(serviceId);
  }

  public registerActionExtension(action: ClassroomActionExtension): void {
    if (!action || !action.id) {
      throw new Error('ClassroomRegistry Error: ClassroomActionExtension must have a valid ID.');
    }
    this.actions.set(action.id, action);
  }

  public getActionExtension(actionId: string): ClassroomActionExtension | undefined {
    return this.actions.get(actionId);
  }

  public registerWidget(widget: { id: string; name: string; slot: string }): void {
    if (!widget || !widget.id) {
      throw new Error('ClassroomRegistry Error: Widget must have a valid ID.');
    }
    this.widgets.set(widget.id, widget);
  }

  public listWidgets(): ReadonlyArray<{ id: string; name: string; slot: string }> {
    return Object.freeze(Array.from(this.widgets.values()));
  }

  public clear(): void {
    this.services.clear();
    this.actions.clear();
    this.widgets.clear();
  }
}
