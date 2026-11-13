import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LoginPage } from '../LoginPage';
import ThemeFailsafeRecoveryButton from '../ThemeFailsafeRecoveryButton';
import { ThemeCenterModal } from '../ThemeCenterModal';
import { PluginSandboxIframeView } from '../PluginSandboxIframeView';
import { TeacherView } from '../../features/teacher/TeacherView';
import { StudentView } from '../../features/student/StudentView';
import { BUILTIN_THEMES, useThemeStore } from '../../store/themeStore';
import { resolveSafeLayouts, type ValidatedThemeBundle } from '../../../packages/core/themes/theme-spec';
import { AppDataProvider } from '../../context/AppDataContext';

const splitBundle: ValidatedThemeBundle = {
  manifest: {
    schemaVersion: 1,
    id: 'layout-theme',
    name: 'Split Studio',
    version: '1.2.0',
    description: 'Layout showcase',
    author: 'Tester',
  },
  modes: {
    light: { '--bg-app': '#ffffff', '--bg-surface': '#f8fafc', '--text-main': '#0f172a', '--color-primary': '#0f766e' },
    dark: { '--bg-app': '#0f172a', '--bg-surface': '#1e293b', '--text-main': '#f8fafc', '--color-primary': '#14b8a6' },
  },
  typography: { fontSans: 'Inter, sans-serif' },
  appearance: { borderRadius: 'pill', cardStyle: 'elevated', density: 'spacious' },
  layouts: resolveSafeLayouts({
    login: { arrangement: 'split-left', order: ['brand', 'auth-form', 'seed-hint'] },
    teacher: { navPosition: 'right', contentMaxWidth: 'wide' },
    student: { headerPosition: 'bottom', cardColumns: 3 },
    admin: { navStyle: 'sidebar-left' },
  }),
  scopedCss: '',
  assetPaths: [],
};

describe('Third-Party Theme UI Layouts, Theme Center, Bridge Payload & Recovery (Issue #484)', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({
      theme: 'light',
      availableThemes: [...BUILTIN_THEMES],
      catalog: [],
      activeBundle: null,
      installedVersion: null,
      latestVersion: null,
      upgradeAvailable: false,
      colorMode: 'auto',
      resolvedColorScheme: 'light',
      appearanceOverrides: {},
      resolvedLayouts: resolveSafeLayouts(null),
      defaultSiteThemeId: 'light',
      fallbackNotice: null,
      principalKey: null,
      previewState: null,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [], themes: [] }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('rearranges LoginPage declaratively without removing any mandatory auth controls', () => {
    useThemeStore.getState().startPreview({
      themeId: 'layout-theme',
      bundle: splitBundle,
      mode: 'light',
      appearanceOverrides: {},
    });

    const { container } = render(<LoginPage onLoginSuccess={vi.fn()} lang="zh" />);
    const mainEl = container.querySelector('#login_page_container');
    expect(mainEl?.getAttribute('data-login-arrangement')).toBe('split-left');
    // Required form controls stay reachable
    expect(screen.getByLabelText(/教工账户名/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /学生自助端/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /安全验证登录/i })).toBeTruthy();
  });

  it('rearranges TeacherView and StudentView via resolvedLayouts while keeping required navigation/content', () => {
    useThemeStore.getState().startPreview({
      themeId: 'layout-theme',
      bundle: splitBundle,
      mode: 'light',
      appearanceOverrides: {},
    });

    const mockTeacherAppData = {
      teacherTab: 'help',
      setTeacherTab: vi.fn(),
      mainNavCollapsed: false,
      setMainNavCollapsed: vi.fn(),
      lang: 'zh',
      session: { role: 'teacher', userId: 't-1', name: 'Teacher', username: 't1' },
      todaySchedules: [],
    } as any;

    const { container: teacherContainer } = render(
      <AppDataProvider value={mockTeacherAppData}>
        <TeacherView />
      </AppDataProvider>,
    );
    expect(teacherContainer.querySelector('[data-teacher-nav-position="right"]')).toBeTruthy();
    expect(teacherContainer.querySelector('#navigation_sidebar')?.getAttribute('data-nav-position')).toBe('right');

    const mockStudentAppData = {
      students: [{ id: 's-1', name: 'Stu 1', email: 's1@test.edu' }],
      activeStudentId: null,
      lang: 'zh',
      studentViewStatus: 'dashboard',
      studentDashboardData: null,
    } as any;

    const { container: studentContainer } = render(
      <AppDataProvider value={mockStudentAppData}>
        <StudentView />
      </AppDataProvider>,
    );
    const stuRoot = studentContainer.querySelector('[data-testid="student-view-root"]');
    expect(stuRoot?.getAttribute('data-student-header-position')).toBe('bottom');
    expect(stuRoot?.getAttribute('data-student-card-columns')).toBe('3');
  });

  it('renders inline-styled ThemeFailsafeRecoveryButton independent of CSS vars and resets cleanly', async () => {
    useThemeStore.getState().startPreview({
      themeId: 'layout-theme',
      bundle: splitBundle,
      mode: 'light',
      appearanceOverrides: {},
    });

    render(<ThemeFailsafeRecoveryButton lang="zh" />);

    const resetBtn = screen.getByTestId('theme-failsafe-recovery') as HTMLButtonElement;
    expect(resetBtn.style.backgroundColor).toBe('rgb(220, 38, 38)');
    expect(screen.getByTestId('theme-cancel-preview')).toBeTruthy();

    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(useThemeStore.getState().theme).toBe('light');
      expect(useThemeStore.getState().activeBundle).toBeNull();
    });
  });

  it('renders ThemeCenterModal with upgrade confirmation & catalog actions', async () => {
    useThemeStore.setState({
      principalKey: 'teacher:t1',
      theme: 'layout-theme',
      installedVersion: '1.0.0',
      latestVersion: '1.2.0',
      upgradeAvailable: true,
      upgradeChangelog: 'Improved font legibility',
      catalog: [
        {
          id: 'layout-theme',
          name: 'Split Studio',
          description: 'Layout showcase',
          author: 'Tester',
          latestVersion: '1.2.0',
          uploaderId: 'teacher:t1',
          uploaderName: 'T1',
          isOwner: true,
          status: 'active',
          supportsModes: ['light', 'dark'],
          platformMinVersion: null,
          platformMaxVersion: null,
          compatible: true,
          previewImageUrl: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    render(<ThemeCenterModal isOpen={true} onClose={vi.fn()} lang="zh" isAdmin={true} />);

    expect(screen.getByText(/Improved font legibility/i)).toBeTruthy();
    expect(screen.getByTestId('theme-upgrade-confirm')).toBeTruthy();
    expect(screen.getByTestId('theme-catalog-card-layout-theme')).toBeTruthy();
    expect(screen.getByRole('button', { name: '停用' })).toBeTruthy();
  });

  it('forwards unified themeMeta payload in PluginSandboxIframeView init postMessage', () => {
    useThemeStore.getState().startPreview({
      themeId: 'layout-theme',
      bundle: splitBundle,
      mode: 'dark',
      appearanceOverrides: {},
    });

    const { container } = render(
      <PluginSandboxIframeView pluginId="demo-plugin" view="panel.html" label="Demo Panel" />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();

    const postSpy = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: postSpy },
      configurable: true,
    });

    fireEvent.load(iframe);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'init',
        payload: expect.objectContaining({
          theme: 'layout-theme',
          themeMeta: expect.objectContaining({
            theme: 'layout-theme',
            colorScheme: 'dark',
            fonts: expect.objectContaining({ sans: 'Inter, sans-serif' }),
          }),
        }),
      }),
      '*',
    );
  });
});
