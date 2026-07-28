import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassTabs } from '../ClassTabs';
import type { ClassType } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    ...overrides,
  };
}

function baseProps() {
  return {
    cls: makeClass(),
    lang: 'en' as 'zh' | 'en',
    classActiveTabs: {} as Record<string, 'students' | 'assignments' | 'schedules' | 'seating' | 'grades'>,
    setClassActiveTabs: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassTabs', () => {
  it('renders the four tab labels in en', () => {
    render(<ClassTabs {...baseProps()} />);
    expect(screen.getByText('Students')).toBeTruthy();
    expect(screen.getByText('Assignments')).toBeTruthy();
    expect(screen.getByText('Attendance')).toBeTruthy();
    expect(screen.getByText('Grades')).toBeTruthy();
  });

  it('calls setClassActiveTabs with an updater that sets [cls.id] to assignments on click', () => {
    const props = baseProps();
    render(<ClassTabs {...props} />);
    fireEvent.click(screen.getByText('Assignments'));

    expect(props.setClassActiveTabs).toHaveBeenCalledTimes(1);
    const updater = props.setClassActiveTabs.mock.calls[0][0];
    expect(typeof updater).toBe('function');
    const next = updater({});
    expect(next).toEqual({ 'class-1': 'assignments' });
  });
});
