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
  private editors = new Map<string, PropertyEditorComponent>();

  register(type: string, editor: PropertyEditorComponent): void {
    this.editors.set(type, editor);
  }

  get(type: string): PropertyEditorComponent | undefined {
    return this.editors.get(type);
  }

  has(type: string): boolean {
    return this.editors.has(type);
  }
}

export const propertyEditorRegistry = new PropertyEditorRegistry();
