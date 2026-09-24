import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GroupCollabWhiteboardModal } from '../GroupCollabWhiteboardModal';

afterEach(cleanup);

const students = [
  { id: 'stu-1', name: '张子豪' },
  { id: 'stu-2', name: '李晓彤' },
  { id: 'stu-3', name: '王一诺' },
  { id: 'stu-4', name: '赵梓涵' },
];

const noopToast = vi.fn();

function renderModal(overrides: Partial<React.ComponentProps<typeof GroupCollabWhiteboardModal>> = {}) {
  return render(
    <GroupCollabWhiteboardModal
      isOpen={true}
      onClose={noopToast}
      lessonId="les-1"
      classId="cls-1"
      availableStudents={students}
      addToast={noopToast}
      {...overrides}
    />,
  );
}

describe('GroupCollabWhiteboardModal', () => {
  it('关闭时不渲染', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('打开时初始化 4 个默认小组 + 白板画布', () => {
    renderModal();
    expect(screen.getByText('第 1 小组')).toBeTruthy();
    expect(screen.getByText('第 4 小组')).toBeTruthy();
    // SVG 画布存在
    expect(document.querySelector('svg')).toBeTruthy();
  });

  it('新建小组追加到列表', () => {
    renderModal();
    const addButton = screen.getByTitle('新建小组');
    fireEvent.click(addButton);
    expect(screen.getByText('第 5 小组')).toBeTruthy();
  });

  it('删除小组从列表移除', () => {
    renderModal();
    const removeButtons = screen.getAllByTitle('删除');
    // 删除第一个小组（第 1 小组）
    fireEvent.click(removeButtons[0]);
    expect(screen.queryByText('第 1 小组')).toBeNull();
    expect(screen.getByText('第 4 小组')).toBeTruthy();
  });

  it('一键自动分配把学生分到各组', () => {
    renderModal();
    fireEvent.click(screen.getByText('一键自动分配'));
    // 4 位学生均被分配（不再出现「未分配成员」×4）
    const unassignedCount = screen.queryAllByText('未分配成员').length;
    expect(unassignedCount).toBeLessThan(4);
    expect(noopToast).toHaveBeenCalledWith(expect.stringContaining('自动分配'), expect.any(String), 'success');
  });

  it('切换「查看全部」按钮状态', () => {
    renderModal();
    expect(screen.getByText('仅当前')).toBeTruthy();
    fireEvent.click(screen.getByText('仅当前'));
    expect(screen.getByText('查看全部')).toBeTruthy();
  });

  it('工具栏包含笔/矩形/圆形/橡皮', () => {
    renderModal();
    expect(screen.getByTitle('笔')).toBeTruthy();
    expect(screen.getByTitle('矩形')).toBeTruthy();
    expect(screen.getByTitle('圆形')).toBeTruthy();
    expect(screen.getByTitle('橡皮')).toBeTruthy();
  });

  it('切换工具后点击该工具为激活态', () => {
    renderModal();
    const rectBtn = screen.getByTitle('矩形');
    fireEvent.click(rectBtn);
    expect(rectBtn.className).toContain('bg-primary-theme');
  });
});
