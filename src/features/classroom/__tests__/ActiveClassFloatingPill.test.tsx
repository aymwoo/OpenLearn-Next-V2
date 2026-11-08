import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActiveClassFloatingPill } from '../ActiveClassFloatingPill';
import { AppDataProvider } from '../../../context/AppDataContext';
import { appStore } from '../../../store/appStore';
import { liveClassStore } from '../../../store/liveClassStore';

describe('ActiveClassFloatingPill (全局授课悬浮监控胶囊)', () => {
  beforeEach(() => {
    appStore.setState({
      lang: 'zh',
      teacherTab: 'plugins',
      selectedLesson: 'lesson-101',
      lessons: [{ id: 'lesson-101', title: 'Python 科学计算与图形白板' } as any],
      classes: [{ id: 'class-1', name: '高一(1)班' } as any],
    });
    liveClassStore.setState({
      liveClassIsActive: true,
      liveClassTimeRemaining: 450, // 07:30
      liveClassSelectedClassId: 'class-1',
      onlineStudentIds: ['s1', 's2', 's3'],
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders pill when not in live_class and active teaching is running', () => {
    render(
      <AppDataProvider value={{ students: [] } as any}>
        <ActiveClassFloatingPill />
      </AppDataProvider>,
    );

    expect(screen.getByTestId('active-class-floating-pill')).toBeTruthy();
    expect(screen.getByText('正在授课')).toBeTruthy();
    expect(screen.getByText('Python 科学计算与图形白板')).toBeTruthy();
    expect(screen.getByText('高一(1)班')).toBeTruthy();
    expect(screen.getByText('07:30')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // online count
  });

  it('does NOT render pill when already inside live_class tab', () => {
    appStore.setState({ teacherTab: 'live_class' });
    render(
      <AppDataProvider value={{ students: [] } as any}>
        <ActiveClassFloatingPill />
      </AppDataProvider>,
    );

    expect(screen.queryByTestId('active-class-floating-pill')).toBeNull();
  });

  it('does NOT render pill when there is no active lesson session', () => {
    appStore.setState({ teacherTab: 'plugins', selectedLesson: null });
    liveClassStore.setState({ liveClassIsActive: false, liveClassTimeRemaining: 0 });
    render(
      <AppDataProvider value={{ students: [] } as any}>
        <ActiveClassFloatingPill />
      </AppDataProvider>,
    );

    expect(screen.queryByTestId('active-class-floating-pill')).toBeNull();
  });

  it('navigates back to live_class instantly on "返回白板" button click', () => {
    const setTeacherTabSpy = vi.fn();
    appStore.setState({ setTeacherTab: setTeacherTabSpy });

    render(
      <AppDataProvider value={{ students: [] } as any}>
        <ActiveClassFloatingPill />
      </AppDataProvider>,
    );

    const backBtn = screen.getByText('返回白板');
    fireEvent.click(backBtn);

    expect(setTeacherTabSpy).toHaveBeenCalledWith('live_class');
  });
});
