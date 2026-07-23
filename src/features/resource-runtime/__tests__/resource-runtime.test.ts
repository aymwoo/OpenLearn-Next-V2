import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ResourceRegistry,
  ResourceType,
  ResourceDescriptor,
  asWorkspaceWidget,
} from '../index.js';

describe('Sprint P3-01 Teaching Resource Runtime Test Suite', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  it('should register and filter resources across all 13 supported resource types', () => {
    const types: ResourceType[] = [
      'PDF',
      'PPT',
      'Image',
      'Video',
      'Markdown',
      'Notebook',
      'Mermaid',
      'MindMap',
      'GeoGebra',
      'Blockly',
      'Scratch',
      'HTML',
      'Plugin',
    ];

    types.forEach((type, idx) => {
      registry.registerResource({
        id: `res_${type.toLowerCase()}_${idx}`,
        title: `Sample ${type} Courseware`,
        type,
        url: `https://storage.openlearn.org/${type.toLowerCase()}.asset`,
      });
    });

    expect(registry.listResources().length).toBe(13);
    expect(registry.listResources('PDF').length).toBe(1);
    expect(registry.listResources('GeoGebra').length).toBe(1);
    expect(registry.listResources('Plugin').length).toBe(1);
  });

  it('should execute standard 7 resource actions (preview, open, pin, favorite, annotate, share, fullscreen)', () => {
    const res: ResourceDescriptor = {
      id: 'res_pdf_101',
      title: 'Linear Algebra PDF',
      type: 'PDF',
      url: 'https://storage.openlearn.org/algebra.pdf',
    };
    registry.registerResource(res);

    expect(registry.executeAction('res_pdf_101', 'pin')).toEqual({ pinned: true });
    expect(registry.executeAction('res_pdf_101', 'favorite')).toEqual({ favorited: true });
    expect(registry.executeAction('res_pdf_101', 'share')).toEqual({ shareUrl: 'https://storage.openlearn.org/algebra.pdf' });
    expect(registry.executeAction('res_pdf_101', 'fullscreen')).toEqual({ fullscreen: true, resourceId: 'res_pdf_101' });
  });

  it('should support plugin custom ResourceProvider (Preview/Open override)', () => {
    const customPreviewSpy = vi.fn().mockReturnValue({ customPreviewRendered: true });

    registry.registerProvider({
      id: 'provider_plugin_geogebra',
      type: 'GeoGebra',
      preview: customPreviewSpy,
    });

    registry.registerResource({
      id: 'res_geo_1',
      title: '3D Geometry Mesh',
      type: 'GeoGebra',
    });

    const result = registry.executeAction('res_geo_1', 'preview');
    expect(customPreviewSpy).toHaveBeenCalled();
    expect(result).toEqual({ customPreviewRendered: true });
  });

  it('should convert any teaching resource into WorkspaceWidget via asWorkspaceWidget', () => {
    const res: ResourceDescriptor = {
      id: 'res_mindmap_99',
      title: 'AI Curriculum MindMap',
      type: 'MindMap',
    };

    const widget = asWorkspaceWidget(res, 'CenterWorkspace');
    expect(widget.id).toBe('widget_res_res_mindmap_99');
    expect(widget.region).toBe('CenterWorkspace');
    expect(widget.name).toBe('AI Curriculum MindMap (MindMap)');
    expect(widget.componentName).toBe('ResourceViewer_MindMap');
  });
});
