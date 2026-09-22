import { describe, it, expect, beforeEach } from 'vitest';
import { classStore } from '../classStore';

describe('classStore', () => {
  beforeEach(() => {
    classStore.setState({
      classes: [],
      students: [],
      classStudentsMap: {},
      classDashboardMap: {},
      studentProgressMap: {},
      classSchedulesMap: {},
      scheduleAttendanceMap: {},
      assignmentSubmissionsMap: {},
      classAssignmentsMap: {},
      classProgressMap: {},
      classSeats: { lab_id: null, seats: [] },
    });
  });

  it('updates classes and students', () => {
    const mockClass = { id: 'c1', name: 'Class 1' } as any;
    const mockStudent = { id: 's1', name: 'Student 1' } as any;

    classStore.getState().setClasses([mockClass]);
    expect(classStore.getState().classes).toHaveLength(1);

    classStore.getState().setStudents([mockStudent]);
    expect(classStore.getState().students).toHaveLength(1);
  });

  it('updates classStudentsMap immutably', () => {
    const mockStudent = { id: 's1', name: 'Student 1' } as any;
    classStore.getState().setClassStudents('c1', [mockStudent]);

    expect(classStore.getState().classStudentsMap['c1']).toEqual([mockStudent]);
  });
});
