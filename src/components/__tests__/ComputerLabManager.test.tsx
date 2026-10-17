import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
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
      if (url.startsWith('/api/classes') && !url.includes('/seats') && !url.includes('/students')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: mockClasses, total: mockClasses.length, page: 1, pageSize: 50 }),
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

describe('ComputerLabManager (拖拽调座与交换逻辑)', () => {
  const mockLabs = [
    { id: 'lab_1', room_number: '305综合机房', rows: 2, cols: 3, created_at: 1000 },
  ];

  const mockClasses = [{ id: 'class_1', name: '高一(1)班', lab_id: 'lab_1' }];

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

  const makeDataTransfer = () =>
    ({
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      dropEffect: '',
      effectAllowed: '',
    }) as any;

  const seatEl = (container: HTMLElement, id: string) =>
    container.querySelector(`[data-seat-id="${id}"]`) as HTMLElement;

  beforeEach(() => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/classes') && !url.includes('/seats') && !url.includes('/students')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: mockClasses, total: mockClasses.length, page: 1, pageSize: 50 }),
        });
      }
      if (url === '/api/classes/class_1/seats') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ lab_id: 'lab_1', seats: mockSeats }),
        });
      }
      if (url === '/api/classes/class_1/students') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStudents) });
      }
      if (url.includes('/api/classes/') && url.includes('/seats') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = fetchMock as any;
    window.fetch = fetchMock as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** 前置：通过点击把李明排到 0_1，形成「张小华@0_0、李明@0_1」的双占用局面 */
  async function setupTwoSeated(container: HTMLElement) {
    const q = within(container);
    await waitFor(() => {
      expect(q.getAllByText('张小华').length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(container.querySelector('[data-unassigned-id="st_2"] button')!);
    fireEvent.click(seatEl(container, '0_1'));
    await waitFor(() => {
      expect(seatEl(container, '0_1').textContent).toContain('李明');
    });
  }

  it('点击式安排：拿起已入座学生放到有人座位时两人交换，无人被挤到未排座列表', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />,
    );

    await setupTwoSeated(container);

    // 拿起 0_0 的张小华
    fireEvent.click(seatEl(container, '0_0'));
    // 放到 0_1（已被李明占用）→ 交换
    fireEvent.click(seatEl(container, '0_1'));

    await waitFor(() => {
      expect(seatEl(container, '0_0').textContent).toContain('李明');
      expect(seatEl(container, '0_1').textContent).toContain('张小华');
    });

    // 交换后未排座池只剩王敏（1 人未排），没有人被挤出去
    expect(within(container).getAllByText(/1 人未排/).length).toBeGreaterThanOrEqual(1);
    expect(within(container).getAllByText('王敏').length).toBeGreaterThanOrEqual(1);
  });

  it('拖拽已入座学生到有人座位可交换，并置 isDirty 后保存持久化交换结果', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />,
    );

    await setupTwoSeated(container);

    // 把 0_0 的张小华拖到 0_1（李明）→ 交换
    const dt = makeDataTransfer();
    fireEvent.dragStart(seatEl(container, '0_0'), { dataTransfer: dt });
    fireEvent.dragOver(seatEl(container, '0_1'), { dataTransfer: dt });
    fireEvent.drop(seatEl(container, '0_1'), { dataTransfer: dt });
    fireEvent.dragEnd(seatEl(container, '0_0'), { dataTransfer: dt });

    await waitFor(() => {
      expect(seatEl(container, '0_0').textContent).toContain('李明');
      expect(seatEl(container, '0_1').textContent).toContain('张小华');
    });
    expect(within(container).getAllByText(/1 人未排/).length).toBeGreaterThanOrEqual(1);

    // 保存持久化：李明(st_2) 应落在 0_0
    fireEvent.click(within(container).getByText(/保存排座/).closest('button')!);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/classes/class_1/seats',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"student_id":"st_2","row_idx":0,"col_idx":0'),
        }),
      );
    });
  });

  it('从未排座列表拖到有人座位可入座，原占位者回到未排座列表', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />,
    );

    const q = within(container);
    await waitFor(() => {
      expect(q.getAllByText('张小华').length).toBeGreaterThanOrEqual(1);
    });

    // 把未排座的李明拖到 0_0（张小华）
    const liMingChip = container.querySelector('[data-unassigned-id="st_2"] button')!;
    const dt = makeDataTransfer();
    fireEvent.dragStart(liMingChip, { dataTransfer: dt });
    fireEvent.dragOver(seatEl(container, '0_0'), { dataTransfer: dt });
    fireEvent.drop(seatEl(container, '0_0'), { dataTransfer: dt });
    fireEvent.dragEnd(liMingChip, { dataTransfer: dt });

    await waitFor(() => {
      expect(seatEl(container, '0_0').textContent).toContain('李明');
    });

    // 张小华回到未排座池（池内变为 张小华 + 王敏）
    expect(q.getAllByText(/2 人未排/).length).toBeGreaterThanOrEqual(1);
    expect(q.getAllByText('张小华').length).toBeGreaterThanOrEqual(1);
  });

  it('拖回原座位或拖到自身不产生任何变化', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <ComputerLabManager computerLabs={mockLabs} onRefresh={onRefresh} lang="zh" classes={mockClasses} />,
    );

    await setupTwoSeated(container);

    // 拖 0_0 的张小华放回 0_0 → 无变化
    const dt = makeDataTransfer();
    fireEvent.dragStart(seatEl(container, '0_0'), { dataTransfer: dt });
    fireEvent.drop(seatEl(container, '0_0'), { dataTransfer: dt });
    fireEvent.dragEnd(seatEl(container, '0_0'), { dataTransfer: dt });

    await waitFor(() => {
      expect(seatEl(container, '0_0').textContent).toContain('张小华');
      expect(seatEl(container, '0_1').textContent).toContain('李明');
    });
  });
});
