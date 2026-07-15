/**
 * 课件中心 — Frontend entry (v2.5+)
 */
import React from 'react';
import TeacherPanel from './frontend/TeacherPanel';
import DashboardWidget from './frontend/DashboardWidget';
import StudentTool from './frontend/StudentTool';
import StudentFullscreen from './frontend/StudentFullscreen';

let pluginCtx: any = null;

// ── Wrappers ─────────────────────────────────────────────────────────

function TeacherPanelWrapper(props: any) {
  if (!pluginCtx) return null;
  const { renderType, mainNavCollapsed } = props || {};
  if (renderType === 'button') {
    return React.createElement('button', {
      className: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-gray-600 hover:bg-gray-100 hover:text-gray-900' + (mainNavCollapsed ? ' justify-center' : ''),
      title: '\u8bfe\u4ef6\u7ba1\u7406',
    },
      React.createElement('span', { className: 'text-lg' }, '\uD83D\uDCDA'),
      !mainNavCollapsed && React.createElement('span', { className: 'text-sm font-medium' }, '\u8bfe\u4ef6\u7ba1\u7406')
    );
  }
  return React.createElement(TeacherPanel, { ctx: pluginCtx });
}

function DashboardWidgetWrapper() {
  return pluginCtx ? React.createElement(DashboardWidget, { ctx: pluginCtx }) : null;
}

function StudentToolWrapper() {
  return pluginCtx ? React.createElement(StudentTool, { ctx: pluginCtx }) : null;
}

function StudentFullscreenWrapper() {
  return pluginCtx ? React.createElement(StudentFullscreen, { ctx: pluginCtx }) : null;
}

// ── Lifecycle ────────────────────────────────────────────────────────

async function activate(hostCtx: any) {
  pluginCtx = hostCtx;

  if (hostCtx.ui?.registerExtensionPoint) {
    hostCtx.ui.registerExtensionPoint('teacher.tab', {
      id: 'courseware-hub-teacher',
      label: '\u8bfe\u4ef6\u7ba1\u7406',
      icon: 'BookOpen',
      component: TeacherPanelWrapper,
      position: 70,
      pluginId: hostCtx.pluginId,
    });

    hostCtx.ui.registerExtensionPoint('student.view', {
      id: 'courseware-hub-student',
      component: StudentToolWrapper,
      pluginId: hostCtx.pluginId,
    });

    hostCtx.ui.registerExtensionPoint('student.fullscreen', {
      id: 'courseware-hub-student-fullscreen',
      component: StudentFullscreenWrapper,
      pluginId: hostCtx.pluginId,
    });
  }
}

function deactivate() {
  pluginCtx = null;
}

export { TeacherPanel, DashboardWidget, StudentTool, StudentFullscreen };
export default { activate, deactivate };
