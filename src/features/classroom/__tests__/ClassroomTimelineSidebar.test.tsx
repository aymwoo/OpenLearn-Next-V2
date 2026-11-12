import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassroomTimelineSidebar, stripHtml, type TimelineSegmentItem } from '../ClassroomTimelineSidebar';
import type { WhiteboardPageItem } from '../../whiteboard/InteractiveWhiteboard';

// Mock ExtensionPointRenderer to avoid complex plugin-host dependencies
vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="extension-point-renderer" />,
}));

describe('ClassroomTimelineSidebar', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockSegments: TimelineSegmentItem[] = [
    { id: 'seg-1', title: '环节一：热身导入', duration: '5m', notes: '<p>热身练习</p>' },
    { id: 'seg-2', title: '环节二：算法实战', duration: '15m', notes: '实战演练' },
  ];

  const mockPages: WhiteboardPageItem[] = [
    { id: 'page-1', title: '导入页', segmentId: 'seg-1', order: 0 },
    { id: 'page-2', title: '实战页', segmentId: 'seg-2', order: 1 },
  ];

  const defaultProps = {
    timelineSegments: mockSegments,
    activeSegmentId: 'seg-1',
    whiteboardPages: mockPages,
    currentWhiteboardPage: 0,
    expandedSegmentMap: { 'seg-1': true, 'seg-2': false },
    elements: [{ id: 'el-1', data: JSON.stringify({ page: 0 }) }],
    selectedLesson: 'lesson-101',
    lang: 'zh',
    onToggleAllSegments: vi.fn(),
    onToggleSegmentExpand: vi.fn(),
    onAddPage: vi.fn(),
    onCollapse: vi.fn(),
    onSelectPage: vi.fn(),
    onStartSegment: vi.fn(),
    getPagesForSegment: vi.fn((seg: TimelineSegmentItem) => {
      if (seg.id === 'seg-1') return [{ page: mockPages[0], globalIdx: 0 }];
      if (seg.id === 'seg-2') return [{ page: mockPages[1], globalIdx: 1 }];
      return [];
    }),
  };

  it('正确渲染环节与白板页面信息', () => {
    render(<ClassroomTimelineSidebar {...defaultProps} />);
    expect(screen.getByText('教学环节进度表')).toBeTruthy();
    expect(screen.getByText(/2 环节/)).toBeTruthy();
    expect(screen.getByText(/2 页面/)).toBeTruthy();
    expect(screen.getByText('环节一：热身导入')).toBeTruthy();
    expect(screen.getByText('环节二：算法实战')).toBeTruthy();
    // 激活的环节显示“演示中”
    expect(screen.getByText('演示中')).toBeTruthy();
  });

  it('点击展开/折叠与全部折叠按钮触发对应回调', () => {
    const onToggleAllSegments = vi.fn();
    const onToggleSegmentExpand = vi.fn();
    render(
      <ClassroomTimelineSidebar
        {...defaultProps}
        onToggleAllSegments={onToggleAllSegments}
        onToggleSegmentExpand={onToggleSegmentExpand}
      />,
    );

    const toggleAllBtn = screen.getByTitle('全部展开/折叠抽屉');
    fireEvent.click(toggleAllBtn);
    expect(onToggleAllSegments).toHaveBeenCalledTimes(1);

    // 点击环节二卡片
    const seg2Title = screen.getByText('环节二：算法实战');
    fireEvent.click(seg2Title);
    expect(onToggleSegmentExpand).toHaveBeenCalledWith('seg-2');
  });

  it('点击加页与收起边栏触发相应回调', () => {
    const onAddPage = vi.fn();
    const onCollapse = vi.fn();
    render(<ClassroomTimelineSidebar {...defaultProps} onAddPage={onAddPage} onCollapse={onCollapse} />);

    const addPageBtn = screen.getByTitle('新建白板页面');
    fireEvent.click(addPageBtn);
    expect(onAddPage).toHaveBeenCalledTimes(1);

    const collapseBtn = screen.getByTitle('收起边栏以扩大白板视野');
    fireEvent.click(collapseBtn);
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('点击白板页面大纲中的页面切换页面', () => {
    const onSelectPage = vi.fn();
    render(<ClassroomTimelineSidebar {...defaultProps} onSelectPage={onSelectPage} />);

    // seg-1 是展开的，大纲中包含导入页 (P1)
    const pageItem = screen.getByText('导入页');
    fireEvent.click(pageItem);
    expect(onSelectPage).toHaveBeenCalledWith(0, 'seg-1');
  });

  it('点击非激活环节的广播按钮触发 onStartSegment', () => {
    const onStartSegment = vi.fn();
    render(<ClassroomTimelineSidebar {...defaultProps} onStartSegment={onStartSegment} />);

    // seg-2 未激活，应该有广播按钮
    const broadcastBtn = screen.getByTitle('广播此环节');
    fireEvent.click(broadcastBtn);
    expect(onStartSegment).toHaveBeenCalledWith(mockSegments[1]);
  });

  it('未选择课节时展示引导文案', () => {
    render(<ClassroomTimelineSidebar {...defaultProps} selectedLesson={null} />);
    expect(screen.getByText('请选择一个课节加载流程表')).toBeTruthy();
  });

  describe('stripHtml 工具函数', () => {
    it('清除 HTML 标签并格式化空白', () => {
      expect(stripHtml('<p>Hello <b>World</b>&nbsp;!</p>')).toBe('Hello World !');
      expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>');
      expect(stripHtml('')).toBe('');
      expect(stripHtml(undefined)).toBe('');
    });
  });
});
