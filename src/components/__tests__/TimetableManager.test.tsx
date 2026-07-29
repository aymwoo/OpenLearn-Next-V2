import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TimetableCalendarView } from '../timetable/sub-views/TimetableCalendarView';
import { TimetableAdjustView } from '../timetable/sub-views/TimetableAdjustView';
import { TimetableImportExportView } from '../timetable/sub-views/TimetableImportExportView';
import { getMonday, getWeekRangeString, getWeekDates, getIsAfternoon } from '../timetable/utils/timetableUtils';

describe('Timetable Utilities & Components', () => {
  describe('timetableUtils', () => {
    it('should compute Monday date correctly', () => {
      // 2026-07-29 is a Wednesday
      const wednesday = new Date(2026, 6, 29);
      const monday = getMonday(wednesday);
      expect(monday.getDay()).toBe(1); // 1 = Monday
      expect(monday.getDate()).toBe(27); // 2026-07-27
    });

    it('should format week range string', () => {
      const monday = new Date(2026, 6, 27);
      const range = getWeekRangeString(monday);
      expect(range).toBe('2026-07-27 ~ 2026-08-02');
    });

    it('should generate 7 week dates', () => {
      const monday = new Date(2026, 6, 27);
      const dates = getWeekDates(monday);
      expect(dates.length).toBe(7);
      expect(dates[0]).toBe('2026-07-27');
      expect(dates[6]).toBe('2026-08-02');
    });

    it('should determine if time slot is afternoon', () => {
      expect(getIsAfternoon('09:00 - 10:30')).toBe(false);
      expect(getIsAfternoon('14:00 - 15:30')).toBe(true);
      expect(getIsAfternoon(null)).toBe(false);
    });
  });

  describe('TimetableCalendarView', () => {
    it('should render calendar view filters and schedules in week mode', () => {
      render(
        <TimetableCalendarView
          lang="zh"
          viewMode="week"
          setViewMode={vi.fn()}
          selectedClassId="all"
          setSelectedClassId={vi.fn()}
          statusFilter="all"
          setStatusFilter={vi.fn()}
          searchQuery=""
          setSearchQuery={vi.fn()}
          classes={[{ id: 'c1', name: '高一(1)班' }]}
          getClassDisplayName={(name) => name}
          loading={false}
          filteredSchedules={[
            {
              id: 'sch-1',
              class_id: 'c1',
              lesson_id: 'les-1',
              scheduled_date: '2026-07-27',
              time_slot: '09:00 - 10:30',
              status: 'scheduled',
              class_name: '高一(1)班',
              lesson_title: '高等数学第一讲'
            }
          ]}
          currentWeekMonday={new Date(2026, 6, 27)}
          setCurrentWeekMonday={vi.fn()}
          showWeekend={false}
          setShowWeekend={vi.fn()}
          dateOverrides={{}}
          setDateOverrides={vi.fn()}
          setOverridingDateKey={vi.fn()}
          setOverrideMode={vi.fn()}
          setOverrideTargetDow={vi.fn()}
          setOverrideTargetDate={vi.fn()}
          openEditModal={vi.fn()}
          handleDeleteSchedule={vi.fn()}
          getDayOfWeekIndex={() => 1}
          getMonday={getMonday}
          getWeekRangeString={getWeekRangeString}
          setFormClassId={vi.fn()}
          setFormLessonId={vi.fn()}
          setFormDate={vi.fn()}
          setFormStatus={vi.fn()}
          setFormNotes={vi.fn()}
          setIsAddOpen={vi.fn()}
        />
      );

      expect(screen.getByText('本周')).toBeDefined();
      expect(screen.getAllByText('高一(1)班').length).toBeGreaterThan(0);
    });
  });

  describe('TimetableAdjustView', () => {
    it('should render batch holiday adjustment form', () => {
      render(
        <TimetableAdjustView
          lang="zh"
          holStartDate="2026-10-01"
          setHolStartDate={vi.fn()}
          holEndDate="2026-10-07"
          setHolEndDate={vi.fn()}
          holType="holiday"
          setHolType={vi.fn()}
          holNotes="国庆假期"
          setHolNotes={vi.fn()}
          handleBatchHolidayAdjustment={vi.fn()}
          loading={false}
        />
      );

      expect(screen.getByText('批量节假日调休排班')).toBeDefined();
      expect(screen.getByText('一键更新该周期课表')).toBeDefined();
    });
  });

  describe('TimetableImportExportView', () => {
    it('should render import and export panels', () => {
      render(
        <TimetableImportExportView
          lang="zh"
          classes={[{ id: 'c1', name: '高一(1)班' }]}
          getClassDisplayName={(name) => name}
          handleExportCSV={vi.fn()}
          handleExportJSON={vi.fn()}
          importClassId=""
          setImportClassId={vi.fn()}
          csvText=""
          setCsvText={vi.fn()}
          importMessage={null}
          handleImportData={vi.fn()}
        />
      );

      expect(screen.getByText('导出系统课表')).toBeDefined();
      expect(screen.getByText('导入课表流程')).toBeDefined();
    });
  });
});
