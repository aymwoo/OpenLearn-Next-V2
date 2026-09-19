import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigationSidebar } from '../NavigationSidebar';

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
});
