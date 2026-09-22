import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppPolling, UseAppPollingOptions } from '../useAppPolling';
import type { SessionType } from '../../types/app';

function createMockOptions(session: SessionType | null): UseAppPollingOptions {
  return {
    session,
    showProcessLogs: null,
    activeStudentId: null,
    currentVfsParent: null,
    selectedLesson: null,
    selectedAssignment: null,
    expandedClassId: null,

    fetchLessons: vi.fn().mockResolvedValue(undefined),
    fetchPlugins: vi.fn().mockResolvedValue(undefined),
    fetchRegisteredCommands: vi.fn().mockResolvedValue(undefined),
    fetchEvents: vi.fn().mockResolvedValue(undefined),
    fetchApprovals: vi.fn().mockResolvedValue(undefined),
    fetchProcesses: vi.fn().mockResolvedValue(undefined),
    fetchClasses: vi.fn().mockResolvedValue(undefined),
    fetchTodaySchedules: vi.fn().mockResolvedValue(undefined),
    fetchStudents: vi.fn().mockResolvedValue(undefined),
    fetchLabs: vi.fn().mockResolvedValue(undefined),
    fetchVfs: vi.fn().mockResolvedValue(undefined),
    fetchProcessLogs: vi.fn().mockResolvedValue(undefined),
    fetchClassStudents: vi.fn().mockResolvedValue(undefined),
    fetchElements: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useAppPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not fetch any data when session is null', () => {
    const options = createMockOptions(null);
    renderHook(() => useAppPolling(options));

    expect(options.fetchLessons).not.toHaveBeenCalled();
    expect(options.fetchEvents).not.toHaveBeenCalled();
    expect(options.fetchApprovals).not.toHaveBeenCalled();
    expect(options.fetchProcesses).not.toHaveBeenCalled();
  });

  it('only polls student-permitted endpoints for student session without 403 endpoints', async () => {
    const studentSession: SessionType = {
      role: 'student',
      studentId: 'stu-1',
      name: 'Alice',
    };
    const options = createMockOptions(studentSession);
    renderHook(() => useAppPolling(options));

    // Mount checks
    expect(options.fetchLessons).toHaveBeenCalled();
    expect(options.fetchPlugins).toHaveBeenCalled();
    expect(options.fetchRegisteredCommands).toHaveBeenCalled();
    expect(options.fetchTodaySchedules).toHaveBeenCalled();

    // Must NOT call administrator endpoints
    expect(options.fetchEvents).not.toHaveBeenCalled();
    expect(options.fetchApprovals).not.toHaveBeenCalled();
    expect(options.fetchProcesses).not.toHaveBeenCalled();

    // Must NOT call teacher-only administrative roster endpoints
    expect(options.fetchClasses).not.toHaveBeenCalled();
    expect(options.fetchStudents).not.toHaveBeenCalled();
    expect(options.fetchLabs).not.toHaveBeenCalled();

    // Advance timer 2s
    await vi.advanceTimersByTimeAsync(2000);

    // In interval, still must NEVER call admin endpoints
    expect(options.fetchEvents).not.toHaveBeenCalled();
    expect(options.fetchApprovals).not.toHaveBeenCalled();
    expect(options.fetchProcesses).not.toHaveBeenCalled();
    expect(options.fetchClasses).not.toHaveBeenCalled();
    expect(options.fetchStudents).not.toHaveBeenCalled();
  });

  it('polls teacher endpoints but omits administrator endpoints for non-admin teacher', async () => {
    const teacherSession: SessionType = {
      role: 'teacher',
      subRole: 'teacher',
      userId: 'usr_teacher',
      username: 'teacher',
      name: 'Bob',
    };
    const options = createMockOptions(teacherSession);
    renderHook(() => useAppPolling(options));

    // Mount checks
    expect(options.fetchLessons).toHaveBeenCalled();
    expect(options.fetchClasses).toHaveBeenCalled();
    expect(options.fetchStudents).toHaveBeenCalled();
    expect(options.fetchLabs).toHaveBeenCalled();

    // Must NOT call admin-only endpoints
    expect(options.fetchEvents).not.toHaveBeenCalled();
    expect(options.fetchApprovals).not.toHaveBeenCalled();
    expect(options.fetchProcesses).not.toHaveBeenCalled();

    // Advance timer 2s
    await vi.advanceTimersByTimeAsync(2000);

    expect(options.fetchEvents).not.toHaveBeenCalled();
    expect(options.fetchApprovals).not.toHaveBeenCalled();
    expect(options.fetchProcesses).not.toHaveBeenCalled();
  });

  it('polls all endpoints including events, approvals, and processes for administrator', async () => {
    const adminSession: SessionType = {
      role: 'teacher',
      subRole: 'administrator',
      userId: 'usr_admin',
      username: 'admin',
      name: 'Admin',
    };
    const options = createMockOptions(adminSession);
    renderHook(() => useAppPolling(options));

    // Mount checks
    expect(options.fetchLessons).toHaveBeenCalled();
    expect(options.fetchClasses).toHaveBeenCalled();
    expect(options.fetchEvents).toHaveBeenCalled();
    expect(options.fetchApprovals).toHaveBeenCalled();
    expect(options.fetchProcesses).toHaveBeenCalled();

    // Advance timer 2s
    await vi.advanceTimersByTimeAsync(2000);

    expect(options.fetchEvents).toHaveBeenCalledTimes(2);
    expect(options.fetchApprovals).toHaveBeenCalledTimes(2);
    expect(options.fetchProcesses).toHaveBeenCalledTimes(2);
  });
});
