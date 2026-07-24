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
  usePluginHostStore.getState().registerExtensionPoint('teacher.dashboard.widget', {
    id: 'official_activity_center',
    label: 'Activity Center',
    icon: 'Puzzle',
    pluginId: 'openlearn-official',
    component: () =>
      import('./ActivityWorkspaceWidget.js').then((m) => ({
        default: () => <ActivityWorkspaceWidget role="teacher" />,
      })),
  });
}
