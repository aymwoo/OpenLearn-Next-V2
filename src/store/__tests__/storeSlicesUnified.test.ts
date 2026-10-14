import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../appStore';
import { classStore } from '../classStore';
import { lessonStore } from '../lessonStore';
import { liveClassStore } from '../liveClassStore';
import { studentStore } from '../studentStore';

describe('Store Slices Unified Architecture (PERF-03 / Stage 5)', () => {
  beforeEach(() => {
    appStore.setState({
      lessons: [],
      selectedLesson: null,
      elements: [],
      vfsNodes: [],
      classes: [],
      students: [],
      classStudentsMap: {},
      classDashboardMap: {},
      liveClassSelectedClassId: null,
      liveClassIsActive: false,
      liveClassFeed: [],
      liveClassTimeRemaining: 0,
      studentDashboardData: null,
      notifications: [],
      session: null,
      dbConnected: false,
      sessionLoading: false,
      aiProviders: [],
      plugins: [],
    });
  });

  describe('Eliminate Split-Brain / Facade Unification', () => {
    it('synchronizes classStore and appStore under the same underlying state', () => {
      const mockClass = { id: 'c-test-1', name: 'Computer Science 101' } as any;

      classStore.getState().setClasses([mockClass]);

      expect(classStore.getState().classes).toEqual([mockClass]);
      expect(appStore.getState().classes).toEqual([mockClass]);

      const mockClass2 = { id: 'c-test-2', name: 'Software Engineering' } as any;
      appStore.getState().setClasses([mockClass, mockClass2]);

      expect(classStore.getState().classes).toHaveLength(2);
      expect(appStore.getState().classes).toHaveLength(2);
    });

    it('synchronizes lessonStore and appStore under the same underlying state', () => {
      const mockLesson = { id: 'les-1', title: 'Data Structures' } as any;

      lessonStore.getState().setLessons([mockLesson]);
      expect(appStore.getState().lessons).toEqual([mockLesson]);

      appStore.getState().setSelectedLesson('les-1');
      expect(lessonStore.getState().selectedLesson).toBe('les-1');
    });

    it('synchronizes liveClassStore and appStore including liveClassTimeRemaining', () => {
      liveClassStore.getState().setLiveClassIsActive(true);
      liveClassStore.getState().setLiveClassTimeRemaining(1800);

      expect(appStore.getState().liveClassIsActive).toBe(true);
      expect(appStore.getState().liveClassTimeRemaining).toBe(1800);

      appStore.getState().setLiveClassTimeRemaining(1200);
      expect(liveClassStore.getState().liveClassTimeRemaining).toBe(1200);
    });

    it('synchronizes studentStore and appStore under the same underlying state', () => {
      const mockDashboard = { studentId: 'stu-99', progress: 88 };
      studentStore.getState().setStudentDashboardData(mockDashboard);

      expect(appStore.getState().studentDashboardData).toEqual(mockDashboard);

      const mockNotif = [{ id: 'n1', title: 'Exam graded' }];
      appStore.getState().setNotifications(mockNotif);
      expect(studentStore.getState().notifications).toEqual(mockNotif);
    });
  });

  describe('Domain Slices Behavior', () => {
    it('classSlice manages immutable map updates correctly', () => {
      const student1 = { id: 's1', name: 'Alice' } as any;
      const student2 = { id: 's2', name: 'Bob' } as any;

      appStore.getState().setClassStudents('class-a', [student1]);
      appStore.getState().setClassStudents('class-b', [student2]);

      const map = appStore.getState().classStudentsMap;
      expect(map['class-a']).toEqual([student1]);
      expect(map['class-b']).toEqual([student2]);
    });

    it('lessonSlice supports both value and functional updater', () => {
      const l1 = { id: 'l1', title: 'L1' } as any;
      const l2 = { id: 'l2', title: 'L2' } as any;

      appStore.getState().setLessons([l1]);
      expect(appStore.getState().lessons).toHaveLength(1);

      appStore.getState().setLessons((prev) => [...prev, l2]);
      expect(appStore.getState().lessons).toHaveLength(2);
      expect(appStore.getState().lessons[1].id).toBe('l2');
    });

    it('liveClassSlice enforces 50-entry cap on liveClassFeed', () => {
      for (let i = 0; i < 60; i++) {
        appStore.getState().appendLiveClassFeed({ id: `feed-${i}`, msg: `Message ${i}` });
      }

      const feed = appStore.getState().liveClassFeed;
      expect(feed).toHaveLength(50);
      expect(feed[0].id).toBe('feed-10');
      expect(feed[49].id).toBe('feed-59');
    });

    it('triggers vanilla subscription listeners regardless of whether action was called from facade or appStore', () => {
      let notifyCount = 0;
      const unsubscribe = appStore.subscribe(() => {
        notifyCount++;
      });

      classStore.getState().setClasses([{ id: 'c-sub', name: 'Sub test' } as any]);
      expect(notifyCount).toBeGreaterThan(0);

      const countBefore = notifyCount;
      lessonStore.getState().setSelectedLesson('l-sub');
      expect(notifyCount).toBeGreaterThan(countBefore);

      unsubscribe();
    });
  });
});
