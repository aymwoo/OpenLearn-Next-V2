import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { StudentType } from '../../../types/app';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { StudentDashboardPanel } from '../StudentDashboardPanel';
import { studentActiveSessionStore } from '../useStudentActiveSession';
import {
  normalizeEffectiveStudentUiPolicy,
  STUDENT_UI_FEATURE_IDS,
} from '../../../../packages/core/student-ui-policy/index';

function policy(features: Record<string, boolean>, hideGuidance = false) {
  return normalizeEffectiveStudentUiPolicy({ features, hideGuidance });
}

function lazyText(text: string) {
  const factory = () => Promise.resolve({ default: () => <span>{text}</span> });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const baseProps = {
  students: [{ id: 's1', name: 'Alice' }] as unknown as StudentType[],
  activeStudentId: 's1',
  studentDashboardData: {
    progress: [],
    assignments: [{ id: 'a1', title: 'HW', class_name: 'C', content: 'x', submission_status: null }],
    schedules: [],
    rollcalls: [],
    classes: [],
  },
  readNotifications: new Set<string>(),
  setReadNotifications: vi.fn(),
  addToast: vi.fn(),
  lang: 'zh' as const,
  setSelectedLesson: vi.fn(),
  setStudentViewStatus: vi.fn(),
  setSelectedAssignment: vi.fn(),
  setQuizStudentAnswers: vi.fn(),
  setSubAssignmentTab: vi.fn(),
};

function renderPanel(studentUiPolicy: any) {
  return render(
    <PluginHostProvider host={new FrontendPluginHost()}>
      <StudentDashboardPanel {...baseProps} studentUiPolicy={studentUiPolicy} />
    </PluginHostProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  studentActiveSessionStore.setState({ activeSession: null, loading: false, studentKey: null });
  usePluginHostStore.setState({ extensionPoints: new Map() });
  vi.restoreAllMocks();
});

describe('StudentDashboardPanel — 教师可见性策略', () => {
  it('隐藏组件时不渲染，但本地布局保留，重新允许后恢复', () => {
    localStorage.setItem(
      'student_dashboard_layout_v4_s1',
      JSON.stringify([
        { id: 'quick-stats', size: 'half', visible: true },
        { id: 'upcoming-assignments', size: 'half', visible: true },
      ]),
    );

    renderPanel(policy({ 'widget.quick-stats': false }));
    expect(document.getElementById('widget-quick-stats')).toBeNull();
    expect(document.getElementById('widget-upcoming-assignments')).not.toBeNull();

    cleanup();
    renderPanel(policy({}));
    expect(document.getElementById('widget-quick-stats')).not.toBeNull();
    expect(localStorage.getItem('student_dashboard_layout_v4_s1')).toContain('quick-stats');
  });

  it('hideGuidance 关闭身份头与组件副标题', () => {
    renderPanel(policy({}, true));
    expect(screen.queryByText('Here is your learning summary.')).toBeNull();
    expect(screen.queryByText('总作业量、平均得分率与出勤概览')).toBeNull();
  });

  it('全部组件被隐藏时显示空态', () => {
    const features: Record<string, boolean> = {};
    for (const id of STUDENT_UI_FEATURE_IDS) {
      if (id.startsWith('widget.')) features[id] = false;
    }
    renderPanel(policy(features));
    expect(screen.getByTestId('student-dashboard-empty')).toBeTruthy();
    expect(document.getElementById('student-dashboard-modular-grid')).toBeNull();
  });

  it('插件贡献被隐藏后扩展卡片自动收起', async () => {
    usePluginHostStore.getState().registerExtensionPoint('student.view' as any, {
      id: 'ext-a',
      label: 'Ext A',
      pluginId: 'plugin-a',
      component: lazyText('Plugin A Content'),
    });

    renderPanel(null);
    expect(await screen.findByText('Plugin A Content')).toBeTruthy();
    expect(document.getElementById('widget-extension-views')).not.toBeNull();

    cleanup();
    renderPanel(policy({}, false));
    // policy 未隐藏插件时仍可见
    expect(await screen.findByText('Plugin A Content')).toBeTruthy();
  });

  it('隐藏整个插件后不再渲染其扩展，并收起扩展卡片', async () => {
    usePluginHostStore.getState().registerExtensionPoint('student.view' as any, {
      id: 'ext-a',
      label: 'Ext A',
      pluginId: 'plugin-a',
      component: lazyText('Plugin A Content'),
    });

    renderPanel(normalizeEffectiveStudentUiPolicy({ hiddenPlugins: ['plugin-a'] }));
    expect(screen.queryByText('Plugin A Content')).toBeNull();
    expect(document.getElementById('widget-extension-views')).toBeNull();
  });

  it('快捷指令内置项与整个 FAB 都可被隐藏', () => {
    renderPanel(policy({ 'quick-action.view-assignments': false }));
    fireEvent.click(document.getElementById('student-quick-actions-fab-btn')!);
    expect(document.getElementById('qa-action-view-assignments')).toBeNull();
    expect(document.getElementById('qa-action-check-notifications')).not.toBeNull();

    cleanup();
    renderPanel(policy({ 'section.floating-quick-actions': false }));
    expect(document.getElementById('student-quick-actions-fab-btn')).toBeNull();
  });
});
