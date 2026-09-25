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

  it('支持切换至同质分层策略并执行自动分配', () => {
    renderModal();
    const homoBtn = screen.getByTitle('同质分层探讨');
    fireEvent.click(homoBtn);
    fireEvent.click(screen.getByText('一键自动分配'));
    expect(noopToast).toHaveBeenCalledWith(
      expect.stringContaining('自动分配完成'),
      expect.stringContaining('同质分层探讨'),
      'success',
    );
  });

  it('支持一键切入「画廊互评大屏并览 (Gallery Walk)」模式', () => {
    renderModal();
    const galleryToggle = screen.getByText('画廊互评大屏并览 (Gallery Walk)');
    fireEvent.click(galleryToggle);

    // 大屏并览标题出现
    expect(screen.getByText('全班小组探究画廊展台')).toBeTruthy();
    expect(screen.getByText('返回单组画布')).toBeTruthy();
  });

  it('画廊模式下支持为小组送花点赞与思辨标签点选及置顶高光', () => {
    renderModal();
    // 切换到画廊模式
    fireEvent.click(screen.getByText('画廊互评大屏并览 (Gallery Walk)'));

    // 1. 测试送花
    const likeButtons = screen.getAllByText(/送花赞赏/);
    fireEvent.click(likeButtons[0]);
    expect(noopToast).toHaveBeenCalledWith(
      expect.stringContaining('送花点赞成功'),
      expect.stringContaining('鲜花'),
      'success',
    );

    // 2. 测试思辨标签点选
    const inquiryTagBtn = screen.getAllByText('+ 思路新颖')[0];
    fireEvent.click(inquiryTagBtn);
    expect(screen.getAllByText('✓ 思路新颖').length).toBeGreaterThanOrEqual(1);

    // 3. 测试置顶高光
    const spotlightBtn = screen.getAllByTitle('设为全班高光')[0];
    fireEvent.click(spotlightBtn);
    expect(screen.getByText('🌟 置顶高光')).toBeTruthy();
  });
});
