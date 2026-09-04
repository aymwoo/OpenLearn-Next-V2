import React from 'react';

export type PropertyEditorProps = {
  elementId: string;
  elementType: string;
  data: Record<string, any>;
  updateData: (partial: Record<string, any>) => void;
  lessonId: string;
  onClose: () => void;
};

export type PropertyEditorComponent = React.FC<PropertyEditorProps>;

class PropertyEditorRegistry {
  private editors = new Map<string, { impl: PropertyEditorComponent; pluginId?: string }>();

  register(type: string, editor: PropertyEditorComponent, pluginId?: string): void {
    this.editors.set(type, { impl: editor, pluginId });
  }

  get(type: string): PropertyEditorComponent | undefined {
    return this.editors.get(type)?.impl;
  }

  has(type: string): boolean {
    return this.editors.has(type);
  }

  /**
   * Remove an editor by type. When `pluginId` is provided, the entry is only
   * removed if it is owned by that plugin — prevents a plugin from evicting
   * host built-in editors or another plugin's editor.
   */
  unregister(type: string, pluginId?: string): void {
    const entry = this.editors.get(type);
    if (!entry) return;
    if (pluginId && entry.pluginId !== pluginId) return;
    this.editors.delete(type);
  }

  /** Remove all editors registered by the given plugin (lifecycle cleanup). */
  unregisterPlugin(pluginId: string): void {
    for (const [type, entry] of this.editors) {
      if (entry.pluginId === pluginId) this.editors.delete(type);
    }
  }
}

export const propertyEditorRegistry = new PropertyEditorRegistry();
