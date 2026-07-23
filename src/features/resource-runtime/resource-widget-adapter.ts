/**
 * OpenLearn Teaching Resource Runtime - Workspace Widget Adapter (Sprint P3-01)
 * Converts any teaching resource into a WorkspaceWidgetDescriptor for WorkspaceLayout embedding.
 */

import { ResourceDescriptor } from './resource-types.js';
import { WorkspaceWidgetDescriptor, WorkspaceRegionType } from '../workspace/index.js';

export const asWorkspaceWidget = (
  resource: ResourceDescriptor,
  targetRegion: WorkspaceRegionType = 'CenterWorkspace'
): WorkspaceWidgetDescriptor => {
  if (!resource || !resource.id) {
    throw new Error('ResourceWidgetAdapter Error: Resource must have a valid ID.');
  }

  return {
    id: `widget_res_${resource.id}`,
    name: `${resource.title} (${resource.type})`,
    region: targetRegion,
    componentName: `ResourceViewer_${resource.type}`,
    hidden: false,
  };
};
