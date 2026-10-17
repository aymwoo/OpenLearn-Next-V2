import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { AppHeader, type AppHeaderProps } from '../AppHeader';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

if (typeof (globalThis as Record<string, unknown>).__APP_VERSION__ === 'undefined') {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0';
}

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function makeProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  return {
    activeRole: 'teacher',
    lang: 'zh',
    teacherTab: 'live_class',
    studentViewStatus: 'dashboard',
    session: { name: 'Teacher', role: 'teacher', avatar: null },
    activeStudentId: null,
    students: [],
    studentDashboardData: null,
    isNotificationsOpen: false,
    studentNotifications: [],
    unreadNotifications: [],
    readNotifications: new Set<string>(),
    selectedNotificationForModal: null,
    dbConnected: true,
    dbStatus: 'normal',
    siteInfo: { siteName: 'OpenLearn Next' },
    setActiveStudentId: vi.fn(),
    setReadNotifications: vi.fn(),
    setIsSystemResourceLibraryOpen: vi.fn(),
    setProfileOpen: vi.fn(),
    setTeacherTab: vi.fn(),
    setStudentViewStatus: vi.fn(),
    setIsNotificationsOpen: vi.fn(),
    setSelectedNotificationForModal: vi.fn(),
    handleLogout: vi.fn(),
    toggleLanguage: vi.fn(),
    setActiveRole: vi.fn(),
    ...overrides,
  };
}

describe('header.async_task.item extension slot', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = new FrontendPluginHost();
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders header.async_task.item in AppHeader top bar and forwards control props', async () => {
    let capturedProps: any = null;
    const mockSetTeacherTab = vi.fn();

    const MockAsyncTaskPlugin = (props: any) => {
      capturedProps = props;
      return (
        <button
          data-testid="async-task-export-pill"
          onClick={() => props.setTeacherTab('reports')}
          className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold"
        >
          数据导出生成中 (80%)
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('header.async_task.item', {
      id: 'report-export-task-ext',
      label: '报表导出后台任务指示器',
      pluginId: 'ext-report-exporter',
      component: createLazyComponent(MockAsyncTaskPlugin),
    });

    render(
      <PluginHostProvider host={host}>
        <AppHeader {...makeProps({ setTeacherTab: mockSetTeacherTab, lang: 'zh', activeRole: 'teacher', teacherTab: 'live_class' })} />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('async-task-export-pill')).toBeTruthy();
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.lang).toBe('zh');
    expect(capturedProps.activeRole).toBe('teacher');
    expect(capturedProps.teacherTab).toBe('live_class');

    // 点击该任务胶囊可联动切换 teacherTab
    fireEvent.click(screen.getByTestId('async-task-export-pill'));
    expect(mockSetTeacherTab).toHaveBeenCalledWith('reports');
  });
});
