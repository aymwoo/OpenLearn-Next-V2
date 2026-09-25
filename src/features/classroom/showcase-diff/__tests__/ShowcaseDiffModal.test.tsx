import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ShowcaseDiffModal } from '../ShowcaseDiffModal';

afterEach(cleanup);

const mockStudents = [
  { id: 'stu-1', name: '张子豪', seatNumber: 'A-01' },
  { id: 'stu-2', name: '李晓彤', seatNumber: 'A-02' },
  { id: 'stu-3', name: '王一诺', seatNumber: 'B-03' },
  { id: 'stu-4', name: '赵梓涵', seatNumber: 'B-04' },
];

const noopToast = vi.fn();
const mockSync = vi.fn();

function renderModal(overrides: Partial<React.ComponentProps<typeof ShowcaseDiffModal>> = {}) {
  return render(
    <ShowcaseDiffModal
      isOpen={true}
      onClose={vi.fn()}
      lessonTitle="高中物理探究：变力做功与动能定理"
      availableStudents={mockStudents}
      addToast={noopToast}
      onSyncToClass={mockSync}
      {...overrides}
    />,
  );
}

describe('ShowcaseDiffModal (Showcase & Dual-Screen Diff)', () => {
  it('当 isOpen 为 false 时不渲染任何 DOM', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('默认打开时呈现 2-Screen Dual 双屏对比与标题', () => {
    renderModal();
    expect(screen.getByText('优秀作业 / 屏幕一键多屏对比投屏批注')).toBeTruthy();
    expect(screen.getByText('2-Screen Dual')).toBeTruthy();

    // 默认展示两位学生作答
    expect(screen.getAllByText('张子豪').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('李晓彤').length).toBeGreaterThanOrEqual(1);
  });

  it('支持打开选人抽屉，并呈现学生作答候选池', () => {
    renderModal();
    const drawerBtn = screen.getByText(/勾选对比/);
    fireEvent.click(drawerBtn);

    const drawer = screen.getByTestId('student-candidate-drawer');
    expect(drawer).toBeTruthy();
    expect(within(drawer).getByText('学生作答候选池')).toBeTruthy();
  });

  it('支持在候选池中增选学生，自适应切换至 3-Screen Triple 与 4-Screen Quad', () => {
    renderModal();
    // 打开抽屉
    fireEvent.click(screen.getByText(/勾选对比/));
    const drawer = screen.getByTestId('student-candidate-drawer');

    // 勾选第 3 位学生（王一诺）
    const studentCard3 = within(drawer).getByText('王一诺');
    fireEvent.click(studentCard3);

    // 验证自适应切换为 3-Screen Triple
    expect(screen.getByText('3-Screen Triple')).toBeTruthy();
    expect(screen.getAllByText('王一诺').length).toBeGreaterThanOrEqual(1);

    // 勾选第 4 位学生（赵梓涵）
    const studentCard4 = within(drawer).getByText('赵梓涵');
    fireEvent.click(studentCard4);

    // 验证自适应切换为 4-Screen Quad
    expect(screen.getByText('4-Screen Quad')).toBeTruthy();
    expect(screen.getAllByText('赵梓涵').length).toBeGreaterThanOrEqual(1);
  });

  it('限制对比人数下限不少于 2 人，上限不超过 4 人', () => {
    renderModal();
    fireEvent.click(screen.getByText(/勾选对比/));
    const drawer = screen.getByTestId('student-candidate-drawer');

    // 尝试取消张子豪，此时只有 2 人，应阻止并提示
    const studentCard1 = within(drawer).getByText('张子豪');
    fireEvent.click(studentCard1);
    expect(noopToast).toHaveBeenCalledWith('提示', expect.stringContaining('至少保留 2 位学生'), 'info');
  });

  it('快捷预设模式：典范 vs 错解 快速对比', () => {
    renderModal();
    fireEvent.click(screen.getByText(/勾选对比/));
    const drawer = screen.getByTestId('student-candidate-drawer');

    const presetBtn = within(drawer).getByText('🎯 典范 vs 错解');
    fireEvent.click(presetBtn);

    expect(noopToast).toHaveBeenCalledWith('对比模式更新', expect.stringContaining('规范典范 vs 典型思维死角'), 'success');
  });

  it('支持一键开启匿名脱敏模式（脱敏为「作答方案 A/B...」）', () => {
    renderModal();
    const anonBtn = screen.getByTitle(/匿名脱敏模式/);
    fireEvent.click(anonBtn);

    // 学生姓名脱敏
    expect(screen.getByText('作答方案 A')).toBeTruthy();
    expect(screen.getByText('作答方案 B')).toBeTruthy();
    expect(screen.queryByText('A-01')).toBeNull(); // 座位号隐藏
  });

  it('批注工具栏状态切换（激光笔、荧光笔、批注笔、印章）', () => {
    renderModal();

    const laserBtn = screen.getByTitle(/动态激光笔/);
    fireEvent.click(laserBtn);
    expect(laserBtn.className).toContain('bg-red-500');

    const highlighterBtn = screen.getByTitle(/荧光笔/);
    fireEvent.click(highlighterBtn);
    expect(highlighterBtn.className).toContain('bg-amber-400');

    const penBtn = screen.getByTitle(/细线批注笔/);
    fireEvent.click(penBtn);
    expect(penBtn.className).toContain('bg-purple-600');
  });

  it('在覆盖画布上加盖思维印章与清空批注', () => {
    renderModal();

    // 选中「⚠️ 典型思维死角」印章
    const stampBtn = screen.getByTitle(/典型思维死角/);
    fireEvent.click(stampBtn);

    // 在批注图层上点击加盖印章
    const overlay = screen.getByTestId('diff-annotation-overlay');
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 200 });

    // 印章已渲染（工具栏 1 个 + 画布上 1 个）
    expect(screen.getAllByText('思维死角').length).toBe(2);

    // 测试清空批注
    const clearBtn = screen.getByText('清空批注');
    fireEvent.click(clearBtn);
    expect(screen.getAllByText('思维死角').length).toBe(1);
    expect(noopToast).toHaveBeenCalledWith('清空完毕', expect.stringContaining('已清除所有覆盖批注'), 'info');
  });

  it('支持一键同步广播至全班学生机', () => {
    renderModal();

    const broadcastBtn = screen.getByText('同步广播至全班');
    fireEvent.click(broadcastBtn);

    expect(mockSync).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining(['stu-1', 'stu-2']),
        layout: 'dual',
      }),
    );
    expect(noopToast).toHaveBeenCalledWith(
      expect.stringContaining('大屏同步已下发'),
      expect.stringContaining('推送到全班学生机'),
      'success',
    );
  });
});
