/**
 * OpenLearn Whiteboard Tool System - Default Built-in Tool Providers (Sprint P2-01)
 */

import { IWhiteboardTool } from './tool-types.js';
import { WhiteboardToolRegistry } from './tool-registry.js';

export const createDefaultTool = (
  id: string,
  name: string,
  category: 'Selection' | 'Drawing' | 'Shape' | 'Annotation' | 'Media',
  icon: string,
  shortcut?: string,
  cursor: string = 'default'
): IWhiteboardTool => ({
  meta: {
    id,
    name,
    category,
    icon,
    shortcut,
    cursor,
    priority: 100,
  },
  activate: () => {},
  deactivate: () => {},
  dispose: () => {},
});

export const registerDefaultWhiteboardTools = (registry: WhiteboardToolRegistry): void => {
  registry.register(createDefaultTool('tool_select', 'Selection', 'Selection', 'mouse-pointer', 'V', 'default'));
  registry.register(createDefaultTool('tool_hand', 'Hand', 'Selection', 'hand', 'H', 'grab'));
  registry.register(createDefaultTool('tool_pen', 'Pen', 'Drawing', 'pen', 'P', 'crosshair'));
  registry.register(createDefaultTool('tool_eraser', 'Eraser', 'Drawing', 'eraser', 'E', 'crosshair'));
  registry.register(createDefaultTool('tool_rectangle', 'Rectangle', 'Shape', 'square', 'R', 'crosshair'));
  registry.register(createDefaultTool('tool_ellipse', 'Ellipse', 'Shape', 'circle', 'O', 'crosshair'));
  registry.register(createDefaultTool('tool_arrow', 'Arrow', 'Shape', 'arrow-right', 'A', 'crosshair'));
  registry.register(createDefaultTool('tool_connector', 'Connector', 'Shape', 'git-commit', 'C', 'crosshair'));
  registry.register(createDefaultTool('tool_text', 'Text', 'Annotation', 'type', 'T', 'text'));
  registry.register(createDefaultTool('tool_sticky_note', 'Sticky Note', 'Annotation', 'sticky-note', 'N', 'pointer'));
  registry.register(createDefaultTool('tool_image', 'Image', 'Media', 'image', 'I', 'pointer'));
};
