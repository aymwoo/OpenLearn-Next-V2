import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassStudentsPanel } from '../ClassStudentsPanel';
import type { ClassType, StudentType, StudentProgressType, Lesson } from '../../../../types/app';

function makeClass(overrides: Partial<ClassType> = {}): ClassType {
  return {
    id: 'class-1',
    name: 'Math 101',
    description: '',
    created_at: 0,
    student_count: 2,
    ...overrides,
  };
}

function makeStudent(id: string, name: string, student_number?: string): StudentType {
  return {
    id,
    name,
    student_number,
    email: `${id}@example.com`,
    password: '123456',
    private_notes: '',
  } as StudentType;
}

function baseProps(overrides: Partial<ReturnType<typeof buildProps>> = {}) {
  const base = buildProps();
  return { ...base, ...overrides };
}

function buildProps() {
  return {
    cls: makeClass(),
    classStudentsMap: {
      'class-1': [
        makeStudent('s-1', 'Alice', 'STU2026001'),
        makeStudent('s-2', 'Bob', 'STU2026002'),
      ],
    },
    students: [
      makeStudent('s-1', 'Alice', 'STU2026001'),
      makeStudent('s-2', 'Bob', 'STU2026002'),
      makeStudent('s-3', 'Carol', 'STU2026003'),
    ],
    lang: 'en' as 'zh' | 'en',
    selectedStudentIds: new Set<string>(),
    rosterViewMode: 'grid' as 'grid' | 'list',
    setRosterViewMode: vi.fn(),
    rosterSearchQuery: '',
    setRosterSearchQuery: vi.fn(),
    rosterTagFilter: 'all' as const,
    setRosterTagFilter: vi.fn(),
    batchMode: false,
    toggleSelectAllStudents: vi.fn(),
    handleBatchDeleteStudents: vi.fn(),
    handleBatchResetPassword: vi.fn(),
    handleBatchTransferStudents: vi.fn(),
    handleBatchSetLockedLesson: vi.fn(),
    expandedStudentId: null,
    setExpandedStudentId: vi.fn(),
    fetchStudentProgress: vi.fn().mockResolvedValue(undefined),
    studentProgressMap: {} as Record<string, StudentProgressType[]>,
    studentActiveTabs: {} as Record<string, 'progress' | 'settings' | 'notes'>,
    setStudentActiveTabs: vi.fn(),
    toggleStudentSelection: vi.fn(),
    get30DayAverageWarning: vi.fn().mockReturnValue(null),
    lessons: [] as Lesson[],
    setStudents: vi.fn(),
    setClassStudentsMap: vi.fn(),
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    parseCSV: vi.fn().mockReturnValue([]),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClassStudentsPanel', () => {
  it('renders the roster header and student names from classStudentsMap', () => {
    render(<ClassStudentsPanel {...baseProps()} />);
    expect(screen.getByText('Class Student Roster')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
  });

  it('renders student_number badges and copies to clipboard on click', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ClassStudentsPanel {...baseProps()} />);
    const badge = screen.getByText('STU2026001');
    expect(badge).toBeTruthy();

    fireEvent.click(badge);
    expect(writeTextMock).toHaveBeenCalledWith('STU2026001');
  });

  it('filters students by student_number query', () => {
    const props = baseProps({ rosterSearchQuery: 'STU2026002' });
    render(<ClassStudentsPanel {...props} />);
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('STU2026002')).toBeTruthy();
  });

  it('renders student_number input in settings tab when student is expanded', () => {
    const props = baseProps({
      expandedStudentId: 's-1',
      studentActiveTabs: { 's-1': 'settings' },
    });
    render(<ClassStudentsPanel {...props} />);
    expect(screen.getByText('Student Number (Login ID):')).toBeTruthy();
    const input = screen.getByDisplayValue('STU2026001') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('toggles a student checkbox via toggleStudentSelection', () => {
    // In list mode each student row renders a checkbox (first checkbox is "Select All").
    const listProps = baseProps({ rosterViewMode: 'list' as const });
    render(<ClassStudentsPanel {...listProps} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // [0] = Select All, [1] = first student (Alice, id 's-1')
    fireEvent.click(checkboxes[1]);
    expect(listProps.toggleStudentSelection).toHaveBeenCalledWith('s-1');
  });

  it('renders the empty-state message when the class has no students', () => {
    const props = baseProps({ classStudentsMap: { 'class-1': [] } });
    render(<ClassStudentsPanel {...props} />);
    expect(screen.getByText('No students registered in this class.')).toBeTruthy();
  });
});
