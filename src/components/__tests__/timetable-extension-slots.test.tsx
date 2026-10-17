import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TimetableOcrView, type TimetableOcrViewProps } from '../timetable/sub-views/TimetableOcrView';
import { TimetableCalendarView, type TimetableCalendarViewProps } from '../timetable/sub-views/TimetableCalendarView';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';
import type { ScheduleType } from '../timetable/types';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockSchedule: ScheduleType = {
  id: 'sch_1',
  class_id: 'class_1',
  lesson_id: 'les_1',
  lesson_title: '算法初步',
  class_name: '高一1班',
  scheduled_date: '2026-10-12',
  time_slot: '08:00 - 08:45',
  status: 'scheduled',
};

describe('Timetable extension slots', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.setState({
      extensionPoints: new Map(),
      activePlugins: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('timetable.import.source slot', () => {
    it('renders timetable.import.source extension in TimetableOcrView and handles import', async () => {
      const setOcrEntriesMock = vi.fn();
      const setOcrSelectedEntriesMock = vi.fn();

      const MockImportSourcePlugin: React.FC<{
        onImportEntries?: (entries: any[]) => void;
        lang?: string;
      }> = ({ onImportEntries, lang }) => (
        <div data-testid="mock-import-source">
          <span>Lang: {lang}</span>
          <button
            type="button"
            data-testid="mock-import-trigger"
            onClick={() =>
              onImportEntries?.([
                {
                  id: 'imported_1',
                  subject: '通用技术',
                  class_name: '高一1班',
                  day_of_week: '2',
                  period: '3',
                },
              ])
            }
          >
            Import Test Entries
          </button>
        </div>
      );

      usePluginHostStore.getState().registerExtensionPoint('timetable.import.source', {
        id: 'test-import-source-ext',
        label: '学校教务系统导入',
        pluginId: 'prov_school_system',
        component: createLazyComponent(MockImportSourcePlugin),
      });

      const host = new FrontendPluginHost();

      const ocrProps: TimetableOcrViewProps = {
        lang: 'zh',
        ocrProviderId: '',
        setOcrProviderId: vi.fn(),
        aiProviders: [{ id: 'p1', name: 'DeepSeek', model_name: 'v3' }],
        ocrFileInputRef: { current: null },
        handleOcrDrop: vi.fn(),
        handleOcrImageSelect: vi.fn(),
        ocrImagePreview: null,
        setOcrImagePreview: vi.fn(),
        setOcrImageBase64: vi.fn(),
        setOcrEntries: setOcrEntriesMock,
        setOcrMessage: vi.fn(),
        setOcrSelectedEntries: setOcrSelectedEntriesMock,
        ocrImageBase64: null,
        ocrLoading: false,
        handleOcrRecognize: vi.fn().mockResolvedValue(undefined),
        ocrProgressStatus: '',
        ocrProgress: 0,
        ocrMessage: null,
        ocrEntries: [],
        ocrSelectedEntries: new Set(),
        toggleAllOcrEntries: vi.fn(),
        toggleOcrEntry: vi.fn(),
        dayNames: { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 0: '周日' },
        findMatchedClass: vi.fn(),
        handleOcrImport: vi.fn().mockResolvedValue(undefined),
        ocrImporting: false,
      };

      render(
        <PluginHostProvider host={host}>
          <TimetableOcrView {...ocrProps} />
        </PluginHostProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('mock-import-source')).toBeTruthy();
      });

      expect(screen.getByText('Lang: zh')).toBeTruthy();

      const importBtn = screen.getByTestId('mock-import-trigger');
      fireEvent.click(importBtn);

      expect(setOcrEntriesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'imported_1',
            subject: '通用技术',
          }),
        ]),
      );
      expect(setOcrSelectedEntriesMock).toHaveBeenCalled();
    });
  });

  describe('timetable.entry.action slot', () => {
    it('renders timetable.entry.action extension in calendar grid and list view', async () => {
      let capturedProps: any = null;

      const MockEntryActionPlugin: React.FC<{
        schedule?: ScheduleType;
        lang?: string;
        onEdit?: () => void;
      }> = (props) => {
        capturedProps = props;
        return (
          <div data-testid={`mock-entry-action-${props.schedule?.id}`}>
            <button type="button" onClick={() => props.onEdit?.()}>
              Quick Sync {props.schedule?.lesson_title}
            </button>
          </div>
        );
      };

      usePluginHostStore.getState().registerExtensionPoint('timetable.entry.action', {
        id: 'test-entry-action-ext',
        label: '条目同步',
        pluginId: 'ext_timetable_sync',
        component: createLazyComponent(MockEntryActionPlugin),
      });

      const host = new FrontendPluginHost();
      const openEditModalMock = vi.fn();

      const calendarProps: TimetableCalendarViewProps = {
        lang: 'zh',
        viewMode: 'list',
        setViewMode: vi.fn(),
        selectedClassId: 'all',
        setSelectedClassId: vi.fn(),
        statusFilter: 'all',
        setStatusFilter: vi.fn(),
        searchQuery: '',
        setSearchQuery: vi.fn(),
        classes: [{ id: 'class_1', name: '高一1班' }],
        getClassDisplayName: (n: string) => n,
        loading: false,
        filteredSchedules: [mockSchedule],
        currentWeekMonday: new Date('2026-10-12T00:00:00Z'),
        setCurrentWeekMonday: vi.fn(),
        showWeekend: false,
        setShowWeekend: vi.fn(),
        dateOverrides: {},
        setDateOverrides: vi.fn(),
        setOverridingDateKey: vi.fn(),
        setOverrideMode: vi.fn(),
        setOverrideTargetDow: vi.fn(),
        setOverrideTargetDate: vi.fn(),
        openEditModal: openEditModalMock,
        handleDeleteSchedule: vi.fn().mockResolvedValue(undefined),
        getDayOfWeekIndex: vi.fn().mockReturnValue(1),
        getMonday: (d: Date) => d,
        getWeekRangeString: () => '10.12 - 10.18',
        setFormClassId: vi.fn(),
        setFormLessonId: vi.fn(),
        setFormDate: vi.fn(),
        setFormStatus: vi.fn(),
        setFormNotes: vi.fn(),
        setIsAddOpen: vi.fn(),
      };

      render(
        <PluginHostProvider host={host}>
          <TimetableCalendarView {...calendarProps} />
        </PluginHostProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('mock-entry-action-sch_1')).toBeTruthy();
      });

      expect(screen.getByText('Quick Sync 算法初步')).toBeTruthy();
      expect(capturedProps).not.toBeNull();
      expect(capturedProps.schedule?.id).toBe('sch_1');
      expect(capturedProps.lang).toBe('zh');

      const btn = screen.getByText('Quick Sync 算法初步');
      fireEvent.click(btn);
      expect(openEditModalMock).toHaveBeenCalledWith(mockSchedule);
    });
  });
});
