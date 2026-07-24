/**
 * OpenLearn Activity Ecosystem — Teacher Extension Registration (Sprint P7-01)
 *
 * Registers the Activity Center as a `teacher.dashboard.widget` extension
 * point so teachers see the SAME ActivityWorkspaceWidget (teacher layout) that
 * students get in their workspace. This reuses the existing frontend extension
 * point mechanism — no new registration path is invented.
 */

import React from 'react';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store.js';
import { ActivityWorkspaceWidget } from './ActivityWorkspaceWidget.js';

let registered = false;

/** Register the teacher Activity Center exactly once. */
export function registerTeacherActivityCenter(): void {
  if (registered) return;
  registered = true;
  // Lazy factory returning the `{ default: Component }` module shape that
  // `React.lazy` expects. The `__isLazyFactory` marker is REQUIRED so that
  // `resolveExtensionComponent` wraps this in `React.lazy` — without it, the
  // factory is mistaken for a direct component, called during render, returns a
  // Promise that React 19 suspends on forever (perpetual "Loading..." on the
  // dashboard), and the Activity Center never actually mounts.
  const activityCenterComponent = () =>
    import('./ActivityWorkspaceWidget.js').then((m) => ({
      default: () => <ActivityWorkspaceWidget role="teacher" mode="status" />,
    }));
  (activityCenterComponent as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;

  usePluginHostStore.getState().registerExtensionPoint('teacher.dashboard.widget', {
    id: 'official_activity_center',
    label: 'Activity Center',
    icon: 'Puzzle',
    pluginId: 'openlearn-official',
    component: activityCenterComponent,
  });
}
