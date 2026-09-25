import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ComputerLabManager } from '../ComputerLabManager';

describe('ComputerLabManager (Unified Computer Lab Seating)', () => {
  const mockLabs = [
    {
      id: 'lab_1',
      room_number: '305综合机房',
      rows: 2,
      cols: 3,
      created_at: 1000,
    },
    {
      id: 'lab_2',
      room_number: '402编程实验室',
      rows: 3,
      cols: 4,
      created_at: 2000,
    },
  ];

  const mockClasses = [
    {
      id: 'class_1',
      name: '高一(1)班',
      lab_id: 'lab_1',
    },
    {
      id: 'class_2',
      name: '高一(2)班',
      lab_id: null,
    },
  ];

  const mockStudents = [
    { id: 'st_1', name: '张小华', student_number: '20260101' },
    { id: 'st_2', name: '李明', student_number: '20260102' },
    { id: 'st_3', name: '王敏', student_number: '20260103' },
  ];

  const mockSeats = [
    {
      class_id: 'class_1',
      student_id: 'st_1',
      lab_id: 'lab_1',
      row_idx: 0,
      col_idx: 0,
      student_name: '张小华',
      student_number: '20260101',
    },
  ];

  beforeEach(() => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/classes') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockClasses),
        });
      }
      if (url === '/api/classes/class_1/seats') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ lab_id: 'lab_1', seats: mockSeats }),
        });
      }
      if (url === '/api/classes/class_1/students') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStudents),
        });
      }
      if (url === '/api/classes/class_2/seats') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ lab_id: null, seats: [] }),
        });
      }
      if (url === '/api/classes/class_2/students') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStudents),
        });
      }
      if (url.includes('/api/classes/') && url.includes('/seats') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
    global.fetch = fetchMock as any;
    window.fetch = fetchMock as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders lab list and automatically detects associated bound classes', async () => {
    const onRefresh = vi.fn();
    render(<ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />);

    expect(screen.getByText('统一机房座位管理')).toBeTruthy();
    expect(screen.getByText('305综合机房')).toBeTruthy();
    expect(screen.getByText('402编程实验室')).toBeTruthy();
  });

  it('loads real student seats and unassigned students from system tables for selected class', async () => {
    const onRefresh = vi.fn();
    render(<ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />);

    await waitFor(() => {
      expect(screen.getAllByText('张小华').length).toBeGreaterThanOrEqual(1);
    });

    // Student st_1 is at row 0, col 0, so student number should be displayed
    expect(screen.getAllByText('20260101').length).toBeGreaterThanOrEqual(1);

    // Students st_2 and st_3 should be in the unassigned pool
    expect(screen.getAllByText('李明').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('王敏').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/2 人未排/).length).toBeGreaterThanOrEqual(1);
  });

  it('supports interactive student placement into an empty seat', async () => {
    const onRefresh = vi.fn();
    render(<ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />);

    await waitFor(() => {
      expect(screen.getAllByText('李明').length).toBeGreaterThanOrEqual(1);
    });

    // Click on unassigned student "李明"
    const liMingBtn = screen.getAllByText('李明')[0].closest('button');
    expect(liMingBtn).toBeTruthy();
    fireEvent.click(liMingBtn!);

    // Prompt indicating student is selected
    expect(screen.getByText(/当前选择: 李明/)).toBeTruthy();

    // Click on empty seat 0-1 (Row 1 Col 2)
    const emptySeat01 = screen.getAllByText('1-2')[0].closest('div');
    expect(emptySeat01).toBeTruthy();
    fireEvent.click(emptySeat01!);

    // Now 李明 is placed in that seat!
    await waitFor(() => {
      expect(screen.getAllByText('李明').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('supports "一键排座" auto-assign for unplaced students', async () => {
    const onRefresh = vi.fn();
    render(<ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />);

    await waitFor(() => {
      expect(screen.getAllByText('一键排座').length).toBeGreaterThanOrEqual(1);
    });

    // Click auto fill button
    const autoFillBtn = screen.getAllByText('一键排座')[0].closest('button')!;
    fireEvent.click(autoFillBtn);

    // After auto fill, both 李明 and 王敏 should be placed in seats, so unassigned count is 0
    await waitFor(() => {
      expect(screen.getByText('当前班级全部学生均已成功分配机位！')).toBeTruthy();
    });
  });

  it('saves updated seating assignments to existing student_seats table via POST /api/classes/:classId/seats', async () => {
    const onRefresh = vi.fn();
    render(<ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />);

    await waitFor(() => {
      expect(screen.getAllByText('一键排座').length).toBeGreaterThanOrEqual(1);
    });

    // Auto-assign to trigger dirty state
    fireEvent.click(screen.getAllByText('一键排座')[0].closest('button')!);

    // Click Save button
    await waitFor(() => {
      expect(screen.getByText(/保存排座/)).toBeTruthy();
    });
    const saveBtn = screen.getByText(/保存排座/).closest('button')!;
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/classes/class_1/seats',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"lab_id":"lab_1"'),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/统一机房排座已成功持久化至系统 student_seats 数据表/)).toBeTruthy();
    });
  });
});
