import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WhiteboardToolRegistry,
  registerDefaultWhiteboardTools,
  IWhiteboardTool,
} from '../tool-system/index.js';

describe('Sprint P2-01 Whiteboard Tool System Test Suite', () => {
  let registry: WhiteboardToolRegistry;

  beforeEach(() => {
    registry = new WhiteboardToolRegistry();
  });

  it('should register all 11 default whiteboard tools properly', () => {
    registerDefaultWhiteboardTools(registry);
    const tools = registry.listTools();
    expect(tools.length).toBe(11);

    const selectTool = registry.getTool('tool_select');
    expect(selectTool?.meta.name).toBe('Selection');
    expect(selectTool?.meta.category).toBe('Selection');

    const penTool = registry.getTool('tool_pen');
    expect(penTool?.meta.name).toBe('Pen');
    expect(penTool?.meta.category).toBe('Drawing');
  });

  it('should activate and deactivate tool lifecycle hooks correctly', () => {
    const activateSpy = vi.fn();
    const deactivateSpy = vi.fn();

    const customTool: IWhiteboardTool = {
      meta: {
        id: 'tool_test',
        name: 'Test Tool',
        category: 'Drawing',
        icon: 'test-icon',
      },
      activate: activateSpy,
      deactivate: deactivateSpy,
    };

    registry.register(customTool);
    expect(registry.getActiveTool()).toBeUndefined();

    registry.activateTool('tool_test', { color: '#ff0000' });
    expect(registry.getActiveTool()?.meta.id).toBe('tool_test');
    expect(activateSpy).toHaveBeenCalledWith({ color: '#ff0000' });

    registry.deactivateActiveTool();
    expect(registry.getActiveTool()).toBeUndefined();
    expect(deactivateSpy).toHaveBeenCalled();
  });

  it('should allow plugins to register extension tools (MindMap, Mermaid, GeoGebra, etc.)', () => {
    registerDefaultWhiteboardTools(registry);

    const mindMapPluginTool: IWhiteboardTool = {
      meta: {
        id: 'tool_plugin_mindmap',
        name: 'MindMap Tool',
        category: 'Extension',
        icon: 'git-merge',
        priority: 200,
      },
    };

    const mermaidPluginTool: IWhiteboardTool = {
      meta: {
        id: 'tool_plugin_mermaid',
        name: 'Mermaid Diagram',
        category: 'Extension',
        icon: 'code',
        priority: 150,
      },
    };

    registry.register(mindMapPluginTool);
    registry.register(mermaidPluginTool);

    const extensions = registry.listTools('Extension');
    expect(extensions.length).toBe(2);
    expect(extensions[0].meta.id).toBe('tool_plugin_mindmap');
    expect(extensions[1].meta.id).toBe('tool_plugin_mermaid');
  });

  it('should dispose tool hooks cleanly when unregistering or clearing registry', () => {
    const disposeSpy = vi.fn();
    const tool: IWhiteboardTool = {
      meta: {
        id: 'tool_disposable',
        name: 'Disposable Tool',
        category: 'Drawing',
        icon: 'trash',
      },
      dispose: disposeSpy,
    };

    registry.register(tool);
    registry.unregister('tool_disposable');
    expect(disposeSpy).toHaveBeenCalled();
  });
});
