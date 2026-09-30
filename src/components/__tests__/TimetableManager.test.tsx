import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TimetableManager } from '../TimetableManager';
import type { ClassType, LessonType } from '../timetable/types';

describe('TimetableManager Component', () => {
  const mockClasses: ClassType[] = [
    { id: 'c1', name: '高一(1)班', description: '重点班' },
    { id: 'c2', name: '高一(2)班', description: '普通班' },
  ];

  const mockLessons: LessonType[] = [
    { id: 'l1', title: '高等数学第1讲' },
    { id: 'l2', title: '大学物理实验' },
  ];

  const mockSchedules = [
    {
      id: 'sch-1',
      class_id: 'c1',
      lesson_id: 'l1',
      scheduled_date: '2026-10-01',
      time_slot: '09:00 - 10:30',
      status: 'scheduled',
      lesson_title: '高等数学第1讲',
      class_name: '高一(1)班',
    },
    {
      id: 'sch-2',
      class_id: 'c2',
      lesson_id: 'l2',
      scheduled_date: '2026-10-02',
      time_slot: '14:00 - 15:30',
      status: 'cancelled',
      lesson_title: '大学物理实验',
      class_name: '高一(2)班',
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/ai-providers')) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: 'p1', name: 'OpenAI Provider' }],
          });
        }
        if (url.includes('/api/schedules') || url.includes('/schedules')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockSchedules,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the header title and default calendar tab in Chinese', async () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('班级课表中心 & 动态调整')).toBeTruthy();
    expect(screen.getByText(/统一管理日常排课/)).toBeTruthy();

    // Verify all 4 tabs are present
    expect(screen.getByRole('button', { name: /🗓️ 课表看板/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /🛠️ 临时调休调课/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /📥 快速导入导出/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /📷 AI 图片识课/ })).toBeTruthy();

    // Default tab should render calendar view elements
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
  });

  it('renders the header title in English when lang is en', () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="en"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('Timetable Center & Adjustments')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Schedule Grid/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Holiday Adjusts/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import \/ Export/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /AI Image OCR/ })).toBeTruthy();
  });

  it('switches between tabs cleanly', async () => {
    render(
      <TimetableManager
        classes={mockClasses}
        lessons={mockLessons}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    // 1. Switch to Holiday Adjusts tab
    const adjustTabBtn = screen.getByRole('button', { name: /🛠️ 临时调休调课/ });
    fireEvent.click(adjustTabBtn);

    expect(screen.getByText('批量节假日调休排班')).toBeTruthy();
    expect(screen.getByText('一键更新该周期课表')).toBeTruthy();

    // 2. Switch to Import / Export tab
    const importExportTabBtn = screen.getByRole('button', { name: /📥 快速导入导出/ });
    fireEvent.click(importExportTabBtn);

    expect(screen.getByText('导出系统课表')).toBeTruthy();
    expect(screen.getByText('导出为 Excel CSV')).toBeTruthy();

    // 3. Switch to OCR tab
    const ocrTabBtn = screen.getByRole('button', { name: /📷 AI 图片识课/ });
    fireEvent.click(ocrTabBtn);

    expect(screen.getByText('第一步：上传课表图片')).toBeTruthy();
    expect(screen.getByText('AI 识别引擎')).toBeTruthy();

    // 4. Switch back to View tab
    const viewTabBtn = screen.getByRole('button', { name: /🗓️ 课表看板/ });
    fireEvent.click(viewTabBtn);

    // Verify calendar view is active again
    expect(screen.queryByText('第一步：上传课表图片')).toBeNull();
    expect(screen.queryByText('批量节假日调休排班')).toBeNull();
  });

  it('renders gracefully when classes and schedules are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        })
      )
    );

    render(
      <TimetableManager
        classes={[]}
        lessons={[]}
        lang="zh"
        onSchedulesUpdated={vi.fn()}
      />
    );

    expect(screen.getByText('班级课表中心 & 动态调整')).toBeTruthy();
    expect(screen.getByRole('button', { name: /🗓️ 课表看板/ })).toBeTruthy();
  });
});
