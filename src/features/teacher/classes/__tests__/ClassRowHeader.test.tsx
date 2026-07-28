import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassRowHeader } from '../ClassRowHeader';
import type { ClassType } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    student_count: 12,
    course_count: 3,
    assignment_count: 5,
    ...overrides,
  };
}

function makeProps(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  const base = baseProps();
  return { ...base, ...overrides };
}

function baseProps() {
  return {
    cls: makeClass(),
    lang: 'zh' as 'zh' | 'en',
    isExpanded: false,
    batchMode: false,
    selectedClassIds: new Set<string>(),
    setExpandedClassId: vi.fn(),
    setSelectedStudentIds: vi.fn(),
    toggleClassSelection: vi.fn(),
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    fetchClassProgress: vi.fn().mockResolvedValue(undefined),
    fetchClassDashboard: vi.fn().mockResolvedValue(undefined),
    fetchClassSchedules: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassRowHeader', () => {
  it('renders the class name passed via cls.name', () => {
    render(<ClassRowHeader {...makeProps()} />);
    expect(screen.getByText('Math 101')).toBeTruthy();
  });

  it('renders the three count labels with their values', () => {
    render(<ClassRowHeader {...makeProps({ lang: 'en' })} />);
    expect(screen.getByTitle('Students')).toBeTruthy();
    expect(screen.getByTitle('Courses')).toBeTruthy();
    expect(screen.getByTitle('Assignments')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('clicking the row when not in batch mode expands the class', () => {
    const props = makeProps();
    render(<ClassRowHeader {...props} />);
    fireEvent.click(screen.getByText('Math 101').parentElement!.parentElement!);
    expect(props.setExpandedClassId).toHaveBeenCalledWith('class-1');
  });

  it('does not expand when in batch mode (toggles selection instead)', () => {
    const props = makeProps({ batchMode: true });
    render(<ClassRowHeader {...props} />);
    fireEvent.click(screen.getByText('Math 101').parentElement!.parentElement!);
    expect(props.toggleClassSelection).toHaveBeenCalledWith('class-1');
    expect(props.setExpandedClassId).not.toHaveBeenCalled();
  });
});
