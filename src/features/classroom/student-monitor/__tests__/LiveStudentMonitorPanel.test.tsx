import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { LiveStudentMonitorPanel } from '../LiveStudentMonitorPanel';

afterEach(() => {
  cleanup();
});

function makeProps(overrides: Partial<ComponentProps<typeof LiveStudentMonitorPanel>> = {}) {
  return {
    lang: 'zh',
    selectedLesson: 'lesson-1',
    liveClassSelectedClassId: 'class-1',
    students: [],
    onlineStudentIds: [],
    liveClassAcknowledgedMap: new Map(),
    activeStudentLessons: {},
    liveClassStudentProgress: [],
    timelineSegments: [],
    activeSegmentId: null,
    studentErrors: [],
    hoveredStudentId: null,
    setHoveredStudentId: vi.fn(),
    pinnedStudentId: null,
    setPinnedStudentId: vi.fn(),
    selectedDrawStudentIds: [],
    activeDrawStudentId: null,
    isDrawing: false,
    onRandomPick: vi.fn(),
    addToast: vi.fn(),
    onOverrideSegmentGate: vi.fn(),
    onToggleStudentLock: vi.fn(),
    isFeedCollapsed: true,
    setIsFeedCollapsed: vi.fn(),
    liveClassFeed: [],
    setLiveClassFeed: vi.fn(),
    ...overrides,
  } as ComponentProps<typeof LiveStudentMonitorPanel>;
}

describe('LiveStudentMonitorPanel 折叠', () => {
  it('展开态显示完整面板，收起按钮触发回调', () => {
    const onToggleCollapse = vi.fn();
    render(<LiveStudentMonitorPanel {...makeProps({ isCollapsed: false, onToggleCollapse })} />);

    expect(screen.getByText('学生专注力监控')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收起学生专注面板' }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it('收起态只渲染窄条，展开按钮触发回调', () => {
    const onToggleCollapse = vi.fn();
    render(<LiveStudentMonitorPanel {...makeProps({ isCollapsed: true, onToggleCollapse })} />);

    expect(screen.getByTestId('live-student-monitor-collapsed')).toBeTruthy();
    expect(screen.queryByText('学生专注力监控')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开学生专注面板' }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
