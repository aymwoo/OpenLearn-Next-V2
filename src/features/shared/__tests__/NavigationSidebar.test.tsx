import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationSidebar } from '../NavigationSidebar';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';

describe('NavigationSidebar (紧凑化与分类折叠)', () => {
  const defaultProps = {
    mainNavCollapsed: false,
    setMainNavCollapsed: vi.fn(),
    teacherTab: 'courses',
    setTeacherTab: vi.fn(),
    lang: 'zh',
    session: { subRole: 'administrator' } as any,
    todaySchedules: [],
  };

  beforeEach(() => {
    localStorage.clear();
    usePluginHostStore.setState({ extensionPoints: new Map() });
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders with compact width (md:w-44) when expanded', () => {
    const { container } = render(<NavigationSidebar {...defaultProps} />);
    const sidebar = container.querySelector('#navigation_sidebar');
    expect(sidebar).toBeTruthy();
    const classAttr = sidebar?.getAttribute('class') || '';
    expect(classAttr).toContain('md:w-44');
    expect(classAttr).not.toContain('md:w-64');
  });

  it('renders modern category group headers with accent bars and toggle buttons', () => {
    render(<NavigationSidebar {...defaultProps} />);

    const teachingGroup = screen.getByTestId('nav_group_teaching');
    expect(teachingGroup).toBeTruthy();
    expect(teachingGroup.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('教学工具')).toBeTruthy();

    const systemGroup = screen.getByTestId('nav_group_system');
    expect(systemGroup).toBeTruthy();
    expect(systemGroup.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('系统管理')).toBeTruthy();

    const supportGroup = screen.getByTestId('nav_group_support');
    expect(supportGroup).toBeTruthy();
    expect(supportGroup.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('帮助支持')).toBeTruthy();
  });

  it('collapses and expands category items when clicking the category header', () => {
    render(<NavigationSidebar {...defaultProps} />);

    // Initially "课程管理" is visible
    expect(screen.getByText('课程管理')).toBeTruthy();

    const teachingGroup = screen.getByTestId('nav_group_teaching');

    // Click to collapse
    fireEvent.click(teachingGroup);
    expect(teachingGroup.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('课程管理')).toBeNull();

    // Verify localStorage has saved the collapsed state
    const saved = JSON.parse(localStorage.getItem('openlearn_nav_collapsed_groups') || '{}');
    expect(saved.teaching).toBe(true);

    // Click again to expand
    fireEvent.click(teachingGroup);
    expect(teachingGroup.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('课程管理')).toBeTruthy();

    const savedAfter = JSON.parse(localStorage.getItem('openlearn_nav_collapsed_groups') || '{}');
    expect(savedAfter.teaching).toBe(false);
  });

  it('navigates when clicking a navigation button', () => {
    const setTeacherTab = vi.fn();
    render(<NavigationSidebar {...defaultProps} setTeacherTab={setTeacherTab} />);

    const liveClassBtn = screen.getByText('互动课堂');
    fireEvent.click(liveClassBtn);
    expect(setTeacherTab).toHaveBeenCalledWith('live_class');
  });

  it('handles mini icon mode (mainNavCollapsed: true)', () => {
    const setMainNavCollapsed = vi.fn();
    const { container } = render(
      <NavigationSidebar {...defaultProps} mainNavCollapsed={true} setMainNavCollapsed={setMainNavCollapsed} />,
    );

    const sidebar = container.querySelector('#navigation_sidebar');
    const classAttr = sidebar?.getAttribute('class') || '';
    expect(classAttr).toContain('w-16');

    // Toggle button should call setMainNavCollapsed
    const toggleBtn = screen.getByTitle('展开导航');
    fireEvent.click(toggleBtn);
    expect(setMainNavCollapsed).toHaveBeenCalledWith(false);
  });

  it('renders plugin tab in EXTENSIONS group with custom icon', () => {
    usePluginHostStore.getState().registerExtensionPoint('teacher.tab', {
      id: 'custom-tool',
      label: '自定义扩展',
      icon: 'Award',
      pluginId: 'ext-custom',
      component: () => Promise.resolve({ default: () => <div>Plugin Content</div> }),
    });

    const host = new FrontendPluginHost();
    const { container } = render(
      <PluginHostProvider host={host}>
        <NavigationSidebar {...defaultProps} />
      </PluginHostProvider>,
    );

    expect(screen.getByText('扩展应用')).toBeTruthy();
    expect(screen.getByText('自定义扩展')).toBeTruthy();
    const awardSvg = container.querySelector('svg.lucide-award');
    expect(awardSvg).toBeTruthy();
  });

  it('renders clean borderless inactive states without persistent boxes on admin or plugins', () => {
    const { container } = render(<NavigationSidebar {...defaultProps} teacherTab="courses" />);

    const coursesBtn = container.querySelector('#nav_btn_courses');
    const coursesWrapper = coursesBtn?.parentElement;
    expect(coursesWrapper?.className).toContain('bg-primary-theme-light');
    expect(coursesWrapper?.className).toContain('text-primary-theme');
    expect(coursesWrapper?.className).toContain('border-primary-theme/25');

    const pluginsBtn = container.querySelector('#nav_btn_plugins');
    const pluginsWrapper = pluginsBtn?.parentElement;
    expect(pluginsWrapper?.className).toContain('border-transparent');
    expect(pluginsWrapper?.className).toContain('text-muted');
    expect(pluginsWrapper?.className).not.toContain('bg-primary-theme-light');
    expect(pluginsWrapper?.className).not.toContain('border-indigo-100');

    const adminBtn = container.querySelector('#nav_btn_admin_directory');
    const adminWrapper = adminBtn?.parentElement;
    expect(adminWrapper?.className).toContain('border-transparent');
    expect(adminWrapper?.className).toContain('text-muted');
    expect(adminWrapper?.className).not.toContain('bg-primary-theme-light');
    expect(adminWrapper?.className).not.toContain('border-indigo-100');
    expect(adminWrapper?.className).not.toContain('bg-slate-50');
  });

  it('activates plugins tab cleanly and resets other items to borderless inactive', () => {
    const { container } = render(<NavigationSidebar {...defaultProps} teacherTab="plugins" />);

    const pluginsBtn = container.querySelector('#nav_btn_plugins');
    const pluginsWrapper = pluginsBtn?.parentElement;
    expect(pluginsWrapper?.className).toContain('bg-primary-theme-light');
    expect(pluginsWrapper?.className).toContain('border-primary-theme/25');

    const coursesBtn = container.querySelector('#nav_btn_courses');
    const coursesWrapper = coursesBtn?.parentElement;
    expect(coursesWrapper?.className).toContain('border-transparent');
    expect(coursesWrapper?.className).not.toContain('bg-primary-theme-light');

    const adminBtn = container.querySelector('#nav_btn_admin_directory');
    const adminWrapper = adminBtn?.parentElement;
    expect(adminWrapper?.className).toContain('border-transparent');
    expect(adminWrapper?.className).not.toContain('border-indigo-100');
  });
});
