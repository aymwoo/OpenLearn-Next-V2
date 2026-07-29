import { describe, it, expect, beforeEach } from 'vitest';
import { studentStore } from '../studentStore';

describe('studentStore', () => {
  beforeEach(() => {
    studentStore.setState({
      studentDashboardData: null,
      notifications: [],
    });
  });

  it('updates dashboard data and notifications', () => {
    studentStore.getState().setStudentDashboardData({ studentId: 's1', gpa: 3.8 });
    expect(studentStore.getState().studentDashboardData).toEqual({ studentId: 's1', gpa: 3.8 });

    studentStore.getState().setNotifications([{ id: 'n1', title: 'New Grade' }]);
    expect(studentStore.getState().notifications).toHaveLength(1);
  });
});
