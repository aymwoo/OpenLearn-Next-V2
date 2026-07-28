import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppHeader, type AppHeaderProps } from '../AppHeader';

afterEach(() => cleanup());

// `__APP_VERSION__` is a vite global (defined in vite.config.ts, not injected by vitest here).
// AppHeader.tsx references it verbatim, so stub it for the test environment without touching source.
if (typeof (globalThis as Record<string, unknown>).__APP_VERSION__ === 'undefined') {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0';
}

function makeProps(overrides: Partial<AppHeaderProps> = {}): AppHeaderProps {
  return {
    activeRole: 'teacher',
    lang: 'en',
    teacherTab: 'dashboard',
    studentViewStatus: 'dashboard',
    session: { name: 'T', role: 'teacher', avatar: null },
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
    ...overrides,
  };
}

describe('AppHeader', () => {
  it('renders the top navbar (basic render case)', () => {
    render(<AppHeader {...makeProps()} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders English labels when lang="en"', () => {
    render(<AppHeader {...makeProps({ lang: 'en' })} />);
    expect(screen.getByText('System Resource Library')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('renders Chinese labels when lang="zh"', () => {
    render(<AppHeader {...makeProps({ lang: 'zh' })} />);
    expect(screen.getByText('系统资源库')).toBeTruthy();
  });
});
